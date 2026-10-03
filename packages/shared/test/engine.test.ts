import { describe, expect, it } from 'vitest';
import { bucketByChunk, CHUNK_SIZE, chunkCoord, FixedStepClock, Heartbeat, Registry } from '../src';

describe('Heartbeat clock', () => {
  it('runs the same number of steps whatever the frame rate', () => {
    const run = (fps: number) => {
      const clock = new FixedStepClock(60);
      for (let i = 0; i < fps * 10; i++) clock.advance(1 / fps);
      return clock.tick;
    };
    // 10 simulated seconds → 600 steps at 30, 60 and 144 fps (±1 for float rounding).
    for (const fps of [30, 60, 144]) expect(Math.abs(run(fps) - 600)).toBeLessThanOrEqual(1);
  });

  it('caps catch-up after a long stall instead of freezing', () => {
    const clock = new FixedStepClock(60, 5);
    expect(clock.advance(10)).toBe(5);
    expect(clock.alpha).toBeLessThanOrEqual(1);
  });

  it('runs systems in order: fixed steps, then one frame update', () => {
    const calls: string[] = [];
    const hb = new Heartbeat(new FixedStepClock(10));
    hb.add({ name: 'a', fixedUpdate: (_dt, tick) => calls.push(`a${tick}`), frameUpdate: () => calls.push('aF') });
    hb.add({ name: 'b', fixedUpdate: (_dt, tick) => calls.push(`b${tick}`) });
    hb.advance(0.25);
    expect(calls).toEqual(['a1', 'b1', 'a2', 'b2', 'aF']);
  });
});

describe('Heartbeat registry', () => {
  type C = { pos: { x: number }; tag: string };

  it('queries entities that have every requested component', () => {
    const reg = new Registry<C>();
    const a = reg.create();
    const b = reg.create();
    reg.set(a, 'pos', { x: 1 });
    reg.set(a, 'tag', 'pod');
    reg.set(b, 'pos', { x: 2 });
    const rows = [...reg.query('pos', 'tag')];
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe(a);
    expect(rows[0][1].tag).toBe('pod');
    reg.destroy(a);
    expect([...reg.query('pos')].map(([e]) => e)).toEqual([b]);
  });
});

describe('GNME chunks', () => {
  it('assigns positions to origin-aligned chunks', () => {
    expect(chunkCoord(0)).toBe(0);
    expect(chunkCoord(CHUNK_SIZE - 0.01)).toBe(0);
    expect(chunkCoord(-0.01)).toBe(-1);
    const buckets = bucketByChunk([[10, 10], [300, -5], [20, 30]] as [number, number][], (p) => p);
    expect(buckets.get('0,0')).toHaveLength(2);
    expect(buckets.get('1,-1')).toHaveLength(1);
  });
});
