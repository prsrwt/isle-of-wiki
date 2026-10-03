import { WALL_HALF } from '../../constants';
import { randRange } from '../../rng';
import { Path } from '../geom';
import {
  arenaRegion,
  canyonSpacing,
  extentOf,
  floorProfile,
  laySections,
  sectionLength,
  seedpodPlan,
  Turtle,
  type Structure,
  type StructurePlan,
  type TrackPlan,
} from './structure';

/**
 * Vine: the whole article as one long circuit, Boonta Eve style. It leaves the Seedpod to
 * the north, sweeps east–west in switchback passes carrying every section in order, then
 * runs home down a return straight on the far west and back into the Seedpod.
 *
 *     ╭──────────────────────╮
 *     │ ╭────────────────────╯   passes (sections, in order)
 *     │ ╰────────────────────╮
 *     │            ╭─────────╯
 *     │  return    │ approach
 *     ╰──▶ SEEDPOD ╯
 */

export const vine: Structure = {
  id: 'vine',
  plan(ctx): StructurePlan {
    const { rng, biome } = ctx;
    const { arena, pit, basin } = seedpodPlan(ctx.pitLines);
    const spacing = Math.max(150, canyonSpacing(biome) + 20);
    const turnR = spacing / 2;
    const need = ctx.sections.reduce((acc, s) => acc + sectionLength(s.lines), 0) + 40;

    // A roughly square field of passes.
    const width = Math.min(1800, Math.max(500, Math.sqrt(need * spacing * 1.2)));
    const perPass = width + Math.PI * turnR;
    let passes = Math.max(2, Math.ceil((need - width / 2) / perPass) + 1);
    if (passes % 2) passes++;

    const turtle = new Turtle(0, arena.z0 + 30, -Math.PI / 2);
    const firstRow = arena.z0 - 160;
    turtle.straight(turtle.pos[1] - (firstRow + turnR)).arc(turnR, Math.PI / 2);
    const contentStart = pointsLength(turtle.points);
    turtle.straight(width / 2 - turnR);
    for (let k = 1; k < passes; k++) {
      // U-turn northward, then the next pass the other way.
      turtle.arc(turnR, k % 2 ? -Math.PI : Math.PI).straight(width);
    }
    const contentEnd = pointsLength(turtle.points);
    // Home: past the west ends, down the return straight, east into the Seedpod.
    const returnX = -width / 2 - spacing - turnR;
    turtle.straight(turtle.pos[0] - (returnX + turnR)).arc(turnR, -Math.PI / 2);
    turtle.straight(-turnR - turtle.pos[1]).arc(turnR, -Math.PI / 2);
    turtle.straight(arena.x0 + 30 - turtle.pos[0]);

    const raw = new Path(turtle.points, () => 0);
    const path = new Path(turtle.points, floorProfile(raw.length, randRange(rng, 0, Math.PI * 2)));
    const tracks: TrackPlan[] = [];
    laySections(
      path,
      ctx.sections.map((s, index) => ({ index, lines: s.lines })),
      contentStart + 10,
      tracks,
    );

    return {
      arena,
      pit,
      carves: [{ path, half: WALL_HALF }],
      basins: [basin],
      tracks,
      decks: [],
      archSpans: [
        { path, half: WALL_HALF, from: 40, to: contentStart },
        { path, half: WALL_HALF, from: contentEnd, to: path.length - 40 },
      ],
      landmarkPaths: [{ path, half: WALL_HALF }],
      regions: [
        arenaRegion(ctx.title, arena),
        ...ctx.sections.map((s, i) => ({ title: s.title, kind: 'section' as const, section: i, path: sparseBetween(path, tracks[i]) })),
        { title: 'Home straight', kind: 'connector', path: sparseBetween(path, { s0: contentEnd, lines: 0, end: path.length }) },
      ],
      extent: extentOf([path], arena),
      arrival: [0, 2, arena.z0 + 40],
      arrivalDir: [0, -1],
    };
  },
};

function pointsLength(points: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return len;
}

/** Sparse centreline of one section's stretch (for minimaps). */
function sparseBetween(path: Path, t: { s0: number; lines: number; end?: number }): [number, number][] {
  const end = t.end ?? t.s0 + t.lines * 4.5;
  const out: [number, number][] = [];
  for (let s = t.s0; s <= end; s += 40) {
    const p = path.at(s);
    out.push([p.x, p.z]);
  }
  return out;
}
