import { formatRaceTime, type RaceResult } from '@isle-of-wiki/shared';

/** "340 m" or "1.2 km". */
export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

const RPM_CELLS = 16;

export class Hud {
  private readonly root = $('hud');
  private readonly page = $('hud-page');
  private readonly target = $('hud-target');
  private readonly gate = $('hud-gate');
  private readonly dash = $('hud-dash');
  private readonly rpm = $('hud-rpm');
  private readonly speed = $('hud-speed');
  private readonly speedArc = $('hud-speed-arc');
  private readonly boostFill = $('hud-boost-fill');
  private readonly info = $('hud-info');
  private readonly infoStats = $('hud-info-stats');
  private readonly rpmCells: HTMLElement[] = [];
  private lastDash = '';
  private readonly paused = $('paused');
  private readonly pausedText = $('paused-text');
  private readonly gnme = $('hud-gnme');
  private readonly status = $('hud-status');
  private readonly thread = $('hud-thread');
  private readonly threadArrow = $('hud-thread-arrow');
  private readonly threadName = $('hud-thread-name');
  private readonly threadDist = $('hud-thread-dist');
  private readonly threadMark = $('hud-thread-mark');
  private readonly threadMarkDist = $('hud-thread-mark-dist');
  private readonly race = $('hud-race');
  private readonly raceTime = $('hud-race-time');
  private readonly raceHops = $('hud-race-hops');
  private readonly countdown = $('hud-countdown');
  private readonly finish = $('finish');
  private readonly finishTime = $('finish-time');
  private readonly finishBest = $('finish-best');
  private readonly finishHops = $('finish-hops');
  private readonly finishPath = $('finish-path');
  private lastRace = '';
  private lastCountdown = '';
  private lastGate = '';
  private lastThread = '';
  private lastMark = '';

  setPage(page: string, target: string): void {
    this.page.textContent = page;
    this.target.textContent = target;
    this.root.classList.remove('hidden');
  }

  /**
   * The cave just ahead, or null. `isThread` when it's the one picked in Folio; `ready` when
   * you're close enough in front of it to travel through with J.
   */
  setGate(target: string | null, isThread = false, ready = false): void {
    const key = `${target ?? ''}|${isThread}|${ready}`;
    if (key === this.lastGate) return;
    this.lastGate = key;
    this.gate.classList.toggle('hidden', !target);
    this.gate.classList.toggle('is-thread', isThread);
    this.gate.classList.toggle('is-ready', ready);
    this.gate.replaceChildren();
    if (!target) return;
    this.gate.append(isThread ? `★ Your cave ⟶ ${target}` : `⟶ ${target}`);
    if (ready) this.gate.append(Object.assign(document.createElement('kbd'), { textContent: 'J' }), 'travel');
  }

  /**
   * Speed gauge (km/h, dial full at `topKmh`), RPM bar (0..1) and boost tank (0..1). Null hides
   * the dashboard (free-fly).
   */
  setDrive(d: { kmh: number; topKmh: number; rpm: number; boost: number; boosting: boolean; scraping: boolean } | null): void {
    if (!this.rpmCells.length) {
      for (let i = 0; i < RPM_CELLS; i++) this.rpmCells.push(this.rpm.appendChild(document.createElement('i')));
    }
    const lit = d ? Math.round(Math.min(1, Math.max(0, d.rpm)) * RPM_CELLS) : 0;
    const kmh = d ? Math.round(d.kmh) : 0;
    const boost = d ? Math.round(d.boost * 100) : 0;
    const key = d ? `${kmh}|${lit}|${boost}|${d.boosting}|${d.scraping}` : '';
    if (key === this.lastDash) return;
    this.lastDash = key;
    this.dash.classList.toggle('hidden', !d);
    if (!d) return;
    this.speed.textContent = String(kmh);
    this.speedArc.style.strokeDasharray = `${Math.min(100, (d.kmh / d.topKmh) * 100).toFixed(1)} 100`;
    this.rpmCells.forEach((c, i) => c.classList.toggle('on', i < lit));
    this.boostFill.style.width = `${boost}%`;
    this.dash.classList.toggle('is-boosting', d.boosting);
    this.dash.classList.toggle('is-scraping', d.scraping);
  }

  get infoOpen(): boolean {
    return !this.info.classList.contains('hidden');
  }

  toggleInfo(): void {
    this.info.classList.toggle('hidden');
  }

  /** Rows for the stats panel (H). */
  setInfo(rows: [string, string][]): void {
    this.infoStats.replaceChildren(
      ...rows.flatMap(([k, v]) => [
        Object.assign(document.createElement('dt'), { textContent: k }),
        Object.assign(document.createElement('dd'), { textContent: v }),
      ]),
    );
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

  /** The race clock and hop count; null hides them. `finished` freezes the clock in gold. */
  setRace(r: { timeMs: number; hops: number; finished: boolean } | null): void {
    const time = r ? formatRaceTime(r.timeMs) : '';
    const key = r ? `${time}|${r.hops}|${r.finished}` : '';
    if (key === this.lastRace) return;
    this.lastRace = key;
    this.race.classList.toggle('hidden', !r);
    if (!r) return;
    this.raceTime.textContent = time;
    this.raceHops.textContent = `${r.hops} ${r.hops === 1 ? 'hop' : 'hops'}`;
    this.race.classList.toggle('is-finished', r.finished);
  }

  /** The big countdown: "3", "2", "1", "GO!" or "" to hide. Each new word pops in. */
  setCountdown(text: string): void {
    if (text === this.lastCountdown) return;
    this.lastCountdown = text;
    this.countdown.classList.toggle('hidden', !text);
    this.countdown.textContent = text;
    this.countdown.classList.toggle('is-go', text === 'GO!');
    // Restart the pop animation.
    this.countdown.style.animation = 'none';
    void this.countdown.offsetWidth;
    this.countdown.style.animation = '';
  }

  /** The finish card: time, hops, the path taken, and the best time for these two pages. */
  showFinish(result: RaceResult, bestMs: number | null): void {
    this.finishTime.textContent = formatRaceTime(result.timeMs);
    const isBest = bestMs === null || result.timeMs <= bestMs;
    this.finishBest.textContent = isBest ? 'New best for this race!' : `Best ${formatRaceTime(bestMs)}`;
    this.finishBest.classList.toggle('is-best', isBest);
    this.finishHops.textContent = `${result.hops} ${result.hops === 1 ? 'hop' : 'hops'}`;
    this.finishPath.replaceChildren(...result.path.map((page) => Object.assign(document.createElement('li'), { textContent: page })));
    this.finish.classList.remove('hidden');
  }

  hideFinish(): void {
    this.finish.classList.add('hidden');
  }

  get finishOpen(): boolean {
    return !this.finish.classList.contains('hidden');
  }

  /** Hides the cave callout, Thread and dashboard while travelling through a link tunnel. */
  setInTunnel(on: boolean): void {
    this.root.classList.toggle('in-tunnel', on);
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

  /** The "click to drive" bar; `text` changes its prompt (e.g. on the starting grid). */
  setPaused(paused: boolean, text = 'Click the world to drive'): void {
    this.paused.classList.toggle('hidden', !paused);
    this.pausedText.textContent = text;
  }
}
