import * as THREE from 'three';
import type { Box, BoxKind, Gate, Panel, Terrain, TextRun } from '@isle-of-wiki/shared';
import type { AdProvider } from '../ads/AdProvider';
import { buildBoxes, buildCaves, buildText, facingQuat, glyphCount, type MaterialKit } from '../render/builders';
import type { GlyphAtlas } from '../render/glyphAtlas';
import { createAdMaterial, createHalftoneMaterial } from '../render/materials';
import { INK, PAPER } from '../render/palette';
import { createTerrainMesh } from '../render/terrainMesh';
import type { Rest, Sleeper, SleepCounts } from './Gnme';

/** Big shapes you can see from afar live in regions; everything else is chunk detail. */
export const CORE_KINDS = new Set<BoxKind>(['spire', 'arch', 'stand', 'hut', 'tower', 'mesa']);
const ROCK_KINDS = new Set<BoxKind>(['spire', 'arch', 'mesa', 'boulder', 'caverock']);

export interface CellData {
  boxes: Box[];
  texts: TextRun[];
  gates: Gate[];
  panels: Panel[];
}

export interface CellDeps {
  terrain: Terrain;
  kit: MaterialKit;
  atlas: GlyphAtlas;
  ads: AdProvider;
  page: string;
  anisotropy: number;
}

const textureLoader = new THREE.TextureLoader().setCrossOrigin('anonymous');

/**
 * A painting or billboard. Its image is only fetched while its chunk is awake, and is
 * released when the chunk falls asleep (the board itself stays as blank paper).
 */
class PanelView {
  readonly mesh: THREE.Mesh;
  private texture: THREE.Texture | null = null;
  private loading = false;
  private wanted = false;

  constructor(
    private readonly panel: Panel,
    private readonly deps: CellDeps,
  ) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(panel.width, panel.height), deps.kit.paperFor(PAPER));
    this.mesh.position.fromArray(panel.center);
    facingQuat(panel.normal, this.mesh.quaternion);
  }

  wake(): void {
    this.wanted = true;
    if (this.texture || this.loading) return;
    this.loading = true;
    void this.load()
      .then((tex) => {
        this.loading = false;
        if (!tex) return;
        if (!this.wanted) return tex.dispose();
        this.texture = tex;
        const { panel } = this;
        this.mesh.material =
          panel.kind === 'painting'
            ? createHalftoneMaterial(tex, panel.width, panel.height, INK, PAPER)
            : createAdMaterial(tex, panel.width, panel.height, INK);
      })
      .catch(() => {
        // Image or ad unavailable: keep the blank board rather than break the world.
        this.loading = false;
      });
  }

  sleep(): void {
    this.wanted = false;
    if (!this.texture) return;
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.material = this.deps.kit.paperFor(PAPER);
    this.texture.dispose();
    this.texture = null;
  }

  dispose(): void {
    this.sleep();
    this.mesh.geometry.dispose();
  }

  private async load(): Promise<THREE.Texture | null> {
    const { panel, deps } = this;
    let tex: THREE.Texture;
    if (panel.kind === 'painting') {
      if (!panel.src) return null;
      tex = await textureLoader.loadAsync(panel.src);
    } else {
      const creative = await deps.ads.creativeFor({ page: deps.page, slot: panel.slot, width: panel.width, height: panel.height });
      if (!creative) return null;
      tex = creative.kind === 'canvas' ? new THREE.CanvasTexture(creative.canvas) : await textureLoader.loadAsync(creative.url);
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = deps.anisotropy;
    return tex;
  }
}

/**
 * One GNME cell of the world, built on first need.
 *  region (role 'core')   — terrain tile, big rocks, cave glows; drawn unless asleep
 *  chunk  (role 'detail') — cave rocks, signs, boards, paintings, text; drawn only when awake
 */
export class CellView implements Sleeper {
  readonly group = new THREE.Group();
  readonly center: THREE.Vector3;
  readonly radius: number;
  built = false;
  state: Rest = 'asleep';
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly panels: PanelView[] = [];
  private readonly totals: SleepCounts;

  constructor(
    readonly role: 'core' | 'detail',
    readonly key: string,
    private readonly cx: number,
    private readonly cz: number,
    private readonly size: number,
    private readonly data: CellData,
    private readonly deps: CellDeps,
  ) {
    this.center = new THREE.Vector3((cx + 0.5) * size, 20, (cz + 0.5) * size);
    // Half-diagonal plus room for tall things standing near the edge.
    this.radius = size * 0.71 + 20;
    this.totals = {
      caves: data.gates.length,
      letters: glyphCount(data.texts),
      rocks: data.boxes.filter((b) => ROCK_KINDS.has(b.kind)).length,
    };
    this.group.visible = false;
  }

  /** What this cell is currently not drawing, for the bedtime roll call. */
  get sleeping(): SleepCounts {
    const hidden = this.role === 'core' ? this.state === 'asleep' : this.state !== 'awake';
    return hidden ? this.totals : { caves: 0, letters: 0, rocks: 0 };
  }

  build(): void {
    if (this.built) return;
    this.built = true;
    const { kit } = this.deps;
    if (this.role === 'core') {
      const t = this.deps.terrain;
      const x0 = this.cx * this.size;
      const z0 = this.cz * this.size;
      const tile = createTerrainMesh(t, kit.palette.terrain, kit.terrain, {
        c0: Math.floor((x0 - t.x0) / t.cell),
        c1: Math.ceil((x0 + this.size - t.x0) / t.cell),
        r0: Math.floor((z0 - t.z0) / t.cell),
        r1: Math.ceil((z0 + this.size - t.z0) / t.cell),
      });
      if (tile) {
        tile.castShadow = true;
        tile.receiveShadow = true;
        this.geometries.push(tile.geometry);
        this.group.add(tile);
      }
      buildBoxes(this.data.boxes, kit, this.group);
      buildCaves(this.data.gates, kit, this.group);
      return;
    }
    buildBoxes(this.data.boxes, kit, this.group);
    const textGeometry = buildText(this.data.texts, this.deps.atlas, kit, this.group);
    if (textGeometry) this.geometries.push(textGeometry);
    for (const panel of this.data.panels) {
      const view = new PanelView(panel, this.deps);
      this.panels.push(view);
      this.group.add(view.mesh);
    }
  }

  rest(state: Rest): void {
    this.state = state;
    this.group.visible = this.role === 'core' ? state !== 'asleep' : state === 'awake';
    if (state === 'awake') this.panels.forEach((p) => p.wake());
    else if (state === 'asleep') this.panels.forEach((p) => p.sleep());
  }

  dispose(): void {
    this.panels.forEach((p) => p.dispose());
    this.geometries.forEach((g) => g.dispose());
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
  }
}
