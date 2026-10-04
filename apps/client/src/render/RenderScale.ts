import type * as THREE from 'three';

/**
 * Most pixels the 3D view draws per frame: about what a 14" Retina laptop shows (3024 × 1964).
 * Every pixel runs the paper, hatching and shadow shaders, so a big high-density monitor (a 27"
 * 4K at 150% is 8.3 million pixels, at 200% or a 5K, 14.7 million) costs up to 2.5 times as
 * much. Above this the view is drawn smaller and the browser scales it up.
 */
const MAX_PIXELS = 6_000_000;
/** The view never drops below this share of its best resolution. */
const MIN_SHARE = 0.5;
/** Frames slower than this on average (over a second) lower the resolution… */
const SLOW_FRAME = 1 / 45;
/** …and a few seconds faster than this raise it again, up to just under where it was slow. */
const FAST_FRAME = 1 / 56;
const FAST_WINDOWS = 3;

/**
 * Keeps the 3D view's resolution affordable: capped by a pixel budget for the screen, then
 * nudged down while frames run slow and back up when there's room. Measures only while the
 * world is being driven (not during loading, Folio or the link tunnel).
 */
export class RenderScale {
  /** Pixel ratio used now (CSS px → drawn px). */
  ratio = 1;
  /** The best this screen gets: device pixels, capped at 2× and by the pixel budget. */
  private best = 1;
  /** Highest ratio allowed back after being slow there. */
  private ceiling = Infinity;
  private width = 1;
  private height = 1;
  private time = 0;
  private frames = 0;
  private fastWindows = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  /** The window changed size (or moved to a screen with another pixel density). */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const device = Math.min(window.devicePixelRatio || 1, 2);
    this.best = Math.min(device, Math.sqrt(MAX_PIXELS / Math.max(1, width * height)));
    this.ceiling = Infinity;
    this.apply(this.best, true);
  }

  /** Share of the best resolution in use, 0..1 (for the stats panel). */
  get share(): number {
    return this.ratio / this.best;
  }

  /** Once per frame; `measure` is false while frame times say nothing about drawing the world. */
  frame(dt: number, measure: boolean): void {
    if (!measure || dt > 0.25) {
      this.time = 0;
      this.frames = 0;
      return;
    }
    this.time += dt;
    this.frames++;
    if (this.time < 1) return;
    const avg = this.time / this.frames;
    this.time = 0;
    this.frames = 0;
    if (avg > SLOW_FRAME) {
      this.fastWindows = 0;
      this.ceiling = this.ratio * 0.95;
      this.apply(Math.max(this.best * MIN_SHARE, this.ratio * 0.85));
    } else if (avg < FAST_FRAME && ++this.fastWindows >= FAST_WINDOWS) {
      this.fastWindows = 0;
      this.apply(Math.min(this.best, this.ceiling, this.ratio * 1.1));
    }
  }

  /** Uses `ratio` from now on; `resized` sets the size even when the ratio hasn't changed. */
  private apply(ratio: number, resized = false): void {
    if (!resized && Math.abs(ratio - this.ratio) < 0.01) return;
    this.ratio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, false);
  }
}
