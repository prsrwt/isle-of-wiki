import { COMMON_KINDS, type BiomePalette } from './palette';

/** Frost — snowfields and blue ice under a pale overcast sky. */
export const frost: BiomePalette = {
  sky: { background: '#c9d8e8', fog: '#dde7f0', fogNear: 400, fogFar: 2200 },
  light: { sun: '#f4f8ff', sunIntensity: 1.9, sunDir: [-0.4, 0.6, 0.45], hemiSky: '#eef5ff', hemiGround: '#9fb4c8', hemiIntensity: 1.6 },
  terrain: { floor: '#eef3f8', wall: '#9ec3dc', plateau: '#f8fbfd', abyss: '#5b7a96' },
  kinds: {
    ...COMMON_KINDS,
    mesa: '#cfe2ef',
    boulder: '#b9d2e3',
    spire: '#a9c7dc',
    tree: '#4f6f5c',
    shard: '#8fd0f0',
    column: '#dfe8ee',
    vent: '#7d8b99',
    arch: '#a9cbe0',
    caverock: '#7fa7c4',
    bridge: '#8a6a50',
    hut: '#f4f7fa',
    stand: '#e8eef4',
  },
  crowd: ['#c0392b', '#2c3e50', '#f1c40f', '#16a085', '#8e44ad', '#ecf0f1', '#d35400'],
};
