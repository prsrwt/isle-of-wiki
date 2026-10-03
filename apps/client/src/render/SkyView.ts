import * as THREE from 'three';
import { mulberry32, randRange, type Bounds } from '@isle-of-wiki/shared';
import { createCraneGeometry } from './geometry';
import { createOutlineMaterial, createPaperMaterial, createStarMaterial } from './materials';
import { INK, PAPER } from './palette';

const STAR_COUNT = 3500;
const STAR_RADIUS = 4500;
const MOON_DIR = new THREE.Vector3(-0.45, 0.32, -0.83).normalize();

/** Starry void and paper moon. Follows the camera so they read as infinitely far away. */
export class SkyView {
  readonly group = new THREE.Group();
  private readonly starMaterial: THREE.ShaderMaterial;

  constructor(gradient: THREE.Texture, pixelRatio: number) {
    const rng = mulberry32(0x5eed);
    const pos = new Float32Array(STAR_COUNT * 3);
    const size = new Float32Array(STAR_COUNT);
    const phase = new Float32Array(STAR_COUNT);
    const v = new THREE.Vector3();
    for (let i = 0; i < STAR_COUNT; i++) {
      // Uniform on the sphere — the void surrounds the islands, below as well as above.
      v.set(randRange(rng, -1, 1), randRange(rng, -1, 1), randRange(rng, -1, 1));
      if (v.lengthSq() < 1e-4) v.set(0, 1, 0);
      v.normalize().multiplyScalar(STAR_RADIUS);
      pos.set([v.x, v.y, v.z], i * 3);
      size[i] = rng() < 0.04 ? randRange(rng, 9, 14) : randRange(rng, 2, 5);
      phase[i] = rng();
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geom.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.starMaterial = createStarMaterial(pixelRatio);
    const stars = new THREE.Points(geom, this.starMaterial);
    stars.frustumCulled = false;
    this.group.add(stars);

    const moonGeom = new THREE.IcosahedronGeometry(260, 1);
    const moonMat = createPaperMaterial(PAPER, gradient, INK);
    moonMat.fog = false;
    const moon = new THREE.Mesh(moonGeom, moonMat);
    moon.position.copy(MOON_DIR).multiplyScalar(3600);
    this.group.add(moon);
    this.group.renderOrder = -1;
  }

  update(camera: THREE.Camera, time: number): void {
    this.group.position.copy(camera.position);
    this.starMaterial.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

interface CraneFlight {
  cx: number;
  cz: number;
  radius: number;
  y: number;
  speed: number;
  phase: number;
}

/** Paper cranes circling over the archipelago. */
export class Cranes {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly outline: THREE.InstancedMesh;
  private readonly flights: CraneFlight[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(3, 3, 3);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(bounds: Bounds, seed: number, gradient: THREE.Texture) {
    const rng = mulberry32(seed ^ 0xc4a2e);
    const count = 36;
    for (let i = 0; i < count; i++) {
      this.flights.push({
        cx: randRange(rng, bounds.minX, bounds.maxX),
        cz: randRange(rng, bounds.minZ, bounds.maxZ),
        radius: randRange(rng, 30, 140),
        y: randRange(rng, 35, 110),
        speed: randRange(rng, 0.08, 0.2) * (rng() < 0.5 ? -1 : 1),
        phase: rng() * Math.PI * 2,
      });
    }
    const geom = createCraneGeometry();
    const mat = createPaperMaterial(PAPER, gradient, INK);
    mat.side = THREE.DoubleSide;
    this.mesh = new THREE.InstancedMesh(geom, mat, count);
    this.outline = new THREE.InstancedMesh(geom, createOutlineMaterial(INK), count);
    this.outline.instanceMatrix = this.mesh.instanceMatrix;
    this.mesh.frustumCulled = false;
    this.outline.frustumCulled = false;
    this.group.add(this.mesh, this.outline);
    this.update(0);
  }

  update(time: number): void {
    this.flights.forEach((f, i) => {
      const a = f.phase + time * f.speed;
      this.p.set(f.cx + Math.cos(a) * f.radius, f.y + Math.sin(time * 0.9 + f.phase) * 2, f.cz + Math.sin(a) * f.radius);
      // Face along the direction of travel (tangent of the circle).
      const heading = Math.atan2(-Math.sin(a) * Math.sign(f.speed), Math.cos(a) * Math.sign(f.speed));
      this.q.setFromAxisAngle(this.up, heading);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    (this.outline.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.outline.dispose();
  }
}
