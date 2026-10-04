import { buildSections, CaveIndex, type Gate, type LinkSource, type ParsedPage, type Span, type WorldLayout } from '@isle-of-wiki/shared';
import { FolioMap, type MapLabel, type MapPose } from './FolioMap';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

/** The cave id a DOM event happened on (a link in the text), if any. */
function gateOf(target: EventTarget | null): number | null {
  const el = target instanceof Element ? target.closest<HTMLElement>('[data-gate]') : null;
  return el ? Number(el.dataset.gate) : null;
}

/**
 * Folio — the article map overlay (Tab). Left: the article, every link clickable. Right: the
 * track from above with every cave. Hovering either side lights up the other; clicking picks
 * that cave as your Thread. Opening Folio pauses nothing: the world keeps running behind it.
 */
export class Folio {
  onSelect: (gate: Gate) => void = () => {};
  onClose: () => void = () => {};
  private readonly root = $('folio');
  private readonly title = $('folio-title');
  private readonly hint = $('folio-hint');
  private readonly text = $('folio-text');
  private readonly map: FolioMap;
  private gates: Gate[] = [];
  /** Text elements standing for each cave (usually one; a link without its own cave borrows one). */
  private links = new Map<number, HTMLElement[]>();
  private hovered: number | null = null;
  private selected: number | null = null;
  private open_ = false;

  constructor() {
    this.map = new FolioMap($('folio-map') as HTMLCanvasElement);
    this.map.onHover = (id) => this.hover(id, true);
    this.map.onPick = (id) => this.pick(id);
    this.text.addEventListener('mouseover', (e) => this.hover(gateOf(e.target), false));
    this.text.addEventListener('mouseleave', () => this.hover(null, false));
    this.text.addEventListener('click', (e) => {
      const id = gateOf(e.target);
      if (id === null) return;
      e.preventDefault();
      this.pick(id);
    });
    $('folio-close').addEventListener('click', () => this.onClose());
    $('folio-zoom-in').addEventListener('click', () => this.map.zoomBy(2));
    $('folio-zoom-out').addEventListener('click', () => this.map.zoomBy(0.5));
    $('folio-zoom-fit').addEventListener('click', () => this.map.fitView());
    window.addEventListener('keydown', (e) => {
      if (this.open_ && e.code === 'Escape') this.onClose();
    });
    window.addEventListener('resize', () => {
      if (this.open_) this.map.resize();
    });
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** Rebuilds the text and map for a newly entered page; `target` is the race's target article. */
  setWorld(page: ParsedPage, layout: WorldLayout, target: string): void {
    this.gates = layout.gates;
    this.links = new Map();
    this.hovered = null;
    this.selected = null;
    this.title.textContent = page.title;

    const caves = new CaveIndex(layout.gates);
    this.map.setWorld(layout, target, mapLabels(page, layout, caves));
    const spans = (list: Span[], source: (span: number) => LinkSource): DocumentFragment => {
      const frag = document.createDocumentFragment();
      list.forEach((s, i) => {
        if (!s.link) {
          frag.append(s.text);
          return;
        }
        const gate = caves.forLink(source(i), s.link);
        if (!gate) {
          frag.append(Object.assign(document.createElement('span'), { className: 'folio-dead', textContent: s.text }));
          return;
        }
        const a = Object.assign(document.createElement('a'), { href: '#', className: 'folio-link', textContent: s.text, title: gate.target });
        a.dataset.gate = String(gate.id);
        if (gate.target === target) a.classList.add('is-target');
        const els = this.links.get(gate.id);
        if (els) els.push(a);
        else this.links.set(gate.id, [a]);
        frag.append(a);
      });
      return frag;
    };

    const out = document.createDocumentFragment();
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => {
      const e = document.createElement(tag);
      if (className) e.className = className;
      out.append(e);
      return e;
    };

    if (page.infobox?.length) {
      const box = el('div', 'folio-infobox');
      box.append(Object.assign(document.createElement('strong'), { textContent: 'Pit lane' }));
      page.infobox.forEach((row, r) => {
        const line = document.createElement('div');
        if (row.header) line.className = 'folio-infobox-header';
        if (row.label) line.append(Object.assign(document.createElement('em'), { textContent: `${row.label} ` }));
        line.append(spans(row.spans, (span) => ({ kind: 'infobox', row: r, span })));
        box.append(line);
      });
    }
    page.blocks.forEach((b, block) => {
      switch (b.kind) {
        case 'heading':
          el(b.level <= 2 ? 'h3' : 'h4').textContent = b.text;
          break;
        case 'paragraph': {
          const p = el('p');
          if (b.indent) p.style.paddingLeft = `${b.indent * 1.2}em`;
          if (b.bullet) p.append(`${b.bullet} `);
          p.append(spans(b.spans, (span) => ({ kind: 'block', block, span })));
          break;
        }
        case 'image':
          if (b.caption) el('p', 'folio-aside').textContent = `▣ ${b.caption}`;
          break;
        case 'table':
          el('p', 'folio-aside').textContent = `▦ Table${b.caption ? `: ${b.caption}` : ''}`;
          break;
      }
    });
    this.text.replaceChildren(out);
    this.text.scrollTop = 0;
    this.updateHint();
  }

  /** Marks the cave chosen as the Thread (or none). */
  setSelected(id: number | null): void {
    for (const a of this.links.get(this.selected ?? -1) ?? []) a.classList.remove('selected');
    this.selected = id;
    for (const a of this.links.get(id ?? -1) ?? []) a.classList.add('selected');
    this.map.setSelected(id);
    this.updateHint();
  }

  open(): void {
    this.open_ = true;
    this.root.classList.remove('hidden');
    this.map.resize();
    const first = this.links.get(this.selected ?? -1)?.[0];
    first?.scrollIntoView({ block: 'center' });
  }

  close(): void {
    this.open_ = false;
    this.hover(null, false);
    this.root.classList.add('hidden');
  }

  /** Redraws the map (the world keeps moving while Folio is open). */
  update(you: MapPose | null): void {
    if (this.open_) this.map.draw(you);
  }

  private hover(id: number | null, fromMap: boolean): void {
    if (id === this.hovered) return;
    for (const a of this.links.get(this.hovered ?? -1) ?? []) a.classList.remove('hover');
    this.hovered = id;
    const els = this.links.get(id ?? -1) ?? [];
    for (const a of els) a.classList.add('hover');
    this.map.setHovered(id);
    if (fromMap) els[0]?.scrollIntoView({ block: 'nearest' });
  }

  private pick(id: number): void {
    const gate = this.gates[id];
    if (gate) this.onSelect(gate);
  }

  private updateHint(): void {
    const g = this.selected !== null ? this.gates[this.selected] : null;
    this.hint.textContent = g ? `Thread → ${g.target}` : 'Click a link or a cave to choose where to go';
  }
}

/**
 * Place names for the map: the page title over the Seedpod and each section's title at the
 * middle of its own caves. (Several sections can share one canyon, so a canyon's midpoint
 * would stack their names; the caves show where each section actually runs.)
 */
function mapLabels(page: ParsedPage, layout: WorldLayout, index: CaveIndex): MapLabel[] {
  const labels: MapLabel[] = [];
  const mid = (path: [number, number][]): [number, number] => path[Math.floor(path.length / 2)];
  const arena = layout.regions.find((r) => r.kind === 'arena');
  if (arena?.path.length) {
    const n = arena.path.length;
    const [x, z] = arena.path.reduce(([ax, az], [px, pz]) => [ax + px / n, az + pz / n], [0, 0]);
    labels.push({ text: page.title, x, z });
  }
  buildSections(page).forEach((s, i) => {
    // The lead (text before the first heading) carries the page title, already over the Seedpod.
    const section = s.block < 0 ? { ...s, title: 'Introduction' } : s;
    const caves = section.items.flatMap((it) => (it.t === 'para' ? it.links : [])).flatMap((l) => index.exact(l.source) ?? []);
    if (caves.length) {
      const g = caves[Math.floor(caves.length / 2)];
      labels.push({ text: section.title, x: g.center[0], z: g.center[2] });
      return;
    }
    const region = layout.regions.find((r) => r.kind === 'section' && r.section === i);
    if (region?.path.length) {
      const [x, z] = mid(region.path);
      labels.push({ text: section.title, x, z });
    }
  });
  return labels;
}
