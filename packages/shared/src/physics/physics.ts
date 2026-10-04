import type * as RapierModule from '@dimforge/rapier3d-deterministic-compat';
import { SIM } from '../constants';
import type { Quat, Terrain, Vec3, WorldLayout } from '../atlas/types';

/**
 * Physics: one Rapier world per page, built from the same `WorldLayout` the renderer draws,
 * so what you see is what you hit. All Rapier calls live in this module, so the engine can
 * be swapped (e.g. for Box3D) without touching game code.
 *
 * We use Rapier's official *deterministic* build: the same inputs give bit-identical results
 * on every machine and browser, which keeps server re-checks and replays possible later.
 */

type Rapier = typeof RapierModule;
let RAPIER: Rapier | null = null;
let ready: Promise<void> | null = null;

/**
 * Loads Rapier and its WebAssembly. Safe to call many times; every `PhysicsWorld` needs it
 * done first. Loaded on demand (not imported up front) so the browser fetches the ~1.7 MB
 * engine as its own file, in parallel with the first article, and caches it separately.
 */
export function initPhysics(): Promise<void> {
  return (ready ??= import('@dimforge/rapier3d-deterministic-compat').then(async (m) => {
    const lib = (m.default ?? m) as Rapier;
    await lib.init();
    RAPIER = lib;
  }));
}

function rapier(): Rapier {
  if (!RAPIER) throw new Error('Physics not loaded: await initPhysics() first');
  return RAPIER;
}

/**
 * Collision groups (Rapier packs "what I am" in the upper 16 bits and "what I touch" in the
 * lower 16). Queries use them to look at the ground alone, or at the props alone.
 */
const GROUND = 0x0001;
const PROPS = 0x0002;
const MOVERS = 0x0004;
const groups = (member: number, touches: number) => ((member << 16) | touches) >>> 0;
const ALL = 0xffff;

/** A solid box as the physics engine holds it (read back from Rapier, for the debug view). */
export interface ColliderBox {
  center: Vec3;
  half: Vec3;
  rot: Quat;
}

export interface RayHit {
  /** Distance along the ray (m). */
  distance: number;
  point: Vec3;
  normal: Vec3;
}

/** A moving body (test balls today; pods in Phase 2B). */
export interface Ball {
  readonly radius: number;
  position(): Vec3;
  velocity(): Vec3;
  setVelocity(v: Vec3): void;
  /** 1 = normal gravity, 0 = floats. */
  setGravityScale(s: number): void;
}

export type RayFilter = 'all' | 'ground' | 'props';

const v3 = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];

export class PhysicsWorld {
  /** Seconds per step: the Heartbeat's fixed rate. */
  static readonly STEP = 1 / SIM.tickHz;

  private readonly R = rapier();
  private readonly world: RapierModule.World;
  private readonly boxes: RapierModule.Collider[] = [];
  private readonly balls = new Map<Ball, RapierModule.RigidBody>();
  private disposed = false;

  /** Builds the physics for one page (loading Rapier first if needed). */
  static async create(layout: WorldLayout): Promise<PhysicsWorld> {
    await initPhysics();
    return new PhysicsWorld(layout);
  }

  /** Call `initPhysics()` (and await it) before constructing directly; throws otherwise. */
  constructor(layout: WorldLayout) {
    const RAPIER = this.R;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PhysicsWorld.STEP;
    this.world.createCollider(groundCollider(RAPIER, layout.terrain).setCollisionGroups(groups(GROUND, ALL)));
    for (const b of layout.boxes) {
      const [x, y, z] = b.center;
      const desc = RAPIER.ColliderDesc.cuboid(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2)
        .setTranslation(x, y, z)
        .setCollisionGroups(groups(PROPS, ALL));
      if (b.rot) desc.setRotation({ x: b.rot[0], y: b.rot[1], z: b.rot[2], w: b.rot[3] });
      this.boxes.push(this.world.createCollider(desc));
    }
    // Rapier indexes new colliders for ray queries during a step; a zero-length step does
    // that without moving anything, so `castRay` works before the first real step.
    this.world.timestep = 0;
    this.world.step();
    this.world.timestep = PhysicsWorld.STEP;
  }

  /** Advances one fixed step. */
  step(): void {
    this.world.step();
  }

  /** Nearest hit along a ray from `origin` in direction `dir` (normalised here), or null. */
  castRay(origin: Vec3, dir: Vec3, maxDistance: number, filter: RayFilter = 'all'): RayHit | null {
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const d = { x: dir[0] / len, y: dir[1] / len, z: dir[2] / len };
    const ray = new this.R.Ray({ x: origin[0], y: origin[1], z: origin[2] }, d);
    const only = filter === 'ground' ? GROUND : filter === 'props' ? PROPS : GROUND | PROPS;
    const hit = this.world.castRayAndGetNormal(ray, maxDistance, true, undefined, groups(ALL, only));
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return { distance: t, point: [origin[0] + d.x * t, origin[1] + d.y * t, origin[2] + d.z * t], normal: v3(hit.normal) };
  }

  /** Height of the first solid surface straight below (x, fromY, z), or null if there is none. */
  heightBelow(x: number, z: number, fromY = 2000, filter: RayFilter = 'all'): number | null {
    const hit = this.castRay([x, fromY, z], [0, -1, 0], fromY + 2000, filter);
    return hit ? hit.point[1] : null;
  }

  /** Drops a solid ball into the world (test objects; fast-moving, so tunnelling protection is on). */
  addBall(center: Vec3, radius: number): Ball {
    const RAPIER = this.R;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(center[0], center[1], center[2]).setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(radius).setRestitution(0.3).setFriction(0.8).setCollisionGroups(groups(MOVERS, ALL)),
      body,
    );
    const ball: Ball = {
      radius,
      position: () => v3(body.translation()),
      velocity: () => v3(body.linvel()),
      setVelocity: (v) => body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true),
      setGravityScale: (s) => body.setGravityScale(s, true),
    };
    this.balls.set(ball, body);
    return ball;
  }

  removeBall(ball: Ball): void {
    const body = this.balls.get(ball);
    if (!body) return;
    this.world.removeRigidBody(body);
    this.balls.delete(ball);
  }

  /** Every prop collider as Rapier holds it. */
  colliderBoxes(): ColliderBox[] {
    return this.boxes.flatMap((c): ColliderBox[] => {
      const h = c.halfExtents(); // null only for non-box shapes, which this list never holds
      if (!h) return [];
      const t = c.translation();
      const r = c.rotation();
      return [{ center: [t.x, t.y, t.z], half: [h.x, h.y, h.z], rot: [r.x, r.y, r.z, r.w] }];
    });
  }

  /** Frees the WebAssembly memory. The world can't be used afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.balls.clear();
    this.world.free();
  }
}

/**
 * The ground as a Rapier heightfield. Rapier splits each grid square along the (10, 01)
 * diagonal, but our terrain (`terrainHeight`, the rendered mesh) splits along (00, 11). A
 * quarter turn about y swaps the diagonals, so the heightfield is laid out rotated 90° and
 * placed with the opposite rotation: the solid ground then matches the drawn ground exactly.
 *
 * Rotating by +90° about y maps local +z → world +x and local +x → world −z. So the local
 * grid's rows (along local z) are our columns, and its columns (along local x) are our rows
 * in reverse order. Rapier wants the matrix column-major and counts squares, not points.
 */
function groundCollider(RAPIER: Rapier, t: Terrain): RapierModule.ColliderDesc {
  const { cols, rows, cell, x0, z0, heights } = t;
  const data = new Float32Array(cols * rows);
  let i = 0;
  for (let j = 0; j < rows; j++) {
    const r = rows - 1 - j;
    for (let c = 0; c < cols; c++) data[i++] = heights[r * cols + c];
  }
  const width = (cols - 1) * cell; // along world x
  const depth = (rows - 1) * cell; // along world z
  return RAPIER.ColliderDesc.heightfield(cols - 1, rows - 1, data, { x: depth, y: 1, z: width }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES)
    .setTranslation(x0 + width / 2, 0, z0 + depth / 2)
    .setRotation({ x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 });
}
