import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];

/** Builds a flat-shaded mesh from triangles, flipping any whose normal points inward. */
function fromTriangles(tris: [V3, V3, V3][], centre: V3 = [0, 0, 0]): THREE.BufferGeometry {
  const pos: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const o = new THREE.Vector3(...centre);
  for (const [p, q, r] of tris) {
    a.set(...p);
    b.set(...q);
    c.set(...r);
    n.subVectors(b, a).cross(c.clone().sub(a));
    mid.copy(a).add(b).add(c).divideScalar(3).sub(o);
    if (n.dot(mid) < 0) pos.push(...p, ...r, ...q);
    else pos.push(...p, ...q, ...r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** One horizontal ring of a folded rock: height, half-width, and how far it drops toward +x / +z. */
interface Ring {
  y: number;
  half: number;
  dropX?: number;
  dropZ?: number;
}

/** Folded rock shapes; instances pick one by variant so the canyon walls don't repeat. */
const ROCK_SHAPES: Ring[][] = [
  // Crisp mesa: vertical walls, one crease, flat-ish top.
  [{ y: -0.5, half: 0.5 }, { y: 0.18, half: 0.5 }, { y: 0.5, half: 0.455 }],
  // Leaning butte: high crease, top slopes down toward +x.
  [{ y: -0.5, half: 0.5 }, { y: 0.32, half: 0.49 }, { y: 0.5, half: 0.4, dropX: 0.09 }],
  // Stepped: two creases, tapering in stages, top tilted toward +z.
  [{ y: -0.5, half: 0.5 }, { y: -0.05, half: 0.5 }, { y: 0.3, half: 0.46 }, { y: 0.5, half: 0.41, dropZ: 0.06 }],
  // Pinched spire: low crease, strong inward fold, corner-tilted top.
  [{ y: -0.5, half: 0.5 }, { y: 0.0, half: 0.48 }, { y: 0.5, half: 0.36, dropX: 0.05, dropZ: 0.05 }],
];

export const ROCK_SHAPE_COUNT = ROCK_SHAPES.length;

/**
 * Unit "folded paper" rock filling the -0.5..0.5 box: stacked rings joined by flat
 * facets, with a shallow valley fold on top. Every vertex stays inside the box, so the
 * physics collider (the box) never sticks out invisibly above the visible rock.
 */
export function createFoldedRockGeometry(shape = 0): THREE.BufferGeometry {
  const rings = ROCK_SHAPES[shape % ROCK_SHAPES.length];
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const ringVerts = rings.map(({ y, half, dropX = 0, dropZ = 0 }) =>
    corners.map(([sx, sz]): V3 => [sx * half, y - dropX * (sx + 1) * 0.5 - dropZ * (sz + 1) * 0.5, sz * half]),
  );
  const top = ringVerts[ringVerts.length - 1];
  const centre: V3 = [0, Math.min(...top.map((v) => v[1])) - 0.02, 0];
  const tris: [V3, V3, V3][] = [];
  for (let r = 0; r < ringVerts.length - 1; r++) {
    const lo = ringVerts[r];
    const hi = ringVerts[r + 1];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      tris.push([lo[i], lo[j], hi[j]], [lo[i], hi[j], hi[i]]);
    }
  }
  for (let i = 0; i < 4; i++) tris.push([top[i], top[(i + 1) % 4], centre]);
  const B = ringVerts[0];
  tris.push([B[0], B[2], B[1]], [B[0], B[3], B[2]]);
  return fromTriangles(tris);
}

/** Low-poly origami crane, ~3 units wingspan, facing +z. */
export function createCraneGeometry(): THREE.BufferGeometry {
  const tris: [V3, V3, V3][] = [
    // wings
    [[0, 0, 0.5], [0, 0, -0.5], [-1.6, 0.35, -0.1]],
    [[0, 0, 0.5], [0, 0, -0.5], [1.6, 0.35, -0.1]],
    // neck and head
    [[0, 0, 0.25], [0, 0.08, 0.55], [0, 0.75, 1.25]],
    [[0, 0.75, 1.25], [0, 0.62, 1.25], [0, 0.66, 1.5]],
    // tail
    [[0, 0, -0.25], [0, 0.08, -0.55], [0, 0.65, -1.3]],
    // keel
    [[0, 0, 0.5], [0, 0, -0.5], [0, -0.45, 0]],
  ];
  const g = fromTriangles(tris, [0, -10, 0]);
  return g;
}

// ------------------------------------------------------------------ biome props
// Each fills (and stays inside) the -0.5..0.5 unit box its prop's collider occupies.

/** Flat-shaded merge of simple parts (folded-paper look). */
function paperMerge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    n.deleteAttribute('normal');
    return n;
  });
  const merged = mergeGeometries(flat);
  merged.computeVertexNormals();
  return merged;
}

/** Paper palm/pine: thin trunk, two stacked folded cones. */
export function createTreeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.06, 0.09, 0.45, 5).translate(0, -0.275, 0);
  const lower = new THREE.ConeGeometry(0.5, 0.5, 7).translate(0, -0.05, 0);
  const upper = new THREE.ConeGeometry(0.36, 0.45, 7).translate(0, 0.275, 0);
  return paperMerge([trunk, lower, upper]);
}

/** Ice shard: a tall four-sided spike. */
export function createShardGeometry(): THREE.BufferGeometry {
  return paperMerge([new THREE.ConeGeometry(0.5, 1, 4).rotateY(Math.PI / 4)]);
}

/** Broken column: fluted shaft on a plinth, top snapped at an angle. */
export function createColumnGeometry(): THREE.BufferGeometry {
  const plinth = new THREE.BoxGeometry(1, 0.1, 1).translate(0, -0.45, 0);
  const shaft = new THREE.CylinderGeometry(0.36, 0.4, 0.88, 8).translate(0, 0.04, 0);
  // Snap the top: tilt the upper ring of the shaft.
  const pos = shaft.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.4) pos.setY(i, pos.getY(i) - 0.08 + pos.getX(i) * 0.1);
  return paperMerge([plinth, shaft]);
}

/** Volcanic vent: a squat truncated cone. */
export function createVentGeometry(): THREE.BufferGeometry {
  return paperMerge([new THREE.CylinderGeometry(0.18, 0.5, 1, 7)]);
}

/** Seedpod hut: round wall with a dome on top. */
export function createDomeGeometry(): THREE.BufferGeometry {
  const wall = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 10).translate(0, -0.25, 0);
  const dome = new THREE.SphereGeometry(0.5, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  return paperMerge([wall, dome]);
}

/** Seedpod lookout tower: slim mast with a saucer platform near the top. */
export function createTowerGeometry(): THREE.BufferGeometry {
  const mast = new THREE.CylinderGeometry(0.22, 0.3, 1, 7);
  const saucer = new THREE.CylinderGeometry(0.5, 0.35, 0.06, 10).translate(0, 0.38, 0);
  const cap = new THREE.ConeGeometry(0.2, 0.08, 7).translate(0, 0.46, 0);
  return paperMerge([mast, saucer, cap]);
}

/** Paper spectator: body and head, ~1 unit tall (scaled to ~1.6 m). */
export function createFigureGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.18, 0.3, 0.65, 6).translate(0, -0.17, 0);
  const head = new THREE.IcosahedronGeometry(0.17, 0).translate(0, 0.33, 0);
  return paperMerge([body, head]);
}
