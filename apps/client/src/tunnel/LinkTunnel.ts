import * as THREE from 'three';
import type { BiomePalette } from '../render/biomes';
import { PodModel } from '../pod/PodModel';

const SEGMENTS = 44;
const SEGMENT_LEN = 7;
const RADIUS = 8;
const SIDES = 6;
const STREAKS = 160;
/** Tunnel speed (m/s): it pulls you in, then races. */
const SPEED_START = 80;
const SPEED_TOP = 260;
/** How far the pod may drift from the tunnel's middle (cosmetic steering). */
const DRIFT = 3.6;
const FLASH_IN = 0.14;
const FLASH_OUT = 0.45;
const INK = '#1d1b22';

/** The tunnel's centre line at distance `s` (it winds and rolls but never doubles back). */
function centre(s: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(14 * Math.sin(s * 0.009) + 6 * Math.sin(s * 0.023 + 1), 9 * Math.sin(s * 0.0071 + 2) + 3 * Math.sin(s * 0.019), -s);
}

/**
 * The link tunnel: the folded-paper tube you fly through between pages. Its own little scene,
 * drawn instead of the world while you travel (so the next world can be built behind it). Its
 * walls fade from the colours of the page you left to the page you're heading for, as soon as
 * the Guestbook says which world that is.
 *
 * The tube is a treadmill: hexagonal paper rings, each twisted a little more than the last,
 * recycled to the front as you pass them. A white flash covers the way in and the way out.
 */
export class LinkTunnel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, 1, 0.3, 600);
  /** True from `begin` until `exit` has flashed white. */
  active = false;
  private readonly rings: THREE.Mesh[] = [];
  private readonly ringS: number[] = [];
  private readonly paperA: THREE.MeshBasicMaterial;
  private readonly paperB: THREE.MeshBasicMaterial;
  private readonly streaks: THREE.InstancedMesh;
  private readonly streakAt: { s: number; angle: number; r: number }[] = [];
  private readonly pod: PodModel;
  private readonly fromA = new THREE.Color();
  private readonly fromB = new THREE.Color();
  private readonly toA = new THREE.Color();
  private readonly toB = new THREE.Color();
  private readonly fog = new THREE.Color();
  private readonly fogTo = new THREE.Color();
  private blend = 1;
  private travelled = 0;
  private speed = SPEED_START;
  private time = 0;
  private drift = new THREE.Vector2();
  private exiting: { t: number; done: () => void } | null = null;
  private readonly flash: HTMLElement;
  private readonly label: HTMLElement;
  private readonly labelName: HTMLElement;
  private readonly labelWait: HTMLElement;
  private flashLevel = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly roll = new THREE.Quaternion();
  private readonly z = new THREE.Vector3(0, 0, 1);

  constructor(gradient: THREE.Texture) {
    this.flash = document.getElementById('tunnel-flash') as HTMLElement;
    this.label = document.getElementById('tunnel-label') as HTMLElement;
    this.labelName = document.getElementById('tunnel-name') as HTMLElement;
    this.labelWait = document.getElementById('tunnel-wait') as HTMLElement;

    this.scene.fog = new THREE.Fog('#ffffff', 60, 280);
    this.scene.background = new THREE.Color('#ffffff');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#887766', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(0.3, 1, 0.4);
    this.scene.add(sun);

    // One ring: an open hexagonal tube seen from inside, each fold shaded a step darker so the
    // creases read like folded paper.
    const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, SEGMENT_LEN, SIDES, 1, true).toNonIndexed();
    geo.rotateX(Math.PI / 2);
    const shades: number[] = [];
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      const face = Math.floor(i / 6);
      const v = [1, 0.84, 0.72, 0.9, 0.78, 0.95][face % SIDES];
      for (let k = 0; k < 3; k++) shades.push(v, v, v);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
    this.paperA = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
    this.paperB = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
    const edges = new THREE.EdgesGeometry(geo, 1);
    const ink = new THREE.LineBasicMaterial({ color: INK });
    for (let i = 0; i < SEGMENTS; i++) {
      const ring = new THREE.Mesh(geo, i % 2 ? this.paperB : this.paperA);
      ring.add(new THREE.LineSegments(edges, ink));
      ring.matrixAutoUpdate = false;
      this.scene.add(ring);
      this.rings.push(ring);
      this.ringS.push(i * SEGMENT_LEN);
    }

    // Speed streaks: thin glowing slivers just inside the walls.
    this.streaks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.08, 0.08, 1),
      new THREE.MeshBasicMaterial({ color: '#fff7e0', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
      STREAKS,
    );
    this.streaks.frustumCulled = false;
    this.scene.add(this.streaks);
    for (let i = 0; i < STREAKS; i++) {
      this.streakAt.push({ s: Math.random() * SEGMENTS * SEGMENT_LEN, angle: Math.random() * Math.PI * 2, r: RADIUS * (0.55 + Math.random() * 0.35) });
    }

    this.pod = new PodModel(gradient);
    this.scene.add(this.pod.group, this.camera);
  }

  /** Into the tunnel toward `target`, in the colours of the world you're leaving. */
  begin(target: string, from: BiomePalette | null): void {
    this.active = true;
    this.exiting = null;
    this.travelled = 0;
    this.speed = SPEED_START;
    this.time = 0;
    this.drift.set(0, 0);
    this.flashLevel = 1;
    for (let i = 0; i < SEGMENTS; i++) this.ringS[i] = i * SEGMENT_LEN;
    this.paperColours(from, this.fromA, this.fromB, this.fog);
    this.toA.copy(this.fromA);
    this.toB.copy(this.fromB);
    this.fogTo.copy(this.fog);
    this.blend = 1;
    this.labelName.textContent = target;
    this.labelWait.classList.add('hidden');
    this.label.classList.remove('hidden');
  }

  /** The page you're heading for has a world: fade the walls toward its colours. */
  setDestination(to: BiomePalette): void {
    if (!this.active) return;
    // Start the fade from wherever the colours are now.
    this.fromA.copy(this.paperA.color);
    this.fromB.copy(this.paperB.color);
    this.fog.copy((this.scene.fog as THREE.Fog).color);
    this.paperColours(to, this.toA, this.toB, this.fogTo);
    this.blend = 0;
  }

  /** Resolves after the shortest trip (so even a cached page gets a proper ride). */
  minimum(seconds: number): Promise<void> {
    return new Promise((r) => setTimeout(r, seconds * 1000));
  }

  /** Shows "still loading" once the ride has run longer than it should. */
  set waiting(on: boolean) {
    this.labelWait.classList.toggle('hidden', !on);
  }

  /** Out of the tunnel: flashes white, then resolves (draw the world again from then on). */
  exit(): Promise<void> {
    if (!this.active) return Promise.resolve();
    return new Promise((done) => {
      this.exiting = { t: 0, done };
    });
  }

  /** Each frame while in the tunnel; `steer` is the move stick (x right, y forward). */
  update(dt: number, steer: { x: number; y: number }): void {
    this.time += dt;
    this.speed += (SPEED_TOP - this.speed) * (1 - Math.exp(-0.9 * dt));
    this.travelled += this.speed * dt;
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    this.drift.x += (steer.x * DRIFT - this.drift.x) * ease(3);
    this.drift.y += (steer.y * DRIFT * 0.6 - this.drift.y) * ease(3);

    // Colours: fade toward the destination over about a second.
    this.blend = Math.min(1, this.blend + dt);
    this.paperA.color.copy(this.fromA).lerp(this.toA, this.blend);
    this.paperB.color.copy(this.fromB).lerp(this.toB, this.blend);
    const fog = (this.scene.fog as THREE.Fog).color.copy(this.fog).lerp(this.fogTo, this.blend);
    (this.scene.background as THREE.Color).copy(fog);

    // Recycle rings that fell behind the camera to the front, each twisted on from the last.
    const behind = this.travelled - 2 * SEGMENT_LEN;
    for (let i = 0; i < SEGMENTS; i++) {
      if (this.ringS[i] < behind) this.ringS[i] += SEGMENTS * SEGMENT_LEN;
      this.place(this.ringS[i] + SEGMENT_LEN / 2, this.ringS[i] * 0.02, 1, this.rings[i].matrix);
      this.rings[i].matrixWorldNeedsUpdate = true;
    }
    const stretch = 2 + (this.speed / SPEED_TOP) * 10;
    for (let i = 0; i < STREAKS; i++) {
      const st = this.streakAt[i];
      if (st.s < behind) st.s += SEGMENTS * SEGMENT_LEN;
      this.place(st.s, st.angle, stretch, this.m, st.r);
      this.streaks.setMatrixAt(i, this.m);
    }
    this.streaks.instanceMatrix.needsUpdate = true;

    // Pod ahead of the camera along the centre line, drifting where you steer, banking into it.
    const podS = this.travelled + 9;
    centre(podS, this.tmp);
    centre(podS + 4, this.tmp2);
    this.pod.group.position.copy(this.tmp);
    this.pod.group.position.x += this.drift.x;
    this.pod.group.position.y += this.drift.y + Math.sin(this.time * 3) * 0.15;
    this.pod.group.lookAt(this.tmp2.x + this.drift.x, this.tmp2.y + this.drift.y, this.tmp2.z);
    this.pod.group.rotateY(Math.PI); // the model's nose points along −z; lookAt aims +z
    this.pod.update(dt, { throttle: 1, speed: 1, turnRate: steer.x * 2.5, boosting: true, braking: false });

    centre(this.travelled, this.camera.position);
    this.camera.position.x += this.drift.x * 0.5;
    this.camera.position.y += this.drift.y * 0.5 + 1.6;
    centre(podS + 20, this.tmp);
    this.camera.lookAt(this.tmp.x + this.drift.x * 0.4, this.tmp.y + this.drift.y * 0.4, this.tmp.z);
    this.camera.rotateZ(Math.sin(this.time * 0.7) * 0.08);

    // Flash: white on the way in, fading to the tunnel; white again on the way out.
    if (this.exiting) {
      this.exiting.t += dt;
      this.flashLevel = Math.min(1, this.exiting.t / FLASH_IN);
      if (this.flashLevel >= 1) {
        const done = this.exiting.done;
        this.exiting = null;
        this.active = false;
        this.label.classList.add('hidden');
        done();
      }
    } else {
      this.flashLevel = Math.max(0, this.flashLevel - dt / FLASH_OUT);
    }
    this.flash.style.opacity = this.flashLevel.toFixed(3);
  }

  /** After the tunnel: the flash fades away over the new world. */
  fadeOut(dt: number): void {
    if (this.flashLevel <= 0) return;
    this.flashLevel = Math.max(0, this.flashLevel - dt / FLASH_OUT);
    this.flash.style.opacity = this.flashLevel.toFixed(3);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Matrix for something at distance `s` along the tube, rolled `angle`, `length` long, `r` off the centre line. */
  private place(s: number, angle: number, length: number, out: THREE.Matrix4, r = 0): void {
    const p = centre(s, this.tmp);
    // Local +z points back along the tube (it runs toward −z), which keeps the turn small and steady.
    const back = centre(s - 1, this.tmp2).sub(p).normalize();
    this.q.setFromUnitVectors(this.z, back);
    if (r) p.add(this.tmp2.set(Math.cos(angle) * r, Math.sin(angle) * r, 0).applyQuaternion(this.q));
    this.q.multiply(this.roll.setFromAxisAngle(this.z, angle));
    out.compose(p, this.q, this.tmp2.set(1, 1, length));
  }

  /** Two paper tones and a glow colour for a biome (white paper when there's no world yet). */
  private paperColours(p: BiomePalette | null, a: THREE.Color, b: THREE.Color, glow: THREE.Color): void {
    if (!p) {
      a.set('#f4efe2');
      b.set('#e6dcc4');
      glow.set('#ffffff');
      return;
    }
    a.set(p.terrain.floor);
    b.set(p.terrain.wall);
    glow.set(p.sky.fog).lerp(new THREE.Color('#ffffff'), 0.5);
  }
}
