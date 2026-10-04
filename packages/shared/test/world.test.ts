import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { canyonSpacing } from '../src/atlas/structures/structure';
import {
  BIOMES,
  buildSections,
  Guestbook,
  infoboxLinks,
  LAYOUT,
  layoutPage,
  mulberry32,
  parseArticle,
  placeItems,
  rankBiomes,
  STRUCTURES,
  terrainHeight,
  type BiomeId,
  type ParsedPage,
  type StructureId,
  type WorldLayout,
} from '../src';

const TITLE = 'List of Star Wars air, aquatic, and ground vehicles';
const html = readFileSync(new URL('./fixtures/podracing.html', import.meta.url), 'utf8');

function parseFixture(): ParsedPage {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const root = document.querySelector('.mw-parser-output') ?? document.body;
  return parseArticle(TITLE, root as unknown as Element);
}

describe('parseArticle', () => {
  const page = parseFixture();

  it('extracts headings and paragraphs', () => {
    expect(page.blocks.filter((b) => b.kind === 'heading').length).toBeGreaterThan(3);
    expect(page.blocks.filter((b) => b.kind === 'paragraph').length).toBeGreaterThan(10);
    expect(page.linkCount).toBeGreaterThan(20);
  });

  it('keeps only article links', () => {
    for (const b of page.blocks) {
      if (b.kind !== 'paragraph') continue;
      for (const s of b.spans) {
        if (!s.link) continue;
        expect(s.link).not.toMatch(/^(File|Help|Category|Wikipedia|Template|Special):/i);
        expect(s.link).not.toContain('_');
      }
    }
  });

  it('drops reference sections and citation markers', () => {
    const headings = page.blocks.flatMap((b) => (b.kind === 'heading' ? [b.text.toLowerCase()] : []));
    expect(headings).not.toContain('references');
    const text = page.blocks.flatMap((b) => (b.kind === 'paragraph' ? b.spans.map((s) => s.text) : [])).join(' ');
    expect(text).not.toMatch(/\[\d+\]/);
  });

  it('captures image URLs for paintings', () => {
    const images = page.blocks.filter((b) => b.kind === 'image');
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) if (img.kind === 'image' && img.src) expect(img.src).toMatch(/^https:\/\//);
  });
});

/** Every structure, each with a different biome so all biome shapes get exercised too. */
const CASES: [StructureId, BiomeId][] = [
  ['hiddenLotus', 'dune'],
  ['hiddenLotus', 'canopy'],
  ['vine', 'frost'],
  ['lilypad', 'ember'],
  ['lilypad', 'relic'],
];

describe.each(CASES)('Atlas: %s in %s', (structure, biome) => {
  const page = parseFixture();
  const spec = { roomSeed: 42, biome, structure };
  const layout: WorldLayout = layoutPage(page, spec);

  it('is deterministic', () => {
    expect(JSON.stringify(layoutPage(parseFixture(), spec))).toEqual(JSON.stringify(layout));
    expect(layout.structure).toBe(structure);
    expect(layout.biome).toBe(biome);
  });

  it('has a Seedpod and one region per section', () => {
    expect(layout.regions.filter((r) => r.kind === 'arena')).toHaveLength(1);
    const sections = layout.regions.filter((r) => r.kind === 'section');
    expect(sections).toHaveLength(buildSections(page).length);
    expect(sections.map((r) => r.section)).toEqual(sections.map((_, i) => i));
  });

  it('gives every article link a cave, in reading order, pointing back at its link', () => {
    const sectionLinks = buildSections(page).flatMap((s) => s.items.flatMap((it) => (it.t === 'para' ? it.links : [])));
    const pitCaves = layout.gates.filter((g) => g.source.kind === 'infobox');
    const sectionCaves = layout.gates.filter((g) => g.source.kind === 'block');
    expect(sectionCaves.map((g) => g.target)).toEqual(sectionLinks.map((l) => l.target));
    expect(sectionCaves.map((g) => g.source)).toEqual(sectionLinks.map((l) => l.source));
    expect(pitCaves.length).toBeLessThanOrEqual(infoboxLinks(page).length);
    expect(layout.gates.every((g, i) => g.id === i)).toBe(true);
  });

  it('cuts every cave into a real wall (never floating in open ground)', () => {
    const stands = layout.boxes.filter((b) => b.kind === 'stand');
    for (const g of layout.gates) {
      const bx = g.center[0] - g.normal[0] * 5;
      const bz = g.center[2] - g.normal[1] * 5;
      const floor = g.center[1] - g.height / 2;
      const rock = terrainHeight(layout.terrain, bx, bz) - floor;
      // Pit-lane gates stand against the grandstand instead of rock.
      const stand = stands.some((s) => Math.abs(s.center[0] - bx) <= s.size[0] / 2 + 4 && Math.abs(s.center[2] - bz) <= s.size[2] / 2);
      expect(rock >= LAYOUT.caveH * 0.85 || (g.source.kind === 'infobox' && stand)).toBe(true);
    }
  });

  it('keeps cave mouths apart', () => {
    const g = layout.gates;
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        expect(Math.hypot(g[i].center[0] - g[j].center[0], g[i].center[2] - g[j].center[2])).toBeGreaterThan(5);
      }
    }
  });

  it('keeps hop-over rocks under the hover ceiling and boards above it', () => {
    for (const b of layout.boxes.filter((x) => x.kind === 'mesa' || x.kind === 'boulder')) {
      expect(b.size[1]).toBeLessThanOrEqual(LAYOUT.hoverCeiling);
    }
    for (const p of layout.panels) {
      const ground = terrainHeight(layout.terrain, p.center[0], p.center[2]);
      expect(p.center[1] - p.height / 2 - ground).toBeGreaterThanOrEqual(LAYOUT.hoverCeiling);
    }
  });

  it('numbers billboards in order and plants the biome landmark', () => {
    const ads = layout.panels.filter((p) => p.kind === 'ad');
    expect(ads.length).toBeGreaterThan(0);
    expect(ads.map((a) => (a.kind === 'ad' ? a.slot : -1))).toEqual(ads.map((_, i) => i));
    expect(layout.boxes.some((b) => b.kind === BIOMES[biome].landmark)).toBe(true);
  });

  it('paints no article text on the ground', () => {
    const floor = layout.texts.filter((t) => t.mode === 'floor' && t.style !== 'link' && t.style !== 'heading');
    expect(floor).toHaveLength(0);
  });

  it('spreads spawns across the track', () => {
    expect(layout.spawns).toHaveLength(LAYOUT.spawnCount);
    expect(new Set(layout.spawns.map((s) => s.join(','))).size).toBe(LAYOUT.spawnCount);
  });
});

describe('Lilypad specifics', () => {
  it('bridges every island to the next over a chasm', () => {
    const layout = layoutPage(parseFixture(), { roomSeed: 7, biome: 'dune', structure: 'lilypad' });
    const decks = layout.boxes.filter((b) => b.kind === 'bridge');
    expect(decks).toHaveLength(buildSections(parseFixture()).length);
    for (const d of decks) {
      // Under the middle of each deck is the chasm.
      expect(terrainHeight(layout.terrain, d.center[0], d.center[2])).toBeLessThan(-20);
    }
  });
});

describe('Guestbook', () => {
  it('never lets a first arrival land in the biome they came from', () => {
    for (let seed = 0; seed < 50; seed++) {
      const book = new Guestbook(seed);
      for (const from of Object.keys(BIOMES) as BiomeId[]) {
        const page = `Page ${seed} ${from}`;
        expect(book.arrive(page, from).biome).not.toBe(from);
      }
    }
  });

  it('gives later arrivals the world the first arrival signed', () => {
    const book = new Guestbook(99);
    const first = book.arrive('Moon', 'dune');
    for (const from of Object.keys(BIOMES) as BiomeId[]) expect(book.arrive('Moon', from)).toEqual(first);
    expect(book.read('Moon')).toEqual(first);
  });

  it('varies worlds between rooms and favours the Hidden Lotus', () => {
    const firsts = new Set(Array.from({ length: 40 }, (_, seed) => rankBiomes(seed, 'Moon')[0]));
    expect(firsts.size).toBeGreaterThan(2);
    const counts: Record<string, number> = {};
    for (let seed = 0; seed < 400; seed++) {
      const s = new Guestbook(seed).arrive('Moon').structure;
      counts[s] = (counts[s] ?? 0) + 1;
    }
    expect(counts.hiddenLotus).toBeGreaterThan(counts.vine);
    expect(counts.hiddenLotus).toBeGreaterThan(counts.lilypad);
  });
});

describe('Atlas guarantees across rooms and a big article', () => {
  const moonHtml = readFileSync(new URL('./fixtures/moon.html', import.meta.url), 'utf8');
  const moon = (() => {
    const { document } = parseHTML(`<!doctype html><html><body>${moonHtml}</body></html>`);
    return parseArticle('Moon', (document.querySelector('.mw-parser-output') ?? document.body) as unknown as Element);
  })();

  const check = (layout: WorldLayout, label: string) => {
    const stands = layout.boxes.filter((b) => b.kind === 'stand');
    const floating = layout.gates.filter((g) => {
      const bx = g.center[0] - g.normal[0] * 5;
      const bz = g.center[2] - g.normal[1] * 5;
      const rock = terrainHeight(layout.terrain, bx, bz) - (g.center[1] - g.height / 2);
      const stand = stands.some((s) => Math.abs(s.center[0] - bx) <= s.size[0] / 2 + 4 && Math.abs(s.center[2] - bz) <= s.size[2] / 2);
      return !(rock >= LAYOUT.caveH * 0.85 || (g.source.kind === 'infobox' && stand));
    });
    expect(floating.length, `${label}: floating caves`).toBe(0);
    // Overlapping caves = a section ran out of wall.
    const g = layout.gates;
    let overlaps = 0;
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (Math.hypot(g[i].center[0] - g[j].center[0], g[i].center[2] - g[j].center[2]) <= 5) overlaps++;
    expect(overlaps, `${label}: overlapping caves`).toBe(0);
  };

  it.each(['hiddenLotus', 'vine', 'lilypad'] as StructureId[])(
    'Moon as %s: every cave in rock, none overlapping',
    (structure) => {
      const layout = layoutPage(moon, { roomSeed: 1, biome: 'dune', structure });
      expect(layout.gates.length).toBeGreaterThan(800);
      check(layout, `Moon ${structure}`);
    },
    30_000,
  );

  it('holds for the worlds the Guestbook actually picks in many rooms', () => {
    const page = parseFixture();
    for (let roomSeed = 1; roomSeed <= 12; roomSeed++) {
      const sig = new Guestbook(roomSeed).arrive(page.title);
      check(layoutPage(page, { roomSeed, ...sig }), `room ${roomSeed} ${sig.structure}/${sig.biome}`);
    }
  }, 60_000);
});

describe('Hidden Lotus petal layers', () => {
  const moonHtml = readFileSync(new URL('./fixtures/moon.html', import.meta.url), 'utf8');
  const moon = (() => {
    const { document } = parseHTML(`<!doctype html><html><body>${moonHtml}</body></html>`);
    return parseArticle('Moon', (document.querySelector('.mw-parser-output') ?? document.body) as unknown as Element);
  })();
  const pages: [string, ParsedPage][] = [
    ['List', parseFixture()],
    ['Moon', moon],
  ];

  /** Furthest any petal reaches from the Seedpod. */
  const reach = (layout: WorldLayout) =>
    Math.max(...layout.regions.filter((r) => r.kind === 'section').flatMap((r) => r.path.map(([x, z]) => Math.hypot(x, z))));

  it('grows outer lobes so long sections stay close (List was 1213 m, Moon 1532 m before layers)', () => {
    for (const biome of ['dune', 'frost', 'canopy'] as BiomeId[]) {
      expect(reach(layoutPage(pages[0][1], { roomSeed: 1, biome, structure: 'hiddenLotus' })), `List ${biome}`).toBeLessThan(1000);
      expect(reach(layoutPage(moon, { roomSeed: 1, biome, structure: 'hiddenLotus' })), `Moon ${biome}`).toBeLessThan(1250);
    }
  }, 60_000);

  it.each(pages)('%s: petals (lobes included) never come closer than canyon spacing past the stems', (_, page) => {
    for (const biome of ['dune', 'frost', 'relic'] as BiomeId[]) {
      const shape = BIOMES[biome];
      const sections = buildSections(page).map((s) => ({ title: s.title, lines: placeItems(s.items).lines }));
      const plan = STRUCTURES.hiddenLotus.plan({ rng: mulberry32(5), title: page.title, sections, pitLines: 10, biome: shape });
      const spacing = canyonSpacing(shape);
      // Stems share sand near the Seedpod by design; beyond this every petal has its own walls.
      const clear = 1.2 * (spacing / ((((2 * Math.PI - (100 * Math.PI) / 180) / 8) * 0.5)));
      const petals = [...new Set(plan.tracks.map((t) => t.path))].map((p) =>
        p.xs.map((x, i) => [x, p.zs[i]] as const).filter(([x, z], i) => i % 2 === 0 && Math.hypot(x, z) > clear),
      );
      expect(petals.length).toBeGreaterThan(1);
      for (let i = 0; i < petals.length; i++) {
        for (let j = i + 1; j < petals.length; j++) {
          let min = Infinity;
          for (const [ax, az] of petals[i]) for (const [bx, bz] of petals[j]) min = Math.min(min, Math.hypot(ax - bx, az - bz));
          expect(min, `${biome}: petals ${i} and ${j}`).toBeGreaterThanOrEqual(spacing - 2);
        }
      }
    }
  }, 60_000);
});
