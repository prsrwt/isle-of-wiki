import * as THREE from 'three';
import type { Terrain } from '@isle-of-wiki/shared';
import type { Ball, PhysicsWorld } from '@isle-of-wiki/shared/physics';

/** Ground wire grid: this many terrain cells each way around the camera. */
const GRID_HALF = 40;
/** Rebuild the ground grid once the camera has moved this many cells. */
const GRID_REBUILD = 8;
const MAX_BALLS = 40;
const BALL_RADIUS = 1.5;

/**
 * Debug view of the physics world (key P): every solid prop as an orange wire box and the
 * ground near you as a cyan wire grid, all read back from Rapier itself rather than from the
 * layout, so it shows what the pod will actually hit. B drops test balls.
 */
export class PhysicsDebug {
  readonly group = new THREE.Group();
  private readonly ground: THREE.LineSegments;
  private readonly groundPos: Float32Array;
  private readonly balls: { ball: Ball; mesh: THREE.Mesh }[] = [];
  private readonly ballGeometry = new THREE.IcosahedronGeometry(BALL_RADIUS, 1);
  private readonly ballMaterial = new THREE.MeshBasicMaterial({ color: '#ff3d7f', wireframe: true });
  private gridCol = Number.NaN;
  private gridRow = Number.NaN;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly terrain: Terrain,
  ) {
    this.group.visible = false;
    this.group.add(boxLines(physics));

    // Grid lines along x and z plus each square's (00, 11) diagonal: 3 segments per vertex.
    const n = GRID_HALF * 2 + 1;
    this.groundPos = new Float32Array(n * n * 3 * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.groundPos, 3));
    this.ground = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#36e2ff' }));
    this.ground.frustumCulled = false;
    this.group.add(this.ground);
  }

  get visible(): boolean {
    return this.group.visible;
  }

  set visible(on: boolean) {
    this.group.visible = on;
    this.gridCol = Number.NaN;
  }

  /** Drops a ball a few metres in front of the camera, thrown the way it looks. */
  dropBall(from: THREE.Vector3, dir: THREE.Vector3): void {
    if (this.balls.length >= MAX_BALLS) this.removeBall(0);
    const start = from.clone().addScaledVector(dir, 6);
    const ball = this.physics.addBall([start.x, start.y, start.z], BALL_RADIUS);
    ball.setVelocity([dir.x * 25, dir.y * 25, dir.z * 25]);
    const mesh = new THREE.Mesh(this.ballGeometry, this.ballMaterial);
    this.group.add(mesh);
    this.balls.push({ ball, mesh });
  }

  update(camera: THREE.Vector3): void {
    if (!this.group.visible) return;
    for (const { ball, mesh } of this.balls) mesh.position.fromArray(ball.position());
    const { x0, z0, cell } = this.terrain;
    const col = Math.round((camera.x - x0) / cell);
    const row = Math.round((camera.z - z0) / cell);
    if (Math.abs(col - this.gridCol) < GRID_REBUILD && Math.abs(row - this.gridRow) < GRID_REBUILD) return;
    this.gridCol = col;
    this.gridRow = row;
    this.rebuildGround(col, row);
  }

  dispose(): void {
    for (const o of this.group.children) {
      if (o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    }
    this.ballGeometry.dispose();
    this.ballMaterial.dispose();
    this.group.removeFromParent();
  }

  private removeBall(i: number): void {
    const [{ ball, mesh }] = this.balls.splice(i, 1);
    this.physics.removeBall(ball);
    mesh.removeFromParent();
  }

  /** Samples the physics ground at every grid vertex near (col, row) by casting rays straight down. */
  private rebuildGround(col: number, row: number): void {
    const { x0, z0, cell, cols, rows } = this.terrain;
    const n = GRID_HALF * 2 + 1;
    const ys = new Float32Array(n * n).fill(Number.NaN);
    const c0 = col - GRID_HALF;
    const r0 = row - GRID_HALF;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = c0 + i;
        const r = r0 + j;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        // A hair inside the grid so edge vertices still hit the heightfield.
        const x = Math.min(Math.max(x0 + c * cell, x0 + 1e-3), x0 + (cols - 1) * cell - 1e-3);
        const z = Math.min(Math.max(z0 + r * cell, z0 + 1e-3), z0 + (rows - 1) * cell - 1e-3);
        ys[j * n + i] = this.physics.heightBelow(x, z, 2000, 'ground') ?? Number.NaN;
      }
    }
    const p = this.groundPos;
    let k = 0;
    const lift = 0.08;
    const seg = (i0: number, j0: number, i1: number, j1: number) => {
      if (i1 >= n || j1 >= n) return;
      const a = ys[j0 * n + i0];
      const b = ys[j1 * n + i1];
      if (Number.isNaN(a) || Number.isNaN(b)) return;
      p.set([x0 + (c0 + i0) * cell, a + lift, z0 + (r0 + j0) * cell, x0 + (c0 + i1) * cell, b + lift, z0 + (r0 + j1) * cell], k);
      k += 6;
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        seg(i, j, i + 1, j);
        seg(i, j, i, j + 1);
        seg(i, j, i + 1, j + 1);
      }
    }
    const geometry = this.ground.geometry;
    geometry.setDrawRange(0, k / 3);
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** One line-segment mesh with the 12 edges of every prop collider. */
function boxLines(physics: PhysicsWorld): THREE.LineSegments {
  const boxes = physics.colliderBoxes();
  const pos = new Float32Array(boxes.length * 24 * 3);
  const corner = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const corners: THREE.Vector3[] = [];
  // Edges between corners whose sign pattern differs in exactly one axis.
  const EDGES: [number, number][] = [];
  for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) if (!(a & bit)) EDGES.push([a, a | bit]);
  let k = 0;
  for (const b of boxes) {
    q.set(b.rot[0], b.rot[1], b.rot[2], b.rot[3]);
    corners.length = 0;
    for (let a = 0; a < 8; a++) {
      // Slightly oversized so the lines aren't hidden inside the drawn faces.
      corner
        .set((a & 1 ? 1 : -1) * (b.half[0] + 0.03), (a & 2 ? 1 : -1) * (b.half[1] + 0.03), (a & 4 ? 1 : -1) * (b.half[2] + 0.03))
        .applyQuaternion(q)
        .add({ x: b.center[0], y: b.center[1], z: b.center[2] });
      corners.push(corner.clone());
    }
    for (const [i, j] of EDGES) {
      pos.set([corners[i].x, corners[i].y, corners[i].z, corners[j].x, corners[j].y, corners[j].z], k);
      k += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#ff9a1f' }));
}
