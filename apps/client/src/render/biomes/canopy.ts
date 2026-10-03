import { COMMON_KINDS, type BiomePalette } from './palette';

/** Canopy — mossy gorges and paper palms in warm, hazy jungle light. */
export const canopy: BiomePalette = {
  sky: { background: '#a9d6c4', fog: '#c6e3cf', fogNear: 300, fogFar: 1800 },
  light: { sun: '#fff1c9', sunIntensity: 2.2, sunDir: [0.3, 0.85, -0.4], hemiSky: '#e3f5d9', hemiGround: '#5d7a3c', hemiIntensity: 1.5 },
  terrain: { floor: '#b9a774', wall: '#5f8a45', plateau: '#79a352', abyss: '#2f4a28' },
  kinds: {
    ...COMMON_KINDS,
    mesa: '#7c9a5a',
    boulder: '#8d8a63',
    spire: '#6b7d4c',
    tree: '#4f9a4a',
    shard: '#c5e8d3',
    column: '#c9c19c',
    vent: '#4b4a3e',
    arch: '#6a8c4a',
    caverock: '#566f3d',
    bridge: '#8b5e3c',
    hut: '#e9e2c6',
    stand: '#d9cfa8',
  },
  crowd: ['#e74c3c', '#f39c12', '#3498db', '#f1c40f', '#ecf0f1', '#9b59b6', '#1abc9c'],
};
