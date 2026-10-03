import { FLOOR_HALF, LAYOUT as L, WALL_HALF } from '../constants';
import { randInt, randRange, type Rng } from '../rng';
import type { ImageBlock, TableBlock } from '../wiki/types';
import type { BiomeShape } from './biomes';
import { tableRows, type LinkRef, type PlacedItem } from './flow';
import { basisQuat, rightOf, yawQuat, type Path, type PathPoint } from './geom';
import { terrainHeight } from './terrain';
import { at, type Side, type Track } from './track';
import type { Box, BoxKind, Gate, Panel, Quat, Terrain, TextRun, TextStyle, Vec2, Vec3 } from './types';

/**
 * The Furnisher puts the article into a canyon: caves (one per link, in reading order,
 * alternating walls), banners for sub-headings, boulder fields for tables, hop-over
 * mesas in the gaps, arches overhead, paintings and billboards on trackside boards —
 * plus the Seedpod's grandstand, huts and towers, and the biome's landmarks.
 * Every structure hands it Tracks; it doesn't care what shape they are.
 */

const LH = L.lineH;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const neg = (v: Vec2): Vec2 => [-v[0], -v[1]];

export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('')}…`;
}

type PanelRequest = { kind: 'painting'; line: number; image: ImageBlock } | { kind: 'ad'; line: number };

/** Wall space a cave needs either side of its centre: mouth, its ring of rocks, and rubble. */
const CAVE_HALF_LEN = (L.caveLines * LH - 2.5) / 2 + 3;

/** Axis-aligned arena rectangle. The grandstand stands along its east (+x) side. */
export interface ArenaRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export class Furnisher {
  readonly boxes: Box[] = [];
  readonly texts: TextRun[] = [];
  readonly gates: Gate[] = [];
  readonly panels: Panel[] = [];
  readonly spawnPoints: Vec3[] = [];
  private adSlots = 0;
  /** Caves alternate walls through a whole canyon, so both walls fill evenly. */
  private nextSide: Side = -1;

  constructor(
    readonly rng: Rng,
    readonly biome: BiomeShape,
  ) {}

  box(kind: BoxKind, center: Vec3, size: Vec3, rot?: Quat, variant = 0): void {
    this.boxes.push(rot ? { kind, center, size, rot, variant } : { kind, center, size, variant });
  }

  text(run: TextRun): void {
    if (run.text.trim()) this.texts.push(run);
  }

  /** Upright text centred on `c`, facing horizontal direction `n`. */
  wallText(text: string, c: Vec3, n: Vec2, cw: number, ch: number, style: TextStyle): void {
    const adv = rightOf(neg(n));
    const half = (Array.from(text).length * cw) / 2;
    this.text({ text, x: c[0] - adv[0] * half, y: c[1], z: c[2] - adv[1] * half, adv, charW: cw, charH: ch, mode: 'wall', style });
  }

  /** Painted marker on the floor, starting `across` metres from the centreline. */
  floorText(p: PathPoint, across: number, text: string, cw: number, style: TextStyle): void {
    const [x, y, z] = at(p, across, 0.1);
    this.text({ text, x, y, z, adv: p.r, charW: cw, charH: cw * L.glyphAspect, mode: 'floor', pitch: Math.atan(p.slope), style });
  }

  /** Sign board on two legs spanning a canyon of half-width `half`, facing an approaching driver. */
  gantry(p: PathPoint, half: number, title: string, clearance: number, maxCharW: number): void {
    const label = truncate(title, 44);
    const n = Math.max(1, Array.from(label).length);
    const span = 2 * (half - 0.6);
    const cw = Math.min(maxCharW, (span - 3) / n);
    const ch = cw * L.glyphAspect;
    const boardH = ch + 1.6;
    const rot = yawQuat(p.t);
    this.box('board', at(p, 0, clearance + boardH / 2), [span + 1.2, boardH, 0.8], rot);
    for (const side of [-1, 1]) this.box('pillar', at(p, side * (half - 0.6), clearance / 2), [1.2, clearance, 1.2], rot);
    const c = at(p, 0, clearance + boardH / 2);
    this.wallText(label, [c[0] - p.t[0] * 0.45, c[1], c[2] - p.t[1] * 0.45], neg(p.t), cw, ch, 'heading');
  }

  /** Rock arch spanning a canyon at p, legs buried in the walls, crown well above the hover ceiling. */
  arch(p: PathPoint, half: number): void {
    const R = half + 5;
    const N = 9;
    const t3: Vec3 = [p.t[0], 0, p.t[1]];
    const segLen = 2 * R * Math.sin(Math.PI / (2 * N)) + 2;
    const thick = randRange(this.rng, 4.5, 6.5);
    const depth = randRange(this.rng, 6, 10);
    for (let i = 0; i < N; i++) {
      const th = ((i + 0.5) * Math.PI) / N;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const x: Vec3 = [-s * p.r[0], c, -s * p.r[1]];
      const y: Vec3 = [c * p.r[0], s, c * p.r[1]];
      this.box('arch', at(p, R * c, R * s), [segLen, thick, depth], basisQuat(x, y, t3), i);
    }
  }

  /** Arches every so often along a stretch of path (biome decides how often). */
  arches(path: Path, half: number, from: number, to: number): void {
    const every = this.biome.archEvery;
    if (!every) return;
    for (let s = from + randRange(this.rng, every * 0.35, every * 0.7); s < to; s += every + randRange(this.rng, -every * 0.25, every * 0.25)) {
      this.arch(path.at(s), half);
    }
  }

  // ---------------------------------------------------------------- canyon content

  /**
   * Lays one section's flow along a track. `caveSides` restricts which walls get caves
   * (the Seedpod's pit lane only has its grandstand wall).
   */
  section(track: Track, placed: PlacedItem[], opts: { ads?: boolean; caveSides?: Side[]; needsRock?: boolean } = {}): void {
    const caves: { line: number; link: LinkRef }[] = [];
    const panels: PanelRequest[] = [];
    for (const { item, line } of placed) {
      switch (item.t) {
        case 'para':
          item.links.forEach((link, i) => caves.push({ line: line + Math.floor(i * L.slotsPerLink), link }));
          if (line < track.lines) this.spawnPoints.push(at(track.path.at(track.lineS(line)), 0, 2));
          break;
        case 'banner':
          this.gantry(track.path.at(track.lineS(line) + LH / 2), WALL_HALF, item.text, L.bannerClearance, 1.4);
          break;
        case 'table':
          this.boulders(track, line, item.table);
          break;
        case 'image':
          panels.push({ kind: 'painting', line, image: item.image });
          break;
        case 'gap':
          if (this.rng() < this.biome.mesaChance) this.lowMesa(track.path.at(track.lineS(line)));
          break;
      }
    }
    if (opts.ads !== false) for (let k = 6; k < track.lines - 3; k += L.adEveryLines) panels.push({ kind: 'ad', line: k });

    for (const { line, link } of caves) {
      const prefer = this.nextSide;
      this.nextSide = (-this.nextSide) as Side;
      const sides: Side[] = opts.caveSides ?? [prefer, (-prefer) as Side];
      const slot = track.findSlot(line, L.caveLines, CAVE_HALF_LEN, sides, opts.needsRock !== false) ?? {
        // Wall completely full: overlap rather than drop a link — every link must stay reachable.
        side: sides[0],
        line: clamp(line, 0, Math.max(0, track.lines - L.caveLines)),
      };
      track.take(slot.side, slot.line, L.caveLines, CAVE_HALF_LEN);
      this.cave(track, slot.side, slot.line, link);
    }

    // Article images first, then billboards fill what is left.
    panels.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'painting' ? -1 : 1));
    for (const req of panels) this.panel(track, req);
  }

  /**
   * Cave in the canyon wall on `side`: the glowing mouth (drawn by the cave shader) ringed by
   * an uneven arch of rocks following the same outline — straight jambs up to 45% of the
   * height, then an elliptical crown — with a paper name plaque on top, and a red marker
   * painted on the floor pointing at it.
   */
  private cave(track: Track, side: Side, line: number, link: LinkRef): void {
    const p = track.span(line, L.caveLines);
    const gw = L.caveLines * LH - 2.5;
    const gh = L.caveH;
    const n: Vec2 = [-side * p.r[0], -side * p.r[1]];
    this.gates.push({ id: this.gates.length, target: link.target, source: link.source, center: at(p, side * (WALL_HALF - 1), gh / 2), width: gw, height: gh, normal: n });

    // Wall-plane frame: u along the wall, v up, out = toward the canyon.
    const base = at(p, side * (WALL_HALF - 1), 0);
    const T3: Vec3 = [p.t[0], 0, p.t[1]];
    const N3: Vec3 = [n[0], 0, n[1]];
    const point = (u: number, v: number, out: number): Vec3 => [base[0] + T3[0] * u + N3[0] * out, base[1] + v, base[2] + T3[2] * u + N3[2] * out];
    const axis = (u: number, v: number): Vec3 => [T3[0] * u, v, T3[2] * u];

    const hw = gw / 2;
    const straight = gh * 0.45;
    const crown = gh * 0.55;
    const outline: Vec2[] = [];
    for (let v = -0.6; v < straight; v += 1.2) outline.push([-hw, v]);
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI - (Math.PI * i) / 10;
      outline.push([hw * Math.cos(a), straight + crown * Math.sin(a)]);
    }
    for (let v = straight - 1.2; v >= -0.6; v -= 1.2) outline.push([hw, v]);

    let top: number = gh;
    for (let i = 0; i < outline.length - 1; i++) {
      const [au, av] = outline[i];
      const [bu, bv] = outline[i + 1];
      const len = Math.hypot(bu - au, bv - av);
      if (len < 0.3) continue;
      const du = (bu - au) / len;
      const dv = (bv - av) / len;
      const mu = (au + bu) / 2;
      const mv = (av + bv) / 2;
      // Outward = perpendicular pointing away from the middle of the mouth.
      let ou = dv;
      let ov = -du;
      if (ou * mu + ov * (mv - straight * 0.6) < 0) {
        ou = -ou;
        ov = -ov;
      }
      const thick = randRange(this.rng, 1.0, 2.1);
      const bulge = randRange(this.rng, 0, 0.45);
      const depth = randRange(this.rng, 1.4, 2.6);
      const cu = mu + ou * (thick / 2 + bulge * 0.5);
      const cv = mv + ov * (thick / 2 + bulge * 0.5);
      const x = axis(du, dv);
      const y = axis(ou, ov);
      const z: Vec3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
      this.box('caverock', point(cu, cv, depth / 2 - 0.8), [len + 0.7, thick, depth], basisQuat(x, y, z), randInt(this.rng, 0, 15));
      top = Math.max(top, cv + thick / 2);
    }

    for (const sgn of [-1, 1]) {
      const s = randRange(this.rng, 0.9, 2);
      this.box('boulder', point(sgn * (hw + randRange(this.rng, 1.6, 2.8)), s / 2, randRange(this.rng, 0.6, 1.8)), [s * 1.3, s, s], yawQuat(p.t), randInt(this.rng, 0, 15));
    }

    // Paper name plaque resting on the crown (red text on red-lit rock would be unreadable).
    const label = truncate(link.target, L.signMaxChars);
    const chars = Array.from(label).length;
    const cw = Math.min(0.75, (gw + 2) / chars);
    const plaqueY = top + 0.8;
    this.box('board', point(0, plaqueY, 1.6), [0.5, 1.7, Math.max(gw * 0.8, chars * cw + 1)], yawQuat(p.t));
    this.wallText(label, point(0, plaqueY, 1.88), n, cw, Math.min(cw * L.glyphAspect, 1.4), 'sign');

    // Red marker on the floor edge pointing at the cave.
    const across = side === 1 ? FLOOR_HALF - 3.5 : -FLOOR_HALF + 3.5 - 1.5;
    this.floorText(p, across, side === 1 ? '▶' : '◀', 1.5, 'link');
  }

  /** Trackside board on two posts at the canyon edge: a painting or a billboard. */
  private panel(track: Track, req: PanelRequest): void {
    let w: number = L.adW;
    let h: number = L.adH;
    if (req.kind === 'painting') {
      w = 12;
      h = w / req.image.aspect;
      if (h > 10) {
        h = 10;
        w = h * req.image.aspect;
      }
    }
    const n = Math.ceil((w + 2) / LH);
    const prefer: Side = req.line % 2 ? 1 : -1;
    const halfLen = w / 2 + 1;
    const slot = track.findSlot(req.line, n, halfLen, [prefer, (-prefer) as Side]);
    if (!slot) return;
    track.take(slot.side, slot.line, n, halfLen);

    const p = track.span(slot.line, n);
    const side = slot.side;
    const normal: Vec2 = [-side * p.r[0], -side * p.r[1]];
    const rot = yawQuat(p.t);
    const back = side * (WALL_HALF - 0.6);
    const front = side * (WALL_HALF - 0.86);
    const base = L.panelBaseY;

    this.box('board', at(p, back, base + h / 2), [0.4, h + 0.6, w + 0.6], rot);
    for (const sgn of [-1, 1]) {
      const c = at(p, back, base / 2);
      this.box('pillar', [c[0] + p.t[0] * sgn * (w / 2), c[1], c[2] + p.t[1] * sgn * (w / 2)], [0.5, base, 0.5], rot);
    }

    const center = at(p, front, base + h / 2);
    if (req.kind === 'ad') {
      this.panels.push({ kind: 'ad', slot: this.adSlots++, center, width: w, height: h, normal });
      return;
    }
    const painting: Panel = { kind: 'painting', caption: req.image.caption, center, width: w, height: h, normal };
    if (req.image.src) painting.src = req.image.src;
    this.panels.push(painting);
    if (req.image.caption) {
      const cw = 0.5;
      this.wallText(truncate(req.image.caption, Math.floor(w / cw)), at(p, front, base - 0.8), normal, cw, cw * L.glyphAspect, 'caption');
    }
  }

  /** Tables become a boulder field on the canyon floor: small hop-over obstacles. */
  private boulders(track: Track, line: number, t: TableBlock): void {
    const kc = clamp(t.cols, 2, 5);
    const cellW = (2 * (FLOOR_HALF - 3.5)) / kc;
    for (let r = 0; r < tableRows(t); r++) {
      const p = track.path.at(track.lineS(line + r));
      for (let c = 0; c < kc; c++) {
        if (this.rng() < 0.35) continue;
        const h = randRange(this.rng, 1.5, 4.5);
        const w = cellW * randRange(this.rng, 0.3, 0.55);
        this.box('boulder', at(p, -(FLOOR_HALF - 3.5) + (c + 0.5) * cellW, h / 2), [w, h, LH * randRange(this.rng, 0.4, 0.7)], yawQuat(p.t), randInt(this.rng, 0, 15));
      }
    }
  }

  /** Low rock in an empty stretch of floor — hop over it or steer round. */
  private lowMesa(p: PathPoint): void {
    const w = randRange(this.rng, 6, 12);
    const h = randRange(this.rng, L.mesaMinH, L.mesaMaxH);
    const across = (this.rng() < 0.5 ? -1 : 1) * randRange(this.rng, 3, FLOOR_HALF - w / 2 - 4);
    this.box('mesa', at(p, across, h / 2), [w, h, 3], yawQuat(p.t), randInt(this.rng, 0, 15));
  }

  // ---------------------------------------------------------------- Seedpod

  /**
   * The Seedpod (arena): open floor, a grandstand along its east side whose wall holds the
   * infobox's link gates (the pit lane), domed huts and lookout towers along the west side,
   * and the article title painted across the middle.
   */
  seedpod(title: string, a: ArenaRect, pit: Track | null, pitPlaced: PlacedItem[], canyons: Path[]): void {
    // Huts and towers must not stand where a canyon comes into the Seedpod.
    const clear = (x: number, z: number, r: number) =>
      canyons.every((c) => {
        for (let i = 0; i < c.xs.length; i += 3) if (Math.hypot(c.xs[i] - x, c.zs[i] - z) < WALL_HALF + r) return false;
        return true;
      });
    const d = a.z1 - a.z0;
    const zc = (a.z0 + a.z1) / 2;
    this.box('stand', [a.x1 + 1, 4, zc], [2, 8, d]);
    for (let i = 0; i < L.standTiers; i++) {
      const h = 8 + (i + 1) * L.standTierH;
      this.box('stand', [a.x1 + 2 + (i + 0.5) * L.standTierW, h / 2, zc], [L.standTierW, h, d], undefined, i);
    }
    // Pit-lane gates stand against the grandstand, not rock.
    if (pit) this.section(pit, pitPlaced, { ads: false, caveSides: [1], needsRock: false });

    for (let z = a.z0 + 20; z < a.z1 - 20; z += randRange(this.rng, 26, 40)) {
      const hw = randRange(this.rng, 12, 20);
      const hd = randRange(this.rng, 10, 16);
      const hx = a.x0 + 6 + hw / 2;
      if (clear(hx, z, Math.max(hw, hd) / 2 + 6)) this.box('hut', [hx, 4, z], [hw, 8, hd], undefined, randInt(this.rng, 0, 15));
      if (this.rng() < 0.45) {
        const th = randRange(this.rng, 18, 34);
        const tz = z + randRange(this.rng, -6, 6);
        if (clear(a.x0 + hw + 14, tz, 8)) this.box('tower', [a.x0 + hw + 14, th / 2, tz], [4, th, 4], undefined, randInt(this.rng, 0, 15));
      }
    }

    const label = truncate(title, 36);
    const n = Array.from(label).length;
    const cw = Math.min(5, ((a.x1 - a.x0) * 0.5) / n);
    const cx = (a.x0 + a.x1) / 2 - 20;
    this.text({ text: label, x: cx - (n * cw) / 2, y: 0.1, z: zc, adv: [1, 0], charW: cw, charH: cw * L.glyphAspect, mode: 'floor', style: 'heading' });
  }

  // ---------------------------------------------------------------- biome landmarks

  /** The biome's landmark (spires, trees, shards, vents, columns) on the plateau beside canyons. */
  landmarks(paths: { path: Path; half: number }[], terrain: Terrain): void {
    const b = this.biome;
    for (const { path, half } of paths) {
      for (let s = 30; s < path.length; s += randRange(this.rng, b.landmarkEvery * 0.6, b.landmarkEvery * 1.4)) {
        if (this.rng() > b.landmarkChance) continue;
        const p = path.at(s);
        const side = this.rng() < 0.5 ? -1 : 1;
        const across = side * (half + b.rimHeight / b.wallSlope + randRange(this.rng, 6, 40));
        const [x, , z] = at(p, across, 0);
        const ground = terrainHeight(terrain, x, z);
        // Only on high ground — never in a canyon or down a chasm.
        if (ground < p.y + b.rimHeight * 0.7) continue;
        this.landmark(x, ground, z);
      }
    }
  }

  /** A ring of landmarks around the Seedpod, on whatever high ground is there. */
  backdrop(a: ArenaRect, terrain: Terrain, count = 10): void {
    const cx = (a.x0 + a.x1) / 2;
    const cz = (a.z0 + a.z1) / 2;
    const r = Math.max(a.x1 - a.x0, a.z1 - a.z0) / 2;
    for (let i = 0; i < count; i++) {
      const ang = randRange(this.rng, 0, Math.PI * 2);
      const d = r + randRange(this.rng, 50, 180);
      const x = cx + Math.cos(ang) * d;
      const z = cz + Math.sin(ang) * d;
      const ground = terrainHeight(terrain, x, z);
      if (ground > this.biome.rimHeight * 0.6) this.landmark(x, ground, z);
    }
  }

  private landmark(x: number, ground: number, z: number): void {
    const b = this.biome;
    const h = randRange(this.rng, b.landmarkH[0], b.landmarkH[1]);
    const fw = randRange(this.rng, b.landmarkW[0], b.landmarkW[1]);
    const a = randRange(this.rng, 0, Math.PI * 2);
    this.box(b.landmark, [x, ground + h / 2 - 3, z], [fw, h, fw * randRange(this.rng, 0.7, 1.2)], yawQuat([Math.sin(a), Math.cos(a)]), randInt(this.rng, 0, 15));
  }

  spawns(fallback: Vec3): Vec3[] {
    const pts = this.spawnPoints;
    if (!pts.length) return Array.from({ length: L.spawnCount }, () => [...fallback] as Vec3);
    return Array.from({ length: L.spawnCount }, (_, i) => [...pts[Math.floor(((i + 0.5) / L.spawnCount) * pts.length)]] as Vec3);
  }
}
