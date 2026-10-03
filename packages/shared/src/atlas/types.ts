export type Vec3 = [number, number, number];
/** Horizontal direction or point (x, z). */
export type Vec2 = [number, number];
/** Rotation quaternion (x, y, z, w). */
export type Quat = [number, number, number, number];

/**
 * Solid props are oriented boxes. The renderer dresses them (Phase 1c-B) and the physics
 * engine turns the same list into cuboid colliders, so what you see is what you hit.
 * The ground itself is the heightfield in `WorldLayout.terrain`.
 */
export type BoxKind =
  /** Low rock on a canyon floor, under the hover ceiling — pods can hop over it. */
  | 'mesa'
  /** Small floor obstacle (tables become boulder fields). */
  | 'boulder'
  /** Tall rock pillar on the plateau or in the arena backdrop (Dune). */
  | 'spire'
  /** Biome landmarks standing where spires would: paper trees (Canopy), ice shards (Frost),
   *  broken columns (Relic), smoking vents (Ember). */
  | 'tree'
  | 'shard'
  | 'column'
  | 'vent'
  /** Deck spanning a chasm between islands (Lilypad). */
  | 'bridge'
  /** One segment of a rock arch spanning a canyon. */
  | 'arch'
  /** One rock of the uneven arch ringing a cave mouth. */
  | 'caverock'
  | 'pillar'
  /** Sign boards: gateways, banners, cave plaques, panel backings. */
  | 'board'
  /** Seedpod grandstand tier. */
  | 'stand'
  /** Seedpod domed building. */
  | 'hut'
  /** Seedpod lookout tower. */
  | 'tower';

export interface Box {
  kind: BoxKind;
  center: Vec3;
  size: Vec3;
  /** Orientation; identity when absent. */
  rot?: Quat;
  /** Seeded cosmetic variant. */
  variant: number;
}

export type TextStyle = 'body' | 'link' | 'bullet' | 'heading' | 'sign' | 'label' | 'caption' | 'quote';

/**
 * A run of characters on a fixed grid. (x, y, z) is the centre line at the leading edge
 * of the first character; characters advance along `adv` (a horizontal unit vector — the
 * reader's right-hand side).
 *  floor — painted on the ground; letter tops point along (adv.z, -adv.x), i.e. away from a
 *          reader standing on the text; `pitch` tilts letters up/down with the floor's slope.
 *  wall  — standing upright, facing (-adv.z, adv.x) toward the reader.
 */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  z: number;
  adv: Vec2;
  charW: number;
  charH: number;
  mode: 'floor' | 'wall';
  pitch?: number;
  style: TextStyle;
}

/** Where a link appears in the article: a span of a block, or a span of an infobox row. */
export type LinkSource = { kind: 'block'; block: number; span: number } | { kind: 'infobox'; row: number; span: number };

/** A link cave mouth in a canyon wall. Driving into it travels to `target`. */
export interface Gate {
  /** Reading-order index; stable for a given page, so the server can validate claims by id. */
  id: number;
  target: string;
  /** The exact link in the article this cave stands for (Folio uses it). */
  source: LinkSource;
  center: Vec3;
  /** Mouth width (along the wall) and height. */
  width: number;
  height: number;
  /** Horizontal direction the mouth opens toward (into the canyon). */
  normal: Vec2;
}

interface PanelBase {
  center: Vec3;
  width: number;
  height: number;
  /** Horizontal direction the panel faces. */
  normal: Vec2;
}

/** One of the article's images, shown on a trackside board. */
export interface PaintingPanel extends PanelBase {
  kind: 'painting';
  src?: string;
  caption: string;
}

/**
 * An ad space on a trackside board. `slot` is stable for a given page (reading order),
 * so every player sees the same ad in the same place.
 */
export interface AdPanel extends PanelBase {
  kind: 'ad';
  slot: number;
}

export type Panel = PaintingPanel | AdPanel;

/**
 * Heightfield ground: `heights[row * cols + col]` is the height at
 * (x0 + col * cell, z0 + row * cell). Triangulated as a regular grid.
 */
export interface Terrain {
  x0: number;
  z0: number;
  cell: number;
  cols: number;
  rows: number;
  heights: number[];
}

/** A named part of the track, for minimaps, Folio and HUD. `path` is its sparse centreline. */
export interface RegionInfo {
  title: string;
  kind: 'arena' | 'section' | 'connector';
  /** Index of the article section (for kind 'section'). */
  section?: number;
  path: Vec2[];
}

export type BiomeId = 'dune' | 'frost' | 'canopy' | 'ember' | 'relic';
export type StructureId = 'hiddenLotus' | 'vine' | 'lilypad';

/** Everything that decides a world besides the article: who's racing and what the Guestbook signed. */
export interface WorldSpec {
  roomSeed: number;
  biome: BiomeId;
  structure: StructureId;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WorldLayout {
  title: string;
  seed: number;
  biome: BiomeId;
  structure: StructureId;
  terrain: Terrain;
  boxes: Box[];
  texts: TextRun[];
  gates: Gate[];
  panels: Panel[];
  regions: RegionInfo[];
  /** Race start positions, spread across the page's canyons. */
  spawns: Vec3[];
  /** Where a pod appears after tunnelling onto this page (in the arena), facing `arrivalDir`. */
  arrival: Vec3;
  arrivalDir: Vec2;
  bounds: Bounds;
}
