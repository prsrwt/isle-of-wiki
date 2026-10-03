import * as THREE from 'three';
import type { Box, BoxKind, Gate, TextRun, TextStyle, Vec2 } from '@isle-of-wiki/shared';
import type { BiomePalette } from './biomes';
import {
  createColumnGeometry,
  createDomeGeometry,
  createFoldedRockGeometry,
  createShardGeometry,
  createTowerGeometry,
  createTreeGeometry,
  createVentGeometry,
  ROCK_SHAPE_COUNT,
} from './geometry';
import type { GlyphAtlas } from './glyphAtlas';
import {
  createCaveMaterial,
  createOutlineMaterial,
  createPaperMaterial,
  createTextMaterial,
} from './materials';
import { INK, KIND_STYLES, RED, TEXT_COLORS, type ShapeId } from './palette';

const FOLDED_ROCKS = Array.from({ length: ROCK_SHAPE_COUNT }, (_, i) => createFoldedRockGeometry(i));
const SHAPES: Record<Exclude<ShapeId, 'folded'>, THREE.BufferGeometry> = {
  box: new THREE.BoxGeometry(1, 1, 1),
  tree: createTreeGeometry(),
  shard: createShardGeometry(),
  column: createColumnGeometry(),
  vent: createVentGeometry(),
  dome: createDomeGeometry(),
  tower: createTowerGeometry(),
};
export const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** Orientation for a quad (PlaneGeometry, facing +z) that faces horizontal direction n. */
export function facingQuat(n: Vec2, out = new THREE.Quaternion()): THREE.Quaternion {
  const z = new THREE.Vector3(n[0], 0, n[1]);
  const x = new THREE.Vector3(n[1], 0, -n[0]);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, UP, z));
}

/** Orientation for one glyph of a text run (see TextRun in the shared package). */
function glyphQuat(run: TextRun, out: THREE.Quaternion): THREE.Quaternion {
  const x = new THREE.Vector3(run.adv[0], 0, run.adv[1]);
  if (run.mode === 'wall') return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, UP, new THREE.Vector3(-run.adv[1], 0, run.adv[0])));
  // Floor: letter tops point along (adv.z, -adv.x), tilted up the slope by `pitch`.
  const top = new THREE.Vector3(run.adv[1], 0, -run.adv[0]);
  const pitch = run.pitch ?? 0;
  const y = top.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch));
  const z = UP.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(top, -Math.sin(pitch));
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * One set of materials per world, shared by every chunk — splitting the world into chunks
 * must not multiply shader programs or uniforms.
 */
export class MaterialKit {
  private readonly paper = new Map<string, THREE.MeshToonMaterial>();
  readonly outline = createOutlineMaterial(INK);
  readonly text: THREE.ShaderMaterial;
  readonly cave = createCaveMaterial(RED);
  readonly terrain = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  readonly textColors: Record<TextStyle, THREE.Color>;

  constructor(
    readonly gradient: THREE.Texture,
    atlas: GlyphAtlas,
    /** The world's biome: colours for terrain and every kind of prop. */
    readonly palette: BiomePalette,
  ) {
    this.text = createTextMaterial(atlas.texture);
    this.textColors = Object.fromEntries(
      Object.entries(TEXT_COLORS).map(([k, v]) => [k, new THREE.Color(v)]),
    ) as Record<TextStyle, THREE.Color>;
  }

  paperFor(color: string): THREE.MeshToonMaterial {
    let m = this.paper.get(color);
    if (!m) {
      m = createPaperMaterial(color, this.gradient, INK);
      this.paper.set(color, m);
    }
    return m;
  }

  dispose(): void {
    this.paper.forEach((m) => m.dispose());
    this.outline.dispose();
    this.text.dispose();
    this.cave.dispose();
    this.terrain.dispose();
  }
}

/** Instanced meshes (plus ink outlines) for a set of boxes, one draw per kind/shape. Casts sun shadows. */
export function buildBoxes(boxes: Box[], kit: MaterialKit, into: THREE.Group): void {
  // shape ≥ 0: which folded-rock variant; -1: the kind's own shape.
  const groups = new Map<string, { kind: BoxKind; shape: number; list: Box[] }>();
  for (const b of boxes) {
    const shape = KIND_STYLES[b.kind].shape === 'folded' ? b.variant % ROCK_SHAPE_COUNT : -1;
    const key = `${b.kind}:${shape}`;
    const group = groups.get(key);
    if (group) group.list.push(b);
    else groups.set(key, { kind: b.kind, shape, list: [b] });
  }

  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const turnQ = new THREE.Quaternion();
  for (const { kind, shape, list } of groups.values()) {
    const style = KIND_STYLES[kind];
    const geometry = shape >= 0 ? FOLDED_ROCKS[shape] : SHAPES[style.shape as Exclude<ShapeId, 'folded'>];
    const mesh = new THREE.InstancedMesh(geometry, kit.paperFor(kit.palette.kinds[kind]), list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    list.forEach((b, i) => {
      p.fromArray(b.center);
      s.fromArray(b.size);
      if (b.rot) q.fromArray(b.rot);
      else q.identity();
      // Folded rocks also turn by a seeded multiple of 90° (inside their box) so slopes
      // face different ways; odd turns swap x/z extents, so swap the scale back.
      // Arch and cave-arch rocks keep their exact orientation so the arches stay continuous.
      const turn = shape >= 0 && kind !== 'arch' && kind !== 'caverock' ? Math.floor(b.variant / ROCK_SHAPE_COUNT) % 4 : 0;
      if (turn) {
        q.multiply(turnQ.setFromAxisAngle(UP, (turn * Math.PI) / 2));
        if (turn % 2) s.set(b.size[2], b.size[1], b.size[0]);
      }
      mesh.setMatrixAt(i, m.compose(p, q, s));
    });
    mesh.computeBoundingSphere();
    into.add(mesh);

    if (style.outline) {
      const outline = new THREE.InstancedMesh(geometry, kit.outline, list.length);
      outline.instanceMatrix = mesh.instanceMatrix;
      outline.computeBoundingSphere();
      into.add(outline);
    }
  }
}

/** Number of visible glyphs in a set of text runs. */
export function glyphCount(texts: TextRun[]): number {
  let n = 0;
  for (const t of texts) for (const c of Array.from(t.text)) if (c.trim()) n++;
  return n;
}

/** All glyphs of a set of text runs as one instanced mesh. Returns its geometry so the caller can dispose it. */
export function buildText(texts: TextRun[], atlas: GlyphAtlas, kit: MaterialKit, into: THREE.Group): THREE.BufferGeometry | null {
  const count = glyphCount(texts);
  if (!count) return null;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const uvs = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const mesh = new THREE.InstancedMesh(geometry, kit.text, count);

  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  let k = 0;
  for (const run of texts) {
    glyphQuat(run, q);
    const col = kit.textColors[run.style];
    Array.from(run.text).forEach((ch, i) => {
      if (!ch.trim()) return;
      const d = (i + 0.5) * run.charW;
      p.set(run.x + run.adv[0] * d, run.y, run.z + run.adv[1] * d);
      s.set(run.charW * 0.95, run.charH, 1);
      mesh.setMatrixAt(k, m.compose(p, q, s));
      uvs.set(atlas.uv(ch), k * 4);
      colors.set([col.r, col.g, col.b], k * 3);
      k++;
    });
  }
  geometry.setAttribute('iUv', new THREE.InstancedBufferAttribute(uvs, 4));
  geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(colors, 3));
  mesh.computeBoundingSphere();
  into.add(mesh);
  return geometry;
}

/** Glowing cave mouths as one instanced mesh. */
export function buildCaves(gates: Gate[], kit: MaterialKit, into: THREE.Group): void {
  if (!gates.length) return;
  const mesh = new THREE.InstancedMesh(UNIT_PLANE, kit.cave, gates.length);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  gates.forEach((g, i) => {
    p.fromArray(g.center);
    s.set(g.width, g.height, 1);
    mesh.setMatrixAt(i, m.compose(p, facingQuat(g.normal, q), s));
  });
  mesh.computeBoundingSphere();
  into.add(mesh);
}
