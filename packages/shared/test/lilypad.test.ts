import { expect, it } from 'vitest';
import { layoutPage, mulberry32, terrainHeight, type Block, type ParsedPage } from '../src';

/** A made-up article: `n` sections with lengths drawn from a wide range (some very long). */
function fakePage(seed: number, n: number): ParsedPage {
  const rng = mulberry32(seed);
  const blocks: Block[] = [];
  let link = 0;
  for (let i = 0; i < n; i++) {
    blocks.push({ kind: 'heading', level: 2, text: `Section ${i}` });
    const paras = rng() < 0.15 ? 20 + Math.floor(rng() * 40) : 1 + Math.floor(rng() * 8);
    for (let p = 0; p < paras; p++) {
      const spans = [];
      const links = Math.floor(rng() * 6);
      for (let k = 0; k < links; k++) spans.push({ text: 'word word word ' }, { text: `L${link}`, link: `Link ${link++}` });
      spans.push({ text: 'Some more text to fill the paragraph out a bit.' });
      blocks.push({ kind: 'paragraph', spans, indent: 0 });
    }
  }
  return { title: `Fake ${seed}`, blocks, infobox: null, linkCount: link } as unknown as ParsedPage;
}

/**
 * Lilypad on many article shapes: every bridge lane, from one island's loop across the deck to
 * the next island's loop, has no step a pod can't ride and no prop standing in it.
 */
it('Lilypad bridge lanes are open and unbroken on articles of every shape', () => {
  const report: string[] = [];
  for (let seed = 1; seed <= 24; seed++) {
    const n = 4 + (seed % 22);
    const page = fakePage(seed, n);
    for (const biome of ['dune', 'ember'] as const) {
      const layout = layoutPage(page, { roomSeed: seed * 13, biome, structure: 'lilypad' });
      const decks = layout.boxes.filter((b) => b.kind === 'bridge');
      const sections = layout.regions.filter((r) => r.kind === 'section').length;
      if (decks.length !== sections) report.push(`${seed}/${biome}: ${decks.length} decks for ${sections} sections`);
      for (const r of layout.regions.filter((r) => r.title === 'Bridge' && r.kind === 'connector')) {
        const [[x0, z0], [x1, z1]] = r.path as [number, number][];
        const L = Math.hypot(x1 - x0, z1 - z0);
        let prev: number | null = null;
        for (let d = 0; d <= L; d += 1) {
          const x = x0 + ((x1 - x0) * d) / L;
          const z = z0 + ((z1 - z0) * d) / L;
          let h = terrainHeight(layout.terrain, x, z);
          for (const b of decks) {
            const [, qy, , qw] = b.rot ?? [0, 0, 0, 1];
            const yaw = 2 * Math.atan2(qy, qw);
            const lx = (x - b.center[0]) * Math.cos(yaw) - (z - b.center[2]) * Math.sin(yaw);
            const lz = (x - b.center[0]) * Math.sin(yaw) + (z - b.center[2]) * Math.cos(yaw);
            if (Math.abs(lx) <= b.size[0] / 2 && Math.abs(lz) <= b.size[2] / 2) h = Math.max(h, b.center[1] + b.size[1] / 2);
          }
          if (prev !== null && Math.abs(h - prev) > 3) {
            report.push(`${seed}/${biome} n=${n}: connector ${x0.toFixed(0)},${z0.toFixed(0)} -> ${x1.toFixed(0)},${z1.toFixed(0)} (${L.toFixed(0)} m): ${prev.toFixed(1)} -> ${h.toFixed(1)} at ${d}`);
            break;
          }
          prev = h;
        }
        // Solid props standing in the bridge lane.
        for (const b of layout.boxes) {
          if (b.kind === 'bridge' || b.kind === 'board') continue;
          const t = Math.max(0, Math.min(L, ((b.center[0] - x0) * (x1 - x0) + (b.center[2] - z0) * (z1 - z0)) / L));
          const px = x0 + ((x1 - x0) * t) / L;
          const pz = z0 + ((z1 - z0) * t) / L;
          const off = Math.hypot(b.center[0] - px, b.center[2] - pz);
          const rad = Math.min(b.size[0], b.size[2]) / 2;
          const bottom = b.center[1] - b.size[1] / 2;
          const ground = terrainHeight(layout.terrain, b.center[0], b.center[2]);
          if (off < rad + 2 && bottom < ground + 8 && t > 20 && t < L - 20) {
            report.push(`${seed}/${biome} n=${n}: ${b.kind} ${b.size.map((v) => v.toFixed(0)).join('x')} in bridge lane at ${b.center[0].toFixed(0)},${b.center[2].toFixed(0)} (t=${t.toFixed(0)}/${L.toFixed(0)}, off ${off.toFixed(1)})`);
          }
        }
      }
      for (const b of decks) {
        const [, qy, , qw] = b.rot ?? [0, 0, 0, 1];
        const yaw = 2 * Math.atan2(qy, qw);
        const ax = Math.sin(yaw);
        const az = Math.cos(yaw);
        const half = b.size[2] / 2;
        const top = b.center[1] + b.size[1] / 2;
        let prev: number | null = null;
        for (let d = -half - 40; d <= half + 40; d += 1) {
          const x = b.center[0] + ax * d;
          const z = b.center[2] + az * d;
          const ground = terrainHeight(layout.terrain, x, z);
          const h = Math.abs(d) <= half ? Math.max(top, ground) : ground;
          if (prev !== null && Math.abs(h - prev) > 3) {
            report.push(`${seed}/${biome} n=${n}: bridge at ${b.center[0].toFixed(0)},${b.center[2].toFixed(0)} len ${b.size[2].toFixed(0)}: step ${prev.toFixed(1)} -> ${h.toFixed(1)} at d=${d.toFixed(0)} (deck half ${half.toFixed(0)})`);
            break;
          }
          prev = h;
        }
      }
    }
  }
  expect(report).toEqual([]);
}, 600_000);
