import type { BiomeShape } from './biome';

/** Canopy — jungle gorges: steep green walls with paper trees crowding the rims. */
export const canopy: BiomeShape = {
  id: 'canopy',
  rimHeight: 36,
  wallSlope: 3.2,
  plateauRoll: 10,
  wallCrag: 0.9,
  landmark: 'tree',
  landmarkH: [16, 34],
  landmarkW: [8, 14],
  landmarkEvery: 32,
  landmarkChance: 0.85,
  archEvery: 340,
  mesaChance: 0.2,
};
