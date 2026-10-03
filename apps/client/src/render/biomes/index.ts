import type { BiomeId } from '@isle-of-wiki/shared';
import { canopy } from './canopy';
import { dune } from './dune';
import { ember } from './ember';
import { frost } from './frost';
import type { BiomePalette } from './palette';
import { relic } from './relic';

export type { BiomePalette } from './palette';

/** Every biome's look. Add a new biome's palette here (and its shape in the shared package). */
export const PALETTES: Record<BiomeId, BiomePalette> = { dune, frost, canopy, ember, relic };
