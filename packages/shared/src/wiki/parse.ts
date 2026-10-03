import type { Block, ImageBlock, InfoboxRow, ParsedPage, Span } from './types';

/**
 * Turns Wikipedia's rendered article HTML (action=parse output) into blocks.
 * Works on any standard DOM: the browser's DOMParser or linkedom on the server.
 */

const SKIP_TAGS = new Set(['style', 'script', 'link', 'meta', 'noscript', 'math']);

const SKIP_CLASSES = [
  'mw-editsection',
  'reference',
  'mw-ref',
  'navbox',
  'navbox-styles',
  'reflist',
  'references',
  'mw-references-wrap',
  'metadata',
  'ambox',
  'sistersitebox',
  'mw-empty-elt',
  'shortdescription',
  'noprint',
  'toc',
  'catlinks',
  'sidebar',
  'side-box',
  'vertical-navbox',
  'authority-control',
  'refbegin',
  'mw-cite-backlink',
  'portalbox',
  'mbox-small',
];

/** Sections that are reference material, not article content. */
const SKIP_SECTIONS = new Set([
  'references',
  'external links',
  'further reading',
  'notes',
  'citations',
  'sources',
  'bibliography',
  'footnotes',
  'works cited',
  'notes and references',
  'general and cited references',
  'explanatory notes',
]);

/** Non-article namespaces; links into these are not race routes. */
const NAMESPACES = new Set([
  'file',
  'image',
  'media',
  'special',
  'talk',
  'user',
  'wikipedia',
  'wp',
  'project',
  'help',
  'category',
  'template',
  'portal',
  'module',
  'mediawiki',
  'draft',
  'timedtext',
  'book',
  'gadget',
  'wikt',
  'wiktionary',
]);

const BLOCK_TAGS = new Set([
  'p', 'ul', 'ol', 'dl', 'table', 'div', 'figure', 'blockquote', 'section',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

interface Ctx {
  blocks: Block[];
  infobox: InfoboxRow[] | null;
  skippingSection: boolean;
}

interface InlineOpts {
  /** Include list items inline (used for infobox values). */
  flattenLists?: boolean;
}

const tagOf = (el: Element): string => el.tagName.toLowerCase();
const childEls = (el: Element): Element[] => Array.from(el.children);

function shouldSkip(el: Element): boolean {
  if (SKIP_TAGS.has(tagOf(el))) return true;
  const cl = el.classList;
  for (const c of SKIP_CLASSES) if (cl.contains(c)) return true;
  const style = el.getAttribute('style');
  return !!style && /display\s*:\s*none/i.test(style);
}

/** Article title an <a> points to, or undefined if it is not a race-valid article link. */
export function linkTarget(a: Element): string | undefined {
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/wiki/')) return undefined;
  if (a.classList.contains('extiw') || a.classList.contains('new')) return undefined;
  let raw = href.slice('/wiki/'.length);
  const hash = raw.indexOf('#');
  if (hash >= 0) raw = raw.slice(0, hash);
  if (!raw) return undefined;
  let title: string;
  try {
    title = decodeURIComponent(raw);
  } catch {
    title = raw;
  }
  title = title.replace(/_/g, ' ').trim();
  const colon = title.indexOf(':');
  if (colon > 0) {
    const ns = title.slice(0, colon).trim().toLowerCase();
    if (NAMESPACES.has(ns) || ns.endsWith(' talk')) return undefined;
  }
  return title || undefined;
}

function appendSpan(out: Span[], text: string, link: string | undefined): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.link === link) last.text += text;
  else out.push(link ? { text, link } : { text });
}

function mathText(el: Element): string {
  const alt = el.querySelector('img')?.getAttribute('alt') ?? el.textContent ?? '';
  const m = /^\{\\displaystyle\s*([\s\S]*)\}$/.exec(alt.trim());
  return ` ${m ? m[1] : alt} `;
}

function collectInline(node: Element, out: Span[], link: string | undefined, opts: InlineOpts): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      appendSpan(out, child.textContent ?? '', link);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (shouldSkip(el)) continue;
    const tag = tagOf(el);
    if (tag === 'br') {
      appendSpan(out, ' ', link);
    } else if (el.classList.contains('mwe-math-element')) {
      appendSpan(out, mathText(el), link);
    } else if (tag === 'ul' || tag === 'ol' || tag === 'dl') {
      if (opts.flattenLists) collectInline(el, out, link, opts);
    } else if (tag === 'li' || tag === 'dt' || tag === 'dd') {
      appendSpan(out, ' ', link);
      collectInline(el, out, link, opts);
      appendSpan(out, ' ', link);
    } else if (tag === 'table' || tag === 'figure' || el.classList.contains('thumb')) {
      continue;
    } else if (tag === 'a') {
      collectInline(el, out, link ?? linkTarget(el), opts);
    } else {
      collectInline(el, out, link, opts);
    }
  }
}

/** Collapses whitespace across span boundaries and trims the ends. */
function normalizeSpans(spans: Span[]): Span[] {
  const res: Span[] = [];
  let prevSpace = true;
  for (const s of spans) {
    let t = s.text.replace(/\s+/g, ' ');
    if (prevSpace) t = t.replace(/^ /, '');
    if (!t) continue;
    prevSpace = t.endsWith(' ');
    appendSpan(res, t, s.link);
  }
  while (res.length) {
    const last = res[res.length - 1];
    last.text = last.text.replace(/ $/, '');
    if (last.text) break;
    res.pop();
  }
  return res;
}

function inlineSpans(el: Element, opts: InlineOpts = {}): Span[] {
  const out: Span[] = [];
  collectInline(el, out, undefined, opts);
  return normalizeSpans(out);
}

function plainText(el: Element | null): string {
  if (!el) return '';
  return inlineSpans(el).map((s) => s.text).join('');
}

function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('')}…`;
}

function pushParagraph(el: Element, indent: number, ctx: Ctx, bullet?: string): void {
  const spans = inlineSpans(el);
  if (!spans.length) return;
  ctx.blocks.push(bullet ? { kind: 'paragraph', spans, indent, bullet } : { kind: 'paragraph', spans, indent });
}

function parseList(list: Element, indent: number, ctx: Ctx): void {
  const ordered = tagOf(list) === 'ol';
  let n = 0;
  for (const li of childEls(list)) {
    if (tagOf(li) !== 'li' || shouldSkip(li)) continue;
    n++;
    pushParagraph(li, indent, ctx, ordered ? `${n}.` : '•');
    for (const sub of childEls(li)) {
      const t = tagOf(sub);
      if (t === 'ul' || t === 'ol') parseList(sub, indent + 1, ctx);
      else if (t === 'dl') parseDl(sub, indent + 1, ctx);
    }
  }
}

function parseDl(dl: Element, indent: number, ctx: Ctx): void {
  for (const item of childEls(dl)) {
    if (shouldSkip(item)) continue;
    const t = tagOf(item);
    if (t === 'dt') pushParagraph(item, indent, ctx);
    else if (t === 'dd') {
      pushParagraph(item, indent + 1, ctx);
      for (const sub of childEls(item)) {
        const st = tagOf(sub);
        if (st === 'ul' || st === 'ol') parseList(sub, indent + 2, ctx);
        else if (st === 'dl') parseDl(sub, indent + 2, ctx);
      }
    }
  }
}

function ownRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table);
}

function parseInfobox(table: Element): InfoboxRow[] {
  const rows: InfoboxRow[] = [];
  for (const tr of ownRows(table)) {
    const cells = childEls(tr).filter((c) => (tagOf(c) === 'th' || tagOf(c) === 'td') && !shouldSkip(c));
    if (!cells.length) continue;
    const th = cells.find((c) => tagOf(c) === 'th');
    const td = cells.find((c) => tagOf(c) === 'td');
    if (th && td) {
      const spans = inlineSpans(td, { flattenLists: true });
      if (spans.length) rows.push({ label: plainText(th), spans });
    } else {
      const only = cells[0];
      const spans = inlineSpans(only, { flattenLists: true });
      if (!spans.length) continue;
      const header =
        tagOf(only) === 'th' || only.classList.contains('infobox-above') || only.classList.contains('infobox-header');
      rows.push(header ? { spans, header } : { spans });
    }
    if (rows.length >= 40) break;
  }
  return rows;
}

function parseTable(el: Element, ctx: Ctx): void {
  if (el.classList.contains('infobox')) {
    if (!ctx.infobox) {
      const rows = parseInfobox(el);
      if (rows.length) ctx.infobox = rows;
      const imageCell = el.querySelector('.infobox-image');
      if (imageCell?.querySelector('img')) {
        ctx.blocks.push(imageBlock(imageCell, plainText(imageCell.querySelector('.infobox-caption'))));
      }
    }
    return;
  }
  const trs = ownRows(el);
  if (!trs.length) return;
  let cols = 0;
  for (const tr of trs) {
    cols = Math.max(cols, childEls(tr).filter((c) => tagOf(c) === 'th' || tagOf(c) === 'td').length);
  }
  ctx.blocks.push({ kind: 'table', rows: trs.length, cols, caption: truncate(plainText(el.querySelector('caption')), 80) });
}

function imageBlock(el: Element, caption: string): ImageBlock {
  const img = el.querySelector('img');
  const rawSrc = img?.getAttribute('src') ?? '';
  const src = rawSrc.startsWith('//') ? `https:${rawSrc}` : rawSrc.startsWith('https://') ? rawSrc : undefined;
  const w = Number(img?.getAttribute('width'));
  const h = Number(img?.getAttribute('height'));
  const aspect = w > 0 && h > 0 ? w / h : 4 / 3;
  const block: ImageBlock = { kind: 'image', caption: truncate(caption, 80), aspect };
  if (src) block.src = src;
  return block;
}

function pushImage(el: Element, ctx: Ctx): void {
  const cap = el.querySelector('figcaption') ?? el.querySelector('.thumbcaption') ?? el.querySelector('.gallerytext');
  ctx.blocks.push(imageBlock(el, plainText(cap)));
}

function hasBlockChild(el: Element): boolean {
  return childEls(el).some((c) => BLOCK_TAGS.has(tagOf(c)));
}

function walk(container: Element, ctx: Ctx): void {
  for (const el of childEls(container)) {
    const tag = tagOf(el);
    const cl = el.classList;

    const heading = cl.contains('mw-heading')
      ? el.querySelector('h1,h2,h3,h4,h5,h6')
      : /^h[1-6]$/.test(tag)
        ? el
        : null;
    if (heading) {
      const level = Number(tagOf(heading)[1]);
      const text = plainText(heading);
      if (level <= 2) ctx.skippingSection = SKIP_SECTIONS.has(text.toLowerCase());
      if (!ctx.skippingSection && text) ctx.blocks.push({ kind: 'heading', level, text });
      continue;
    }
    if (ctx.skippingSection || shouldSkip(el)) continue;

    if (tag === 'p') pushParagraph(el, 0, ctx);
    else if ((tag === 'ul' || tag === 'ol') && cl.contains('gallery')) {
      childEls(el)
        .filter((li) => li.classList.contains('gallerybox'))
        .slice(0, 4)
        .forEach((li) => pushImage(li, ctx));
    } else if (tag === 'ul' || tag === 'ol') parseList(el, 0, ctx);
    else if (tag === 'dl') parseDl(el, 0, ctx);
    else if (tag === 'table') parseTable(el, ctx);
    else if (tag === 'figure' || cl.contains('thumb')) pushImage(el, ctx);
    else if (hasBlockChild(el)) walk(el, ctx);
    else pushParagraph(el, 0, ctx);
  }
}

export function parseArticle(title: string, root: Element): ParsedPage {
  const ctx: Ctx = { blocks: [], infobox: null, skippingSection: false };
  walk(root, ctx);

  const links = new Set<string>();
  const addLinks = (spans: Span[]) => spans.forEach((s) => s.link && links.add(s.link));
  for (const b of ctx.blocks) if (b.kind === 'paragraph') addLinks(b.spans);
  ctx.infobox?.forEach((r) => addLinks(r.spans));

  return { title, blocks: ctx.blocks, infobox: ctx.infobox, linkCount: links.size };
}
