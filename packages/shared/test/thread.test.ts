import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { buildSections, CaveIndex, infoboxLinks, layoutPage, parseArticle, threadGuide, type Vec2 } from '../src';

const html = readFileSync(new URL('./fixtures/podracing.html', import.meta.url), 'utf8');
const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
const page = parseArticle('List of Star Wars air, aquatic, and ground vehicles', (document.querySelector('.mw-parser-output') ?? document.body) as unknown as Element);

describe('Thread guide', () => {
  const NORTH: Vec2 = [0, -1];

  it('measures straight-line, ground and height distance', () => {
    const g = threadGuide([0, 10, 0], NORTH, [3, 22, -4]);
    expect(g.ground).toBeCloseTo(5);
    expect(g.climb).toBeCloseTo(12);
    expect(g.distance).toBeCloseTo(13);
  });

  it('turns right for a cave to the east and left for one to the west when facing north', () => {
    expect(threadGuide([0, 0, 0], NORTH, [10, 0, 0]).turn).toBeCloseTo(Math.PI / 2);
    expect(threadGuide([0, 0, 0], NORTH, [-10, 0, 0]).turn).toBeCloseTo(-Math.PI / 2);
  });

  it('says 0 straight ahead and ±π straight behind, whatever the heading length', () => {
    expect(threadGuide([5, 0, 5], [0, -0.01], [5, 0, -50]).turn).toBeCloseTo(0);
    expect(Math.abs(threadGuide([5, 0, 5], [0, -7], [5, 0, 50]).turn)).toBeCloseTo(Math.PI);
  });

  it('works for any heading: facing east, a cave to the south is a right turn', () => {
    expect(threadGuide([0, 0, 0], [1, 0], [0, 0, 10]).turn).toBeCloseTo(Math.PI / 2);
  });

  it('reports no turn when looking straight down or standing on the cave', () => {
    expect(threadGuide([0, 0, 0], [0, 0], [10, 0, 0]).turn).toBe(0);
    expect(threadGuide([1, 5, 1], NORTH, [1, 0, 1]).turn).toBe(0);
  });
});

describe('CaveIndex (Folio link → cave)', () => {
  const layout = layoutPage(page, { roomSeed: 7, biome: 'dune', structure: 'hiddenLotus' });
  const index = new CaveIndex(layout.gates);

  it('finds the exact cave for every link in the article text', () => {
    const links = buildSections(page).flatMap((s) => s.items.flatMap((it) => (it.t === 'para' ? it.links : [])));
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      const g = index.forLink(l.source, l.target);
      expect(g?.source).toEqual(l.source);
      expect(g?.target).toBe(l.target);
    }
  });

  it('gives every infobox link a cave to the same page (its own when the pit lane had room)', () => {
    for (const l of infoboxLinks(page)) {
      const g = index.forLink(l.source, l.target);
      if (g) expect(g.target).toBe(l.target);
      if (index.exact(l.source)) expect(g?.source).toEqual(l.source);
    }
  });

  it('returns nothing for a link with no cave and no other cave to its page', () => {
    expect(index.forLink({ kind: 'block', block: 99999, span: 0 }, 'No such article anywhere')).toBeNull();
  });
});
