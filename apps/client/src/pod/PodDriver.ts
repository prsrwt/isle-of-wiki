import * as THREE from 'three';
import type { System, Vec2, Vec3 } from '@isle-of-wiki/shared';
import { NO_INPUT, Pod, type PhysicsWorld, type PodInput } from '@isle-of-wiki/shared/physics';
import type { Input } from '../heartbeat/Input';

/**
 * Drives your pod: turns keys and gamepad into pod controls at the fixed simulation rate,
 * remembers the last two simulated poses so rendering can blend between them (physics ticks
 * 60 times a second, screens refresh at 60–240).
 *
 * Heartbeat runs `fixedUpdate` (controls) before the physics step and `afterPhysics` after it.
 */
export class PodDriver implements System {
  readonly name = 'pod';
  /** When false the pod gets no controls (menu, Folio open, mouse not captured, free-fly). */
  active = () => true;
  private pod: Pod | null = null;
  /** The controls used on the last step (for the RPM gauge). */
  lastInput: PodInput = NO_INPUT;
  /** Frozen pods aren't simulated (while travelling through a cave). */
  private frozen = false;
  private prevPos: Vec3 = [0, 0, 0];
  private curPos: Vec3 = [0, 0, 0];
  private prevHeading: Vec2 = [0, -1];
  private curHeading: Vec2 = [0, -1];

  constructor(private readonly input: Input) {}

  /**
   * A new pod on a new page's physics world, standing on `ground` facing `heading`. The old
   * pod belonged to the old world, which is freed as a whole, so it is simply dropped.
   */
  attach(physics: PhysicsWorld, ground: Vec3, heading: Vec2): void {
    this.pod = new Pod(physics, ground, heading);
    this.frozen = false;
    this.prevPos = this.curPos = this.pod.position();
    this.prevHeading = this.curHeading = this.pod.heading;
  }

  /** Stops the pod dead and stops simulating it (while travelling through a cave). */
  freeze(): void {
    this.frozen = true;
    this.pod?.body.setVelocity([0, 0, 0]);
  }

  /** Unfreezes after a failed trip through a cave, where it was. */
  release(): void {
    this.frozen = false;
  }

  get current(): Pod | null {
    return this.pod;
  }

  fixedUpdate(): void {
    if (!this.pod || this.frozen) return;
    this.lastInput = this.active() ? this.controls() : NO_INPUT;
    this.pod.step(this.lastInput);
  }

  afterPhysics(): void {
    if (!this.pod || this.frozen) return;
    this.prevPos = this.curPos;
    this.prevHeading = this.curHeading;
    this.curPos = this.pod.position();
    this.curHeading = this.pod.heading;
  }

  respawn(): void {
    if (!this.pod || this.frozen) return;
    this.pod.respawn();
    this.prevPos = this.curPos = this.pod.position();
    this.prevHeading = this.curHeading = this.pod.heading;
  }

  /** Where to draw the pod this frame: between the last two physics steps by `alpha` (0..1). */
  pose(alpha: number, pos: THREE.Vector3, heading: THREE.Vector2): void {
    const a = this.prevPos;
    const b = this.curPos;
    pos.set(a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha);
    const ha = this.prevHeading;
    const hb = this.curHeading;
    heading.set(ha[0] + (hb[0] - ha[0]) * alpha, ha[1] + (hb[1] - ha[1]) * alpha).normalize();
  }

  /** Keyboard W/S + A/D, left stick, triggers (RT throttle, LT brake), Shift / RB boost, Space / B brake. */
  private controls(): PodInput {
    const move = this.input.move();
    const { lt, rt } = this.input.triggers();
    return {
      throttle: Math.max(-1, Math.min(1, move.y + rt - lt)),
      steer: move.x,
      boost: this.input.isDown('boost'),
      brake: this.input.isDown('brake'),
    };
  }
}
