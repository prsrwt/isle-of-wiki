import type { Gate, Vec3 } from '../atlas/types';

/** How far in front of a cave mouth (m) you can be to travel through it with J. */
export const GATE_RANGE = 25;

/**
 * Can a pod at `pos` travel through this cave? It must be in front of the mouth (on the
 * canyon side), within `GATE_RANGE`, lined up with the opening (the
 * allowed sideways offset grows with distance, a cone out of the mouth), and near its height.
 * Uses only + − × ÷ and comparisons, so every machine (and later the server) agrees.
 */
export function gateInReach(g: Gate, pos: Vec3): boolean {
  const [nx, nz] = g.normal;
  const dx = pos[0] - g.center[0];
  const dz = pos[2] - g.center[2];
  const out = dx * nx + dz * nz;
  if (out < 0 || out > GATE_RANGE) return false;
  const along = dx * -nz + dz * nx;
  if (Math.abs(along) > g.width / 2 + out * 0.6) return false;
  const up = pos[1] - g.center[1];
  return up > -g.height && up < g.height + 4;
}

/** The nearest cave in reach of `pos`, or null. */
export function nearestGateInReach(gates: readonly Gate[], pos: Vec3): Gate | null {
  let best: Gate | null = null;
  let bestD = Infinity;
  for (const g of gates) {
    const dx = pos[0] - g.center[0];
    const dz = pos[2] - g.center[2];
    const d = dx * dx + dz * dz;
    if (d < bestD && gateInReach(g, pos)) {
      best = g;
      bestD = d;
    }
  }
  return best;
}
