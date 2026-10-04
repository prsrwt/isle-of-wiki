import * as THREE from 'three';
import { createPaperMaterial } from '../render/materials';

/** Pod colours: paper hull, red folds, cream engines, ink creases. */
const HULL = '#f4efe2';
const TRIM = '#d8452f';
const ENGINE = '#e6dcc4';
const SEAT = '#3a3540';
const INK = '#1d1b22';

/** What the pod is doing this frame, for the model's animation. */
export interface PodLook {
  /** Throttle input, −1..1. */
  throttle: number;
  /** Forward speed as a share of boost top speed, 0..1. */
  speed: number;
  /** Turn rate (rad/s, positive = right), for leaning into turns. */
  turnRate: number;
  boosting: boolean;
  braking: boolean;
}

/** Flat-faceted geometry: every triangle gets its own normal, like a paper fold. */
function facets(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Triangles from corner lists, each face a fan: quads [a, b, c, d], triangles [a, b, c]. Each
 * triangle is turned to face away from the middle of the shape, so it's never inside-out
 * (and culled) whatever order its corners were listed in. `flat` keeps the order as given,
 * for a single sheet listed both ways round.
 */
function fold(points: Record<string, [number, number, number]>, faces: string[][], flat = false): THREE.BufferGeometry {
  const all = Object.values(points);
  const mid = all.reduce((m, p) => m.add(new THREE.Vector3(...p)), new THREE.Vector3()).divideScalar(all.length);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const out: number[] = [];
  for (const f of faces) {
    for (let i = 1; i + 1 < f.length; i++) {
      a.set(...points[f[0]]);
      b.set(...points[f[i]]);
      c.set(...points[f[i + 1]]);
      n.subVectors(b, a).cross(c.clone().sub(a));
      const centre = a.clone().add(b).add(c).divideScalar(3).sub(mid);
      if (!flat && n.dot(centre) < 0) out.push(...a.toArray(), ...c.toArray(), ...b.toArray());
      else out.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    }
  }
  return facets(out);
}

/**
 * Your pod as folded paper, nose toward −z, origin at the physics body's centre: a paper-boat
 * cockpit with a creased cowl and low windshield, and two faceted lantern engines out front on
 * ink cables, tied by a glowing binder. The engines sit where the physics engine's engine
 * spheres are, so what you see is what hits the walls.
 *
 * `update` animates it: leaning into turns, nose dipping under braking, a gentle hover bob,
 * exhaust flames that grow with throttle and burn hot while boosting.
 */
export class PodModel {
  readonly group = new THREE.Group();
  /** Everything that leans and bobs (the group itself follows the physics pose). */
  private readonly body = new THREE.Group();
  private readonly flames: THREE.Mesh[] = [];
  private readonly flameMaterial = new THREE.MeshBasicMaterial({
    color: '#ff9a3d',
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly binderMaterial = new THREE.MeshBasicMaterial({ color: '#ff4a5a', transparent: true, opacity: 0.8, depthWrite: false });
  private readonly glowMaterial = new THREE.MeshBasicMaterial({ color: '#ff8a3d' });
  private roll = 0;
  private pitch = 0;
  private flame = 0;
  private time = 0;
  private readonly cold = new THREE.Color('#ff9a3d');
  private readonly hot = new THREE.Color('#9fd8ff');

  constructor(gradient: THREE.Texture) {
    this.group.add(this.body);
    const hull = createPaperMaterial(HULL, gradient, INK);
    const trim = createPaperMaterial(TRIM, gradient, INK);
    const engine = createPaperMaterial(ENGINE, gradient, INK);
    const seat = new THREE.MeshBasicMaterial({ color: SEAT });
    const ink = new THREE.LineBasicMaterial({ color: INK });

    const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 1), ink));
      this.body.add(mesh);
      return mesh;
    };

    // Paper-boat cockpit: a creased cowl folding up to a ridge, flat sides, a keel underneath.
    const P: Record<string, [number, number, number]> = {
      nose: [0, -0.15, -2.1],
      ridge: [0, 0.32, -0.95],
      sl: [-0.72, 0.18, -0.7],
      sr: [0.72, 0.18, -0.7],
      bl: [-0.72, 0.24, 1.35],
      br: [0.72, 0.24, 1.35],
      kf: [0, -0.6, -0.8],
      kr: [0, -0.6, 1.35],
      cl: [-0.55, 0.0, -0.55],
      cr: [0.55, 0.0, -0.55],
      dl: [-0.55, 0.0, 1.2],
      dr: [0.55, 0.0, 1.2],
    };
    add(
      fold(P, [
        ['nose', 'ridge', 'sl'],
        ['nose', 'sr', 'ridge'],
        ['ridge', 'sr', 'cr', 'cl', 'sl'],
        ['nose', 'sl', 'kf'],
        ['nose', 'kf', 'sr'],
        ['sl', 'bl', 'kr', 'kf'],
        ['sr', 'kf', 'kr', 'br'],
        ['bl', 'br', 'kr'],
        ['sl', 'cl', 'dl', 'bl'],
        ['sr', 'br', 'dr', 'cr'],
        ['bl', 'dl', 'dr', 'br'],
      ]),
      hull,
    );
    // Seat well, and a red fold along the cowl's ridge.
    const well = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.75), seat);
    well.rotation.x = -Math.PI / 2;
    well.position.set(0, 0.01, 0.33);
    this.body.add(well);
    add(fold({ a: [0, 0.33, -0.95], b: [-0.12, 0.29, -0.85], c: [0, 0.2, -1.65], d: [0.12, 0.29, -0.85] }, [['a', 'b', 'c'], ['a', 'c', 'd']]), trim);

    // Low windshield leaning back from the cowl.
    const shield = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.42),
      new THREE.MeshBasicMaterial({ color: '#bfe3ff', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    );
    shield.position.set(0, 0.42, -0.7);
    shield.rotation.x = -0.8;
    shield.add(new THREE.LineSegments(new THREE.EdgesGeometry(shield.geometry), ink));
    this.body.add(shield);

    // Engines: faceted lanterns with a red intake collar, a folded fin and a tapered tail.
    for (const side of [-1, 1]) {
      const x = side * 1.7;
      const lantern = add(new THREE.CylinderGeometry(0.46, 0.52, 2.4, 6).toNonIndexed(), engine);
      lantern.rotation.x = Math.PI / 2;
      lantern.position.set(x, 0.15, -4.5);
      const collar = add(new THREE.CylinderGeometry(0.58, 0.5, 0.4, 6).toNonIndexed(), trim);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(x, 0.15, -5.85);
      const tail = add(new THREE.ConeGeometry(0.52, 0.7, 6).toNonIndexed(), engine);
      tail.rotation.x = Math.PI / 2;
      tail.position.set(x, 0.15, -2.95);
      const fin = add(fold({ a: [0, 0, 0.5], b: [0, 0, -0.7], c: [0, 0.7, 0.35] }, [['a', 'b', 'c'], ['a', 'c', 'b']], true), trim);
      fin.position.set(x, 0.6, -4.3);

      // Exhaust: a glowing hole and a flame trailing back from the tail.
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.26, 6), this.glowMaterial);
      glow.position.set(x, 0.15, -2.59);
      this.body.add(glow);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1, 6, 1, true), this.flameMaterial);
      flame.geometry.translate(0, 0.5, 0); // base at the origin, tip along +y…
      flame.rotation.x = Math.PI / 2; // …turned to trail back (+z) toward the cockpit
      flame.position.set(x, 0.15, -2.6);
      this.body.add(flame);
      this.flames.push(flame);

      // Ink cable from the engine back to the cockpit's front corner.
      const from = new THREE.Vector3(x, 0.1, -2.7);
      const to = new THREE.Vector3(side * 0.6, -0.05, -1.0);
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, from.distanceTo(to), 5), new THREE.MeshBasicMaterial({ color: INK }));
      cable.position.copy(from).add(to).multiplyScalar(0.5);
      cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      this.body.add(cable);
    }
    const binder = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.05, 0.05), this.binderMaterial);
    binder.position.set(0, 0.15, -5.1);
    this.body.add(binder);
  }

  /** Animates the model; `dt` in seconds. */
  update(dt: number, look: PodLook): void {
    this.time += dt;
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    // Lean into turns (more at speed), dip the nose when braking, lift it a touch on throttle.
    const rollTarget = THREE.MathUtils.clamp(-look.turnRate * (0.12 + 0.25 * look.speed), -0.45, 0.45);
    const pitchTarget = look.braking || look.throttle < 0 ? -0.07 : look.throttle > 0 ? 0.025 : 0;
    this.roll += (rollTarget - this.roll) * ease(6);
    this.pitch += (pitchTarget - this.pitch) * ease(5);
    this.body.rotation.set(this.pitch, 0, this.roll, 'YXZ');
    this.body.position.y = Math.sin(this.time * 2.2) * 0.06;

    // Flames: idle flicker, longer with throttle, longest and hot blue-white while boosting.
    const want = look.boosting ? 2.4 : 0.25 + 1.1 * Math.max(0, look.throttle);
    this.flame += (want - this.flame) * ease(10);
    const flicker = 1 + Math.sin(this.time * 41) * 0.08 + Math.sin(this.time * 67) * 0.05;
    for (const f of this.flames) f.scale.set(1, this.flame * flicker, 1);
    this.flameMaterial.color.copy(this.cold).lerp(this.hot, look.boosting ? 1 : 0);
    this.binderMaterial.opacity = 0.55 + 0.35 * Math.abs(Math.sin(this.time * (look.boosting ? 18 : 6)));
  }
}
