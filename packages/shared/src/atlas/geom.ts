import type { Quat, Vec2, Vec3 } from './types';

/** Reader's right-hand side when facing horizontal direction `t` (y up): (-t.z, t.x). */
export const rightOf = (t: Vec2): Vec2 => [-t[1], t[0]];

/** Rotation about +y that turns local +z to face horizontal direction `t`. */
export function yawQuat(t: Vec2): Quat {
  const yaw = Math.atan2(t[0], t[1]);
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

/** Quaternion from an orthonormal right-handed basis (columns x, y, z). */
export function basisQuat(x: Vec3, y: Vec3, z: Vec3): Quat {
  const [m00, m10, m20] = x;
  const [m01, m11, m21] = y;
  const [m02, m12, m22] = z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

export interface PathPoint {
  x: number;
  z: number;
  /** Unit tangent (direction of travel). */
  t: Vec2;
  /** Unit right-hand side. */
  r: Vec2;
  /** Floor height and its slope (dy/ds) here. */
  y: number;
  slope: number;
}

/** A canyon centreline: dense polyline with arc length, plus a floor-height profile. */
export class Path {
  readonly xs: number[] = [];
  readonly zs: number[] = [];
  readonly ss: number[] = [];
  readonly length: number;

  constructor(
    points: Vec2[],
    private readonly floorY: (s: number) => number,
  ) {
    let s = 0;
    points.forEach(([x, z], i) => {
      if (i > 0) {
        const d = Math.hypot(x - this.xs[i - 1], z - this.zs[i - 1]);
        if (d < 1e-6) return;
        s += d;
      }
      this.xs.push(x);
      this.zs.push(z);
      this.ss.push(s);
    });
    this.length = s;
  }

  floor(s: number): number {
    return this.floorY(s);
  }

  at(s: number): PathPoint {
    const ss = this.ss;
    const sc = Math.min(Math.max(s, 0), this.length);
    let lo = 0;
    let hi = ss.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ss[mid] <= sc) lo = mid;
      else hi = mid;
    }
    const seg = ss[hi] - ss[lo] || 1;
    const f = (sc - ss[lo]) / seg;
    const x = this.xs[lo] + (this.xs[hi] - this.xs[lo]) * f;
    const z = this.zs[lo] + (this.zs[hi] - this.zs[lo]) * f;
    // Smooth the tangent by looking a few metres either side.
    const ahead = this.pointAt(sc + 3);
    const behind = this.pointAt(sc - 3);
    const dx = ahead[0] - behind[0];
    const dz = ahead[1] - behind[1];
    const len = Math.hypot(dx, dz) || 1;
    const t: Vec2 = [dx / len, dz / len];
    const y = this.floorY(sc);
    const slope = (this.floorY(sc + 1) - this.floorY(sc - 1)) / 2;
    return { x, z, t, r: rightOf(t), y, slope };
  }

  private pointAt(s: number): Vec2 {
    const ss = this.ss;
    const sc = Math.min(Math.max(s, 0), this.length);
    let lo = 0;
    let hi = ss.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ss[mid] <= sc) lo = mid;
      else hi = mid;
    }
    const f = (sc - ss[lo]) / (ss[hi] - ss[lo] || 1);
    return [this.xs[lo] + (this.xs[hi] - this.xs[lo]) * f, this.zs[lo] + (this.zs[hi] - this.zs[lo]) * f];
  }

  /** Every ~`step` metres of centreline, for minimaps. */
  sparse(step: number): Vec2[] {
    const out: Vec2[] = [];
    for (let s = 0; s < this.length; s += step) {
      const p = this.at(s);
      out.push([p.x, p.z]);
    }
    const end = this.at(this.length);
    out.push([end.x, end.z]);
    return out;
  }
}

/** Seeded 2D value noise in roughly [-1, 1], smoothly interpolated. */
export function valueNoise2D(seed: number): (x: number, z: number) => number {
  const hash = (ix: number, iz: number) => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967296) * 2 - 1;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, z) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = smooth(x - ix);
    const fz = smooth(z - iz);
    const a = hash(ix, iz);
    const b = hash(ix + 1, iz);
    const c = hash(ix, iz + 1);
    const d = hash(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
}
