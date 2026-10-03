import { LAYOUT as L } from '../constants';
import type { ImageBlock, ParsedPage, TableBlock } from '../wiki/types';
import type { LinkSource } from './types';

/**
 * Article → sections → a flow of slots along each section's canyon.
 * Text is no longer painted on the ground (Folio shows the article); what the canyon
 * needs from the article is *where its links are*, in order, so caves appear in reading
 * order and Folio can point at them.
 */

export interface LinkRef {
  target: string;
  source: LinkSource;
}

export type FlowItem =
  /** A paragraph or list item: one cave per link, spread over a few slots. */
  | { t: 'para'; links: LinkRef[] }
  /** Breathing room between paragraphs (sometimes gets a hop-over rock). */
  | { t: 'gap' }
  /** Sub-heading (h3+) shown on an overhead banner across the canyon. */
  | { t: 'banner'; text: string }
  /** Tables become boulder fields. */
  | { t: 'table'; table: TableBlock }
  /** Takes no space; becomes a painting on a nearby trackside board. */
  | { t: 'image'; image: ImageBlock };

export interface Section {
  title: string;
  /** Index into ParsedPage.blocks of the heading that starts it (-1 for the lead). */
  block: number;
  items: FlowItem[];
}

export interface PlacedItem {
  item: FlowItem;
  /** First slot along the canyon this item occupies. */
  line: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const tableRows = (t: TableBlock): number => clamp(t.rows, 2, 6);

export function itemLines(it: FlowItem): number {
  switch (it.t) {
    case 'para':
      return Math.max(1, Math.ceil(it.links.length * L.slotsPerLink));
    case 'gap':
      return 1;
    case 'banner':
      return 2;
    case 'table':
      return tableRows(it.table);
    case 'image':
      return 0;
  }
}

/** Greedy word wrap on a fixed character grid (used for multi-line signs). */
export function wrapCells<T extends { c: string }>(cells: T[], width: number): T[][] {
  const lines: T[][] = [];
  let i = 0;
  while (i < cells.length) {
    while (i < cells.length && cells[i].c === ' ') i++;
    if (i >= cells.length) break;
    let end = Math.min(i + width, cells.length);
    if (end < cells.length && cells[end].c !== ' ') {
      let j = end - 1;
      while (j > i && cells[j].c !== ' ') j--;
      if (j > i) end = j;
    }
    const line = cells.slice(i, end);
    while (line.length && line[line.length - 1].c === ' ') line.pop();
    lines.push(line);
    i = end;
  }
  return lines;
}

export function buildSections(page: ParsedPage): Section[] {
  const sections: Section[] = [];
  let cur: Section = { title: page.title, block: -1, items: [] };
  let lastWasList = false;
  const hasContent = (s: Section) => s.items.some((it) => it.t !== 'gap');
  const gap = () => {
    const last = cur.items[cur.items.length - 1];
    if (last && last.t !== 'gap') cur.items.push({ t: 'gap' });
  };

  page.blocks.forEach((b, block) => {
    switch (b.kind) {
      case 'heading':
        if (b.level <= 2) {
          if (hasContent(cur)) sections.push(cur);
          cur = { title: b.text, block, items: [] };
        } else {
          gap();
          cur.items.push({ t: 'banner', text: b.text });
        }
        lastWasList = false;
        break;
      case 'paragraph': {
        const isList = !!b.bullet;
        if (!(isList && lastWasList)) gap();
        const links: LinkRef[] = [];
        b.spans.forEach((s, span) => {
          if (s.link && s.text.trim()) links.push({ target: s.link, source: { kind: 'block', block, span } });
        });
        cur.items.push({ t: 'para', links });
        lastWasList = isList;
        break;
      }
      case 'table':
        gap();
        cur.items.push({ t: 'table', table: b });
        lastWasList = false;
        break;
      case 'image':
        cur.items.push({ t: 'image', image: b });
        break;
    }
  });
  if (hasContent(cur)) sections.push(cur);

  for (const s of sections) {
    while (s.items.length && s.items[s.items.length - 1].t === 'gap') s.items.pop();
  }
  return sections;
}

/** Infobox links in reading order (they become gates in the Seedpod's grandstand). */
export function infoboxLinks(page: ParsedPage): LinkRef[] {
  const out: LinkRef[] = [];
  (page.infobox ?? []).forEach((r, row) =>
    r.spans.forEach((s, span) => {
      if (s.link && s.text.trim()) out.push({ target: s.link, source: { kind: 'infobox', row, span } });
    }),
  );
  return out;
}

/** Assigns each item its first slot along the canyon; returns the total slot count. */
export function placeItems(items: FlowItem[]): { placed: PlacedItem[]; lines: number } {
  const placed: PlacedItem[] = [];
  let line = 0;
  for (const item of items) {
    placed.push({ item, line });
    line += itemLines(item);
  }
  return { placed, lines: line };
}
