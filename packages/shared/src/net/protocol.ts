/**
 * Multiplayer wire protocol (implemented in Phase 4, defined now so client code
 * is shaped around it from the start).
 *
 * Model: the server owns race state (who is on which page, who finished).
 * Clients simulate their own pod and stream state; page changes are *claims*
 * the server validates against the deterministic layout of that page.
 */
import type { BiomeId, StructureId } from '../atlas/types';

export const PROTOCOL_VERSION = 3;

export interface RaceConfig {
  start: string;
  target: string;
  /** Seeds the room's Guestbook: which biome and structure each page becomes. */
  roomSeed: number;
}

export interface PodState {
  tick: number;
  page: string;
  p: [number, number, number];
  q: [number, number, number, number];
  v: [number, number, number];
}

export interface PlayerInfo {
  id: string;
  name: string;
  page: string;
  hops: number;
  finishedMs: number | null;
}

export type ClientMsg =
  | { t: 'join'; v: number; room: string; name: string }
  | { t: 'configure'; config: RaceConfig }
  | { t: 'ready' }
  | { t: 'state'; s: PodState }
  /** Claim: "I drove through gate `gateId` on `page`." */
  | { t: 'enterGate'; page: string; gateId: number };

export type ServerMsg =
  | { t: 'welcome'; id: string; room: string }
  | { t: 'lobby'; players: PlayerInfo[]; config: RaceConfig | null }
  /** `spawn` maps player id → index into the start page's `spawns`. */
  | { t: 'countdown'; startsAt: number; spawn: Record<string, number> }
  | { t: 'snapshot'; tick: number; pods: Record<string, PodState> }
  /** A racer reached `page`; its world is whatever the Guestbook signed (first arrival decides). */
  | { t: 'pageChange'; id: string; page: string; hops: number; biome: BiomeId; structure: StructureId }
  | { t: 'gateRejected'; gateId: number; reason: string }
  | { t: 'finish'; id: string; timeMs: number; hops: number; path: string[] };
