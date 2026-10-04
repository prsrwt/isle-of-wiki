import type { Gate, LinkSource, Vec2, Vec3 } from '../atlas/types';

/** Stable key for a link's place in the article. */
export const linkKey = (s: LinkSource): string => (s.kind === 'block' ? `b${s.block}:${s.span}` : `i${s.row}:${s.span}`);

/**
 * Which cave stands for which link. Every article link has its own cave; the only exception
 * is an infobox link the pit lane had no room for, which borrows another cave to the same page.
 */
export class CaveIndex {
  private readonly bySource = new Map<string, Gate>();
  private readonly byTarget = new Map<string, Gate>();

  constructor(gates: readonly Gate[]) {
    for (const g of gates) {
      this.bySource.set(linkKey(g.source), g);
      if (!this.byTarget.has(g.target)) this.byTarget.set(g.target, g);
    }
  }

  /** The cave built for exactly this link, if there is one. */
  exact(source: LinkSource): Gate | null {
    return this.bySource.get(linkKey(source)) ?? null;
  }

  /** The cave to use for a link: its own, else the first cave to the same page, else none. */
  forLink(source: LinkSource, target: string): Gate | null {
    return this.exact(source) ?? this.byTarget.get(target) ?? null;
  }
}

/** Where the Thread's cave is relative to you. */
export interface ThreadGuide {
  /** Straight-line distance (m). */
  distance: number;
  /** Horizontal distance (m). */
  ground: number;
  /**
   * How far to turn (radians, -π..π) from the way you face to face the cave, seen from above:
   * positive = turn right, negative = turn left, ±π = straight behind.
   */
  turn: number;
  /** Height of the cave above you (m); negative when it's below. */
  climb: number;
}

/**
 * Thread maths. `facing` is your horizontal heading (x, z), any length; when it's zero (looking
 * straight down) the turn is reported as 0. World axes: x east, z south, y up.
 */
export function threadGuide(from: Vec3, facing: Vec2, to: Vec3): ThreadGuide {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const climb = to[1] - from[1];
  const ground = Math.hypot(dx, dz);
  const flen = Math.hypot(facing[0], facing[1]);
  let turn = 0;
  if (flen > 1e-9 && ground > 1e-9) {
    const fx = facing[0] / flen;
    const fz = facing[1] / flen;
    // With x east and z south, a clockwise turn (to the right, seen from above) has a positive cross product.
    turn = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
  }
  return { distance: Math.hypot(ground, climb), ground, turn, climb };
}
