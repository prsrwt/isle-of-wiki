import * as THREE from 'three';

const CHASE_DIST = 11;
const CHASE_HEIGHT = 3.2;
/** The camera looks slightly down at the pod. */
const CHASE_PITCH = -0.16;
/** How quickly the camera swings round behind the pod in a turn, and follows bumps (per second). */
const YAW_FOLLOW = 6;
const HEIGHT_FOLLOW = 8;
/** After this long without mouse/stick look, the view eases back to behind the pod. */
const RECENTRE_AFTER = 1.2;
const RECENTRE_RATE = 3;

/** Shortest signed angle from a to b. */
function angleTo(a: number, b: number): number {
  const d = (b - a) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
}

/**
 * Chase camera behind the pod. Its position is locked to the pod's (blended) position every
 * frame — only the swing round in turns and the height over bumps are smoothed — so it never
 * lags along the direction of travel, which is what made fast driving jitter. The mouse (or
 * right stick) orbits it freely, measured from the pod's heading, and after a moment of no
 * look input it eases back behind the pod.
 */
export class PodCamera {
  private readonly dir = new THREE.Vector3();
  private yaw = 0;
  private height = 0;
  private ready = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Snap (no smoothing) on the next update: after a respawn or a new page. */
  reset(): void {
    this.ready = false;
  }

  update(dt: number, pos: THREE.Vector3, heading: THREE.Vector2, look: { yaw: number; pitch: number; idle: number }): void {
    if (look.idle > RECENTRE_AFTER) {
      const k = Math.min(1, RECENTRE_RATE * dt);
      look.yaw -= look.yaw * k;
      look.pitch -= look.pitch * k;
    }
    // Three.js yaw 0 looks toward −z; yaw θ looks toward (−sin θ, −cos θ).
    const podYaw = Math.atan2(-heading.x, -heading.y);
    if (!this.ready) {
      this.yaw = podYaw;
      this.height = pos.y;
      this.ready = true;
    } else {
      // Frame-rate independent easing.
      this.yaw += angleTo(this.yaw, podYaw) * (1 - Math.exp(-YAW_FOLLOW * dt));
      this.height += (pos.y - this.height) * (1 - Math.exp(-HEIGHT_FOLLOW * dt));
    }

    const yaw = this.yaw + look.yaw;
    const pitch = THREE.MathUtils.clamp(CHASE_PITCH + look.pitch, -1.2, 0.5);
    this.dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    this.camera.position.set(pos.x, this.height + CHASE_HEIGHT, pos.z).addScaledVector(this.dir, -CHASE_DIST);
    this.camera.lookAt(pos.x, this.height + 1.2, pos.z);
  }
}
