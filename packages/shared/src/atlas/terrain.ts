import { LAYOUT as L } from '../constants';
import type { BiomeShape } from './biomes';
import { valueNoise2D, type Path } from './geom';
import type { Bounds, Terrain } from './types';

/** A canyon to carve: its centreline and the half-width of its flat floor. */
export interface Carve {
  path: Path;
  half: number;
}

/** Axis-aligned flat basin (the arena). */
export interface Basin {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floor: number;
}

/**
 * Terrain before any canyon is carved, if a structure wants something other than one big
 * plateau (Lilypad: islands rising out of chasms). Return the height at (x, z), given the
 * biome's plateau height there.
 */
export type BaseShape = (x: number, z: number, plateau: number) => number;

/**
 * Plateau with canyons cut into it. Every canyon has a flat floor of width 2·half that
 * follows its path's floor height, then walls climbing at the biome's slope up to the
 * plateau. Overlapping carves take the lower ground, so canyons join cleanly.
 */
export function buildTerrain(
  bounds: Bounds,
  carves: Carve[],
  basins: Basin[],
  seed: number,
  biome: BiomeShape,
  base?: BaseShape,
): Terrain {
  const cell = L.terrainCell;
  const x0 = Math.floor((bounds.minX - L.terrainMargin) / cell) * cell;
  const z0 = Math.floor((bounds.minZ - L.terrainMargin) / cell) * cell;
  const cols = Math.ceil((bounds.maxX + L.terrainMargin - x0) / cell) + 1;
  const rows = Math.ceil((bounds.maxZ + L.terrainMargin - z0) / cell) + 1;

  const broad = valueNoise2D(seed ^ 0x1234);
  const detail = valueNoise2D(seed ^ 0x5678);
  const heights = new Array<number>(cols * rows);
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * cell;
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * cell;
      const plateau = biome.rimHeight + broad(x / 240, z / 240) * biome.plateauRoll + detail(x / 60, z / 60) * 4;
      heights[r * cols + c] = base ? base(x, z, plateau) : plateau;
    }
  }

  /** Wall height a distance `out` beyond a floor edge, with a little craggy noise. */
  const wall = (floor: number, out: number, x: number, z: number) =>
    floor + Math.max(0, out) * biome.wallSlope * (1 + detail(x / 9, z / 9) * biome.wallCrag * 0.4);

  const reach = (biome.rimHeight + biome.plateauRoll) / biome.wallSlope + 30;
  // Per-vertex nearest centreline point for the canyon being carved. Each canyon must be
  // profiled from its *nearest* point only: taking the minimum over every nearby segment
  // would let lower floor further back along a slope sink the ground under the text.
  const bestD = new Float64Array(cols * rows).fill(Infinity);
  const bestFloor = new Float64Array(cols * rows);
  const touched: number[] = [];
  for (const { path, half } of carves) {
    const { xs, zs, ss } = path;
    touched.length = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      const ax = xs[i];
      const az = zs[i];
      const bx = xs[i + 1];
      const bz = zs[i + 1];
      const r = half + reach;
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - x0) / cell));
      const c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + r - x0) / cell));
      const r0 = Math.max(0, Math.floor((Math.min(az, bz) - r - z0) / cell));
      const r1 = Math.min(rows - 1, Math.ceil((Math.max(az, bz) + r - z0) / cell));
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      for (let row = r0; row <= r1; row++) {
        const z = z0 + row * cell;
        for (let col = c0; col <= c1; col++) {
          const x = x0 + col * cell;
          const f = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
          const d = Math.hypot(x - (ax + dx * f), z - (az + dz * f));
          if (d > r) continue;
          const idx = row * cols + col;
          if (bestD[idx] === Infinity) touched.push(idx);
          if (d < bestD[idx]) {
            bestD[idx] = d;
            bestFloor[idx] = path.floor(ss[i] + (ss[i + 1] - ss[i]) * f);
          }
        }
      }
    }
    // Between different canyons, the lower ground wins so junctions open up cleanly.
    for (const idx of touched) {
      const h = wall(bestFloor[idx], bestD[idx] - half, x0 + (idx % cols) * cell, z0 + Math.floor(idx / cols) * cell);
      if (h < heights[idx]) heights[idx] = h;
      bestD[idx] = Infinity;
    }
  }

  for (const b of basins) {
    const r = reach;
    const c0 = Math.max(0, Math.floor((b.minX - r - x0) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((b.maxX + r - x0) / cell));
    const r0 = Math.max(0, Math.floor((b.minZ - r - z0) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((b.maxZ + r - z0) / cell));
    for (let row = r0; row <= r1; row++) {
      const z = z0 + row * cell;
      for (let col = c0; col <= c1; col++) {
        const x = x0 + col * cell;
        const out = Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
        const h = wall(b.floor, out, x, z);
        const idx = row * cols + col;
        if (h < heights[idx]) heights[idx] = h;
      }
    }
  }

  // Round to centimetres: keeps the layout compact and identical when serialised.
  for (let i = 0; i < heights.length; i++) heights[i] = Math.round(heights[i] * 100) / 100;
  return { x0, z0, cell, cols, rows, heights };
}

/** Ground height at (x, z), matching the grid's triangulation (split along the cell diagonal). */
export function terrainHeight(t: Terrain, x: number, z: number): number {
  const fx = (x - t.x0) / t.cell;
  const fz = (z - t.z0) / t.cell;
  const c = Math.min(Math.max(Math.floor(fx), 0), t.cols - 2);
  const r = Math.min(Math.max(Math.floor(fz), 0), t.rows - 2);
  const u = Math.min(Math.max(fx - c, 0), 1);
  const v = Math.min(Math.max(fz - r, 0), 1);
  const h00 = t.heights[r * t.cols + c];
  const h10 = t.heights[r * t.cols + c + 1];
  const h01 = t.heights[(r + 1) * t.cols + c];
  const h11 = t.heights[(r + 1) * t.cols + c + 1];
  // Triangles (00,10,11) and (00,11,01).
  return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
}
