import type { BiomeShape } from './biome';

/** Dune — desert canyons: tall sandstone walls, rock arches and spires (Boonta Eve country). */
export const dune: BiomeShape = {
  id: 'dune',
  rimHeight: 42,
  wallSlope: 2.4,
  plateauRoll: 14,
  wallCrag: 0.6,
  landmark: 'spire',
  landmarkH: [25, 70],
  landmarkW: [6, 13],
  landmarkEvery: 90,
  landmarkChance: 0.55,
  archEvery: 260,
  mesaChance: 0.25,
};
