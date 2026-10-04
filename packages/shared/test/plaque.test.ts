import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { layoutPage, parseArticle, plaqueLines, wrapLines } from '../src';

describe('Cave name plaques', () => {
  it('wraps at word boundaries and only splits words that are too long', () => {
    expect(wrapLines('Foundation for Environmental Education', 16, 3)).toEqual(['Foundation for', 'Environmental', 'Education']);
    expect(wrapLines('Supercalifragilistic', 8, 3)).toEqual(['Supercal', 'ifragili', 'stic']);
    expect(wrapLines('one two three four', 5, 2)).toBeNull();
  });

  it('keeps short names on one big line and wraps long ones instead of cutting them', () => {
    expect(plaqueLines('Jabba the Hutt', 9.5).lines).toEqual(['Jabba the Hutt']);
    const long = plaqueLines('Foundation for Environmental Education', 9.5);
    expect(long.lines.join(' ')).toBe('Foundation for Environmental Education');
    expect(long.lines.length).toBeGreaterThan(1);
  });

  it('shows every cave name on a real page in full', () => {
    const html = readFileSync(new URL('./fixtures/podracing.html', import.meta.url), 'utf8');
    const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
    const page = parseArticle('List of Star Wars air, aquatic, and ground vehicles', (document.querySelector('.mw-parser-output') ?? document.body) as unknown as Element);
    const layout = layoutPage(page, { roomSeed: 42, biome: 'dune', structure: 'hiddenLotus' });
    const signs = layout.texts.filter((t) => t.style === 'sign').map((t) => t.text);
    for (const g of layout.gates) {
      // Every word of the name appears on some sign line, and nothing was cut with an ellipsis.
      for (const word of g.target.split(/\s+/)) expect(signs.some((s) => s.includes(word.slice(0, 8)))).toBe(true);
    }
    expect(signs.some((s) => s.includes('…') && layout.gates.some((g) => g.target.startsWith(s.slice(0, -1))))).toBe(false);
  });
});
