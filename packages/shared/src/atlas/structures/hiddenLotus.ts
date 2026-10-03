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
 */

const MAX_PETALS = 8;
/** Angle (each side of due east) kept clear for the grandstand. */
const GRANDSTAND_WEDGE = (50 * Math.PI) / 180;
/** Fraction of each petal's slice taken by the petal itself (the rest separates petals). */
const PETAL_FILL = 0.5;
const STEP = 2;

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

    const tracks: TrackPlan[] = [];
    const carves: Carve[] = [];
    const regions: RegionInfo[] = [arenaRegion(ctx.title, arena)];
    const petals: { path: Path; tipS: number; theta: number; r1: number }[] = [];

    groups.forEach((group, gi) => {
      const theta = GRANDSTAND_WEDGE + (gi + 0.5) * slice;
      const a = theta - width / 2;
      const b = theta + width / 2;
      const need = group.reduce((acc, i) => acc + sectionLength(ctx.sections[i].lines), 0) + 30;
      const phase = randRange(rng, 0, Math.PI * 2);
      const meander = randRange(rng, 10, 18);

      // Grow the petal until the stretch between the free radii is long enough.
      let r1 = Math.max(rFree + 140, (need + 2 * rFree) / (2 + width));
      let path!: Path;
      let content: [number, number] = [0, 0];
      let tipS = 0;
      for (let attempt = 0; attempt < 8; attempt++) {
        const pts = petalPoints(a, b, r0, r1, rFree, meander, phase, spacing);
        path = new Path(pts.points, () => 0);
        content = [pts.freeOutIndex, pts.freeBackIndex].map((i) => path.ss[Math.min(i, path.ss.length - 1)]) as [number, number];
        tipS = path.ss[Math.min(pts.tipIndex, path.ss.length - 1)];
        const have = content[1] - content[0];
        if (have >= need) break;
        r1 += (need - have) / (2 + width) + 20;
      }
      path = new Path(path.xs.map((x, i) => [x, path.zs[i]] as Vec2), floorProfile(path.length, randRange(rng, 0, Math.PI * 2)));

      laySections(
        path,
        group.map((i) => ({ index: i, lines: ctx.sections[i].lines })),
        content[0] + 10,
        tracks,
      );
      carves.push({ path, half: WALL_HALF });
      petals.push({ path, tipS, theta, r1 });
      group.forEach((i) => regions.push({ title: ctx.sections[i].title, kind: 'section', section: i, path: path.sparse(40) }));
    });

    // The Calyx: an outer ring joining the petal tips, grown by about half of all lotuses.
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
      for (const petal of petals) {
        const tip = petal.path.at(petal.tipS);
        const dir: Vec2 = [Math.cos(petal.theta), Math.sin(petal.theta)];
        const start: Vec2 = [tip.x, tip.z];
        const len = Math.max(10, rc - Math.hypot(tip.x, tip.z));
        const spur = new Path(
          [start, [start[0] + dir[0] * len, start[1] + dir[1] * len]],
          (s) => tip.y * Math.max(0, 1 - s / len),
        );
        carves.push({ path: spur, half: WALL_HALF });
        // The spur opens through the petal's outer wall at its tip: keep caves away from there.
        const outer = petal.path.at(petal.tipS).r[0] * dir[0] + petal.path.at(petal.tipS).r[1] * dir[1] > 0 ? 1 : -1;
        for (const t of tracks) {
          if (t.path === petal.path) t.blocks.push({ side: outer, sa: petal.tipS - WALL_HALF - 15, sb: petal.tipS + WALL_HALF + 15 });
        }
      }
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
 * One petal: out along angle a from r0 to r1, round the tip at r1, back along angle b.
 * Legs meander sideways once they are clear of the stem, never closer to a neighbour than
 * `spacing`. Returns the points plus where the free (wall-separated) stretch starts and ends.
 */
function petalPoints(a: number, b: number, r0: number, r1: number, rFree: number, meander: number, phase: number, spacing: number) {
  const points: Vec2[] = [];
  const width = b - a;
  const leg = (ang: number, rFrom: number, rTo: number) => {
    const dir: Vec2 = [Math.cos(ang), Math.sin(ang)];
    const side: Vec2 = [-dir[1], dir[0]];
    const steps = Math.ceil(Math.abs(rTo - rFrom) / STEP);
    for (let i = 0; i <= steps; i++) {
      const r = rFrom + ((rTo - rFrom) * i) / steps;
      // Meander only where there's room: fades in past rFree and out before the tip.
      const room = Math.max(0, (r * Math.min(width, 2 * Math.PI) - spacing) / 2);
      const env = Math.min(1, Math.max(0, (r - rFree) / 150), Math.max(0, (r1 - r) / 90));
      const off = Math.min(meander, room) * env * Math.sin((r - rFree) / 55 + phase);
      points.push([dir[0] * r + side[0] * off, dir[1] * r + side[1] * off]);
    }
  };

  leg(a, r0, r1);
  const freeOutIndex = points.findIndex((p) => Math.hypot(p[0], p[1]) >= rFree);
  const tipSteps = Math.max(2, Math.ceil((r1 * width) / STEP));
  const tipStart = points.length;
  for (let i = 1; i < tipSteps; i++) {
    const ang = a + (width * i) / tipSteps;
    points.push([Math.cos(ang) * r1, Math.sin(ang) * r1]);
  }
  const tipIndex = tipStart + Math.floor(tipSteps / 2);
  const backStart = points.length;
  leg(b, r1, r0);
  let freeBackIndex = points.length - 1;
  for (let i = backStart; i < points.length; i++) {
    if (Math.hypot(points[i][0], points[i][1]) < rFree) {
      freeBackIndex = i;
      break;
    }
  }
  return { points, freeOutIndex: Math.max(0, freeOutIndex), freeBackIndex, tipIndex };
}
