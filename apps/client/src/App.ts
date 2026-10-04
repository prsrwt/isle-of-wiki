import * as THREE from 'three';
import { Guestbook, Heartbeat, Marshal, nearestGateInReach, RACE, SIM, threadGuide, type BiomeId, type Gate, type RaceConfig } from '@isle-of-wiki/shared';
import { PhysicsWorld, POD } from '@isle-of-wiki/shared/physics';
import { HouseAdProvider, type AdProvider } from './ads/AdProvider';
import { FreeFlyControls } from './controls/FreeFlyControls';
import { Folio } from './folio/Folio';
import { Gnme, goodnightLines } from './gnme/Gnme';
import { Input } from './heartbeat/Input';
import { PhysicsDebug } from './physics/PhysicsDebug';
import { PodCamera } from './pod/PodCamera';
import { PodFx } from './pod/PodFx';
import { PodModel } from './pod/PodModel';
import { PodDriver } from './pod/PodDriver';
import { startLoop } from './heartbeat/Loop';
import { PALETTES, type BiomePalette } from './render/biomes';
import { loadGlyphFont } from './render/glyphAtlas';
import { createToonGradient } from './render/materials';
import { WorldView } from './render/WorldView';
import { LinkTunnel } from './tunnel/LinkTunnel';
import type { Hud } from './ui/hud';
import { BIOME_NAMES, STRUCTURE_NAMES } from './ui/names';
import { fetchArticleHtml } from './wiki/api';
import { loadWorld, type LoadedWorld } from './wiki/loadWorld';

const GATE_CALLOUT_RANGE = 70;
/** The shortest ride through a link tunnel: what it costs on the race clock. */
const TUNNEL_SECONDS = RACE.tunnelTicks / SIM.tickHz;
/** "GO!" stays up this long after the countdown (ticks). */
const GO_TICKS = SIM.tickHz;
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
  private readonly driver: PodDriver;
  private readonly podCamera: PodCamera;
  private readonly podModel = new PodModel(this.gradient);
  private readonly podFx: PodFx;
  /** Pod's drawn yaw last frame and its smoothed turn rate, for leaning into turns. */
  private podYaw = 0;
  private turnRate = 0;
  private readonly contact = new THREE.Vector3();
  private readonly push = new THREE.Vector2();
  private readonly away = new THREE.Vector3();
  /** Smoothed engine revs for the RPM bar, 0..1. */
  private rpm = 0;
  private readonly hemi = new THREE.HemisphereLight();
  private readonly sun = new THREE.DirectionalLight();
  private readonly sunDir = new THREE.Vector3(0.5, 0.8, 0.35).normalize();
  private palette: BiomePalette | null = null;
  private view: WorldView | null = null;
  private world: LoadedWorld | null = null;
  private gnme: Gnme | null = null;
  private physics: PhysicsWorld | null = null;
  private physicsDebug: PhysicsDebug | null = null;
  private guestbook: Guestbook | null = null;
  private config: RaceConfig | null = null;
  /** This race's rules and clock: the grid, countdown, time, hops and finish. */
  private marshal: Marshal | null = null;
  private readonly tunnel: LinkTunnel;
  /** The cave chosen in Folio; Thread guides you to it until you jump or pick another. */
  private thread: Gate | null = null;
  private jumping = false;
  /** The last cave whose page was fetched ahead of time. */
  private prefetched: string | null = null;
  private showGnme = false;
  private time = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpMark = new THREE.Vector3();
  private readonly podPos = new THREE.Vector3();
  private readonly podHeading = new THREE.Vector2();

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
    this.controls.flying = false;
    this.podCamera = new PodCamera(this.camera);
    this.driver = new PodDriver(this.input);
    this.driver.active = () =>
      this.controls.locked && !this.folio.isOpen && !this.controls.flying && !this.jumping && !!this.marshal?.canDrive;
    this.scene.add(this.podModel.group, this.camera);
    this.podFx = new PodFx(this.camera, this.scene);
    this.tunnel = new LinkTunnel(this.gradient);
    this.controls.onLockChange = (locked) => {
      // Taking control on the starting grid starts the countdown.
      if (locked && this.world && !this.controls.flying) this.marshal?.startCountdown();
      this.hud.setPaused(!locked && !!this.world && !this.folio.isOpen && !this.hud.finishOpen);
    };
    this.folio.onClose = () => this.closeFolio();
    this.folio.onSelect = (gate) => {
      this.thread = gate;
      this.folio.setSelected(gate.id);
      this.closeFolio();
    };

    // Heartbeat: each fixed step, the Marshal's clock → pod controls → physics → pod reads where
    // it ended up (and whether it drove into a cave); then each frame, read input → look →
    // camera, GNME + draw (or the link tunnel) → forget one-shot presses.
    this.heartbeat
      .add({ name: 'marshal', fixedUpdate: () => this.marshal?.step() })
      .add(this.driver)
      .add({ name: 'physics', fixedUpdate: () => this.physics?.step() })
      .add({ name: 'pod-after', fixedUpdate: () => this.driver.afterPhysics() })
      .add({ name: 'input', frameUpdate: () => this.input.poll() })
      .add(this.controls)
      .add({ name: 'frame', frameUpdate: (dt, alpha) => this.frame(dt, alpha) })
      .add({ name: 'input-end', frameUpdate: () => this.input.endFrame() });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    startLoop(this.renderer, this.heartbeat);
  }

  setInputEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  /**
   * Starts a race: a new room (its own Guestbook) and the start page, signed as the first
   * arrival. The racer waits on the grid until they take control, then the countdown runs.
   */
  async start(config: RaceConfig): Promise<void> {
    this.hud.hideFinish();
    this.hud.setCountdown('');
    this.config = config;
    this.guestbook = new Guestbook(config.roomSeed);
    await this.enter(config.start);
    // Only now: a race started over a running one keeps its old Marshal until the new page is up.
    this.marshal = new Marshal(config);
  }

  /**
   * Goes through a cave to `target` (J in front of it, or J at any cave ahead while flying),
   * riding a link tunnel while the next page downloads and builds behind it. The ride costs
   * the same on the clock however long that takes.
   * The Guestbook decides the world: whoever arrives first gets a biome other than the one
   * they came from; anyone later gets the same world.
   */
  async jump(target: string): Promise<void> {
    const marshal = this.marshal;
    if (!this.guestbook || !this.world || this.jumping || !marshal?.canDrive) return;
    this.jumping = true;
    this.driver.freeze();
    // After the finish you can keep travelling; the Marshal just stops timing.
    marshal.enterTunnel();
    this.tunnel.begin(target, this.palette);
    this.hud.setInTunnel(true);
    const slow = setTimeout(() => (this.tunnel.waiting = true), (TUNNEL_SECONDS + 1.5) * 1000);
    try {
      await Promise.all([this.enter(target, this.world.layout.biome), this.tunnel.minimum(TUNNEL_SECONDS)]);
      const won = marshal.arrive(this.world.page.title);
      await this.tunnel.exit();
      if (won && marshal === this.marshal) this.finishRace(marshal);
    } catch (err) {
      marshal.abortTunnel();
      await this.tunnel.exit();
      // Stay where you were and drive on.
      this.hud.setInTunnel(false);
      this.hud.setStatus(`Couldn't reach ${target}: ${(err as Error).message}`);
      this.driver.release();
      this.podCamera.reset();
      await new Promise((r) => setTimeout(r, 2500));
      this.hud.setStatus(null);
    } finally {
      clearTimeout(slow);
      this.hud.setInTunnel(false);
      this.jumping = false;
    }
  }

  /** Flag: the finish card, with the best time for this start and target remembered locally. */
  private finishRace(marshal: Marshal): void {
    const result = marshal.result();
    if (!result) return;
    const key = `iow.best:${marshal.config.start}\u2192${marshal.config.target}`;
    let best: number | null = null;
    try {
      const stored = Number(localStorage.getItem(key));
      if (stored > 0) best = stored;
      if (best === null || result.timeMs < best) localStorage.setItem(key, String(result.timeMs));
    } catch {
      // No storage (private window): no best time.
    }
    this.hud.showFinish(result, best);
    this.hud.setPaused(false);
    this.controls.unlock();
  }

  /** Closes the finish card and drives on around the target page (untimed). */
  keepExploring(): void {
    this.hud.hideFinish();
    void this.controls.lock().then((ok) => {
      if (!ok) this.hud.setPaused(!!this.world);
    });
  }

  /** The race being run (for "Race again"). */
  get raceConfig(): RaceConfig | null {
    return this.config;
  }

  /** Loads `title` as the Guestbook says: signed now if this room's first arrival (coming from biome `from`). */
  private async enter(title: string, from?: BiomeId): Promise<void> {
    if (!this.guestbook) return;
    const [article] = await Promise.all([fetchArticleHtml(title), loadGlyphFont()]);
    const signature = this.guestbook.arrive(article.title, from);
    this.tunnel.setDestination(PALETTES[signature.biome]);
    const loaded = await loadWorld(article, this.guestbook.spec(signature));
    const physics = await PhysicsWorld.create(loaded.layout);

    const showPhysics = this.physicsDebug?.visible ?? false;
    this.physicsDebug?.dispose();
    this.physics?.dispose();
    this.physics = physics;
    this.physicsDebug = new PhysicsDebug(physics, loaded.layout.terrain);
    this.physicsDebug.visible = showPhysics;
    this.scene.add(this.physicsDebug.group);
    this.driver.attach(physics, loaded.layout.arrival, loaded.layout.arrivalDir);

    this.view?.dispose();
    this.view = new WorldView(loaded.layout, this.gradient, this.renderer.capabilities.getMaxAnisotropy(), this.ads);
    this.scene.add(this.view.group);
    this.applyPalette(this.view.palette);
    this.world = loaded;
    this.thread = null;
    this.folio.setWorld(loaded.page, loaded.layout, this.config?.target ?? '');
    this.gnme = new Gnme(this.camera, this.view.cells);

    if (this.controls.flying) {
      const [x, y, z] = loaded.layout.arrival;
      const [dx, dz] = loaded.layout.arrivalDir;
      this.controls.setPose(x, y + 5, z, Math.atan2(-dx, -dz), -0.06);
    } else {
      this.controls.setLook(0, 0);
      this.podCamera.reset();
      this.placeCamera(0, 1);
    }
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
    this.controls.flying = true;
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
    this.tunnel.resize(w / h);
  }

  /** Toggles the free-fly spectator camera (debug); the pod waits where it is meanwhile. */
  private toggleFly(): void {
    const flying = !this.controls.flying;
    this.controls.flying = flying;
    if (flying) {
      const fwd = this.camera.getWorldDirection(this.tmpDir);
      const p = this.camera.position;
      this.controls.setPose(p.x, p.y, p.z, Math.atan2(-fwd.x, -fwd.z), Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)));
    } else {
      this.controls.setLook(0, 0);
      this.podCamera.reset();
    }
  }

  /** Camera and pod model at the pod's pose, blended `alpha` of the way between physics steps. */
  private placeCamera(dt: number, alpha: number): void {
    this.driver.pose(alpha, this.podPos, this.podHeading);
    const yaw = Math.atan2(-this.podHeading.x, -this.podHeading.y);
    this.podModel.group.position.copy(this.podPos);
    this.podModel.group.rotation.y = yaw;

    // Turn rate seen on screen (yaw grows to the left), smoothed, for leaning into turns.
    if (dt > 0) {
      let d = this.podYaw - yaw;
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      this.turnRate += (d / dt - this.turnRate) * (1 - Math.exp(-8 * dt));
    }
    this.podYaw = yaw;

    const pod = this.driver.current;
    const input = this.driver.lastInput;
    const speed = pod ? Math.min(1, Math.abs(pod.forwardSpeed()) / POD.boostSpeed) : 0;
    this.podModel.update(dt, {
      throttle: input.throttle,
      speed,
      turnRate: this.turnRate,
      boosting: !!pod?.boosting,
      braking: !!input.brake,
    });
    if (this.controls.flying || !pod) {
      this.podFx.update(dt, null);
      return;
    }
    this.podCamera.update(dt, this.podPos, this.podHeading, this.controls.look, (from, dir, max) => {
      const hit = this.physics?.castRay([from.x, from.y, from.z], [dir.x, dir.y, dir.z], max, 'all');
      return hit ? hit.distance : null;
    });
    // Sparks where the pod meets the wall: from the pod's middle, look along the wall's push
    // (reversed) for the pod's edge — the side for a side swipe, the engine tips head-on.
    this.push.set(pod.scrapePush[0], pod.scrapePush[1]);
    this.away.set(-this.push.x, 0, -this.push.y);
    const hit = pod.scraping ? this.physics?.castRay([this.podPos.x, this.podPos.y, this.podPos.z], [this.away.x, 0, this.away.z], 8, 'all') : null;
    this.contact.copy(this.podPos).addScaledVector(this.away, hit ? hit.distance : 2.3);
    this.podFx.update(dt, { speed, mps: Math.abs(pod.forwardSpeed()), scraping: pod.scraping, contact: this.contact, push: this.push });
  }

  private frame(dt: number, alpha: number): void {
    this.time += dt;
    if (this.world && this.input.wasPressed('info')) this.hud.toggleInfo();
    this.updateRace();
    if (this.tunnel.active) {
      // In a link tunnel: the next world is being built behind it; draw only the tunnel.
      this.tunnel.update(dt, this.controls.locked ? this.input.move() : { x: 0, y: 0 });
      this.renderer.render(this.tunnel.scene, this.tunnel.camera);
      return;
    }
    this.tunnel.fadeOut(dt);
    if (this.world && this.controls.locked && !this.jumping) {
      if (this.input.wasPressed('fly')) this.toggleFly();
      if (!this.controls.flying && this.input.wasPressed('respawn')) {
        this.driver.respawn();
        this.podCamera.reset();
      }
    }
    if (this.world && this.driver.current) this.placeCamera(dt, alpha);
    if (this.world && this.controls.locked && this.controls.flying && this.input.wasPressed('overview')) {
      const p = this.camera.position;
      this.controls.setPose(p.x, 900, p.z, 0, -1.45);
    }
    if (this.world && this.input.wasPressed('gnme')) this.showGnme = !this.showGnme;
    if (this.physicsDebug && this.input.wasPressed('physics')) this.physicsDebug.visible = !this.physicsDebug.visible;
    if (this.physicsDebug?.visible && this.controls.locked && this.input.wasPressed('drop')) {
      this.physicsDebug.dropBall(this.camera.position, this.camera.getWorldDirection(this.tmpDir));
    }
    if (this.world && this.controls.enabled && !this.jumping && this.input.wasPressed('folio')) {
      if (this.folio.isOpen) this.closeFolio();
      else this.openFolio();
    }
    // Caves: driving, J travels through the one you're in front of (within reach); free-flying,
    // J takes any cave ahead (debug).
    const reach = !this.controls.flying && this.world ? nearestGateInReach(this.world.layout.gates, [this.podPos.x, this.podPos.y, this.podPos.z]) : null;
    const ahead = reach ?? this.gateAhead();
    const ready = !!ahead && (this.controls.flying || reach === ahead) && !!this.marshal?.canDrive;
    // Start downloading a cave's page as soon as you pull up in front of it: a shorter wait in the tunnel.
    if (reach && reach.target !== this.prefetched) {
      this.prefetched = reach.target;
      fetchArticleHtml(reach.target).catch(() => {});
    }
    if (ahead && ready && this.controls.locked && this.input.wasPressed('jump')) void this.jump(ahead.target);

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
    if (this.world) this.hud.setGate(ahead?.target ?? null, !!ahead && ahead.id === this.thread?.id, ready && !this.jumping);
    this.updateDash(dt);
    this.updateThread();
  }

  /** The race clock, and the big 3, 2, 1, GO! */
  private updateRace(): void {
    const m = this.marshal;
    if (!m || !this.world) {
      this.hud.setRace(null);
      this.hud.setCountdown('');
      return;
    }
    this.hud.setRace({ timeMs: m.timeMs, hops: m.hops, finished: m.phase === 'finished' });
    const n = m.countdownNumber;
    this.hud.setCountdown(n > 0 ? String(n) : m.phase === 'racing' && m.hops === 0 && m.ticks < GO_TICKS ? 'GO!' : '');
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
    this.physicsDebug?.update(this.camera.position);
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

  /** The dashboard: speed, revs and boost (hidden while free-flying). */
  private updateDash(dt: number): void {
    const pod = this.driver.current;
    if (!this.world || !pod || this.controls.flying) {
      this.hud.setDrive(null);
      return;
    }
    const speed = Math.abs(pod.forwardSpeed());
    // Revs: idle, rising with speed, kicked up by throttle and boost; eased so the bar sweeps.
    const throttle = Math.abs(this.driver.lastInput.throttle);
    const target = Math.min(1, 0.1 + 0.72 * Math.min(1, speed / POD.maxSpeed) + 0.12 * throttle + (pod.boosting ? 0.12 : 0));
    this.rpm += (target - this.rpm) * Math.min(1, 8 * dt);
    this.hud.setDrive({ kmh: speed * 3.6, topKmh: POD.boostSpeed * 3.6, rpm: this.rpm, boost: pod.boostTank, boosting: pod.boosting, scraping: pod.scraping });
  }

  /** Nerd stats for the H panel (refreshed twice a second while it's open). */
  private updateHudStats(): void {
    this.hud.setGnme(this.showGnme && this.gnme ? goodnightLines(this.gnme.stats()) : null);
    if (!this.world || !this.hud.infoOpen) return;
    const { page, layout } = this.world;
    const { minX, maxX, minZ, maxZ } = layout.bounds;
    const pod = this.driver.current;
    const g = this.gnme?.stats();
    const rows: [string, string][] = [
      ['Frame rate', `${this.fps} fps`],
      ['Page', page.title],
      ['World', `${STRUCTURE_NAMES[layout.structure]} · ${BIOME_NAMES[layout.biome]}`],
      ['Size', `${Math.round(maxX - minX)} × ${Math.round(maxZ - minZ)} m`],
      ['Caves', `${layout.gates.length} → ${page.linkCount} linked pages`],
      ['Props', `${layout.boxes.length} solid boxes`],
      ['Camera', this.controls.flying ? `free-fly · speed ${Math.round(this.controls.speed)}` : 'chase'],
    ];
    if (pod) {
      const [x, y, z] = pod.position();
      rows.push(
        ['Pod', `${x.toFixed(0)}, ${y.toFixed(1)}, ${z.toFixed(0)}`],
        ['Hover', pod.surfaceBelow === null ? 'falling' : `${(y - pod.surfaceBelow).toFixed(2)} m up`],
        ['Respawns', String(pod.respawns)],
      );
    }
    if (g) rows.push(['GNME', goodnightLines(g)[0]]);
    this.hud.setInfo(rows);
  }

}
