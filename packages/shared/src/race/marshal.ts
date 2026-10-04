import { SIM } from '../constants';

/** Race timing, in Heartbeat ticks (60 a second). */
export const RACE = {
  /** 3, 2, 1, GO. */
  countdownTicks: 3 * SIM.tickHz,
  /**
   * What every trip through a link tunnel costs on the clock, however long the page takes to
   * download and build: fast and slow connections race on equal terms.
   */
  tunnelTicks: 2 * SIM.tickHz,
} as const;

/**
 * - `grid`: on the start page, waiting for the racer to take control
 * - `countdown`: 3, 2, 1; the pod can't move yet
 * - `racing`: the clock runs
 * - `tunnel`: travelling through a link to another page (the clock runs for `RACE.tunnelTicks`)
 * - `finished`: reached the target; the clock has stopped, and you can keep exploring
 */
export type RacePhase = 'grid' | 'countdown' | 'racing' | 'tunnel' | 'finished';

export interface RaceResult {
  timeMs: number;
  /** Links travelled through. */
  hops: number;
  /** Every page visited, start to target. */
  path: string[];
}

/** Wikipedia titles compare equal regardless of underscores or the first letter's case. */
export function samePage(a: string, b: string): boolean {
  const norm = (t: string) => {
    const s = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  return norm(a) === norm(b);
}

/** "0:42.18", "12:03.50", "1:02:03.50". */
export function formatRaceTime(ms: number): string {
  const cs = Math.floor(Math.max(0, ms) / 10);
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const frac = String(cs % 100).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}.${frac}` : `${m}:${ss}.${frac}`;
}

/**
 * The Marshal runs one racer's race: holds them on the grid, counts down, keeps time, logs
 * every page they travel to and waves the flag when they reach the target.
 *
 * It counts Heartbeat ticks, not wall-clock time, so a race is timed the same on every
 * machine and the server (Phase 4) can re-run it. `step` runs once per fixed tick.
 */
export class Marshal {
  phase: RacePhase = 'grid';
  /** Race time so far, in ticks. */
  ticks = 0;
  /** Ticks left on the countdown. */
  countdownLeft = 0;
  /** Pages visited so far, starting with the start page. */
  readonly path: string[];
  private tunnelTicks = 0;
  private finishTicks: number | null = null;

  constructor(readonly config: { start: string; target: string }) {
    this.path = [config.start];
  }

  /** The page you're on (or leaving, while in a tunnel). */
  get page(): string {
    return this.path[this.path.length - 1];
  }

  get hops(): number {
    return this.path.length - 1;
  }

  /** Race time in milliseconds. */
  get timeMs(): number {
    return Math.round(((this.finishTicks ?? this.ticks) * 1000) / SIM.tickHz);
  }

  /** Whether the pod may be driven: not on the grid or during the countdown. */
  get canDrive(): boolean {
    return this.phase === 'racing' || this.phase === 'finished';
  }

  /** The countdown's number (3, 2, 1), or 0 when it isn't counting down. */
  get countdownNumber(): number {
    return this.phase === 'countdown' ? Math.ceil(this.countdownLeft / SIM.tickHz) : 0;
  }

  /** Leaves the grid: the countdown starts. Does nothing once the race is under way. */
  startCountdown(): void {
    if (this.phase !== 'grid') return;
    this.phase = 'countdown';
    this.countdownLeft = RACE.countdownTicks;
  }

  /** One fixed tick. */
  step(): void {
    if (this.phase === 'countdown') {
      if (--this.countdownLeft <= 0) this.phase = 'racing';
    } else if (this.phase === 'racing') {
      this.ticks++;
    } else if (this.phase === 'tunnel') {
      // The tunnel costs exactly RACE.tunnelTicks: the clock stops while the page loads after.
      if (this.tunnelTicks < RACE.tunnelTicks) {
        this.tunnelTicks++;
        this.ticks++;
      }
    }
  }

  /**
   * Into a link tunnel. Returns false (and changes nothing) unless racing; after the finish you
   * can still travel, untimed.
   */
  enterTunnel(): boolean {
    if (this.phase !== 'racing') return false;
    this.phase = 'tunnel';
    this.tunnelTicks = 0;
    return true;
  }

  /**
   * Out of the tunnel onto `page` (its canonical title). Tops the clock up to the tunnel's full
   * cost if the page arrived early. Returns true when that page is the target: the race is won.
   */
  arrive(page: string): boolean {
    if (this.phase !== 'tunnel') return false;
    this.ticks += RACE.tunnelTicks - this.tunnelTicks;
    this.path.push(page);
    if (samePage(page, this.config.target)) {
      this.phase = 'finished';
      this.finishTicks = this.ticks;
      return true;
    }
    this.phase = 'racing';
    return false;
  }

  /** The page couldn't be reached: back where you were. The time spent stays on the clock. */
  abortTunnel(): void {
    if (this.phase === 'tunnel') this.phase = 'racing';
  }

  result(): RaceResult | null {
    return this.phase === 'finished' ? { timeMs: this.timeMs, hops: this.hops, path: [...this.path] } : null;
  }
}
