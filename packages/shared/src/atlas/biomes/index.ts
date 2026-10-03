import type { BiomeId } from '../types';
import type { BiomeShape } from './biome';
import { canopy } from './canopy';
import { dune } from './dune';
import { ember } from './ember';
import { frost } from './frost';
import { relic } from './relic';

export type { BiomeShape } from './biome';

/** Every biome Atlas can build. Add a new one here (and a palette in the client). */
export const BIOMES: Record<BiomeId, BiomeShape> = { dune, frost, canopy, ember, relic };

export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];
