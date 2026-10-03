import { BIOME_IDS } from '../atlas/biomes';
import { STRUCTURE_WEIGHTS } from '../atlas/structures';
import type { BiomeId, StructureId, WorldSpec } from '../atlas/types';
import { hashString, mulberry32 } from '../rng';

/**
 * The Guestbook: a room's memory of which world each page became.
 *
 * The first racer in a room to reach a page "signs" it: the page gets a biome — never the
 * one that racer arrived from, so trailblazers always jump somewhere new — and a structure.
 * Everyone who arrives later reads the signature, so the whole room shares one world per
 * page. The choice is a seeded ranking, not a free pick, so it's repeatable and nobody can
 * steer it. In multiplayer the server keeps the Guestbook (it settles who was first).
 */
export interface Signature {
  biome: BiomeId;
  structure: StructureId;
}

/** This page's biomes in preference order for this room (deterministic). */
export function rankBiomes(roomSeed: number, page: string): BiomeId[] {
  const rng = mulberry32(hashString(`biome:${roomSeed}:${page}`));
  const ids = [...BIOME_IDS];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

/** This page's structure for this room (deterministic, weighted toward the Hidden Lotus). */
export function pickStructure(roomSeed: number, page: string): StructureId {
  const roll = mulberry32(hashString(`structure:${roomSeed}:${page}`))();
  let acc = 0;
  const entries = Object.entries(STRUCTURE_WEIGHTS) as [StructureId, number][];
  for (const [id, weight] of entries) {
    acc += weight;
    if (roll < acc) return id;
  }
  return entries[0][0];
}

export class Guestbook {
  private readonly signatures = new Map<string, Signature>();

  constructor(readonly roomSeed: number) {}

  /** What a page already is in this room, if anyone has reached it. */
  read(page: string): Signature | undefined {
    return this.signatures.get(page);
  }

  /**
   * Arrive at `page` from a world of biome `from` (none for the race start). Returns the
   * page's world: the existing signature, or a new one signed now.
   */
  arrive(page: string, from?: BiomeId): Signature {
    const known = this.signatures.get(page);
    if (known) return known;
    const ranked = rankBiomes(this.roomSeed, page);
    const biome = ranked.find((b) => b !== from) ?? ranked[0];
    const signature: Signature = { biome, structure: pickStructure(this.roomSeed, page) };
    this.signatures.set(page, signature);
    return signature;
  }

  spec(signature: Signature): WorldSpec {
    return { roomSeed: this.roomSeed, ...signature };
  }
}
