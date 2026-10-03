import { COMMON_KINDS, type BiomePalette } from './palette';

/** Ember — black basalt trenches and glowing lava fields under a smoky orange sky. */
export const ember: BiomePalette = {
  sky: { background: '#d9835a', fog: '#c27058', fogNear: 300, fogFar: 2000 },
  light: { sun: '#ffc690', sunIntensity: 2.0, sunDir: [-0.5, 0.55, -0.3], hemiSky: '#ffb38a', hemiGround: '#3a1f1a', hemiIntensity: 1.3 },
  terrain: { floor: '#e2733c', wall: '#3b302e', plateau: '#57463f', abyss: '#2a1512' },
  kinds: {
    ...COMMON_KINDS,
    mesa: '#4a3c38',
    boulder: '#3e3330',
    spire: '#2f2726',
    tree: '#3b4a2e',
    shard: '#f09a5a',
    column: '#6b5a52',
    vent: '#3a2c29',
    arch: '#453733',
    caverock: '#2c2321',
    bridge: '#5a3a2a',
    hut: '#d8c4b0',
    stand: '#c9b29c',
    tower: '#b9a08c',
  },
  crowd: ['#f1c40f', '#e67e22', '#ecf0f1', '#3498db', '#95a5a6', '#e74c3c', '#2ecc71'],
};
