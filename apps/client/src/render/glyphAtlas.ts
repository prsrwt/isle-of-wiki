import * as THREE from 'three';

export const GLYPH_FONT_FAMILY = '"M PLUS Rounded 1c", "Segoe UI", sans-serif';
const FONT = `800 80px ${GLYPH_FONT_FAMILY}`;

const CELL_W = 52;
const CELL_H = 96;
const COLS = 40;
const MAX_ROWS = 21;
const FALLBACK = '?';

/** u0, v0 (bottom-left), u1, v1 (top-right) */
export type UvRect = [number, number, number, number];

/** Waits for the web font so glyphs aren't drawn with a fallback face. */
export async function loadGlyphFont(): Promise<void> {
  try {
    await document.fonts.load(FONT);
  } catch {
    // Fallback font is fine.
  }
}

/** One texture holding every character the page needs, drawn once. */
export class GlyphAtlas {
  readonly texture: THREE.CanvasTexture;
  private readonly uvs = new Map<string, UvRect>();

  constructor(chars: Iterable<string>, anisotropy: number) {
    const unique = [FALLBACK, ...new Set(chars)].filter((c, i, arr) => c.trim() && arr.indexOf(c) === i);
    const list = unique.slice(0, COLS * MAX_ROWS);
    const rows = Math.max(1, Math.ceil(list.length / COLS));

    const canvas = document.createElement('canvas');
    canvas.width = COLS * CELL_W;
    canvas.height = rows * CELL_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';

    const W = canvas.width;
    const H = canvas.height;
    list.forEach((ch, i) => {
      const cx = (i % COLS) * CELL_W;
      const cy = Math.floor(i / COLS) * CELL_H;
      // Glyphs sit on a fixed grid; widen narrow ones (up to 1.3×) so text doesn't look letter-spaced,
      // and squeeze wide ones so they don't bleed into the neighbouring cell.
      const sx = Math.min(1.3, (CELL_W - 6) / Math.max(1, ctx.measureText(ch).width));
      ctx.setTransform(sx, 0, 0, 1, cx + CELL_W / 2, cy + CELL_H / 2);
      ctx.fillText(ch, 0, 4);
      this.uvs.set(ch, [(cx + 1) / W, 1 - (cy + CELL_H - 1) / H, (cx + CELL_W - 1) / W, 1 - (cy + 1) / H]);
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.anisotropy = anisotropy;
  }

  uv(ch: string): UvRect {
    return this.uvs.get(ch) ?? (this.uvs.get(FALLBACK) as UvRect);
  }

  dispose(): void {
    this.texture.dispose();
  }
}
