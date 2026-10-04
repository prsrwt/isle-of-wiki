/** "340 m" or "1.2 km". */
export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

export class Hud {
  private readonly root = $('hud');
  private readonly page = $('hud-page');
  private readonly target = $('hud-target');
  private readonly gate = $('hud-gate');
  private readonly stats = $('hud-stats');
  private readonly paused = $('paused');
  private readonly gnme = $('hud-gnme');
  private readonly status = $('hud-status');
  private readonly thread = $('hud-thread');
  private readonly threadArrow = $('hud-thread-arrow');
  private readonly threadName = $('hud-thread-name');
  private readonly threadDist = $('hud-thread-dist');
  private readonly threadMark = $('hud-thread-mark');
  private readonly threadMarkDist = $('hud-thread-mark-dist');
  private lastGate = '';
  private lastThread = '';
  private lastMark = '';

  setPage(page: string, target: string): void {
    this.page.textContent = page;
    this.target.textContent = target;
    this.root.classList.remove('hidden');
  }

  /** The cave just ahead, or null. `isThread` when it's the one picked in Folio. */
  setGate(target: string | null, isThread = false): void {
    const key = `${target ?? ''}|${isThread}`;
    if (key === this.lastGate) return;
    this.lastGate = key;
    this.gate.classList.toggle('hidden', !target);
    this.gate.classList.toggle('is-thread', isThread);
    this.gate.textContent = !target ? '' : isThread ? `★ Your cave ⟶ ${target}` : `⟶ ${target}`;
  }

  /**
   * The Thread chip: arrow turned `turn` radians from straight ahead (positive = right) and the
   * distance to the cave. Null hides it.
   */
  setThread(t: { name: string; distance: number; turn: number } | null): void {
    const deg = t ? Math.round((t.turn * 180) / Math.PI) : 0;
    const dist = t ? formatDistance(t.distance) : '';
    const key = t ? `${t.name}|${dist}|${deg}` : '';
    if (key === this.lastThread) return;
    this.lastThread = key;
    this.thread.classList.toggle('hidden', !t);
    if (!t) return;
    this.threadName.textContent = t.name;
    this.threadDist.textContent = dist;
    this.threadArrow.style.transform = `rotate(${deg}deg)`;
  }

  /** Marker over the Thread's cave at screen point (x, y) in CSS px, or null when it's out of view. */
  setThreadMark(at: { x: number; y: number; distance: number } | null): void {
    const key = at ? `${Math.round(at.x)},${Math.round(at.y)},${formatDistance(at.distance)}` : '';
    if (key === this.lastMark) return;
    this.lastMark = key;
    this.threadMark.classList.toggle('hidden', !at);
    if (!at) return;
    this.threadMark.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -100%)`;
    this.threadMarkDist.textContent = formatDistance(at.distance);
  }

  setStats(text: string): void {
    this.stats.textContent = text;
  }

  /** GNME's bedtime roll call, or null to hide it. */
  setGnme(lines: string[] | null): void {
    this.gnme.classList.toggle('hidden', !lines);
    if (!lines) return;
    const [summary, ...goodnights] = lines;
    this.gnme.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: 'Goodnight Moon Engine' }),
      Object.assign(document.createElement('span'), { textContent: summary }),
      ...goodnights.map((l) => Object.assign(document.createElement('em'), { textContent: l })),
    );
  }

  /** A short centred notice (e.g. "Jumping to Moon…"), or null to hide it. */
  setStatus(text: string | null): void {
    this.status.classList.toggle('hidden', !text);
    this.status.textContent = text ?? '';
  }

  setPaused(paused: boolean): void {
    this.paused.classList.toggle('hidden', !paused);
  }
}
