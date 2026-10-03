import * as THREE from 'three';
import type { Terrain } from '@isle-of-wiki/shared';

export interface TerrainColors {
  floor: string;
  wall: string;
  plateau: string;
  /** Ground far below the canyon floors (Lilypad's chasm). */
  abyss: string;
}

/** Inclusive grid range (columns/rows of vertices) to build. */
export interface GridRange {
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

/**
 * Faceted heightfield mesh for one rectangle of the grid. Triangulation matches
 * `terrainHeight` in the shared package (each cell split into (00,10,11) and (00,11,01)),
 * so what you see is what the physics heightfield will be. Neighbouring ranges share
 * their edge vertices, so chunk tiles meet without cracks. Colour comes from slope:
 * flat floors, steep walls, rolling plateau.
 */
export function createTerrainMesh(t: Terrain, colors: TerrainColors, material: THREE.Material, range?: GridRange): THREE.Mesh | null {
  const { cols, rows, cell, x0, z0, heights } = t;
  const c0 = Math.max(0, range?.c0 ?? 0);
  const c1 = Math.min(cols - 1, range?.c1 ?? cols - 1);
  const r0 = Math.max(0, range?.r0 ?? 0);
  const r1 = Math.min(rows - 1, range?.r1 ?? rows - 1);
  const w = c1 - c0 + 1;
  const h = r1 - r0 + 1;
  if (w < 2 || h < 2) return null;

  const pos = new Float32Array(w * h * 3);
  const col = new Float32Array(w * h * 3);
  const floor = new THREE.Color(colors.floor);
  const wall = new THREE.Color(colors.wall);
  const plateau = new THREE.Color(colors.plateau);
  const abyss = new THREE.Color(colors.abyss);
  const c = new THREE.Color();
  const at = (cc: number, rr: number) => heights[Math.min(rows - 1, Math.max(0, rr)) * cols + Math.min(cols - 1, Math.max(0, cc))];

  for (let r = r0; r <= r1; r++) {
    for (let k = c0; k <= c1; k++) {
      const i = (r - r0) * w + (k - c0);
      const y = heights[r * cols + k];
      pos[i * 3] = x0 + k * cell;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z0 + r * cell;
      const slope = Math.hypot(at(k + 1, r) - at(k - 1, r), at(k, r + 1) - at(k, r - 1)) / (2 * cell);
      // Steep → wall colour; flat and high → plateau; flat and low → canyon floor.
      const steep = THREE.MathUtils.smoothstep(slope, 0.25, 0.9);
      const high = THREE.MathUtils.smoothstep(y, 15, 30);
      const deep = 1 - THREE.MathUtils.smoothstep(y, -40, -8);
      c.copy(floor).lerp(plateau, high).lerp(wall, steep).lerp(abyss, deep);
      col.set([c.r, c.g, c.b], i * 3);
    }
  }

  const index = new Uint32Array((w - 1) * (h - 1) * 6);
  let n = 0;
  for (let r = 0; r < h - 1; r++) {
    for (let k = 0; k < w - 1; k++) {
      const a = r * w + k; // 00
      const b = a + 1; // 10
      const d = a + w; // 01
      const e = d + 1; // 11
      // Counter-clockwise seen from above (+y): (00, 11, 10) and (00, 01, 11).
      index.set([a, e, b, a, d, e], n);
      n += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return new THREE.Mesh(geometry, material);
}
