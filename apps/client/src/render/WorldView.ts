import * as THREE from 'three';
import { BIOMES, bucketByChunk, CHUNK_SIZE, chunkKey, chunkRange, mulberry32, REGION_SIZE, type WorldLayout } from '@isle-of-wiki/shared';
import type { AdProvider } from '../ads/AdProvider';
import { CellView, CORE_KINDS, type CellData, type CellDeps } from '../gnme/CellView';
import { PALETTES, type BiomePalette } from './biomes';
import { MaterialKit } from './builders';
import { createFigureGeometry } from './geometry';
import { GlyphAtlas } from './glyphAtlas';
import { Cranes } from './SkyView';

/** Spectators are only drawn while the camera is this close to the Seedpod. */
const CROWD_RANGE = 700;
const FIGURE = createFigureGeometry();

/**
 * Everything drawn for one Wikipedia page, split into GNME cells: 1 km regions for the big
 * shapes and 256 m chunks for close-up detail. Nothing heavy is built up front — each cell
 * builds itself the first time GNME wakes it. Colours come from the page's biome.
 */
export class WorldView {
  readonly group = new THREE.Group();
  readonly cells: CellView[] = [];
  readonly palette: BiomePalette;
  private readonly atlas: GlyphAtlas;
  private readonly kit: MaterialKit;
  private readonly cranes: Cranes;
  private readonly crowd: THREE.InstancedMesh | null;
  private readonly crowdCenter = new THREE.Vector3();
  private readonly owned: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];

  constructor(layout: WorldLayout, gradient: THREE.Texture, anisotropy: number, ads: AdProvider) {
    this.palette = PALETTES[layout.biome];
    const chars = new Set<string>();
    for (const t of layout.texts) for (const c of Array.from(t.text)) chars.add(c);
    this.atlas = new GlyphAtlas(chars, anisotropy);
    this.kit = new MaterialKit(gradient, this.atlas, this.palette);
    const deps: CellDeps = { terrain: layout.terrain, kit: this.kit, atlas: this.atlas, ads, page: layout.title, anisotropy };

    const coreBoxes = layout.boxes.filter((b) => CORE_KINDS.has(b.kind));
    const detailBoxes = layout.boxes.filter((b) => !CORE_KINDS.has(b.kind));
    const at = (p: { center: number[] }): [number, number] => [p.center[0], p.center[2]];

    this.addCells('core', REGION_SIZE, layout, deps, {
      boxes: bucketByChunk(coreBoxes, at, REGION_SIZE),
      gates: bucketByChunk(layout.gates, at, REGION_SIZE),
    });
    this.addCells('detail', CHUNK_SIZE, layout, deps, {
      boxes: bucketByChunk(detailBoxes, at, CHUNK_SIZE),
      texts: bucketByChunk(layout.texts, (t) => [t.x, t.z], CHUNK_SIZE),
      panels: bucketByChunk(layout.panels, at, CHUNK_SIZE),
    });

    this.buildHorizon(layout);
    this.crowd = this.buildCrowd(layout);
    this.cranes = new Cranes(layout.bounds, layout.seed, gradient);
    this.group.add(this.cranes.group);
  }

  private addCells(
    role: 'core' | 'detail',
    size: number,
    layout: WorldLayout,
    deps: CellDeps,
    buckets: { [K in keyof CellData]?: Map<string, CellData[K]> },
  ): void {
    const { minX, maxX, minZ, maxZ } = layout.bounds;
    const { cx0, cx1, cz0, cz1 } = chunkRange(minX, maxX, minZ, maxZ, size);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = chunkKey(cx, cz);
        const data: CellData = {
          boxes: buckets.boxes?.get(key) ?? [],
          texts: buckets.texts?.get(key) ?? [],
          gates: buckets.gates?.get(key) ?? [],
          panels: buckets.panels?.get(key) ?? [],
        };
        // Detail chunks with nothing in them are never needed.
        if (role === 'detail' && !data.boxes.length && !data.texts.length && !data.panels.length) continue;
        const cell = new CellView(role, `${role}:${key}`, cx, cz, size, data, deps);
        this.cells.push(cell);
        this.group.add(cell.group);
      }
    }
  }

  /**
   * Ground beyond the generated terrain, out to the horizon, so the map never ends in bare
   * sky: a plateau-coloured frame around it, or for Lilypad the floor of the chasm.
   */
  private buildHorizon(layout: WorldLayout): void {
    const { minX, maxX, minZ, maxZ } = layout.bounds;
    const far = 12000;
    const chasm = layout.structure === 'lilypad';
    const material = new THREE.MeshLambertMaterial({ color: chasm ? this.palette.terrain.abyss : this.palette.terrain.plateau });
    this.ownedMaterials.push(material);
    const y = chasm ? -72 : BIOMES[layout.biome].rimHeight - 1;
    const pieces: [number, number, number, number][] = chasm
      ? [[minX - far, maxX + far, minZ - far, maxZ + far]]
      : [
          [minX - far, maxX + far, maxZ, maxZ + far],
          [minX - far, maxX + far, minZ - far, minZ],
          [minX - far, minX, minZ, maxZ],
          [maxX, maxX + far, minZ, maxZ],
        ];
    for (const [x0, x1, z0, z1] of pieces) {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
      this.owned.push(g);
      const mesh = new THREE.Mesh(g, material);
      mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Paper spectators along the top of every grandstand tier, facing the Seedpod. */
  private buildCrowd(layout: WorldLayout): THREE.InstancedMesh | null {
    const tiers = layout.boxes.filter((b) => b.kind === 'stand' && b.size[1] > 8.5);
    if (!tiers.length) return null;
    const rng = mulberry32(layout.seed ^ 0xc20d);
    const spots: THREE.Vector3[] = [];
    for (const t of tiers) {
      const top = t.center[1] + t.size[1] / 2;
      const x = t.center[0] - t.size[0] / 2 + 0.9;
      for (let z = t.center[2] - t.size[2] / 2 + 1; z < t.center[2] + t.size[2] / 2 - 1; z += 1.7) {
        if (rng() < 0.85) spots.push(new THREE.Vector3(x, top + 0.8, z + (rng() - 0.5) * 0.6));
      }
    }
    const mesh = new THREE.InstancedMesh(FIGURE, this.kit.paperFor('#ffffff'), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    spots.forEach((p, i) => {
      const s = 1.5 + rng() * 0.3;
      mesh.setMatrixAt(i, m.compose(p, q, new THREE.Vector3(s, s, s)));
      mesh.setColorAt(i, color.set(this.palette.crowd[Math.floor(rng() * this.palette.crowd.length)]));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    this.crowdCenter.set(tiers[0].center[0], 0, tiers[0].center[2]);
    this.group.add(mesh);
    return mesh;
  }

  update(time: number, camera: THREE.Vector3): void {
    this.kit.cave.uniforms.uTime.value = time;
    this.cranes.update(time);
    // The crowd is GNME-style too: goodnight, spectators, once the Seedpod is far behind.
    if (this.crowd) this.crowd.visible = camera.distanceTo(this.crowdCenter) < CROWD_RANGE;
  }

  dispose(): void {
    this.cranes.dispose();
    this.crowd?.dispose();
    this.cells.forEach((c) => c.dispose());
    this.owned.forEach((g) => g.dispose());
    this.ownedMaterials.forEach((m) => m.dispose());
    this.kit.dispose();
    this.atlas.dispose();
    this.group.removeFromParent();
  }
}
