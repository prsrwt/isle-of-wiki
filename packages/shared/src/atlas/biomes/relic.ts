import type { BiomeShape } from './biome';

/** Relic — ruins: worn stone cuttings lined with broken columns, the odd surviving arch. */
export const relic: BiomeShape = {
  id: 'relic',
  rimHeight: 26,
  wallSlope: 3.6,
  plateauRoll: 6,
  wallCrag: 0.2,
  landmark: 'column',
  landmarkH: [8, 22],
  landmarkW: [2.5, 4],
  landmarkEvery: 40,
  landmarkChance: 0.75,
  archEvery: 200,
  mesaChance: 0.4,
};
