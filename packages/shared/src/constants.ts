/**
 * World-scale constants. Everything is in world units (roughly metres).
 * Every client and the server derive the same world from these, so changing
 * them changes the map for everyone — bump PROTOCOL_VERSION when you do.
 * Biome-specific shape values (rim height, wall steepness, props) live in atlas/biomes.
 */
export const LAYOUT = {
  /**
   * Length of one placement slot along a canyon. The article flows along each canyon in
   * slots: a paragraph takes a slot per link (plus spacing), a sub-heading two, and so on.
   */
  lineH: 4.5,
  /** Slots per link: each wall needs ~12.5 m per cave and caves alternate walls. */
  slotsPerLink: 1.6,
  /** Glyph height / width ratio for signs. */
  glyphAspect: 1.8,

  // --- Terrain -------------------------------------------------------------
  /** Heightfield grid spacing. Large cells = big flat origami facets. */
  terrainCell: 4,
  /** Flat terrain kept around the outside of the map. */
  terrainMargin: 260,
  /** Gentle rise and fall of canyon floors. */
  floorAmp: 3,
  floorWavelength: 420,

  // --- Seedpod (arena) -----------------------------------------------------
  arenaW: 240,
  arenaMinD: 200,
  standTiers: 10,
  standTierW: 3,
  standTierH: 2.6,

  // --- Heights -------------------------------------------------------------
  /** Pods can never hover higher than this (Phase 2). Low mesas fit under it. */
  hoverCeiling: 8,
  mesaMinH: 3,
  mesaMaxH: 6,
  /** Overhead signs sit above the hover ceiling so pods pass beneath. */
  bannerClearance: 9.5,
  gatewayClearance: 11,

  // --- Caves ---------------------------------------------------------------
  /** A cave mouth spans this many slots of canyon wall. */
  caveLines: 2,
  caveH: 5.5,
  signMaxChars: 18,

  // --- Trackside panels (paintings, billboards) ----------------------------
  /** Bottom edge of every panel — above the hover ceiling and cave plaques. */
  panelBaseY: 12,
  adW: 10,
  adH: 5,
  /** One billboard per this many slots of each canyon. */
  adEveryLines: 22,

  spawnCount: 8,
} as const;

/** Half-width of a section canyon's open floor (keep-clear zone in front of the walls). */
export const FLOOR_HALF = 24.5;

/**
 * Half-width where a section canyon's walls start. 1.5 grid cells wider than FLOOR_HALF,
 * because a grid cell straddling the foot of a wall tilts the ground beside it.
 */
export const WALL_HALF = FLOOR_HALF + 1.5 * LAYOUT.terrainCell;

/** Fixed simulation rate shared by client prediction and the server. */
export const SIM = {
  tickHz: 60,
} as const;
