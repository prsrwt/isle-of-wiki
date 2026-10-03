import type { BiomeId, BoxKind } from '../types';

/**
 * The part of a biome that changes the world's *shape* (so it lives in shared code and is
 * identical on every machine). Colours, skies and lighting are the client's job
 * (apps/client/src/render/biomes).
 */
export interface BiomeShape {
  id: BiomeId;
  /** Plateau height above canyon floors. */
  rimHeight: number;
  /** Canyon walls rise this many metres per metre outward from the floor edge. */
  wallSlope: number;
  /** Rolling of the plateau (m) and craggy noise on walls (fraction of slope). */
  plateauRoll: number;
  wallCrag: number;
  /** The landmark standing on the plateau and behind the Seedpod. */
  landmark: BoxKind;
  /** Landmark size ranges: height and footprint (m). */
  landmarkH: [number, number];
  landmarkW: [number, number];
  /** Metres between landmark attempts along each canyon, and the chance each succeeds. */
  landmarkEvery: number;
  landmarkChance: number;
  /** Metres between rock arches spanning the canyons (0 = none). */
  archEvery: number;
  /** Chance an empty stretch of floor gets a hop-over mesa. */
  mesaChance: number;
}
