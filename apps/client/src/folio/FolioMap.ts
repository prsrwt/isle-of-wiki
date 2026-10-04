import { FLOOR_HALF, type Gate, type WorldLayout } from '@isle-of-wiki/shared';

/** How close (CSS px) the pointer must be to a cave dot to hover it. */
const HIT_RADIUS = 9;
const PAD = 28;
/** Furthest zoom-in, relative to the whole-page view. */
const MAX_ZOOM = 60;
/** Cave names appear once the map is at least this many pixels per metre. */
const CAVE_LABEL_SCALE = 0.9;
/** Pointer travel (px) that turns a click into a drag. */
const DRAG_SLOP = 4;
const LABEL_MAX_CHARS = 28;
/** Section names wrap onto at most two lines of this width (px). */
const SECTION_WRAP = 190;
const SECTION_LINE_H = 15;

const INK = '#16151a';
const RED = '#d8263b';
const PAPER = '#f6f2e9';
const CANYON = '#e4d6bb';
const ARENA = '#d3c09c';
const PICKED = '#f5c518';
const SECTION_FONT = '800 13px "M PLUS Rounded 1c", sans-serif';
const CAVE_FONT = '500 11px "M PLUS Rounded 1c", sans-serif';

/** Where the camera is and which way it faces (horizontal), for the "you are here" marker. */
export interface MapPose {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
}

/** A place name drawn on the map (section titles, the page title over the Seedpod). */
export interface MapLabel {
  text: string;
  x: number;
  z: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const clip = (s: string) => (s.length > LABEL_MAX_CHARS ? `${s.slice(0, LABEL_MAX_CHARS - 1)}…` : s);

/** Greedy word wrap into at most `maxLines` lines; the last line gets an ellipsis if text is left over. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (!line || ctx.measureText(next).width <= maxW) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === maxLines - 1) {
      const rest = words.slice(i).join(' ');
      let cut = rest;
      while (cut.length > 1 && ctx.measureText(cut).width > maxW) cut = cut.slice(0, -1);
      return [...lines, cut === rest ? rest : `${cut.slice(0, -1).trimEnd()}…`];
    }
  }
  return [...lines, line];
}

/**
 * Folio's track map: the page's world seen from above (north = -z = up), canyons as paper
 * strips, every cave as a dot. Wheel zooms at the cursor, dragging pans. Like a street map,
 * names appear as there is room: section names first, cave names once zoomed in, and any
 * label that would overlap one already drawn is left out.
 */
export class FolioMap {
  onHover: (gateId: number | null) => void = () => {};
  onPick: (gateId: number) => void = () => {};
  private readonly ctx: CanvasRenderingContext2D;
  private layout: WorldLayout | null = null;
  private labels: MapLabel[] = [];
  private target = '';
  private hovered: number | null = null;
  private selected: number | null = null;
  private width = 0;
  private height = 0;
  /** Current view: screen = world * scale + off. `fitScale` shows the whole page. */
  private scale = 1;
  private fitScale = 1;
  private offX = 0;
  private offY = 0;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  /** Redraw only when something changed: the view, hover, selection, or where you are. */
  private dirty = true;
  private lastPose = '';
  private suppressClick = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    // Labels measured before the web font arrived would be the wrong width.
    void document.fonts?.ready.then(() => (this.dirty = true));
    const local = (e: MouseEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      if (!this.drag.moved) this.onHover(null);
      this.drag.moved = true;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.pan(dx, dy);
      canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', () => {
      if (!this.drag) return;
      this.suppressClick = this.drag.moved;
      this.drag = null;
      canvas.style.cursor = this.hovered === null ? 'grab' : 'pointer';
    });
    canvas.addEventListener('mousemove', (e) => {
      if (!this.drag?.moved) this.onHover(this.gateAt(...local(e)));
    });
    canvas.addEventListener('mouseleave', () => {
      if (!this.drag) this.onHover(null);
    });
    canvas.addEventListener('click', (e) => {
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      const id = this.gateAt(...local(e));
      if (id !== null) this.onPick(id);
    });
    canvas.addEventListener('dblclick', (e) => {
      const [x, y] = local(e);
      if (this.gateAt(x, y) === null) this.zoomAt(x, y, 2);
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
        this.zoomAt(...local(e), Math.exp(-e.deltaY * lines * 0.0015));
      },
      { passive: false },
    );
  }

  setWorld(layout: WorldLayout, target: string, labels: MapLabel[]): void {
    this.layout = layout;
    this.target = target;
    this.labels = labels;
    this.hovered = null;
    this.selected = null;
    this.fitView();
    this.dirty = true;
  }

  setHovered(id: number | null): void {
    if (id !== this.hovered) this.dirty = true;
    this.hovered = id;
    if (!this.drag) this.canvas.style.cursor = id === null ? 'grab' : 'pointer';
  }

  setSelected(id: number | null): void {
    this.selected = id;
    this.dirty = true;
  }

  /** Matches the backing store to the element's size, keeping the zoom and the centre of view. */
  resize(): void {
    const oldW = this.width;
    const centre = oldW ? this.toWorld(this.width / 2, this.height / 2) : null;
    const zoom = this.scale / this.fitScale;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(this.width * dpr));
    this.canvas.height = Math.max(1, Math.round(this.height * dpr));
    this.fitView();
    if (centre && zoom > 1) {
      this.scale = this.fitScale * zoom;
      this.offX = this.width / 2 - centre[0] * this.scale;
      this.offY = this.height / 2 - centre[1] * this.scale;
    }
  }

  /** Shows the whole page. */
  fitView(): void {
    if (!this.layout || !this.width) return;
    const { minX, maxX, minZ, maxZ } = this.layout.bounds;
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxZ - minZ);
    this.fitScale = Math.max(1e-4, Math.min((this.width - PAD * 2) / w, (this.height - PAD * 2) / h));
    this.scale = this.fitScale;
    this.offX = (this.width - w * this.scale) / 2 - minX * this.scale;
    this.offY = (this.height - h * this.scale) / 2 - minZ * this.scale;
    this.dirty = true;
  }

  /** Zooms about the centre of the map (the + / − buttons). */
  zoomBy(factor: number): void {
    this.zoomAt(this.width / 2, this.height / 2, factor);
  }

  draw(you: MapPose | null): void {
    // Moving less than a metre or turning less than a degree doesn't change the picture.
    const pose = you ? `${Math.round(you.x)},${Math.round(you.z)},${Math.round((Math.atan2(you.dirZ, you.dirX) * 180) / Math.PI)}` : '';
    if (!this.dirty && pose === this.lastPose) return;
    this.dirty = false;
    this.lastPose = pose;
    const { ctx, layout } = this;
    const dpr = this.canvas.width / Math.max(1, this.width);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, this.width, this.height);
    if (!layout) return;

    // Canyons: an ink edge under a paper strip, as wide as the canyon floor.
    const floorPx = Math.max(3, FLOOR_HALF * 2 * this.scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const pass of [0, 1]) {
      for (const r of layout.regions) {
        if (r.path.length < 2) continue;
        ctx.beginPath();
        r.path.forEach(([x, z], i) => (i ? ctx.lineTo(this.sx(x), this.sy(z)) : ctx.moveTo(this.sx(x), this.sy(z))));
        const w = r.kind === 'arena' ? Math.max(floorPx, 8) * 1.6 : floorPx;
        ctx.lineWidth = pass === 0 ? w + 3 : w;
        ctx.strokeStyle = pass === 0 ? INK : r.kind === 'arena' ? ARENA : CANYON;
        ctx.stroke();
      }
    }

    // Caves: ink dots that grow a little as you zoom; caves to the race target in red.
    const r = Math.min(4.5, 1.6 + this.scale * 1.2);
    for (const g of layout.gates) if (g.target !== this.target && this.onScreen(g)) this.dot(g, r, INK);
    for (const g of layout.gates) if (g.target === this.target) this.dot(g, r + 2.8, RED, INK);
    const selected = this.selected !== null ? layout.gates[this.selected] : null;
    if (selected) this.dot(selected, r + 4.5, PICKED, INK, 2.5);

    this.drawLabels(r);
    if (you) this.you(you);
    if (this.hovered !== null) {
      const g = layout.gates[this.hovered];
      this.dot(g, r + 4, g.target === this.target ? RED : PAPER, INK, 2.5);
      this.callout(g);
    }
  }

  /**
   * Names, most important first; each is drawn only if it doesn't overlap one already drawn.
   * Places → the Thread's cave → caves to the target → (zoomed in) every other cave on screen.
   */
  private drawLabels(dotR: number): void {
    const { ctx, layout } = this;
    if (!layout) return;
    const taken: Rect[] = [];
    const fits = (rect: Rect) =>
      rect.x0 >= 0 && rect.y0 >= 0 && rect.x1 <= this.width && rect.y1 <= this.height && !taken.some((t) => rect.x0 < t.x1 && rect.x1 > t.x0 && rect.y0 < t.y1 && rect.y1 > t.y0);

    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = SECTION_FONT;
    ctx.textAlign = 'center';
    for (const l of this.labels) {
      const lines = wrap(ctx, l.text, SECTION_WRAP, 2);
      const w = Math.max(...lines.map((t) => ctx.measureText(t).width));
      const cx = this.sx(l.x);
      const top = this.sy(l.z) - ((lines.length - 1) * SECTION_LINE_H) / 2;
      const rect = { x0: cx - w / 2 - 3, y0: top - 9, x1: cx + w / 2 + 3, y1: top + (lines.length - 1) * SECTION_LINE_H + 9 };
      if (!fits(rect)) continue;
      taken.push(rect);
      lines.forEach((t, i) => this.haloText(t, cx, top + i * SECTION_LINE_H, INK, 4));
    }
    ctx.textAlign = 'left';

    const showAll = this.scale >= CAVE_LABEL_SCALE;
    const order: Gate[] = [];
    if (this.selected !== null) order.push(layout.gates[this.selected]);
    for (const g of layout.gates) if (g.target === this.target && g.id !== this.selected) order.push(g);
    if (showAll) for (const g of layout.gates) if (g.target !== this.target && g.id !== this.selected) order.push(g);

    ctx.font = CAVE_FONT;
    for (const g of order) {
      if (!this.onScreen(g)) continue;
      const text = clip(g.target);
      const w = ctx.measureText(text).width;
      const cx = this.sx(g.center[0]);
      const cy = this.sy(g.center[2]);
      const gap = dotR + 4;
      // Try the right of the dot, then the left.
      for (const x of [cx + gap, cx - gap - w]) {
        const rect = { x0: x - 2, y0: cy - 7, x1: x + w + 2, y1: cy + 7 };
        if (!fits(rect)) continue;
        taken.push(rect);
        this.haloText(text, x, cy, g.target === this.target ? RED : INK, 3);
        break;
      }
    }
  }

  private haloText(text: string, x: number, y: number, color: string, halo: number): void {
    const { ctx } = this;
    ctx.lineWidth = halo;
    ctx.strokeStyle = PAPER;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  private zoomAt(px: number, py: number, factor: number): void {
    if (!this.layout) return;
    const [wx, wz] = this.toWorld(px, py);
    this.scale = Math.min(this.fitScale * MAX_ZOOM, Math.max(this.fitScale, this.scale * factor));
    this.offX = px - wx * this.scale;
    this.offY = py - wz * this.scale;
    this.clampView();
    this.dirty = true;
  }

  private pan(dx: number, dy: number): void {
    this.offX += dx;
    this.offY += dy;
    this.clampView();
    this.dirty = true;
  }

  /** Keeps some of the page on screen: its centre may not leave the map. */
  private clampView(): void {
    if (!this.layout) return;
    const { minX, maxX, minZ, maxZ } = this.layout.bounds;
    const cx = this.sx((minX + maxX) / 2);
    const cy = this.sy((minZ + maxZ) / 2);
    const halfW = ((maxX - minX) / 2) * this.scale;
    const halfH = ((maxZ - minZ) / 2) * this.scale;
    // The page's edge may come in as far as the map's centre, no further.
    this.offX += Math.min(0, this.width / 2 + halfW - cx) - Math.min(0, cx + halfW - this.width / 2);
    this.offY += Math.min(0, this.height / 2 + halfH - cy) - Math.min(0, cy + halfH - this.height / 2);
  }

  private toWorld(px: number, py: number): [number, number] {
    return [(px - this.offX) / this.scale, (py - this.offY) / this.scale];
  }

  private sx(x: number): number {
    return x * this.scale + this.offX;
  }

  private sy(z: number): number {
    return z * this.scale + this.offY;
  }

  private onScreen(g: Gate, margin = 20): boolean {
    const x = this.sx(g.center[0]);
    const y = this.sy(g.center[2]);
    return x > -margin && y > -margin && x < this.width + margin && y < this.height + margin;
  }

  private gateAt(px: number, py: number): number | null {
    if (!this.layout) return null;
    let best: number | null = null;
    let bestD = HIT_RADIUS;
    for (const g of this.layout.gates) {
      const d = Math.hypot(this.sx(g.center[0]) - px, this.sy(g.center[2]) - py);
      if (d < bestD) {
        best = g.id;
        bestD = d;
      }
    }
    return best;
  }

  private dot(g: Gate, r: number, fill: string, stroke?: string, lineWidth = 1.5): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(this.sx(g.center[0]), this.sy(g.center[2]), r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  /** "You are here": an arrowhead pointing the way the camera faces. */
  private you(p: MapPose): void {
    const { ctx } = this;
    const angle = Math.atan2(p.dirZ, p.dirX);
    ctx.save();
    ctx.translate(this.sx(p.x), this.sy(p.z));
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-7, 7);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-7, -7);
    ctx.closePath();
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.restore();
  }

  /** The hovered cave's full name in an ink tag above it. */
  private callout(g: Gate): void {
    const { ctx } = this;
    ctx.font = '800 13px "M PLUS Rounded 1c", sans-serif';
    const text = g.target;
    const w = ctx.measureText(text).width + 16;
    const x = Math.min(Math.max(4, this.sx(g.center[0]) - w / 2), this.width - w - 4);
    const y = Math.max(4, this.sy(g.center[2]) - 34);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 24, 8);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 8, y + 12);
  }
}
