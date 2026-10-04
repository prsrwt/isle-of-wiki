import * as THREE from 'three';

const BASE_FOV = 75;
/** Extra field of view at boost top speed: the world seems to rush past. */
const FOV_GAIN = 14;
const STREAKS = 70;
const SPARKS = 90;
const SPARK_LIFE = 0.45;

export interface FxState {
  /** Forward speed as a share of boost top speed, 0..1. */
  speed: number;
  /** Metres per second, for how fast streaks fly past. */
  mps: number;
  scraping: boolean;
  /** Where the pod touches the wall (world), and the way the wall pushed it (x, z). */
  contact: THREE.Vector3;
  push: THREE.Vector2;
}

/**
 * Speed and impact effects for the chase camera: the field of view widens with speed, wind
 * streaks fly past at high speed, and scraping a wall throws sparks from the contact point
 * and shakes the camera. All visual — nothing here touches the simulation.
 */
export class PodFx {
  private readonly streaks: THREE.LineSegments;
  private readonly streakPos: Float32Array;
  private readonly streakSeed: Float32Array;
  private readonly streakMaterial = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, fog: false });
  private readonly sparks: THREE.Points;
  private readonly sparkPos: Float32Array;
  private readonly sparkVel = new Float32Array(SPARKS * 3);
  private readonly sparkLife = new Float32Array(SPARKS);
  private nextSpark = 0;
  private shake = 0;
  private fov = BASE_FOV;
  private readonly offset = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
  ) {
    // Wind streaks live in camera space: a ring of lines around the view, flying toward you.
    this.streakPos = new Float32Array(STREAKS * 6);
    this.streakSeed = new Float32Array(STREAKS * 3);
    for (let i = 0; i < STREAKS; i++) this.respawnStreak(i, -4 - Math.random() * 56);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.streakPos, 3));
    this.streaks = new THREE.LineSegments(sg, this.streakMaterial);
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 10;
    camera.add(this.streaks);

    this.sparkPos = new Float32Array(SPARKS * 3).fill(-1e6);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparks = new THREE.Points(
      pg,
      new THREE.PointsMaterial({ color: '#ffd27a', size: 0.35, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
  }

  /** Call after the camera has been placed for the frame. Null state (free-fly) turns it all off. */
  update(dt: number, s: FxState | null): void {
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);

    // Field of view.
    const fov = BASE_FOV + (s ? FOV_GAIN * s.speed * s.speed : 0);
    this.fov += (fov - this.fov) * ease(4);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Wind streaks fade in above about half of top speed.
    const wind = s ? THREE.MathUtils.smoothstep(s.speed, 0.45, 0.9) : 0;
    this.streakMaterial.opacity = wind * 0.55;
    this.streaks.visible = wind > 0.01;
    if (this.streaks.visible && s) {
      const len = 0.6 + s.speed * 7;
      for (let i = 0; i < STREAKS; i++) {
        let z = this.streakPos[i * 6 + 2] + s.mps * 1.4 * dt;
        if (z > -2) z = this.respawnStreak(i, -50 - Math.random() * 10);
        const x = this.streakSeed[i * 3];
        const y = this.streakSeed[i * 3 + 1];
        this.streakPos.set([x, y, z, x, y, z - len], i * 6);
      }
      (this.streaks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    // Sparks from the contact point while scraping, then they fall and fade.
    if (s?.scraping) {
      for (let k = 0; k < 4; k++) this.emitSpark(s.contact, s.push);
      this.shake = Math.min(1, this.shake + dt * 8);
    } else {
      this.shake -= this.shake * ease(6);
    }
    let alive = false;
    for (let i = 0; i < SPARKS; i++) {
      if (this.sparkLife[i] <= 0) continue;
      alive = true;
      this.sparkLife[i] -= dt;
      if (this.sparkLife[i] <= 0) {
        this.sparkPos[i * 3 + 1] = -1e6;
        continue;
      }
      this.sparkVel[i * 3 + 1] -= 25 * dt;
      for (let a = 0; a < 3; a++) this.sparkPos[i * 3 + a] += this.sparkVel[i * 3 + a] * dt;
    }
    if (alive) (this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    // Camera shake: a small random jolt, fading out after the scrape.
    if (this.shake > 0.01) {
      this.offset.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.35 * this.shake);
      this.camera.position.add(this.offset);
    }
  }

  private respawnStreak(i: number, z: number): number {
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 7;
    this.streakSeed[i * 3] = Math.cos(a) * r;
    this.streakSeed[i * 3 + 1] = Math.sin(a) * r * 0.6;
    this.streakPos[i * 6 + 2] = z;
    return z;
  }

  private emitSpark(at: THREE.Vector3, push: THREE.Vector2): void {
    const i = this.nextSpark;
    this.nextSpark = (i + 1) % SPARKS;
    this.sparkPos.set([at.x, at.y, at.z], i * 3);
    const out = 3 + Math.random() * 6;
    this.sparkVel.set(
      [push.x * out + (Math.random() - 0.5) * 6, 2 + Math.random() * 5, push.y * out + (Math.random() - 0.5) * 6],
      i * 3,
    );
    this.sparkLife[i] = SPARK_LIFE * (0.5 + Math.random() * 0.5);
  }
}
