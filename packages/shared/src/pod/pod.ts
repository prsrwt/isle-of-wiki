import { LAYOUT } from '../constants';
import type { Vec2, Vec3 } from '../atlas/types';
import { PhysicsWorld, type Body } from '../physics/physics';

/** Pod handling. Units: metres, seconds, radians. */
export const POD = {
  /** The cockpit's solid sphere. */
  radius: 1.1,
  /** The engines out front, as solid spheres (x right, y up, z back; nose toward −z). */
  engines: [
    { offset: [-1.7, 0.15, -3.6], radius: 0.6 },
    { offset: [-1.7, 0.15, -5.4], radius: 0.6 },
    { offset: [1.7, 0.15, -3.6], radius: 0.6 },
    { offset: [1.7, 0.15, -5.4], radius: 0.6 },
  ] as { offset: Vec3; radius: number }[],
  /** Height of the pod's centre above whatever it hovers over. */
  ride: 1.8,
  maxSpeed: 70,
  boostSpeed: 100,
  accel: 30,
  boostAccel: 50,
  brake: 60,
  reverseSpeed: 18,
  reverseAccel: 20,
  /** Share of speed lost per second with the throttle released. */
  coast: 0.35,
  /** Share of speed lost per second while scraping a wall. */
  scrapeDrag: 1.2,
  /** How fast sideways slide is removed, per second (on the ground / in the air). */
  grip: 5,
  airGrip: 0.6,
  /**
   * Steering, like a car: no turning at a standstill; at low speed the tightest circle is
   * `minTurnRadius`, so the turn rate grows with speed; at high speed grip (`turnGrip`, the
   * sideways acceleration the pod can hold, m/s²) limits it, so turns widen. Never faster than
   * `maxTurnRate` (rad/s).
   */
  minTurnRadius: 8,
  turnGrip: 70,
  maxTurnRate: 2.4,
  /** Share of thrust and steering left while airborne. */
  airControl: 0.35,
  gravity: 30,
  /** Hover spring: stiffness and damping (critically damped: damping² = 4 · spring). */
  spring: 110,
  damping: 21,
  /** A surface further than this below ride height gives no lift. */
  reach: 6,
  /** Look-ahead times (s): the pod lines up with a bridge deck before it reaches it. */
  lookahead: [0.15, 0.3, 0.5, 0.7],
  /** Also always check this far past the nose, so a slow pod nosing onto a deck rises to it. */
  bumper: 2.2,
  /** Surfaces steeper than this (normal's up component) are walls, never hovered over. */
  wallNormalY: 0.7,
  /** Boost tank: share drained / refilled per second. */
  boostDrain: 0.35,
  boostRefill: 0.12,
  /** After running the tank dry, boost stays off until it has refilled this far. */
  boostRearm: 0.3,
  /** Falling this far below the last safe spot respawns you there. */
  fallLimit: 25,
  /** Record a safe spot every this many steps of steady hovering. */
  safeEvery: 30,
} as const;

/**
 * One step's controls. throttle −1 (brake/reverse)..1, steer −1 (left)..1 (right). Steering
 * works whenever the pod is moving; how hard it turns depends on speed (see `POD.turnGrip`).
 */
export interface PodInput {
  throttle: number;
  steer: number;
  boost: boolean;
  /** Brake (Space): slows hard to a stop, never into reverse, and overrides the throttle. */
  brake?: boolean;
}

export const NO_INPUT: PodInput = { throttle: 0, steer: 0, boost: false };

/** Horizontal velocity change (m/s, squared) from a collision that counts as scraping. */
const SCRAPE_SQ = 0.25 * 0.25;

const clamp1 = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

/** Unit vector, using only operations every machine rounds identically (no sin/cos). */
function unit(x: number, z: number): Vec2 {
  const len = Math.sqrt(x * x + z * z);
  return len > 1e-12 ? [x / len, z / len] : [0, -1];
}

interface Support {
  /** Highest surface to hover over (centre and look-ahead), or null. */
  top: number | null;
  /** Surface straight below the pod, or null. */
  below: number | null;
}

/**
 * A hover pod: a sphere the physics engine keeps out of walls and props, driven by setting
 * its velocity each fixed step (arcade handling, not tyre physics). Call `step` before every
 * `PhysicsWorld.step`. Only + − × ÷ and square roots in here, so with Rapier's deterministic
 * build the same inputs give the same race on every machine.
 *
 * Heading is a unit vector (x, z) — x east, z south — so turning never needs sin/cos.
 */
export class Pod {
  readonly body: Body;
  heading: Vec2;
  /** Boost tank, 0..1. */
  boostTank = 1;
  /** Hovering over something (not falling). */
  supported = false;
  /** Touching a wall or prop that is slowing it down. */
  scraping = false;
  /** While scraping: the horizontal direction (unit x, z) the wall pushed the pod — away from the wall. */
  scrapePush: Vec2 = [0, 0];
  boosting = false;
  /** Tank ran dry: no boost until it refills to `POD.boostRearm`. */
  boostLocked = false;
  respawns = 0;
  /** What the hover saw last step: the surface below and the highest one ahead (null = none). */
  surfaceBelow: number | null = null;
  surfaceTop: number | null = null;
  /** Velocity set last step (x, y, z), to see what collisions changed. */
  private want: Vec3 | null = null;
  private safe: { pos: Vec3; heading: Vec2 };
  private safeTicks = 0;

  /** `ground` is a point on the surface; the pod appears at ride height above it. */
  constructor(
    private readonly world: PhysicsWorld,
    ground: Vec3,
    heading: Vec2,
  ) {
    this.heading = unit(heading[0], heading[1]);
    const start: Vec3 = [ground[0], ground[1] + POD.ride, ground[2]];
    this.body = world.addBody(start, POD.radius, { friction: 0, restitution: 0.1 }, POD.engines);
    this.body.setGravityScale(0); // gravity is applied here, so hover and fall share one rule
    this.turnBody();
    this.safe = { pos: start, heading: this.heading };
  }

  position(): Vec3 {
    return this.body.position();
  }

  velocity(): Vec3 {
    return this.body.velocity();
  }

  /** Signed speed along the heading (m/s); negative when reversing. */
  forwardSpeed(): number {
    const v = this.body.velocity();
    return v[0] * this.heading[0] + v[2] * this.heading[1];
  }

  step(input: PodInput, dt = PhysicsWorld.STEP): void {
    const p = this.body.position();
    let [vx, vy, vz] = this.body.velocity();

    if (this.want) {
      // Scraping: a wall or prop changed the horizontal velocity we set last step.
      const dx = vx - this.want[0];
      const dz = vz - this.want[2];
      const pushSq = dx * dx + dz * dz;
      this.scraping = pushSq > SCRAPE_SQ;
      if (this.scraping) {
        const len = Math.sqrt(pushSq);
        this.scrapePush = [dx / len, dz / len];
      }
      // Hitting a slope or a prop's edge must not launch the pod upward (it would drive up
      // canyon walls like ramps): only the hover lifts it. Contacts can still stop it. (The
      // tolerance covers the physics engine handing velocities back in 32-bit precision.)
      if (vy > this.want[1] + 0.05) vy = Math.max(this.want[1], 0);
    }

    // --- Hover ---------------------------------------------------------------
    const s = this.support(p, vx, vz);
    this.surfaceBelow = s.below;
    this.surfaceTop = s.top;
    this.supported = s.top !== null;
    if (s.top !== null) {
      const ceiling = (s.below ?? s.top) + LAYOUT.hoverCeiling;
      const target = Math.min(s.top + POD.ride, ceiling);
      let a = POD.spring * (target - p[1]) - POD.damping * vy;
      // Dropping off a ledge falls no faster than gravity; the spring catches it at the bottom.
      if (a < -POD.gravity) a = -POD.gravity;
      vy += a * dt;
    } else {
      vy -= POD.gravity * dt;
    }

    // --- Thrust and steering ---------------------------------------------------
    const [hx, hz] = this.heading;
    const rx = -hz; // right-hand side
    const rz = hx;
    let vf = vx * hx + vz * hz;
    let vl = vx * rx + vz * rz;
    const control = this.supported ? 1 : POD.airControl;
    const throttle = input.brake ? 0 : clamp1(input.throttle);

    // Without the lock-out, an empty tank would refill a sliver each step and boost would
    // flicker on and off every other step instead of ending.
    if (this.boostLocked && this.boostTank >= POD.boostRearm) this.boostLocked = false;
    this.boosting = input.boost && throttle > 0 && !this.boostLocked && this.boostTank > 0;
    this.boostTank = this.boosting ? Math.max(0, this.boostTank - POD.boostDrain * dt) : Math.min(1, this.boostTank + POD.boostRefill * dt);
    if (this.boostTank === 0) this.boostLocked = true;
    const top = this.boosting ? POD.boostSpeed : POD.maxSpeed;

    // Throttle against the way you're moving brakes (hard), and carries on through zero.
    if (input.brake) {
      const slow = POD.brake * control * dt;
      vf = vf > 0 ? Math.max(0, vf - slow) : Math.min(0, vf + slow);
    } else if (throttle > 0) {
      if (vf < 0) vf = vf + POD.brake * throttle * control * dt;
      else if (vf < top) vf = Math.min(top, vf + (this.boosting ? POD.boostAccel : POD.accel) * throttle * control * dt);
    } else if (throttle < 0) {
      if (vf > 0) vf = vf + POD.brake * throttle * control * dt;
      else vf = Math.max(-POD.reverseSpeed, vf + POD.reverseAccel * throttle * control * dt);
    } else {
      vf -= vf * POD.coast * dt;
    }
    // Faster than allowed (boost ran out, or a downhill): ease back.
    if (vf > top) vf -= (vf - top) * 1.5 * dt;
    if (this.scraping) vf -= vf * POD.scrapeDrag * dt;
    vl -= vl * Math.min(1, (this.supported ? POD.grip : POD.airGrip) * dt);

    vx = hx * vf + rx * vl;
    vz = hz * vf + rz * vl;

    // Turn: nudge the heading toward its right-hand side and re-normalise.
    // Reversing swings the nose the other way, as in a car.
    const speed = Math.abs(vf);
    const grip = speed > 1e-6 ? Math.min(POD.maxTurnRate, speed / POD.minTurnRadius, POD.turnGrip / speed) : 0;
    const rate = grip * clamp1(input.steer) * (vf < 0 ? -1 : 1) * control;
    this.heading = unit(hx + rx * rate * dt, hz + rz * rate * dt);
    this.turnBody();

    this.body.setVelocity([vx, vy, vz]);
    this.want = [vx, vy, vz];

    // --- Safe spots and falling ---------------------------------------------------
    if (s.below !== null && !this.scraping) {
      if (++this.safeTicks >= POD.safeEvery) {
        this.safeTicks = 0;
        this.safe = { pos: [p[0], s.below + POD.ride, p[2]], heading: this.heading };
      }
    } else {
      this.safeTicks = 0;
    }
    if (p[1] < this.safe.pos[1] - POD.fallLimit) this.respawn();
  }

  /** Back to the last safe spot, stopped. */
  respawn(): void {
    this.place(this.safe.pos, this.safe.heading);
    this.respawns++;
  }

  dispose(): void {
    this.world.removeBody(this.body);
  }

  private place(pos: Vec3, heading: Vec2): void {
    this.body.teleport(pos);
    this.body.setVelocity([0, 0, 0]);
    this.heading = heading;
    this.turnBody();
    this.want = null;
    this.scraping = false;
  }

  /**
   * Turns the solid body (and so the engines) to face the heading. The yaw quaternion comes
   * from the heading by half-angle formulas — square roots only, no sin/cos. Facing −z is yaw 0.
   */
  private turnBody(): void {
    const [hx, hz] = this.heading;
    // Facing (hx, hz) = (−sin θ, −cos θ): cos θ = −hz, sin θ = −hx.
    const c = -hz;
    const qw = Math.sqrt(Math.max(0, (1 + c) / 2));
    const qy = (hx > 0 ? -1 : 1) * Math.sqrt(Math.max(0, (1 - c) / 2));
    this.body.setYaw(qy, qw);
  }

  /**
   * What the pod can hover over: rays straight down from above the pod at the pod itself,
   * then — for decks only, the sudden steps; the ground is smooth enough to just follow — at a
   * few points along its path and just past its nose. Walls, and decks far above what the pod
   * is on, don't count.
   */
  private support(p: Vec3, vx: number, vz: number): Support {
    const fromAbove = LAYOUT.hoverCeiling;
    const range = fromAbove + POD.ride + POD.reach;
    const hit = (x: number, z: number, filter: 'hover' | 'decks'): number | null => {
      const h = this.world.castRay([x, p[1] + fromAbove, z], [0, -1, 0], range, filter);
      return h && h.distance > 1e-6 && h.normal[1] >= POD.wallNormalY ? h.point[1] : null;
    };
    const below = hit(p[0], p[2], 'hover');
    let top = below;
    const consider = (x: number, z: number) => {
      const y = hit(x, z, 'decks');
      if (y === null || (below !== null && y > below + LAYOUT.mesaMaxH + 1)) return;
      if (top === null || y > top) top = y;
    };
    for (const t of POD.lookahead) consider(p[0] + vx * t, p[2] + vz * t);
    consider(p[0] + this.heading[0] * POD.bumper, p[2] + this.heading[1] * POD.bumper);
    return { top, below };
  }
}
