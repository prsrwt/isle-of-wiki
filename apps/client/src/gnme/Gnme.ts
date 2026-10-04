import * as THREE from 'three';
import type { System } from '@isle-of-wiki/shared';

/**
 * GNME — the Goodnight Moon Engine.
 *
 * "Goodnight room. Goodnight moon." Each frame it walks the world's chunks and decides how
 * awake each needs to be for the camera:
 *   awake  — everything: text, cave rocks, boards, paintings
 *   drowsy — big shapes only (terrain, cliffs, arches, glowing cave mouths)
 *   asleep — not drawn at all
 * Chunks are built lazily ("good morning"), nearest first, within a per-frame time budget,
 * so a world appears as soon as the chunks around you exist.
 */
export type Rest = 'awake' | 'drowsy' | 'asleep';

export interface SleepCounts {
  caves: number;
  letters: number;
  rocks: number;
}

/** Anything GNME can put to sleep. */
export interface Sleeper {
  readonly key: string;
  readonly center: THREE.Vector3;
  readonly radius: number;
  readonly built: boolean;
  readonly state: Rest;
  /** What it is currently not drawing, for the bedtime roll call. */
  readonly sleeping: SleepCounts;
  build(): void;
  rest(state: Rest): void;
}

export interface GnmeOptions {
  /** Within this distance (m, beyond the chunk's radius) everything is awake. */
  awakeDistance: number;
  /** Within this, big shapes are drawn; beyond it the chunk sleeps. */
  drowsyDistance: number;
  /** A chunk only changes state once it is this much further past the line — stops flicker. */
  hysteresis: number;
  /** Milliseconds per frame GNME may spend building chunks. */
  buildBudgetMs: number;
}

export const DEFAULT_GNME: GnmeOptions = { awakeDistance: 380, drowsyDistance: 2600, hysteresis: 1.15, buildBudgetMs: 6 };

export interface GnmeStats {
  awake: number;
  drowsy: number;
  asleep: number;
  unbuilt: number;
  /** Things currently put to sleep (not drawn). */
  sleeping: SleepCounts;
}

export class Gnme implements System {
  readonly name = 'gnme';
  private readonly queue: { s: Sleeper; target: Rest; d: number }[] = [];
  private lightsOut = false;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly sleepers: Sleeper[],
    private readonly opts: GnmeOptions = DEFAULT_GNME,
  ) {}

  /**
   * Good morning: build and wake everything `point` needs, nearest first, yielding a frame
   * whenever the budget is spent so animations (loading screen, link tunnel) never stall.
   */
  async wakeAround(point: THREE.Vector3, budgetMs = 12): Promise<void> {
    const jobs = this.sleepers
      .map((s) => ({ s, d: this.distance(s, point) }))
      .map((j) => ({ ...j, target: this.desired(j.s, j.d) }))
      .filter((j) => j.target !== 'asleep')
      .sort((a, b) => a.d - b.d);
    let start = performance.now();
    for (const { s, target } of jobs) {
      s.build();
      s.rest(target);
      if (performance.now() - start > budgetMs) {
        await new Promise(requestAnimationFrame);
        start = performance.now();
      }
    }
  }

  /**
   * Lights out: something covers the whole screen (Folio), so say goodnight to every cell and
   * keep them asleep until the lights come back on. Built cells stay built, so waking is instant.
   */
  setLightsOut(on: boolean): void {
    this.lightsOut = on;
    if (on) for (const s of this.sleepers) if (s.state !== 'asleep') s.rest('asleep');
  }

  frameUpdate(): void {
    if (this.lightsOut) return;
    const cam = this.camera.position;
    this.queue.length = 0;
    for (const s of this.sleepers) {
      const d = this.distance(s, cam);
      const target = this.desired(s, d);
      if (target === s.state) continue;
      if (target !== 'asleep' && !s.built) this.queue.push({ s, target, d });
      else s.rest(target);
    }
    if (!this.queue.length) return;
    this.queue.sort((a, b) => a.d - b.d);
    const start = performance.now();
    for (const { s, target } of this.queue) {
      s.build();
      s.rest(target);
      if (performance.now() - start > this.opts.buildBudgetMs) break;
    }
  }

  stats(): GnmeStats {
    const st: GnmeStats = { awake: 0, drowsy: 0, asleep: 0, unbuilt: 0, sleeping: { caves: 0, letters: 0, rocks: 0 } };
    for (const s of this.sleepers) {
      st[s.state]++;
      if (!s.built) st.unbuilt++;
      const z = s.sleeping;
      st.sleeping.caves += z.caves;
      st.sleeping.letters += z.letters;
      st.sleeping.rocks += z.rocks;
    }
    return st;
  }

  private distance(s: Sleeper, p: THREE.Vector3): number {
    return Math.max(0, s.center.distanceTo(p) - s.radius);
  }

  private desired(s: Sleeper, d: number): Rest {
    const { awakeDistance: a, drowsyDistance: w, hysteresis: h } = this.opts;
    // Stay in the current state a little longer than it takes to enter it.
    const awakeLimit = s.state === 'awake' ? a * h : a;
    const drowsyLimit = s.state === 'asleep' ? w : w * h;
    if (d <= awakeLimit) return 'awake';
    if (d <= drowsyLimit) return 'drowsy';
    return 'asleep';
  }
}

/** The bedtime roll call shown in the GNME overlay. */
export function goodnightLines(st: GnmeStats): string[] {
  const n = (v: number) => v.toLocaleString('en');
  return [
    `Awake ${st.awake} · Drowsy ${st.drowsy} · Asleep ${st.asleep} cells${st.unbuilt ? ` (${st.unbuilt} not yet built)` : ''}`,
    `Goodnight, ${n(st.sleeping.caves)} caves.`,
    `Goodnight, ${n(st.sleeping.letters)} letters.`,
    `Goodnight, ${n(st.sleeping.rocks)} rocks.`,
  ];
}
