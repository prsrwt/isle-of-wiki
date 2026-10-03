import { COMMON_KINDS, type BiomePalette } from './palette';

/** Dune — warm sandstone under a clear blue sky. */
export const dune: BiomePalette = {
  sky: { background: '#8fc6f0', fog: '#bcdcf2', fogNear: 600, fogFar: 2800 },
  light: { sun: '#fff3dd', sunIntensity: 2.4, sunDir: [0.5, 0.8, 0.35], hemiSky: '#d6ecff', hemiGround: '#c9a26b', hemiIntensity: 1.4 },
  terrain: { floor: '#e6c793', wall: '#c47f4a', plateau: '#d9a86c', abyss: '#6b4a2f' },
  kinds: {
    ...COMMON_KINDS,
    mesa: '#c98a52',
    boulder: '#b98858',
    spire: '#bb7744',
    tree: '#7c9a4a',
    shard: '#cfe4ef',
    column: '#e2d3b4',
    vent: '#5b4a42',
    arch: '#c47f4a',
    caverock: '#a8653a',
    bridge: '#9b6b43',
    hut: '#f0e5cd',
  },
  crowd: ['#e05d44', '#3d7dca', '#f2c14e', '#6aa84f', '#9b59b6', '#f7f1e3', '#e67e22'],
};
