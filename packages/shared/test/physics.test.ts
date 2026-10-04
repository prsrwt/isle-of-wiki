import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, PhysicsWorld } from '../src/physics';
import {
  layoutPage,
  mulberry32,
  parseArticle,
  terrainHeight,
  type BiomeId,
  type Box,
  type StructureId,
  type Vec3,
  type WorldLayout,
} from '../src';

const html = readFileSync(new URL('./fixtures/podracing.html', import.meta.url), 'utf8');
const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
const page = parseArticle('List of Star Wars air, aquatic, and ground vehicles', (document.querySelector('.mw-parser-output') ?? document.body) as unknown as Element);

const CASES: [StructureId, BiomeId][] = [
  ['hiddenLotus', 'dune'],
  ['vine', 'frost'],
  ['lilypad', 'ember'],
];

/** Runs `seconds` of fixed steps, calling `each` after every one. */
function run(world: PhysicsWorld, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds / PhysicsWorld.STEP); i++) {
    world.step();
    each?.();
  }
}

/** Point in a box's local frame (inverse-rotate by its yaw). Only used for upright boxes. */
function toLocal(b: Box, p: Vec3): Vec3 {
  const [qx, qy, qz, qw] = b.rot ?? [0, 0, 0, 1];
  void qx;
  void qz;
  const yaw = 2 * Math.atan2(qy, qw);
  const dx = p[0] - b.center[0];
  const dz = p[2] - b.center[2];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c * dx - s * dz, p[1] - b.center[1], s * dx + c * dz];
}

const upright = (b: Box) => !b.rot || (Math.abs(b.rot[0]) < 1e-9 && Math.abs(b.rot[2]) < 1e-9);

describe.each(CASES)('Physics world: %s in %s', (structure, biome) => {
  const layout: WorldLayout = layoutPage(page, { roomSeed: 42, biome, structure });
  const t = layout.terrain;
  let world: PhysicsWorld;

  beforeAll(async () => {
    world = await PhysicsWorld.create(layout);
  });
  afterAll(() => world.dispose());

  it('has one solid box for every prop', () => {
    const boxes = world.colliderBoxes();
    expect(boxes.length).toBe(layout.boxes.length);
    for (let i = 0; i < boxes.length; i += 97) {
      expect(boxes[i].center[1]).toBeCloseTo(layout.boxes[i].center[1], 3);
      expect(boxes[i].half[0] * 2).toBeCloseTo(layout.boxes[i].size[0], 3);
    }
  });

  it('has solid ground exactly where the drawn ground is (same triangles)', () => {
    const rng = mulberry32(9);
    const w = (t.cols - 1) * t.cell;
    const d = (t.rows - 1) * t.cell;
    let worst = 0;
    for (let i = 0; i < 4000; i++) {
      const x = t.x0 + 0.01 + rng() * (w - 0.02);
      const z = t.z0 + 0.01 + rng() * (d - 0.02);
      const y = world.heightBelow(x, z, 2000, 'ground');
      expect(y).not.toBeNull();
      worst = Math.max(worst, Math.abs(y! - terrainHeight(t, x, z)));
    }
    // Float32 storage of heights: well under a millimetre.
    expect(worst).toBeLessThan(1e-3);
  });

  it('lets a ball dropped on a canyon floor settle on the floor', () => {
    const [x, , z] = layout.spawns[0];
    const ground = terrainHeight(t, x, z);
    const ball = world.addBall([x, ground + 30, z], 1);
    run(world, 6);
    const [bx, by, bz] = ball.position();
    // Canyon floors slope gently along the track, so it may still be rolling downhill, but it
    // stays in the canyon and rests on the ground rather than in it or bouncing above it.
    expect(Math.hypot(bx - x, bz - z)).toBeLessThan(40);
    expect(by - terrainHeight(t, bx, bz)).toBeGreaterThan(0.95);
    expect(by - terrainHeight(t, bx, bz)).toBeLessThan(1.3);
    expect(Math.abs(ball.velocity()[1])).toBeLessThan(1);
    world.removeBall(ball);
  });

  it('lets a ball dropped on a prop land on its top', () => {
    const r = 0.5;
    const target = layout.boxes.find((b) => {
      if (!upright(b) || b.size[0] < 4 || b.size[2] < 4 || b.size[1] < 1) return false;
      const top = b.center[1] + b.size[1] / 2;
      // Nothing above it in the way.
      return Math.abs((world.heightBelow(b.center[0], b.center[2]) ?? -Infinity) - top) < 1e-3;
    });
    expect(target).toBeDefined();
    const b = target!;
    const top = b.center[1] + b.size[1] / 2;
    const ball = world.addBall([b.center[0], top + 10, b.center[2]], r);
    run(world, 4);
    const p = ball.position();
    expect(p[1]).toBeGreaterThan(top + r - 0.05);
    expect(p[1]).toBeLessThan(top + r + 0.1);
    world.removeBall(ball);
  });

  it('never lets a fast ball sink through the ground or the canyon walls', () => {
    const r = 1;
    const [x, , z] = layout.spawns[0];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const ball = world.addBall([x, terrainHeight(t, x, z) + 3, z], r);
      ball.setVelocity([Math.cos(a) * 90, -5, Math.sin(a) * 90]);
      let deepest = Infinity;
      let last = Infinity;
      run(world, 3, () => {
        const [bx, by, bz] = ball.position();
        const inside = bx > t.x0 && bx < t.x0 + (t.cols - 1) * t.cell && bz > t.z0 && bz < t.z0 + (t.rows - 1) * t.cell;
        if (!inside) return;
        last = by - terrainHeight(t, bx, bz);
        deepest = Math.min(deepest, last);
      });
      // A hard hit can press it a little way into the ground for a step (contacts are slightly
      // soft), but it never goes under, and it ends up resting on top again.
      expect(deepest).toBeGreaterThan(r * 0.5);
      if (last !== Infinity) expect(last).toBeGreaterThan(r - 0.05);
      world.removeBall(ball);
    }
  });

  it("never lets a fast ball pass through a prop's side", () => {
    const r = 0.5;
    const candidates = layout.boxes.filter((b) => upright(b) && b.size[0] >= 2 && b.size[1] >= 3 && b.size[2] >= 2);
    expect(candidates.length).toBeGreaterThan(0);
    let tried = 0;
    for (const b of candidates) {
      if (tried >= 6) break;
      // Start 6 m out from the box's local +x face at mid-height, aimed straight at it.
      const yaw = 2 * Math.atan2(b.rot?.[1] ?? 0, b.rot?.[3] ?? 1);
      const ax: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const out = b.size[0] / 2 + 6;
      const start: Vec3 = [b.center[0] + ax[0] * out, b.center[1], b.center[2] + ax[2] * out];
      // Only use a clear shot: the first thing the ray meets is this box's face.
      const hit = world.castRay(start, [-ax[0], 0, -ax[2]], 20);
      if (!hit || Math.abs(hit.distance - 6) > 1e-3) continue;
      tried++;
      const ball = world.addBall(start, r);
      ball.setGravityScale(0);
      ball.setVelocity([-ax[0] * 150, 0, -ax[2] * 150]);
      let closest = Infinity;
      run(world, 0.5, () => {
        closest = Math.min(closest, toLocal(b, ball.position())[0]);
      });
      expect(closest).toBeGreaterThan(b.size[0] / 2 + r - 0.1);
      world.removeBall(ball);
    }
    expect(tried).toBeGreaterThan(0);
  });
});

describe('Physics determinism', () => {
  it('gives bit-identical results for the same drop in two separate worlds', async () => {
    await initPhysics();
    const layout = layoutPage(page, { roomSeed: 3, biome: 'canopy', structure: 'hiddenLotus' });
    const simulate = () => {
      const world = new PhysicsWorld(layout);
      const [x, y, z] = layout.spawns[1];
      const balls = [0, 1, 2, 3].map((k) => {
        const b = world.addBall([x + k * 3, y + 20 + k, z], 0.8);
        b.setVelocity([10 * Math.cos(k), 0, 10 * Math.sin(k)]);
        return b;
      });
      run(world, 5);
      const out = balls.flatMap((b) => b.position());
      world.dispose();
      return out;
    };
    expect(simulate()).toEqual(simulate());
  });
});
