import * as THREE from 'three';
import type { System } from '@isle-of-wiki/shared';
import type { Input } from '../heartbeat/Input';

const LOOK_SPEED = 0.0022;
const PAD_LOOK_SPEED = 2.4;
const PITCH_LIMIT = 1.55;

/**
 * Mouse capture and looking around, for both cameras. Click to capture the mouse.
 * Flying (`flying`, debug key F): a spectator camera moved by Heartbeat's input actions, with
 * `yaw` measured from north. Driving: it only collects look angles — `yaw` relative to the
 * pod's heading — and the pod camera places the view.
 */
export class FreeFlyControls implements System {
  readonly name = 'free-fly';
  speed = 45;
  /** When false, clicks don't capture the mouse (e.g. while the menu is open). */
  enabled = false;
  /** Free-fly spectator camera (true) or look-only for the pod (false). */
  flying = true;
  onLockChange: (locked: boolean) => void = () => {};
  /** Look angles plus seconds since the mouse or right stick last moved them. */
  readonly look = { yaw: 0, pitch: 0, idle: 0 };
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly move = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly input: Input,
  ) {
    dom.addEventListener('click', () => {
      if (this.enabled && !this.locked) void dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.input.clear();
      this.onLockChange(this.locked);
    });
    // Older browsers report a refused lock only through this event.
    document.addEventListener('pointerlockerror', () => this.onLockChange(false));
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || (e.movementX === 0 && e.movementY === 0)) return;
      this.look.yaw -= e.movementX * LOOK_SPEED;
      this.look.pitch = THREE.MathUtils.clamp(this.look.pitch - e.movementY * LOOK_SPEED, -PITCH_LIMIT, PITCH_LIMIT);
      this.look.idle = 0;
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.flying) return;
        this.speed = THREE.MathUtils.clamp(this.speed * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 5, 800);
      },
      { passive: true },
    );
  }

  get locked(): boolean {
    return document.pointerLockElement === this.dom;
  }

  /** Captures the mouse (needs a recent click or key press). Resolves false if the browser refuses. */
  async lock(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      await this.dom.requestPointerLock();
      return true;
    } catch {
      return false;
    }
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** Free-fly only: place the camera. */
  setPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.camera.position.set(x, y, z);
    this.look.yaw = yaw;
    this.look.pitch = pitch;
    this.applyRotation();
  }

  /** Sets the look angles without moving the camera (switching between flying and driving). */
  setLook(yaw: number, pitch: number): void {
    this.look.yaw = yaw;
    this.look.pitch = pitch;
    this.look.idle = 0;
  }

  frameUpdate(dt: number): void {
    this.look.idle += dt;
    if (this.enabled && (this.input.look.x !== 0 || this.input.look.y !== 0)) {
      this.look.yaw -= this.input.look.x * PAD_LOOK_SPEED * dt;
      this.look.pitch = THREE.MathUtils.clamp(this.look.pitch - this.input.look.y * PAD_LOOK_SPEED * dt, -PITCH_LIMIT, PITCH_LIMIT);
      this.look.idle = 0;
    }
    if (!this.flying) return;
    this.applyRotation();
    if (!this.enabled) return;
    const { x, y } = this.input.move();
    const up = (this.input.isDown('up') ? 1 : 0) - (this.input.isDown('down') ? 1 : 0);
    this.move.set(x, 0, -y).applyQuaternion(this.camera.quaternion);
    this.move.y += up;
    if (this.move.lengthSq() === 0) return;
    const boost = this.input.isDown('boost') ? 4 : 1;
    const len = Math.min(1, this.move.length());
    this.camera.position.addScaledVector(this.move.normalize(), this.speed * boost * len * dt);
  }

  private applyRotation(): void {
    this.euler.set(this.look.pitch, this.look.yaw, 0);
    this.camera.quaternion.setFromEuler(this.euler);
  }
}
