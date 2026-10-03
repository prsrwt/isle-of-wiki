import type { BiomeShape } from './biome';

/** Frost — ice canyons: lower, smoother walls, glassy shards jutting from the snowfields. */
export const frost: BiomeShape = {
  id: 'frost',
  rimHeight: 30,
  wallSlope: 1.8,
  plateauRoll: 20,
  wallCrag: 0.3,
  landmark: 'shard',
  landmarkH: [14, 45],
  landmarkW: [3, 7],
  landmarkEvery: 55,
  landmarkChance: 0.7,
  archEvery: 420,
  mesaChance: 0.35,
};
