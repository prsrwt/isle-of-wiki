import { WALL_HALF } from '../../constants';
import { randRange } from '../../rng';
import { Path } from '../geom';
import type { Carve } from '../terrain';
import type { RegionInfo, Vec2 } from '../types';
import {
  arenaRegion,
  canyonSpacing,
  extentOf,
  floorProfile,
  groupSections,
  laySections,
  sectionLength,
  seedpodPlan,
  type Structure,
  type StructurePlan,
  type TrackPlan,
} from './structure';

/**
 * The Hidden Lotus (default). The Seedpod sits in the middle; each Petal is a loop canyon
 * that leaves the Seedpod along one ray, winds outward, curls round its tip and comes back
 * in along the neighbouring ray. Near the Seedpod the petals' stems merge into open sand
 * (the Stem gates); caves begin only where a petal's walls have separated. Long articles
 * pack several sections into one petal, in order. Some lotuses also grow a Calyx — an outer
 * ring canyon joining the petal tips — so racers can hop petal to petal.
 *
 *          ╭──╮   ╭──╮
 *         ╱ §2 ╲ ╱ §3 ╲
 *     ╭──╲──╱───╲──╱──╮      angles run anticlockwise from the east;
 *     │ §1  SEEDPOD  ▐▌ grandstand   the east wedge is kept for the grandstand
 *     ╰──╱──╲───╱──╲──╯
 *         ╲ §5 ╱ ╲ §4 ╱
 *          ╰──╯   ╰──╯
 *
 * Petal layers: a petal carrying a long section would have to reach far out on its own.
 * Instead it grows an outer lobe — past a neck it widens over its shorter neighbours (which
 * tuck in beneath it), so the same length of canyon fits much closer to the Seedpod. It is
 * still one loop, so the section still reads in order:
 *
 *        ╭──────────╮   outer layer (the lobe)
 *        ╰──╮    ╭──╯
 *      ╭─╮  │    │  ╭─╮ inner layer: tucked neighbours
 *       ─────SEEDPOD─────
 */

const MAX_PETALS = 8;
/** Angle (each side of due east) kept clear for the grandstand. */
const GRANDSTAND_WEDGE = (50 * Math.PI) / 180;
/** Fraction of each petal's slice taken by the petal itself (the rest separates petals). */
const PETAL_FILL = 0.5;
const STEP = 2;
/** A lobe is kept only if it brings the petal's tip at least this much closer (fraction of its reach). */
const LOBE_GAIN = 0.85;

/** The outer layer of a petal: beyond radius `rNeck` it spans angles aL..bL instead of a..b. */
export interface Lobe {
  rNeck: number;
  aL: number;
  bL: number;
}

interface PetalSeed {
  group: number[];
  theta: number;
  a: number;
  b: number;
  need: number;
  phase: number;
  meander: number;
  floorPhase: number;
}

interface GrownPetal {
  path: Path;
  content: [number, number];
  tipS: number;
  /** Furthest radius (the tip). */
  r1: number;
  /** Direction of the tip from the Seedpod. */
  tipAngle: number;
}

export const hiddenLotus: Structure = {
  id: 'hiddenLotus',
  plan(ctx): StructurePlan {
    const { rng, biome } = ctx;
    const { arena, pit, basin } = seedpodPlan(ctx.pitLines);
    const groups = groupSections(ctx.sections.map((s) => sectionLength(s.lines)), MAX_PETALS);
    const n = groups.length;
    const slice = (2 * Math.PI - 2 * GRANDSTAND_WEDGE) / n;
    const width = slice * PETAL_FILL;
    const gap = slice - width;
    const spacing = canyonSpacing(biome);
    const arenaRadius = Math.hypot(arena.x1 - arena.x0, arena.z1 - arena.z0) / 2;
    // Beyond this radius a petal's two legs, and neighbouring petals, no longer share walls.
    const rFree = Math.max(spacing / width, spacing / gap, arenaRadius + 60);
    const r0 = 30;

    // Random draws stay in their original per-petal order, so petals without a lobe come out
    // exactly as before.
    const seeds: PetalSeed[] = groups.map((group, gi) => {
      const theta = GRANDSTAND_WEDGE + (gi + 0.5) * slice;
      return {
        group,
        theta,
        a: theta - width / 2,
        b: theta + width / 2,
        need: group.reduce((acc, i) => acc + sectionLength(ctx.sections[i].lines), 0) + 30,
        phase: randRange(rng, 0, Math.PI * 2),
        meander: randRange(rng, 10, 18),
        floorPhase: randRange(rng, 0, Math.PI * 2),
      };
    });

    /** Grows a petal (with or without a lobe) until the stretch between the free radii is long enough. */
    const grow = (seed: PetalSeed, lobe: Lobe | null): GrownPetal => {
      const { a, b, need, phase, meander } = seed;
      const aL = lobe?.aL ?? a;
      const bL = lobe?.bL ?? b;
      const sideArcs = lobe ? lobe.rNeck * (a - aL + (bL - b)) : 0;
      let r1 = lobe
        ? Math.max(lobe.rNeck + spacing + 40, (need + 2 * rFree - sideArcs) / (2 + (bL - aL)))
        : Math.max(rFree + 140, (need + 2 * rFree) / (2 + width));
      let pts!: ReturnType<typeof petalPoints>;
      let path!: Path;
      let content: [number, number] = [0, 0];
      for (let attempt = 0; attempt < 8; attempt++) {
        pts = petalPoints(a, b, r0, r1, rFree, meander, phase, spacing, lobe);
        path = new Path(pts.points, () => 0);
        content = [pts.freeOutIndex, pts.freeBackIndex].map((i) => path.ss[Math.min(i, path.ss.length - 1)]) as [number, number];
        const have = content[1] - content[0];
        if (have >= need) break;
        r1 += (need - have) / (2 + (bL - aL)) + 20;
      }
      const tipS = path.ss[Math.min(pts.tipIndex, path.ss.length - 1)];
      return { path, content, tipS, r1, tipAngle: (aL + bL) / 2 };
    };

    // Inner layer: every petal as a plain loop.
    const petals = seeds.map((seed) => grow(seed, null));

    // Outer layer: longest petals first, each may grow a lobe over neighbours that are clearly
    // shorter and not lobed themselves. Those neighbours are then tucked in and can't lobe.
    const lobed = new Set<number>();
    const tucked = new Set<number>();
    const order = petals.map((_, i) => i).sort((i, j) => petals[j].r1 - petals[i].r1 || i - j);
    for (const i of order) {
      if (tucked.has(i)) continue;
      // Neighbouring slices only; the first and last petals border the grandstand wedge.
      const eligible = [i - 1, i + 1].filter((j) => j >= 0 && j < n && !lobed.has(j) && petals[j].r1 + spacing < petals[i].r1);
      // Spread over one side, the other, or both — whichever brings the tip in closest.
      const options = eligible.length === 2 ? [[eligible[0]], [eligible[1]], eligible] : eligible.length ? [eligible] : [];
      let best: { grown: GrownPetal; sides: number[] } | null = null;
      for (const sides of options) {
        const rNeck = Math.max(rFree + 60, ...sides.map((j) => petals[j].r1 + spacing));
        // Stop short of the neighbour's centre line, so a lobe from its other side still has room.
        const margin = spacing / (2 * rNeck);
        const seed = seeds[i];
        const grown = grow(seed, {
          rNeck,
          aL: sides.includes(i - 1) ? seeds[i - 1].theta + margin : seed.a,
          bL: sides.includes(i + 1) ? seeds[i + 1].theta - margin : seed.b,
        });
        if (!best || grown.r1 < best.grown.r1) best = { grown, sides };
      }
      if (!best || best.grown.r1 > petals[i].r1 * LOBE_GAIN) continue;
      petals[i] = best.grown;
      lobed.add(i);
      for (const j of best.sides) tucked.add(j);
    }

    const tracks: TrackPlan[] = [];
    const carves: Carve[] = [];
    const regions: RegionInfo[] = [arenaRegion(ctx.title, arena)];
    petals.forEach((grown, gi) => {
      const { group, floorPhase } = seeds[gi];
      const path = new Path(
        grown.path.xs.map((x, i) => [x, grown.path.zs[i]] as Vec2),
        floorProfile(grown.path.length, floorPhase),
      );
      petals[gi] = { ...grown, path };
      laySections(
        path,
        group.map((i) => ({ index: i, lines: ctx.sections[i].lines })),
        grown.content[0] + 10,
        tracks,
      );
      carves.push({ path, half: WALL_HALF });
      group.forEach((i) => regions.push({ title: ctx.sections[i].title, kind: 'section', section: i, path: path.sparse(40) }));
    });

    // The Calyx: an outer ring joining the petal tips, grown by about half of all lotuses.
    // Petals tucked under a lobe don't reach it (their spur would cut through the lobe).
    const archSpans: StructurePlan['archSpans'] = [];
    if (n >= 3 && rng() < 0.5) {
      const rc = Math.max(...petals.map((p) => p.r1)) + spacing + 20;
      const ring: Vec2[] = [];
      for (let i = 0; i <= Math.ceil((2 * Math.PI * rc) / STEP); i++) {
        const ang = (i / Math.ceil((2 * Math.PI * rc) / STEP)) * 2 * Math.PI;
        ring.push([Math.cos(ang) * rc, Math.sin(ang) * rc]);
      }
      const ringPath = new Path(ring, () => 0);
      carves.push({ path: ringPath, half: WALL_HALF });
      archSpans.push({ path: ringPath, half: WALL_HALF, from: 0, to: ringPath.length });
      regions.push({ title: 'Calyx', kind: 'connector', path: ringPath.sparse(60) });
      petals.forEach((petal, gi) => {
        if (tucked.has(gi)) return;
        const tip = petal.path.at(petal.tipS);
        const dir: Vec2 = [Math.cos(petal.tipAngle), Math.sin(petal.tipAngle)];
        const start: Vec2 = [tip.x, tip.z];
        const len = Math.max(10, rc - Math.hypot(tip.x, tip.z));
        const spur = new Path(
          [start, [start[0] + dir[0] * len, start[1] + dir[1] * len]],
          (s) => tip.y * Math.max(0, 1 - s / len),
        );
        carves.push({ path: spur, half: WALL_HALF });
        // The spur opens through the petal's outer wall at its tip: keep caves away from there.
        const outer = tip.r[0] * dir[0] + tip.r[1] * dir[1] > 0 ? 1 : -1;
        for (const t of tracks) {
          if (t.path === petal.path) t.blocks.push({ side: outer, sa: petal.tipS - WALL_HALF - 15, sb: petal.tipS + WALL_HALF + 15 });
        }
      });
    }

    const paths = carves.map((c) => c.path);
    return {
      arena,
      pit,
      carves,
      basins: [basin],
      tracks,
      decks: [],
      archSpans,
      landmarkPaths: carves.map((c) => ({ path: c.path, half: c.half })),
      regions,
      extent: extentOf(paths, arena),
      arrival: [arena.x0 + 50, 2, 0],
      arrivalDir: [1, 0],
    };
  },
};

/**
 * One petal: out along angle a from r0, round the tip at r1, back along angle b. With a lobe,
 * the legs stop at the neck, step sideways along the neck's arc to the lobe's edges aL/bL,
 * and the tip spans aL..bL. Main legs meander sideways once clear of the stem, never closer
 * to a neighbour than `spacing`. Returns the points plus where the free (wall-separated)
 * stretch starts and ends. Without a lobe this is exactly the classic petal.
 */
function petalPoints(
  a: number,
  b: number,
  r0: number,
  r1: number,
  rFree: number,
  meander: number,
  phase: number,
  spacing: number,
  lobe: Lobe | null = null,
) {
  const points: Vec2[] = [];
  /** Adds a point unless it repeats the previous one (where a one-sided lobe meets its leg). */
  const push = (p: Vec2) => {
    const last = points[points.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) points.push(p);
  };
  const width = b - a;
  const rNeck = lobe?.rNeck ?? r1;
  const aL = lobe?.aL ?? a;
  const bL = lobe?.bL ?? b;
  /** Radial run along `ang`, both ends included; main legs (`wiggle`) meander. */
  const leg = (ang: number, rFrom: number, rTo: number, wiggle: boolean) => {
    const dir: Vec2 = [Math.cos(ang), Math.sin(ang)];
    const side: Vec2 = [-dir[1], dir[0]];
    const steps = Math.ceil(Math.abs(rTo - rFrom) / STEP);
    for (let i = 0; i <= steps; i++) {
      const r = rFrom + ((rTo - rFrom) * i) / steps;
      // Meander only where there's room: fades in past rFree and out before the neck (or tip).
      const room = Math.max(0, (r * Math.min(width, 2 * Math.PI) - spacing) / 2);
      const env = wiggle ? Math.min(1, Math.max(0, (r - rFree) / 150), Math.max(0, (rNeck - r) / 90)) : 0;
      const off = Math.min(meander, room) * env * Math.sin((r - rFree) / 55 + phase);
      push([dir[0] * r + side[0] * off, dir[1] * r + side[1] * off]);
    }
  };
  /** Arc at radius r from angle `from` to `to`, both ends excluded. */
  const arc = (r: number, from: number, to: number) => {
    const steps = Math.max(2, Math.ceil((r * Math.abs(to - from)) / STEP));
    for (let i = 1; i < steps; i++) {
      const ang = from + ((to - from) * i) / steps;
      push([Math.cos(ang) * r, Math.sin(ang) * r]);
    }
  };

  leg(a, r0, rNeck, true);
  const freeOutIndex = points.findIndex((p) => Math.hypot(p[0], p[1]) >= rFree);
  if (lobe) {
    if (aL !== a) arc(rNeck, a, aL);
    leg(aL, rNeck, r1, false);
  }
  const tipStart = points.length;
  const tipSteps = Math.max(2, Math.ceil((r1 * (bL - aL)) / STEP));
  arc(r1, aL, bL);
  const tipIndex = tipStart + Math.floor(tipSteps / 2);
  if (lobe) {
    leg(bL, r1, rNeck, false);
    if (bL !== b) arc(rNeck, bL, b);
  }
  const backStart = points.length;
  leg(b, rNeck, r0, true);
  let freeBackIndex = points.length - 1;
  for (let i = backStart; i < points.length; i++) {
    if (Math.hypot(points[i][0], points[i][1]) < rFree) {
      freeBackIndex = i;
      break;
    }
  }
  return { points, freeOutIndex: Math.max(0, freeOutIndex), freeBackIndex, tipIndex };
}
