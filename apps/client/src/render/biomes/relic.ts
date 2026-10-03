import { COMMON_KINDS, type BiomePalette } from './palette';

/** Relic — pale limestone ruins in a golden late-afternoon light. */
export const relic: BiomePalette = {
  sky: { background: '#f0c99a', fog: '#f2d9b8', fogNear: 500, fogFar: 2600 },
  light: { sun: '#ffd9a3', sunIntensity: 2.3, sunDir: [0.8, 0.35, 0.2], hemiSky: '#fbe7c9', hemiGround: '#a88d6a', hemiIntensity: 1.3 },
  terrain: { floor: '#e9dcc2', wall: '#bfae8e', plateau: '#d6c7a6', abyss: '#6e5d47' },
  kinds: {
    ...COMMON_KINDS,
    mesa: '#cbbb9a',
    boulder: '#b9a888',
    spire: '#b5a281',
    tree: '#6f8a4a',
    shard: '#d8e6ea',
    column: '#efe6d2',
    vent: '#6b5c50',
    arch: '#d2c3a2',
    caverock: '#a99878',
    bridge: '#8f6e4c',
    hut: '#f2ead8',
  },
  crowd: ['#a93226', '#1f618d', '#d4ac0d', '#196f3d', '#6c3483', '#fdfefe', '#ca6f1e'],
};
