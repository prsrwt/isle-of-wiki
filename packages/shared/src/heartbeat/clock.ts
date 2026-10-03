import { SIM } from '../constants';

/**
 * Heartbeat's metronome: turns irregular real time (frames, timers) into exact fixed
 * simulation steps, so the game behaves identically at 30 fps, 144 fps, or on the server.
 */
export class FixedStepClock {
  /** Seconds per simulation step. */
  readonly step: number;
  /** Simulation steps run so far. */
  tick = 0;
  private acc = 0;

  constructor(
    hz: number = SIM.tickHz,
    /** Cap on steps per advance, so a long stall (tab in background) can't freeze the game catching up. */
    private readonly maxSteps = 5,
  ) {
    this.step = 1 / hz;
  }

  /** Feeds in elapsed real seconds; returns how many fixed steps are due now. */
  advance(elapsed: number): number {
    this.acc += Math.max(0, elapsed);
    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSteps) {
      this.acc -= this.step;
      steps++;
    }
    // Drop time we could not catch up on rather than spiralling.
    if (steps === this.maxSteps) this.acc = Math.min(this.acc, this.step);
    this.tick += steps;
    return steps;
  }

  /** How far (0..1) real time is between the last step and the next — for smooth rendering. */
  get alpha(): number {
    return this.acc / this.step;
  }
}
