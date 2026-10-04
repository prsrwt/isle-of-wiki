import * as THREE from 'three';
import { Guestbook, Heartbeat, threadGuide, type BiomeId, type Gate, type RaceConfig } from '@isle-of-wiki/shared';
import { HouseAdProvider, type AdProvider } from './ads/AdProvider';
import { FreeFlyControls } from './controls/FreeFlyControls';
import { Folio } from './folio/Folio';
import { Gnme, goodnightLines } from './gnme/Gnme';
import { Input } from './heartbeat/Input';
import { startLoop } from './heartbeat/Loop';
import type { BiomePalette } from './render/biomes';
import { loadGlyphFont } from './render/glyphAtlas';
import { createToonGradient } from './render/materials';
import { WorldView } from './render/WorldView';
import type { Hud } from './ui/hud';
import { BIOME_NAMES, STRUCTURE_NAMES } from './ui/names';
import { fetchArticleHtml } from './wiki/api';
import { loadWorld, type LoadedWorld } from './wiki/loadWorld';

const GATE_CALLOUT_RANGE = 70;
/** Half-size of the sun's shadow box around the camera (metres). */
const SHADOW_RANGE = 220;

export class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, 1, 0.3, 6000);
  private readonly input = new Input();
  private readonly controls: FreeFlyControls;
  private readonly heartbeat = new Heartbeat();
  private readonly gradient = createToonGradient();
  private readonly ads: AdProvider = new HouseAdProvider();
  private readonly folio = new Folio();
  private readonly hemi = new THREE.HemisphereLight();
  private readonly sun = new THREE.DirectionalLight();
  private readonly sunDir = new THREE.Vector3(0.5, 0.8, 0.35).normalize();
  private palette: BiomePalette | null = null;
  private view: WorldView | null = null;
  private world: LoadedWorld | null = null;
  private gnme: Gnme | null = null;
  private guestbook: Guestbook | null = null;
  private config: RaceConfig | null = null;
  /** The cave chosen in Folio; Thread guides you to it until you jump or pick another. */
  private thread: Gate | null = null;
  private jumping = false;
  private showGnme = false;
  private time = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpMark = new THREE.Vector3();

  constructor(
    canvas: HTMLCanvasElement,
    private readonly hud: Hud,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.fog = new THREE.Fog('#bcdcf2', 600, 2800);
    this.scene.background = new THREE.Color('#8fc6f0');
    // Sun shadows cover a box around the camera that moves with it (see frame()).
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_RANGE;
    sc.right = SHADOW_RANGE;
    sc.top = SHADOW_RANGE;
    sc.bottom = -SHADOW_RANGE;
    sc.near = 1;
    sc.far = 1200;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.controls = new FreeFlyControls(this.camera, canvas, this.input);
    this.controls.onLockChange = (locked) => this.hud.setPaused(!locked && !!this.world && !this.folio.isOpen);
    this.folio.onClose = () => this.closeFolio();
    this.folio.onSelect = (gate) => {
      this.thread = gate;
      this.folio.setSelected(gate.id);
      this.closeFolio();
    };

    // Heartbeat order each frame: read input → move camera → GNME + draw → forget one-shot presses.
    this.heartbeat
      .add({ name: 'input', frameUpdate: () => this.input.poll() })
      .add(this.controls)
      .add({ name: 'frame', frameUpdate: (dt) => this.frame(dt) })
      .add({ name: 'input-end', frameUpdate: () => this.input.endFrame() });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    startLoop(this.renderer, this.heartbeat);
  }

  setInputEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  /** Starts a race: a new room (its own Guestbook) and the start page, signed as the first arrival. */
  async start(config: RaceConfig): Promise<void> {
    this.config = config;
    this.guestbook = new Guestbook(config.roomSeed);
    await this.enter(config.start);
  }

  /**
   * Goes through a cave to `target` (debug key J until hyperspace arrives in Phase 3).
   * The Guestbook decides the world: whoever arrives first gets a biome other than the one
   * they came from; anyone later gets the same world.
   */
  async jump(target: string): Promise<void> {
    if (!this.guestbook || !this.world || this.jumping) return;
    this.jumping = true;
    this.hud.setStatus(`Jumping to ${target}…`);
    try {
      await this.enter(target, this.world.layout.biome);
    } catch (err) {
      this.hud.setStatus(`Couldn't reach ${target}: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 2500));
    } finally {
      this.hud.setStatus(null);
      this.jumping = false;
    }
  }

  /** Loads `title` as the Guestbook says: signed now if this room's first arrival (coming from biome `from`). */
  private async enter(title: string, from?: BiomeId): Promise<void> {
    if (!this.guestbook) return;
    const [article] = await Promise.all([fetchArticleHtml(title), loadGlyphFont()]);
    const signature = this.guestbook.arrive(article.title, from);
    const loaded = await loadWorld(article, this.guestbook.spec(signature));

    this.view?.dispose();
    this.view = new WorldView(loaded.layout, this.gradient, this.renderer.capabilities.getMaxAnisotropy(), this.ads);
    this.scene.add(this.view.group);
    this.applyPalette(this.view.palette);
    this.world = loaded;
    this.thread = null;
    this.folio.setWorld(loaded.page, loaded.layout, this.config?.target ?? '');
    this.gnme = new Gnme(this.camera, this.view.cells);

    const [x, y, z] = loaded.layout.arrival;
    const [dx, dz] = loaded.layout.arrivalDir;
    this.controls.setPose(x, y + 5, z, Math.atan2(-dx, -dz), -0.06);
    // Good morning: build what the arrival needs in slices (the page keeps animating), then let
    // the graphics card compile shaders in the background instead of freezing on the first frame.
    await this.gnme.wakeAround(this.camera.position);
    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.folio.isOpen) this.gnme.setLightsOut(true);
    this.hud.setPage(loaded.page.title, this.config?.target ?? '');
  }

  /** Sky, fog and light for the world's biome. */
  private applyPalette(p: BiomePalette): void {
    this.palette = p;
    (this.scene.background as THREE.Color).set(p.sky.background);
    (this.scene.fog as THREE.Fog).color.set(p.sky.fog);
    this.hemi.color.set(p.light.hemiSky);
    this.hemi.groundColor.set(p.light.hemiGround);
    this.hemi.intensity = p.light.hemiIntensity;
    this.sun.color.set(p.light.sun);
    this.sun.intensity = p.light.sunIntensity;
    this.sunDir.set(...p.light.sunDir).normalize();
  }

  /**
   * Folio opens over the running world: nothing pauses (the Heartbeat, input and later physics
   * keep ticking), the mouse is released, and since the world can't be seen GNME puts every
   * cell to sleep and the 3D scene stops drawing.
   */
  private openFolio(): void {
    this.folio.open();
    this.gnme?.setLightsOut(true);
    this.hud.setPaused(false);
    this.controls.unlock();
  }

  /** Back to flying. If the browser won't recapture the mouse (e.g. closed with Esc), ask for a click. */
  private closeFolio(): void {
    this.folio.close();
    this.gnme?.setLightsOut(false);
    void this.controls.lock().then((ok) => {
      if (!ok) this.hud.setPaused(!!this.world);
    });
  }

  /** Dev hook: jump the camera (exposed as window.iow in dev builds). */
  debugPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.controls.setPose(x, y, z, yaw, pitch);
  }

  /** Dev hook: current GNME roll call. */
  debugGnme(): ReturnType<Gnme['stats']> | null {
    return this.gnme?.stats() ?? null;
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(dt: number): void {
    this.time += dt;
    if (this.world && this.controls.locked && this.input.wasPressed('overview')) {
      const p = this.camera.position;
      this.controls.setPose(p.x, 900, p.z, 0, -1.45);
    }
    if (this.world && this.input.wasPressed('gnme')) this.showGnme = !this.showGnme;
    if (this.world && this.controls.enabled && this.input.wasPressed('folio')) {
      if (this.folio.isOpen) this.closeFolio();
      else this.openFolio();
    }
    const ahead = this.gateAhead();
    if (ahead && this.input.wasPressed('jump')) void this.jump(ahead.target);

    if (this.folio.isOpen) {
      // Lights out: draw only Folio's map, not the hidden 3D world.
      const fwd = this.camera.getWorldDirection(this.tmpDir);
      const p = this.camera.position;
      this.folio.update({ x: p.x, z: p.z, dirX: fwd.x, dirZ: fwd.z });
    } else {
      this.drawWorld();
    }

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.updateHudStats();
    }
    if (this.world) this.hud.setGate(ahead?.target ?? null, !!ahead && ahead.id === this.thread?.id);
    this.updateThread();
  }

  /** Thread: the HUD arrow and distance to the picked cave, and a marker over it when it's in view. */
  private updateThread(): void {
    const gate = this.thread;
    if (!gate || this.folio.isOpen) {
      this.hud.setThread(null);
      this.hud.setThreadMark(null);
      return;
    }
    const p = this.camera.position;
    const fwd = this.camera.getWorldDirection(this.tmpDir);
    const guide = threadGuide([p.x, p.y, p.z], [fwd.x, fwd.z], gate.center);
    this.hud.setThread({ name: gate.target, distance: guide.distance, turn: guide.turn });

    // Marker just above the cave mouth, only when it's in front of the camera and on screen.
    const m = this.tmpMark.set(gate.center[0], gate.center[1] + gate.height / 2 + 1.5, gate.center[2]);
    const ahead = (m.x - p.x) * fwd.x + (m.y - p.y) * fwd.y + (m.z - p.z) * fwd.z > 0;
    m.project(this.camera);
    const onScreen = ahead && Math.abs(m.x) <= 1 && Math.abs(m.y) <= 1;
    this.hud.setThreadMark(
      onScreen ? { x: ((m.x + 1) / 2) * window.innerWidth, y: ((1 - m.y) / 2) * window.innerHeight, distance: guide.distance } : null,
    );
  }

  private drawWorld(): void {
    // Thin the fog as the camera climbs so the bird's-eye view stays clear.
    if (this.palette) {
      const fog = this.scene.fog as THREE.Fog;
      const lift = Math.max(0, this.camera.position.y - 60) * 3;
      fog.near = this.palette.sky.fogNear + lift;
      fog.far = this.palette.sky.fogFar + lift;
    }
    this.followSun();

    this.gnme?.frameUpdate();
    this.view?.update(this.time, this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  /** Keeps the shadow box centred on the camera, snapped to shadow-map texels so shadows don't shimmer. */
  private followSun(): void {
    const texel = (2 * SHADOW_RANGE) / this.sun.shadow.mapSize.x;
    const c = this.camera.position;
    const tx = Math.round(c.x / texel) * texel;
    const tz = Math.round(c.z / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx, 0, tz).addScaledVector(this.sunDir, 500);
  }

  /** Nearest cave roughly in front of the camera, for the HUD callout. */
  private gateAhead(): Gate | null {
    if (!this.world) return null;
    const cam = this.camera.position;
    const fwd = this.camera.getWorldDirection(this.tmpDir);
    let best: Gate | null = null;
    let bestD = GATE_CALLOUT_RANGE;
    for (const g of this.world.layout.gates) {
      const dx = g.center[0] - cam.x;
      const dy = g.center[1] - cam.y;
      const dz = g.center[2] - cam.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < bestD && (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d > 0.85) {
        best = g;
        bestD = d;
      }
    }
    return best;
  }

  private updateHudStats(): void {
    if (!this.world) return;
    const { page, layout } = this.world;
    const { minX, maxX, minZ, maxZ } = layout.bounds;
    const size = `${Math.round(maxX - minX)}×${Math.round(maxZ - minZ)} m`;
    this.hud.setStats(
      `${this.fps} fps · ${STRUCTURE_NAMES[layout.structure]} · ${BIOME_NAMES[layout.biome]} · ${layout.gates.length} caves → ${page.linkCount} pages · ${size} · speed ${Math.round(this.controls.speed)}`,
    );
    this.hud.setGnme(this.showGnme && this.gnme ? goodnightLines(this.gnme.stats()) : null);
  }
}
