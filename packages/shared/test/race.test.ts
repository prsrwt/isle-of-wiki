import { describe, expect, it } from 'vitest';
import { formatRaceTime, Marshal, RACE, samePage, SIM } from '../src';

const run = (m: Marshal, ticks: number) => {
  for (let i = 0; i < ticks; i++) m.step();
};

/** A marshal whose race has just started (countdown done). */
function racing(): Marshal {
  const m = new Marshal({ start: 'Podracing', target: 'Moon' });
  m.startCountdown();
  run(m, RACE.countdownTicks);
  return m;
}

describe('Marshal', () => {
  it('holds the racer on the grid until the countdown, then counts 3, 2, 1 without timing', () => {
    const m = new Marshal({ start: 'Podracing', target: 'Moon' });
    run(m, 500);
    expect(m.phase).toBe('grid');
    expect(m.canDrive).toBe(false);
    m.startCountdown();
    expect(m.countdownNumber).toBe(3);
    run(m, SIM.tickHz);
    expect(m.countdownNumber).toBe(2);
    run(m, SIM.tickHz);
    expect(m.countdownNumber).toBe(1);
    expect(m.canDrive).toBe(false);
    run(m, SIM.tickHz);
    expect(m.phase).toBe('racing');
    expect(m.canDrive).toBe(true);
    expect(m.ticks).toBe(0);
  });

  it('times the race in ticks', () => {
    const m = racing();
    run(m, 90);
    expect(m.timeMs).toBe(1500);
  });

  it('charges every tunnel exactly its fixed cost, however long the page takes to load', () => {
    const quick = racing();
    const slow = racing();
    for (const m of [quick, slow]) expect(m.enterTunnel()).toBe(true);
    run(quick, 10); // page ready almost at once
    run(slow, RACE.tunnelTicks * 5); // slow connection
    quick.arrive('Repulsorlift');
    slow.arrive('Repulsorlift');
    expect(quick.ticks).toBe(RACE.tunnelTicks);
    expect(slow.ticks).toBe(RACE.tunnelTicks);
    expect(quick.phase).toBe('racing');
    expect(quick.page).toBe('Repulsorlift');
    expect(quick.hops).toBe(1);
  });

  it('finishes on reaching the target, stops the clock and reports the path', () => {
    const m = racing();
    run(m, 60);
    m.enterTunnel();
    m.arrive('Repulsorlift');
    run(m, 60);
    m.enterTunnel();
    expect(m.arrive('moon')).toBe(true);
    expect(m.phase).toBe('finished');
    const time = m.timeMs;
    expect(time).toBe(Math.round(((120 + 2 * RACE.tunnelTicks) * 1000) / SIM.tickHz));
    run(m, 600);
    expect(m.timeMs).toBe(time);
    expect(m.result()).toEqual({ timeMs: time, hops: 2, path: ['Podracing', 'Repulsorlift', 'moon'] });
    // Exploring after the finish is untimed and changes nothing.
    expect(m.enterTunnel()).toBe(false);
    expect(m.result()?.hops).toBe(2);
  });

  it('only lets you into a tunnel while racing', () => {
    const m = new Marshal({ start: 'A', target: 'B' });
    expect(m.enterTunnel()).toBe(false);
    m.startCountdown();
    expect(m.enterTunnel()).toBe(false);
    expect(m.arrive('B')).toBe(false);
    expect(m.result()).toBeNull();
  });

  it('keeps the time spent when a tunnel fails and lets you race on', () => {
    const m = racing();
    m.enterTunnel();
    run(m, 30);
    m.abortTunnel();
    expect(m.phase).toBe('racing');
    expect(m.ticks).toBe(30);
    expect(m.hops).toBe(0);
  });
});

describe('race helpers', () => {
  it('compares titles like Wikipedia does', () => {
    expect(samePage('moon', 'Moon')).toBe(true);
    expect(samePage('Star_Wars', 'Star Wars')).toBe(true);
    expect(samePage('Moon', 'Mood')).toBe(false);
  });

  it('formats race times', () => {
    expect(formatRaceTime(0)).toBe('0:00.00');
    expect(formatRaceTime(42180)).toBe('0:42.18');
    expect(formatRaceTime(723500)).toBe('12:03.50');
    expect(formatRaceTime(3723500)).toBe('1:02:03.50');
  });
});
