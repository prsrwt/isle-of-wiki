import * as THREE from 'three';
import type { System } from '@isle-of-wiki/shared';
import type { Input } from '../heartbeat/Input';

const LOOK_SPEED = 0.0022;
const PAD_LOOK_SPEED = 2.4;
const PITCH_LIMIT = 1.55;

/**
 * Spectator camera for inspecting worlds (replaced by the pod in Phase 2).
 * Click to capture the mouse; movement comes from Heartbeat's input actions.
 */
export class FreeFlyControls implements System {
  readonly name = 'free-fly';
  speed = 45;
  /** When false, clicks don't capture the mouse (e.g. while the menu is open). */
  enabled = false;
  onLockChange: (locked: boolean) => void = () => {};
  private yaw = 0;
  private pitch = 0;
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
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * LOOK_SPEED;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * LOOK_SPEED, -PITCH_LIMIT, PITCH_LIMIT);
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        this.speed = THREE.MathUtils.clamp(this.speed * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 5, 800);
      },
      { passive: true },
    );
  }

  get locked(): boolean {
    return document.pointerLockElement === this.dom;
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.camera.position.set(x, y, z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.applyRotation();
  }

  frameUpdate(dt: number): void {
    if (this.enabled) {
      this.yaw -= this.input.look.x * PAD_LOOK_SPEED * dt;
      this.pitch = THREE.MathUtils.clamp(this.pitch - this.input.look.y * PAD_LOOK_SPEED * dt, -PITCH_LIMIT, PITCH_LIMIT);
    }
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
    this.euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this.euler);
  }
}
