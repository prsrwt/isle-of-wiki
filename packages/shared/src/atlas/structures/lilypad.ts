import { WALL_HALF } from '../../constants';
import { randRange } from '../../rng';
import { Path, yawQuat } from '../geom';
import type { Carve } from '../terrain';
import type { RegionInfo, Vec2 } from '../types';
import {
  arenaRegion,
  sectionLength,
  seedpodPlan,
  trackLines,
  wallReach,
  type Structure,
  type StructurePlan,
  type TrackPlan,
} from './structure';

/**
 * Lilypad: every section is an island with a loop canyon around it, the Seedpod is an
 * island too, and the islands float on a deep chasm, joined by bridges in reading order.
 * Miss a bridge and you fall.
 *
 *     (§2)══(§1)══(SEEDPOD)
 *      ║
 *     (§3)══(§4)══(§5)
 */

const CHASM = -70;
const CHASM_GAP = 70;
const DECK_HALF = 9;
const STEP = 2;

interface Island {
  cx: number;
  cz: number;
  /** Island radius (cliff edge). */
  r: number;
  /** Loop ellipse radii (0 for the Seedpod). */
  ax: number;
  az: number;
  phase: number;
}

export const lilypad: Structure = {
  id: 'lilypad',
  plan(ctx): StructurePlan {
    const { rng, biome } = ctx;
    const { arena, pit, basin } = seedpodPlan(ctx.pitLines);
    const reach = wallReach(biome);

    // Size each section's loop: an ellipse (x radius 1.25 × z radius) long enough for its content.
    const islands: Island[] = [{ cx: 0, cz: 0, r: Math.hypot(arena.x1 - arena.x0 + 40, arena.z1 - arena.z0) / 2 + 30, ax: 0, az: 0, phase: 0 }];
    for (const s of ctx.sections) {
      const need = sectionLength(s.lines) + 120;
      // Ramanujan's ellipse perimeter with a = 1.25 b: P ≈ 7.09 b.
      const az = Math.max(90, need / 7.09);
      const ax = az * 1.25;
      islands.push({ cx: 0, cz: 0, r: ax + WALL_HALF + reach + 25, ax, az, phase: randRange(rng, 0, Math.PI * 2) });
    }

    // Pack islands in rows (reading order, left to right), Seedpod first.
    const area = islands.reduce((a, i) => a + (2 * i.r + CHASM_GAP) ** 2, 0);
    const rowWidth = Math.max(...islands.map((i) => 2 * i.r), Math.sqrt(area) * 1.1);
    let x = 0;
    let z = 0;
    let rowDepth = 0;
    let row = 0;
    const rows: number[] = [];
    for (const isl of islands) {
      if (x > 0 && x + 2 * isl.r > rowWidth) {
        z -= rowDepth + CHASM_GAP;
        x = 0;
        rowDepth = 0;
        row++;
      }
      // Odd rows run right-to-left so consecutive islands stay neighbours.
      isl.cx = x + isl.r;
      isl.cz = z - isl.r;
      rows.push(row);
      x += 2 * isl.r + CHASM_GAP;
      rowDepth = Math.max(rowDepth, 2 * isl.r);
    }
    for (let r = 1; r <= row; r += 2) {
      const members = islands.filter((_, i) => rows[i] === r);
      const minX = Math.min(...members.map((m) => m.cx - m.r));
      const maxX = Math.max(...members.map((m) => m.cx + m.r));
      for (const m of members) m.cx = minX + maxX - m.cx;
    }
    // Centre the Seedpod island on the origin, and mirror so the islands lie to its west:
    // its first bridge must leave through the open west side, not through the grandstand.
    const ox = islands[0].cx;
    const oz = islands[0].cz;
    for (const i of islands) {
      i.cx = -(i.cx - ox);
      i.cz -= oz;
    }

    const carves: Carve[] = [];
    const tracks: TrackPlan[] = [];
    const decks: StructurePlan['decks'] = [];
    const regions: RegionInfo[] = [arenaRegion(ctx.title, arena)];
    const loops: Path[] = [];

    const loopPoint = (isl: Island, ang: number): Vec2 => {
      const wob = 1 + 0.06 * Math.sin(3 * ang + isl.phase);
      return [isl.cx + Math.cos(ang) * isl.ax * wob, isl.cz + Math.sin(ang) * isl.az * wob];
    };
    const angleTo = (from: Island, to: Island) => Math.atan2(to.cz - from.cz, to.cx - from.cx);

    ctx.sections.forEach((s, i) => {
      const isl = islands[i + 1];
      const prev = islands[i];
      // The loop starts where the bridge from the previous island lands, and runs round.
      const start = angleTo(isl, prev);
      const n = Math.ceil((2 * Math.PI * Math.max(isl.ax, isl.az)) / STEP);
      const pts: Vec2[] = [];
      for (let k = 0; k <= n; k++) pts.push(loopPoint(isl, start + (2 * Math.PI * k) / n));
      const raw = new Path(pts, () => 0);
      const len = raw.length;
      const loop = new Path(pts, (sArc) => 3 * Math.sin((sArc / len) * 2 * Math.PI * 2) * Math.min(1, sArc / 60, Math.max(0, len - sArc) / 60));
      loops.push(loop);
      carves.push({ path: loop, half: WALL_HALF });
      const track: TrackPlan = { section: i, path: loop, gatewayS: 34, s0: 44 + 2.25, lines: trackLines(s.lines), blocks: [] };
      // Where the bridge onward leaves the loop, keep its outer wall clear of caves.
      const next = islands[i + 2];
      if (next) {
        const exit = angleTo(isl, next);
        const exitS = (((exit - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * len;
        const p = loop.at(exitS);
        const out: Vec2 = [Math.cos(exit), Math.sin(exit)];
        const side = p.r[0] * out[0] + p.r[1] * out[1] > 0 ? 1 : -1;
        track.blocks.push({ side, sa: exitS - DECK_HALF - 20, sb: exitS + DECK_HALF + 20 });
      }
      // ...and the wall behind the landing at the start.
      track.blocks.push({ side: 1, sa: len - 30, sb: len }, { side: -1, sa: len - 30, sb: len });
      tracks.push(track);
      regions.push({ title: s.title, kind: 'section', section: i, path: loop.sparse(40) });
    });

    // Bridges: a short canyon cut from each island's loop (or the Seedpod) to its cliff,
    // a deck across the chasm, and the same on the far side.
    for (let i = 0; i + 1 < islands.length; i++) {
      const a = islands[i];
      const b = islands[i + 1];
      const ang = angleTo(a, b);
      const from: Vec2 = i === 0 ? [a.cx, a.cz] : loopPoint(a, ang);
      const to = loopPoint(b, ang + Math.PI);
      const connector = new Path([from, to], () => 0);
      carves.push({ path: connector, half: DECK_HALF });
      const dir: Vec2 = [Math.cos(ang), Math.sin(ang)];
      const edgeA: Vec2 = [a.cx + dir[0] * (a.r - 12), a.cz + dir[1] * (a.r - 12)];
      const edgeB: Vec2 = [b.cx - dir[0] * (b.r - 12), b.cz - dir[1] * (b.r - 12)];
      const len = Math.hypot(edgeB[0] - edgeA[0], edgeB[1] - edgeA[1]);
      decks.push({
        center: [(edgeA[0] + edgeB[0]) / 2, -0.6, (edgeA[1] + edgeB[1]) / 2],
        size: [2 * DECK_HALF, 1.2, len],
        rot: yawQuat(dir),
      });
      regions.push({ title: 'Bridge', kind: 'connector', path: [from, to] });
    }

    const base = (px: number, pz: number, plateau: number): number => {
      let best = CHASM;
      for (const isl of islands) {
        const d = Math.hypot(px - isl.cx, pz - isl.cz);
        // Cliff falls steeply from the island's edge into the chasm.
        const h = d <= isl.r ? plateau : plateau - (d - isl.r) * 4;
        if (h > best) best = h;
      }
      return best;
    };

    const extent = {
      minX: Math.min(...islands.map((i) => i.cx - i.r)),
      maxX: Math.max(...islands.map((i) => i.cx + i.r)),
      minZ: Math.min(...islands.map((i) => i.cz - i.r)),
      maxZ: Math.max(...islands.map((i) => i.cz + i.r)),
    };

    return {
      arena,
      pit,
      carves,
      basins: [basin],
      base,
      tracks,
      decks,
      archSpans: [],
      landmarkPaths: loops.map((path) => ({ path, half: WALL_HALF })),
      regions,
      extent,
      arrival: [arena.x0 + 50, 2, 0],
      arrivalDir: [1, 0],
    };
  },
};
