import type { BoxKind, TextStyle } from '@isle-of-wiki/shared';

/**
 * Colours every biome shares: ink, paper, and the one red accent reserved for links and
 * caves. Each biome's own colours live in ./biomes.
 */
export const INK = '#2a2118';
export const PAPER = '#fbf6ea';
export const RED = '#d8263b';

export const TEXT_COLORS: Record<TextStyle, string> = {
  body: INK,
  link: RED,
  bullet: INK,
  heading: INK,
  sign: RED,
  label: INK,
  caption: INK,
  quote: INK,
};

/** Which paper shape draws each kind of prop. */
export type ShapeId = 'box' | 'folded' | 'tree' | 'shard' | 'column' | 'vent' | 'dome' | 'tower';

export interface KindStyle {
  shape: ShapeId;
  outline: boolean;
}

export const KIND_STYLES: Record<BoxKind, KindStyle> = {
  mesa: { shape: 'folded', outline: true },
  boulder: { shape: 'folded', outline: true },
  spire: { shape: 'folded', outline: true },
  tree: { shape: 'tree', outline: true },
  shard: { shape: 'shard', outline: true },
  column: { shape: 'column', outline: true },
  vent: { shape: 'vent', outline: true },
  arch: { shape: 'folded', outline: true },
  caverock: { shape: 'folded', outline: true },
  bridge: { shape: 'box', outline: true },
  pillar: { shape: 'box', outline: false },
  board: { shape: 'box', outline: true },
  stand: { shape: 'box', outline: true },
  hut: { shape: 'dome', outline: true },
  tower: { shape: 'tower', outline: true },
};
