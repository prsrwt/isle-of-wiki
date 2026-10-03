import type { BiomeShape } from './biome';

/** Ember — volcanic trenches: jagged black walls and smoking vents on the lava fields. */
export const ember: BiomeShape = {
  id: 'ember',
  rimHeight: 48,
  wallSlope: 2.8,
  plateauRoll: 18,
  wallCrag: 1.2,
  landmark: 'vent',
  landmarkH: [10, 26],
  landmarkW: [10, 22],
  landmarkEvery: 110,
  landmarkChance: 0.5,
  archEvery: 300,
  mesaChance: 0.3,
};
