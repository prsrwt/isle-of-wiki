import { LAYOUT as L, WALL_HALF } from '../constants';
import type { Path, PathPoint } from './geom';
import { terrainHeight } from './terrain';
import type { Terrain, Vec3 } from './types';

export type Side = 1 | -1;

/** Point `across` metres to the right of the centreline and `up` above the floor. */
export const at = (p: PathPoint, across: number, up: number): Vec3 => [p.x + p.r[0] * across, p.y + up, p.z + p.r[1] * across];

/**
 * A stretch of canyon that holds content: slot k sits at arc length s0 + k·lineH.
 * Tracks also keep a ledger of which stretches of each wall are taken (or unusable),
 * measured in metres along the wall itself — on the inside of a hairpin a wall is much
 * shorter than the centreline, so counting in slots would let caves overlap.
 */
export class Track {
  private readonly wall = new Map<Side, { s: number[]; w: number[] }>();
  private readonly taken = new Map<Side, [number, number][]>([
    [1, []],
    [-1, []],
  ]);

  constructor(
    readonly path: Path,
    /** Arc length of slot 0's centre. */
    readonly s0: number,
    readonly lines: number,
    /** The carved ground, so caves can insist on real rock behind them. */
    private readonly terrain?: Terrain,
  ) {
    const from = s0 - L.lineH;
    const to = s0 + lines * L.lineH + 1;
    for (const side of [1, -1] as Side[]) {
      const s: number[] = [];
      const w: number[] = [];
      let prev: Vec3 | null = null;
      let acc = 0;
      for (let si = from; si <= to; si += 1) {
        const q = at(path.at(si), side * WALL_HALF, 0);
        if (prev) acc += Math.hypot(q[0] - prev[0], q[2] - prev[2]);
        prev = q;
        s.push(si);
        w.push(acc);
      }
      this.wall.set(side, { s, w });
    }
  }

  lineS(k: number): number {
    return this.s0 + k * L.lineH;
  }

  /** Point at the middle of slots k .. k+n-1. */
  span(k: number, n: number): PathPoint {
    return this.path.at(this.lineS(k) + ((n - 1) * L.lineH) / 2);
  }

  /** Marks a stretch of wall (centreline arc lengths sa..sb) unusable, e.g. where another canyon opens. */
  block(side: Side, sa: number, sb: number): void {
    (this.taken.get(side) as [number, number][]).push([this.wallPos(side, Math.min(sa, sb)), this.wallPos(side, Math.max(sa, sb))]);
  }

  take(side: Side, k: number, n: number, halfLen: number): void {
    (this.taken.get(side) as [number, number][]).push(this.interval(side, k, n, halfLen));
  }

  /**
   * Nearest free wall spot for something `halfLen` metres either side of the middle of
   * n slots; the first side in `sides` wins small shifts. With `needsRock`, only spots with
   * solid wall behind them count (canyons that merge or turn sharply leave open ground).
   */
  findSlot(line: number, n: number, halfLen: number, sides: Side[], needsRock = false): { side: Side; line: number } | null {
    const offsets = (r: number) => (r === 0 ? [0] : [-r, r]);
    const tries: [Side, number][] = [];
    for (const side of sides) for (let r = 0; r <= 2; r++) for (const d of offsets(r)) tries.push([side, d]);
    for (let r = 3; r < this.lines; r++) for (const side of sides) for (const d of offsets(r)) tries.push([side, d]);
    for (const [side, d] of tries) {
      if (this.fits(side, line + d, n, halfLen) && (!needsRock || this.rockBehind(side, line + d, n))) return { side, line: line + d };
    }
    return null;
  }

  /** Is there wall, tall enough to hold a cave, a few metres behind this stretch's wall line? */
  private rockBehind(side: Side, k: number, n: number): boolean {
    if (!this.terrain) return true;
    const p = this.span(k, n);
    for (const along of [-2.5, 0, 2.5]) {
      const [x, , z] = at(p, side * (WALL_HALF + 4), 0);
      const h = terrainHeight(this.terrain, x + p.t[0] * along, z + p.t[1] * along) - p.y;
      if (h < L.caveH + 1) return false;
    }
    return true;
  }

  /** Distance along the `side` wall at centreline arc length s. */
  private wallPos(side: Side, s: number): number {
    const { s: ss, w } = this.wall.get(side) as { s: number[]; w: number[] };
    const i = Math.min(Math.max(Math.floor(s - ss[0]), 0), ss.length - 2);
    const f = Math.min(Math.max(s - ss[i], 0), 1);
    return w[i] + (w[i + 1] - w[i]) * f;
  }

  private interval(side: Side, k: number, n: number, halfLen: number): [number, number] {
    const c = this.wallPos(side, this.lineS(k) + ((n - 1) * L.lineH) / 2);
    return [c - halfLen, c + halfLen];
  }

  private fits(side: Side, k: number, n: number, halfLen: number): boolean {
    if (k < 0 || k + n > this.lines) return false;
    const [a, b] = this.interval(side, k, n, halfLen);
    return (this.taken.get(side) as [number, number][]).every(([c, d]) => b <= c || a >= d);
  }
}
