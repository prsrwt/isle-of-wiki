import type { StructureId } from '../types';
import { hiddenLotus } from './hiddenLotus';
import { lilypad } from './lilypad';
import type { Structure } from './structure';
import { vine } from './vine';

export type { Structure, StructureContext, StructurePlan, TrackPlan } from './structure';

/** Every structure Atlas can build. Add a new one here. */
export const STRUCTURES: Record<StructureId, Structure> = { hiddenLotus, vine, lilypad };

/** How often the Guestbook picks each structure (the Hidden Lotus is the default). */
export const STRUCTURE_WEIGHTS: Record<StructureId, number> = { hiddenLotus: 0.6, vine: 0.2, lilypad: 0.2 };
