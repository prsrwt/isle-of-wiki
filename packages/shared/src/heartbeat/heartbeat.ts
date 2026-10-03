import { FixedStepClock } from './clock';

/**
 * A system is one piece of game logic. `fixedUpdate` runs at the fixed simulation rate
 * (physics, race rules — must be deterministic); `frameUpdate` runs once per rendered
 * frame (camera, visuals, GNME).
 */
export interface System {
  readonly name: string;
  fixedUpdate?(dt: number, tick: number): void;
  frameUpdate?(dt: number, alpha: number): void;
}

/** Heartbeat: runs systems in the order they were added, on a fixed-step clock. */
export class Heartbeat {
  private readonly systems: System[] = [];

  constructor(readonly clock = new FixedStepClock()) {}

  add(system: System): this {
    this.systems.push(system);
    return this;
  }

  remove(system: System): void {
    const i = this.systems.indexOf(system);
    if (i >= 0) this.systems.splice(i, 1);
  }

  /** Advances by `elapsed` real seconds: due fixed steps first, then one frame update. */
  advance(elapsed: number): void {
    const steps = this.clock.advance(elapsed);
    for (let i = 0; i < steps; i++) {
      const tick = this.clock.tick - steps + i + 1;
      for (const s of this.systems) s.fixedUpdate?.(this.clock.step, tick);
    }
    for (const s of this.systems) s.frameUpdate?.(elapsed, this.clock.alpha);
  }
}
