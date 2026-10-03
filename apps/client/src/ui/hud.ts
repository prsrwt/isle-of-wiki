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
  private lastGate: string | null = null;

  setPage(page: string, target: string): void {
    this.page.textContent = page;
    this.target.textContent = target;
    this.root.classList.remove('hidden');
  }

  setGate(target: string | null): void {
    if (target === this.lastGate) return;
    this.lastGate = target;
    this.gate.classList.toggle('hidden', !target);
    this.gate.textContent = target ? `⟶ ${target}` : '';
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
