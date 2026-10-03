/**
 * Ad slots on cliff faces. Each page's layout numbers its slots in reading order, so
 * (page, slot) identifies the same spot for every player — that is the key an ad
 * server would sell and report impressions against.
 */
export interface AdSlotRequest {
  page: string;
  slot: number;
  /** Panel size in world units (metres); the aspect ratio the creative should fit. */
  width: number;
  height: number;
}

export type AdCreative =
  /** An image URL; the host must send CORS headers (Access-Control-Allow-Origin). */
  | { kind: 'url'; url: string; clickUrl?: string }
  | { kind: 'canvas'; canvas: HTMLCanvasElement };

export interface AdProvider {
  /** Resolve a creative for a slot, or null to leave the slot blank. */
  creativeFor(req: AdSlotRequest): Promise<AdCreative | null>;
}

/** Placeholder "your ad here" boards until a real ad source is plugged in. */
export class HouseAdProvider implements AdProvider {
  async creativeFor(req: AdSlotRequest): Promise<AdCreative> {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = Math.round((512 * req.height) / req.width);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    const { width: w, height: h } = canvas;
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d8263b';
    ctx.fillRect(0, 0, w, h * 0.22);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fffdf8';
    ctx.font = `800 ${Math.round(h * 0.13)}px "M PLUS Rounded 1c", sans-serif`;
    ctx.fillText('ISLE OF WIKI', w / 2, h * 0.11);
    ctx.fillStyle = '#16151a';
    ctx.font = `800 ${Math.round(h * 0.24)}px "M PLUS Rounded 1c", sans-serif`;
    ctx.fillText('YOUR AD HERE', w / 2, h * 0.52);
    ctx.font = `500 ${Math.round(h * 0.1)}px "M PLUS Rounded 1c", sans-serif`;
    ctx.fillText(`slot #${req.slot} · ${req.page}`.slice(0, 48), w / 2, h * 0.8);
    return { kind: 'canvas', canvas };
  }
}
