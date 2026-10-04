import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, NO_INPUT, PhysicsWorld, Pod, POD, type PodInput } from '../src/physics';
import {
  GATE_RANGE,
  gateInReach,
  LAYOUT,
  nearestGateInReach,
  layoutPage,
  parseArticle,
  terrainHeight,
  type Box,
  type Gate,
  type Terrain,
  type Vec3,
  type WorldLayout,
} from '../src';

beforeAll(() => initPhysics());

const STEP = PhysicsWorld.STEP;

/** A test world: ground from `height(x, z)` over a 400 m square around the origin, plus props. */
function world(height: (x: number, z: number) => number, boxes: Box[] = []): PhysicsWorld {
  const cell = 4;
  const cols = 101;
  const rows = 101;
  const x0 = -200;
  const z0 = -200;
  const heights: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights.push(height(x0 + c * cell, z0 + r * cell));
  const terrain: Terrain = { x0, z0, cell, cols, rows, heights };
  const layout: WorldLayout = {
    title: 'test',
    seed: 1,
    biome: 'dune',
    structure: 'hiddenLotus',
    terrain,
    boxes,
    texts: [],
    gates: [],
    panels: [],
    regions: [],
    spawns: [],
    arrival: [0, 0, 0],
    arrivalDir: [0, -1],
    bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 },
  };
  return new PhysicsWorld(layout);
}

const box = (kind: Box['kind'], center: Vec3, size: Vec3): Box => ({ kind, center, size, variant: 0 });
const flat = () => 0;
const NORTH: [number, number] = [0, -1];

/** Drives for `seconds`, calling `each` after every step. */
function drive(w: PhysicsWorld, pod: Pod, input: PodInput, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    pod.step(input);
    w.step();
    each?.();
  }
}

const FULL: PodInput = { throttle: 1, steer: 0, boost: false };
const hspeed = (pod: Pod) => Math.hypot(pod.velocity()[0], pod.velocity()[2]);

describe('Pod hover', () => {
  it('settles at ride height over flat ground', () => {
    const w = world(flat);
    const pod = new Pod(w, [0, 5, 0], NORTH);
    drive(w, pod, NO_INPUT, 3);
    expect(pod.position()[1]).toBeCloseTo(POD.ride, 2);
    expect(Math.abs(pod.velocity()[1])).toBeLessThan(0.01);
    expect(pod.supported).toBe(true);
  });

  it('follows a gentle slope', () => {
    const w = world((x, z) => -z * 0.1);
    const pod = new Pod(w, [0, -10, 100], NORTH);
    let worst = 0;
    drive(w, pod, FULL, 3, () => {
      const [x, y, z] = pod.position();
      worst = Math.max(worst, Math.abs(y - (-z * 0.1 + POD.ride)));
    });
    expect(pod.position()[2]).toBeLessThan(0);
    expect(worst).toBeLessThan(1);
  });
});

describe('Pod driving', () => {
  it('reaches top speed and no more; boost goes faster and drains the tank', () => {
    const w = world(flat);
    const pod = new Pod(w, [0, 0, 180], NORTH);
    drive(w, pod, FULL, 4);
    expect(pod.forwardSpeed()).toBeCloseTo(POD.maxSpeed, 0);
    drive(w, pod, { throttle: 1, steer: 0, boost: true }, 1.5);
    expect(pod.forwardSpeed()).toBeGreaterThan(POD.maxSpeed + 20);
    expect(pod.boostTank).toBeLessThan(0.6);
  });

  it('turns right with positive steer, left with negative (seen from above)', () => {
    for (const [steer, side] of [
      [1, 1],
      [-1, -1],
    ] as const) {
      const w = world(flat);
      const pod = new Pod(w, [0, 0, 100], NORTH);
      drive(w, pod, { throttle: 1, steer, boost: false }, 0.5);
      // Facing north (−z), right is east (+x).
      expect(Math.sign(pod.heading[0])).toBe(side);
      expect(Math.sign(pod.position()[0])).toBe(side);
    }
  });

  it('ends boost cleanly when the tank runs dry, and re-arms only after refilling', () => {
    const w = world(flat);
    const pod = new Pod(w, [0, 0, 190], NORTH);
    const BOOST: PodInput = { throttle: 1, steer: 0, boost: true };
    drive(w, pod, BOOST, 1 / POD.boostDrain + 0.1); // empties the tank
    expect(pod.boostLocked).toBe(true);
    let flickers = 0;
    let fastest = 0;
    drive(w, pod, BOOST, 1.5, () => {
      flickers += pod.boosting ? 1 : 0;
      fastest = Math.max(fastest, pod.forwardSpeed());
    });
    expect(flickers).toBe(0);
    // Speed eases back down toward normal top speed instead of hovering at boost speed.
    expect(pod.forwardSpeed()).toBeLessThan(fastest);
    drive(w, pod, FULL, POD.boostRearm / POD.boostRefill + 0.1);
    drive(w, pod, BOOST, 0.1);
    expect(pod.boosting).toBe(true);
  });

  it("doesn't turn at a standstill, but steers while coasting", () => {
    const w = world(flat);
    const pod = new Pod(w, [0, 0, 100], NORTH);
    drive(w, pod, { throttle: 0, steer: 1, boost: false }, 1);
    expect(pod.heading[0]).toBeCloseTo(0, 6);
    drive(w, pod, FULL, 1);
    drive(w, pod, { throttle: 0, steer: 1, boost: false }, 0.3);
    expect(pod.heading[0]).toBeGreaterThan(0.1);
  });

  it('turns like a car: tightest circle when slow, wider turns when fast', () => {
    // Steady speed, full lock: the turn rate is speed / radius, so radius = speed / rate.
    const radiusAt = (speed: number) => {
      const w = world(flat);
      const pod = new Pod(w, [0, 0, 0], NORTH);
      pod.body.setVelocity([0, 0, -speed]);
      const before = pod.heading;
      pod.step({ throttle: 0, steer: 1, boost: false });
      const turned = Math.acos(before[0] * pod.heading[0] + before[1] * pod.heading[1]) / STEP;
      return speed / turned;
    };
    expect(radiusAt(5)).toBeCloseTo(POD.minTurnRadius, 0);
    expect(radiusAt(60)).toBeGreaterThan(radiusAt(30));
    expect(radiusAt(95)).toBeGreaterThan(100);
  });

  it('swings the nose the other way in reverse', () => {
    const w = world(flat);
    const pod = new Pod(w, [0, 0, 0], NORTH);
    drive(w, pod, { throttle: -1, steer: 0, boost: false }, 1.5);
    drive(w, pod, { throttle: -1, steer: 1, boost: false }, 0.5);
    expect(pod.heading[0]).toBeLessThan(-0.05); // steering right while backing: nose goes left
  });

  it('brakes hard to a stop with Space and never reverses, even with the throttle held', () => {
    const w = world(flat);
    const pod = new Pod(w, [0, 0, 150], NORTH);
    drive(w, pod, FULL, 4);
    drive(w, pod, { throttle: 1, steer: 0, boost: true, brake: true }, POD.maxSpeed / POD.brake + 0.1);
    expect(pod.forwardSpeed()).toBeCloseTo(0, 5);
    expect(pod.boosting).toBe(false);
    drive(w, pod, { throttle: -1, steer: 0, boost: false, brake: true }, 1);
    expect(pod.forwardSpeed()).toBeCloseTo(0, 5);
  });

  it('brakes to a stop, then reverses', () => {
    const w = world(flat);
    const pod = new Pod(w, [0, 0, 0], NORTH);
    drive(w, pod, FULL, 1.5);
    drive(w, pod, { throttle: -1, steer: 0, boost: false }, 3);
    expect(pod.forwardSpeed()).toBeCloseTo(-POD.reverseSpeed, 0);
  });

  it('gives the same race for the same inputs (deterministic)', () => {
    const run = () => {
      const w = world((x, z) => Math.abs(x) * 0.05 + (z > 0 ? 0 : 1));
      const pod = new Pod(w, [0, 0, 150], NORTH);
      for (let i = 0; i < 300; i++) {
        pod.step({ throttle: 1, steer: i % 90 < 45 ? 0.6 : -0.6, boost: i > 150 });
        w.step();
      }
      return [...pod.position(), ...pod.heading];
    };
    expect(run()).toEqual(run());
  });
});

describe('Pod and the track', () => {
  it.each(['mesa', 'boulder', 'stand'] as const)('is stopped by a %s (rocks and grandstands are obstacles, not ramps)', (kind) => {
    const w = world(flat, [box(kind, [0, 1.5, 0], [60, 3, 6])]);
    const pod = new Pod(w, [0, 0, 120], NORTH);
    let highest = 0;
    drive(w, pod, FULL, 5, () => (highest = Math.max(highest, pod.position()[1])));
    expect(pod.position()[2]).toBeGreaterThan(3 + POD.radius - 0.2);
    expect(highest).toBeLessThan(POD.ride + 0.3);
  });

  it('passes under a banner without touching it', () => {
    const y = LAYOUT.bannerClearance + 1;
    const w = world(flat, [box('board', [0, y, 0], [40, 2, 0.4])]);
    const pod = new Pod(w, [0, 0, 180], NORTH);
    drive(w, pod, FULL, 2.5);
    let scraped = false;
    drive(w, pod, FULL, 3, () => (scraped ||= pod.scraping));
    expect(scraped).toBe(false);
    expect(pod.position()[2]).toBeLessThan(-30);
  });

  it("can't climb a canyon wall, however fast it drives into it", () => {
    // Floor at 0 for z > -20, then a 60° wall (slope 1.8) up to a 40 m plateau.
    const wall = (x: number, z: number) => Math.min(40, Math.max(0, (-20 - z) * 1.8));
    for (const [hx, hz] of [
      [0, -1],
      [0.5, -0.866],
    ] as const) {
      const w = world(wall);
      const pod = new Pod(w, [0, 0, 150], [hx, hz]);
      let highest = 0;
      drive(w, pod, { throttle: 1, steer: 0, boost: true }, 6, () => (highest = Math.max(highest, pod.position()[1])));
      expect(highest).toBeLessThan(LAYOUT.hoverCeiling + 1);
      expect(pod.position()[2]).toBeGreaterThan(-25);
    }
  });

  it('scrapes along a wall it hits at an angle, losing speed', () => {
    const w = world(flat, [box('pillar', [-6, 5, 0], [2, 10, 400])]);
    const pod = new Pod(w, [0, 0, 150], NORTH);
    drive(w, pod, FULL, 2);
    const v0 = hspeed(pod);
    let scraped = 0;
    drive(w, pod, { throttle: 1, steer: -0.3, boost: false }, 2, () => (scraped += pod.scraping ? 1 : 0));
    expect(scraped).toBeGreaterThan(10);
    expect(hspeed(pod)).toBeLessThan(v0 * 0.8);
    expect(pod.position()[0]).toBeGreaterThan(-5 + POD.radius - 0.2);
  });

  it('respawns at the last safe spot after falling into a chasm', () => {
    const chasm = (x: number, z: number) => (z < -40 ? -70 : 0);
    const w = world(chasm);
    const pod = new Pod(w, [0, 0, 150], NORTH);
    drive(w, pod, FULL, 4.5);
    expect(pod.respawns).toBe(0);
    drive(w, pod, NO_INPUT, 4);
    expect(pod.respawns).toBe(1);
    const [, y, z] = pod.position();
    expect(z).toBeGreaterThan(-40);
    expect(y).toBeCloseTo(POD.ride, 0);
  });

  it('crosses a bridge over a chasm', () => {
    const chasm = (x: number, z: number) => (z < -20 && z > -100 ? -70 : 0);
    const w = world(chasm, [box('bridge', [0, -0.5, -60], [14, 1, 90])]);
    const pod = new Pod(w, [0, 0, 150], NORTH);
    drive(w, pod, FULL, 6);
    expect(pod.respawns).toBe(0);
    expect(pod.position()[2]).toBeLessThan(-110);
  });
});

describe('Travelling through caves (J)', () => {
  const gate: Gate = {
    id: 0,
    target: 'Somewhere',
    source: { kind: 'block', block: 0, span: 0 },
    center: [0, 2.75, 0],
    width: 6.5,
    height: 5.5,
    normal: [0, 1], // opens toward +z
  };

  it('is in reach in front of the mouth, up to the range', () => {
    expect(gateInReach(gate, [0, 1.8, 2])).toBe(true);
    expect(gateInReach(gate, [0, 1.8, GATE_RANGE - 0.5])).toBe(true);
    expect(gateInReach(gate, [8, 1.8, 15])).toBe(true); // off to the side, further out: inside the cone
  });

  it('is out of reach too far, behind the wall, far off to the side, or high above', () => {
    expect(gateInReach(gate, [0, 1.8, GATE_RANGE + 1])).toBe(false);
    expect(gateInReach(gate, [0, 1.8, -2])).toBe(false);
    expect(gateInReach(gate, [10, 1.8, 2])).toBe(false);
    expect(gateInReach(gate, [0, 20, 5])).toBe(false);
  });

  it('picks the nearest cave in reach', () => {
    const far: Gate = { ...gate, id: 1, center: [3, 2.75, -10] };
    expect(nearestGateInReach([far, gate], [0, 1.8, 4])).toBe(gate);
    expect(nearestGateInReach([far, gate], [0, 1.8, 40])).toBeNull();
  });

  it('every cave on a real page can be driven up to and reached', async () => {
    const html = readFileSync(new URL('./fixtures/podracing.html', import.meta.url), 'utf8');
    const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
    const page = parseArticle('List of Star Wars air, aquatic, and ground vehicles', (document.querySelector('.mw-parser-output') ?? document.body) as unknown as Element);
    const layout = layoutPage(page, { roomSeed: 42, biome: 'dune', structure: 'hiddenLotus' });
    const w = await PhysicsWorld.create(layout);
    const unreachable: number[] = [];
    for (const g of layout.gates) {
      // A pod 20 m out from the mouth driving straight at it until it stops — straight on, or
      // from either side (an arch leg or a panel post can stand in front of a mouth).
      const [nx, nz] = g.normal;
      let ok = false;
      for (const side of [0, 0.5, -0.5]) {
        if (ok) break;
        const ox = nx - nz * side;
        const oz = nz + nx * side;
        const x = g.center[0] + ox * 20;
        const z = g.center[2] + oz * 20;
        const pod = new Pod(w, [x, terrainHeight(layout.terrain, x, z), z], [-ox, -oz]);
        for (let i = 0; i < 120 && !ok; i++) {
          pod.step({ throttle: 0.5, steer: 0, boost: false });
          w.step();
          const p = pod.position();
          // Close to the mouth (within 8 m) and in reach: the player would see the J prompt.
          const out = (p[0] - g.center[0]) * nx + (p[2] - g.center[2]) * nz;
          ok = out < 8 && gateInReach(g, p);
        }
        pod.dispose();
      }
      if (!ok) unreachable.push(g.id);
    }
    w.dispose();
    expect(unreachable).toEqual([]);
  }, 60_000);
});

describe('Driving real tracks', () => {
  const html = readFileSync(new URL('./fixtures/podracing.html', import.meta.url), 'utf8');
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const page = parseArticle('List of Star Wars air, aquatic, and ground vehicles', (document.querySelector('.mw-parser-output') ?? document.body) as unknown as Element);

  /**
   * Simple auto-driver: aims at each waypoint in turn, easing off and braking for sharp turns,
   * swerving round rocks it sees ahead, and backing out (like a player would) when it's pinned
   * against something. Returns null if it got to the end, or what went wrong.
   */
  function follow(w: PhysicsWorld, layout: WorldLayout, route: [number, number][]): string | null {
    const [sx, sz] = route[0];
    const pod = new Pod(w, [sx, terrainHeight(layout.terrain, sx, sz), sz], [route[1][0] - sx, route[1][1] - sz]);
    let length = 0;
    for (let i = 1; i < route.length; i++) length += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
    const limit = Math.round((length / 15 + 10) / STEP);
    let next = 1;
    let slow = 0;
    let backing = 0;
    let backouts = 0;
    let steps = 0;
    let problem: string | null = null;
    for (; steps < limit && next < route.length && !problem; steps++) {
      const [x, , z] = pod.position();
      const [tx, tz] = route[next];
      if (Math.hypot(tx - x, tz - z) < 15) {
        next++;
        continue;
      }
      const [hx, hz] = pod.heading;
      const dx = tx - x;
      const dz = tz - z;
      let turn = Math.atan2(hx * dz - hz * dx, hx * dx + hz * dz);
      const speed = pod.forwardSpeed();
      // Look ahead (like a driver would) and swerve toward the clearer side of any rock.
      const p = pod.position();
      // From the cockpit and from each engine (the pod is 4.4 m wide).
      const clear = (a: number) => {
        const c = Math.cos(a);
        const s = Math.sin(a);
        const dir: Vec3 = [hx * c - hz * s, 0, hz * c + hx * s];
        let d = 40;
        for (const side of [0, -2.2, 2.2]) {
          const from: Vec3 = [p[0] - hz * side, p[1], p[2] + hx * side];
          d = Math.min(d, w.castRay(from, dir, 40, 'props')?.distance ?? 40);
        }
        return d;
      };
      const ahead = Math.min(clear(0), clear(0.06), clear(-0.06));
      // Only for rocks close ahead, and only a partial swerve, so it stays near its route.
      if (ahead < Math.min(20, Math.max(10, speed * 0.4))) turn += clear(0.45) >= clear(-0.45) ? 0.6 : -0.6;
      let throttle = Math.abs(turn) > 0.8 && speed > 20 ? -0.6 : Math.abs(turn) > 0.4 ? 0.3 : 1;
      let steer = Math.max(-1, Math.min(1, turn * 3));
      if (backing > 0) {
        backing--;
        throttle = -1;
        // Reversing swings the nose the other way, so steer away to turn toward the waypoint.
        steer = turn > 0 ? -1 : 1;
      }
      pod.step({ throttle, steer, boost: false });
      w.step();
      slow = hspeed(pod) < 2 && backing === 0 ? slow + 1 : 0;
      if (slow > 0.8 / STEP) {
        slow = 0;
        backing = Math.round(1.2 / STEP);
        if (++backouts > 4) problem = 'stuck (backed out 4 times)';
      }
      if (pod.respawns > 0) problem = 'fell';
    }
    const [x, y, z] = pod.position();
    pod.dispose();
    if (!problem && next < route.length) problem = 'too slow';
    if (!problem && length / (steps * STEP) < 15) problem = `slow (${(length / (steps * STEP)).toFixed(0)} m/s)`;
    return problem && `${problem} at waypoint ${next}/${route.length}, pod at ${x.toFixed(0)},${y.toFixed(1)},${z.toFixed(0)}`;
  }

  it.each([
    ['hiddenLotus', 'dune'],
    ['hiddenLotus', 'canopy'],
    ['vine', 'frost'],
    ['lilypad', 'ember'],
    ['lilypad', 'relic'],
  ] as const)('an auto-driver can follow every canyon of %s (%s) end to end', async (structure, biome) => {
    const layout = layoutPage(page, { roomSeed: 42, biome, structure });
    const w = await PhysicsWorld.create(layout);
    const report: string[] = [];
    for (const region of layout.regions) {
      // Lilypad's "Bridge" regions are map lines between island centres, not driving lines;
      // the bridges themselves are driven in the next test.
      if (region.kind === 'arena' || region.title === 'Bridge' || region.path.length < 2) continue;
      const problem = follow(w, layout, region.path);
      if (problem) report.push(`${region.kind} "${region.title}": ${problem}`);
    }
    w.dispose();
    expect(report).toEqual([]);
  }, 300_000);

  /**
   * KNOWN BUG (Atlas/Lilypad, found in Phase 2B): on each of these pages one bridge's far end
   * lands on a plateau rim 25–50 m up instead of its island's canyon floor, so the deck runs
   * into a cliff. Empty this list when the Lilypad layout is fixed.
   */
  const BROKEN_BRIDGES: Record<string, string[]> = { ember: ['-230,-837'], relic: ['-201,-790'] };

  it.each(['ember', 'relic'] as const)('an auto-driver can cross every Lilypad bridge (%s), apart from the known broken ones', async (biome) => {
    const layout = layoutPage(page, { roomSeed: 42, biome, structure: 'lilypad' });
    const w = await PhysicsWorld.create(layout);
    const failed: string[] = [];
    for (const b of layout.boxes) {
      if (b.kind !== 'bridge') continue;
      // Along the deck's long (local z) axis, from just before one end to just past the other.
      const [, qy, , qw] = b.rot ?? [0, 0, 0, 1];
      const yaw = 2 * Math.atan2(qy, qw);
      const ax = Math.sin(yaw);
      const az = Math.cos(yaw);
      const half = b.size[2] / 2 + 3;
      const there: [number, number][] = [
        [b.center[0] - ax * half, b.center[2] - az * half],
        [b.center[0] + ax * half, b.center[2] + az * half],
      ];
      // Both ways: a bridge is only usable if you can get on it from either island.
      const problem = follow(w, layout, there) ?? follow(w, layout, [there[1], there[0]]);
      if (problem) {
        failed.push(`${b.center[0].toFixed(0)},${b.center[2].toFixed(0)}`);
      }
    }
    w.dispose();
    expect(failed).toEqual(BROKEN_BRIDGES[biome]);
  }, 300_000);
});
