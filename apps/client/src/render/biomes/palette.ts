import type { BoxKind } from '@isle-of-wiki/shared';

/**
 * How a biome *looks*: sky, light, ground and paper colours (sRGB hex). Its shape lives in
 * the shared package (packages/shared/src/atlas/biomes). Red stays reserved for links and
 * caves in every biome so routes stand out at speed.
 */
export interface BiomePalette {
  sky: {
    background: string;
    fog: string;
    fogNear: number;
    fogFar: number;
  };
  light: {
    sun: string;
    sunIntensity: number;
    /** Direction toward the sun. */
    sunDir: [number, number, number];
    hemiSky: string;
    hemiGround: string;
    hemiIntensity: number;
  };
  terrain: {
    floor: string;
    wall: string;
    plateau: string;
    /** Far ground under the horizon (plateau colour, or the chasm floor for Lilypad). */
    abyss: string;
  };
  /** Paper colour for every kind of prop. */
  kinds: Record<BoxKind, string>;
  /** Spectators' clothes in the Seedpod grandstand. */
  crowd: string[];
}

/** Shared colours most biomes keep. */
export const COMMON_KINDS = {
  board: '#fbf6ea',
  pillar: '#5a4634',
  stand: '#eadcc0',
  tower: '#ddd0b5',
} as const;
