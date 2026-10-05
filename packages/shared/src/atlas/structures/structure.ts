import { LAYOUT as L, WALL_HALF } from '../../constants';
import type { Rng } from '../../rng';
import type { BiomeShape } from '../biomes';
import type { ArenaRect } from '../furnish';
import { Path } from '../geom';
import type { Basin, BaseShape, Carve } from '../terrain';
import type { Side } from '../track';
import type { Bounds, Quat, RegionInfo, StructureId, Vec2, Vec3 } from '../types';

/**
 * A structure decides the *shape* of a track: where the Seedpod is, which canyons exist,
 * and which stretch of which canyon carries each article section. The Furnisher then fills
 * those stretches with caves and props, and the terrain is carved around them.
 * To add a structure: implement `Structure` in a new file and register it in ./index.ts.
 */
export interface StructureContext {
  rng: Rng;
  title: string;
  /** Article sections in reading order, with the slots each needs. */
  sections: { title: string; lines: number }[];
  /** Slots the infobox pit lane needs. */
  pitLines: number;
  biome: BiomeShape;
}

/** Where one article section lives: slots s0, s0+lineH, … along `path`. */
export interface TrackPlan {
  section: number;
  path: Path;
  /** Arc length of the section's gateway arch. */
  gatewayS: number;
  /** Arc length of slot 0's centre. */
  s0: number;
  lines: number;
  /** Stretches of wall where another canyon opens (no caves or boards there). */
  blocks: { side: Side; sa: number; sb: number }[];
  /** Stretches where a bridge or connector leaves through the wall: no arches there. */
  exits?: { sa: number; sb: number }[];
}

export interface StructurePlan {
  arena: ArenaRect;
  pit: { path: Path; s0: number; lines: number } | null;
  carves: Carve[];
  basins: Basin[];
  base?: BaseShape;
  tracks: TrackPlan[];
  /** Bridge decks over chasms. */
  decks: { center: Vec3; size: Vec3; rot: Quat }[];
  /** Stretches (outside section content) that get arches too, e.g. connectors. */
  archSpans: { path: Path; half: number; from: number; to: number }[];
  /** Canyons whose rims get biome landmarks. */
  landmarkPaths: { path: Path; half: number }[];
  regions: RegionInfo[];
  /** Area everything stands in (the terrain extends a margin beyond it). */
  extent: Bounds;
  arrival: Vec3;
  arrivalDir: Vec2;
}

export interface Structure {
  id: StructureId;
  plan(ctx: StructureContext): StructurePlan;
}

// ------------------------------------------------------------------ shared helpers

/** Gap kept between consecutive sections on the same canyon (gateway + breathing room). */
export const SECTION_LEAD = 14;
export const SECTION_TAIL = 16;

/**
 * Slots a section's canyon gets for content needing `lines`: spare wall so caves can shift
 * past places where the rock is missing (where canyons join or branch).
 */
export const trackLines = (lines: number): number => Math.ceil(lines * 1.3) + 4;

/** Metres of canyon a section needs. */
export const sectionLength = (lines: number): number => SECTION_LEAD + trackLines(lines) * L.lineH + SECTION_TAIL;

/** How far a canyon wall reaches beyond the canyon floor before meeting the plateau. */
export const wallReach = (b: BiomeShape): number => (b.rimHeight + b.plateauRoll) / b.wallSlope;

/** Minimum distance between two canyon centrelines so their walls don't merge. */
export const canyonSpacing = (b: BiomeShape): number => 2 * (WALL_HALF + wallReach(b)) + 8;

/**
 * Floor height along a canyon of length `len`: gentle rises and dips, flat (0) at both
 * ends so it meets the Seedpod and other canyons without a step.
 */
export function floorProfile(len: number, phase: number): (s: number) => number {
  const k = (2 * Math.PI) / L.floorWavelength;
  return (s) => L.floorAmp * Math.sin(s * k + phase) * Math.min(1, s / 60, Math.max(0, len - s) / 60);
}

/**
 * Pen-plotter for canyon centrelines: straight runs and circular arcs, sampled every 2 m.
 * Heading ψ points along (cos ψ, sin ψ) in (x, z); a positive arc angle turns toward
 * (−sin ψ, cos ψ).
 */
export class Turtle {
  readonly points: Vec2[];
  private heading: number;

  constructor(
    private x: number,
    private z: number,
    heading: number,
  ) {
    this.heading = heading;
    this.points = [[x, z]];
  }

  get pos(): Vec2 {
    return [this.x, this.z];
  }

  straight(len: number): this {
    const steps = Math.max(1, Math.ceil(len / 2));
    const dx = Math.cos(this.heading) * (len / steps);
    const dz = Math.sin(this.heading) * (len / steps);
    for (let i = 0; i < steps; i++) {
      this.x += dx;
      this.z += dz;
      this.points.push([this.x, this.z]);
    }
    return this;
  }

  arc(radius: number, angle: number): this {
    const side = Math.sign(angle);
    const cx = this.x - Math.sin(this.heading) * radius * side;
    const cz = this.z + Math.cos(this.heading) * radius * side;
    const start = Math.atan2(this.z - cz, this.x - cx);
    const steps = Math.max(2, Math.ceil((Math.abs(angle) * radius) / 2));
    for (let i = 1; i <= steps; i++) {
      const a = start + (angle * i) / steps;
      this.x = cx + Math.cos(a) * radius;
      this.z = cz + Math.sin(a) * radius;
      this.points.push([this.x, this.z]);
    }
    this.heading += angle;
    return this;
  }
}

/** Splits sections (in order) into at most `max` contiguous groups of similar total length. */
export function groupSections(lengths: number[], max: number): number[][] {
  const n = Math.min(max, lengths.length);
  const total = lengths.reduce((a, b) => a + b, 0);
  const groups: number[][] = [];
  let cur: number[] = [];
  let acc = 0;
  lengths.forEach((len, i) => {
    const remainingGroups = n - groups.length;
    const remainingItems = lengths.length - i;
    // Close the group once it reaches its share — unless the rest still need a group each.
    if (cur.length && (acc + len / 2 > (total / n) * (groups.length + 1) || remainingItems < remainingGroups) && remainingGroups > 1) {
      groups.push(cur);
      cur = [];
    }
    cur.push(i);
    acc += len;
  });
  if (cur.length) groups.push(cur);
  return groups;
}

/** The Seedpod, centred on the origin, deep enough for the infobox pit lane. */
export function seedpodPlan(pitLines: number): { arena: ArenaRect; pit: StructurePlan['pit']; basin: Basin } {
  const w = L.arenaW;
  const d = Math.max(L.arenaMinD, pitLines * L.lineH + 70);
  const arena: ArenaRect = { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 };
  const pitX = arena.x1 - WALL_HALF - 2;
  const pitPath = new Path(
    [
      [pitX, arena.z1 - 15],
      [pitX, arena.z0],
    ],
    () => 0,
  );
  const lines = Math.max(0, Math.floor((pitPath.length - 40) / L.lineH));
  const standDepth = 2 + L.standTiers * L.standTierW + 2;
  const basin: Basin = { minX: arena.x0, maxX: arena.x1 + standDepth, minZ: arena.z0, maxZ: arena.z1, floor: 0 };
  return { arena, pit: lines ? { path: pitPath, s0: 30, lines } : null, basin };
}

/** Bounds of a set of paths plus the arena. */
export function extentOf(paths: Path[], arena: ArenaRect, pad = 0): Bounds {
  const b: Bounds = { minX: arena.x0, maxX: arena.x1, minZ: arena.z0, maxZ: arena.z1 };
  for (const p of paths) {
    for (let i = 0; i < p.xs.length; i++) {
      b.minX = Math.min(b.minX, p.xs[i] - pad);
      b.maxX = Math.max(b.maxX, p.xs[i] + pad);
      b.minZ = Math.min(b.minZ, p.zs[i] - pad);
      b.maxZ = Math.max(b.maxZ, p.zs[i] + pad);
    }
  }
  return b;
}

/** Lays sections one after another along a path from arc length `from`. Returns where it stopped. */
export function laySections(path: Path, sections: { index: number; lines: number }[], from: number, into: TrackPlan[]): number {
  let cur = from;
  for (const { index, lines } of sections) {
    into.push({ section: index, path, gatewayS: cur + 4, s0: cur + SECTION_LEAD + L.lineH / 2, lines: trackLines(lines), blocks: [] });
    cur += sectionLength(lines);
  }
  return cur;
}

/** Seedpod region outline for minimaps. */
export function arenaRegion(title: string, a: ArenaRect): RegionInfo {
  return {
    title,
    kind: 'arena',
    path: [
      [a.x0, a.z0],
      [a.x1, a.z0],
      [a.x1, a.z1],
      [a.x0, a.z1],
    ],
  };
}
