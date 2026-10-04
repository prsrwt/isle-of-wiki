import './style.css';
import { App } from './App';
import { Hud } from './ui/hud';
import { randomTitle, resolveTitle, suggestTitles } from './wiki/api';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const menu = document.getElementById('menu') as HTMLDivElement;
const form = document.getElementById('race-form') as HTMLFormElement;
const startInput = document.getElementById('start') as HTMLInputElement;
const targetInput = document.getElementById('target') as HTMLInputElement;
const goButton = document.getElementById('go') as HTMLButtonElement;
const randomButton = document.getElementById('random-start') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const openMenu = document.getElementById('open-menu') as HTMLButtonElement;
const finishExplore = document.getElementById('finish-explore') as HTMLButtonElement;
const finishAgain = document.getElementById('finish-again') as HTMLButtonElement;
const finishNew = document.getElementById('finish-new') as HTMLButtonElement;

const GRID_PROMPT = 'Click the world to start the countdown';
/** A fresh room each race: its seed decides which biome and structure every page becomes. */
const newRoomSeed = () => Math.floor(Math.random() * 2 ** 31);

const hud = new Hud();
const app = new App(canvas, hud);
if (import.meta.env.DEV) Object.assign(window, { iow: app });

function setStatus(text: string, error = false): void {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function attachSuggestions(input: HTMLInputElement, listId: string): void {
  const list = document.getElementById(listId) as HTMLDataListElement;
  let timer = 0;
  let seq = 0;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return;
    timer = window.setTimeout(async () => {
      const mine = ++seq;
      const titles = await suggestTitles(q).catch(() => []);
      if (mine !== seq) return;
      list.replaceChildren(...titles.map((t) => Object.assign(document.createElement('option'), { value: t })));
    }, 200);
  });
}

attachSuggestions(startInput, 'suggest-start');
attachSuggestions(targetInput, 'suggest-target');

randomButton.addEventListener('click', async () => {
  randomButton.disabled = true;
  try {
    startInput.value = await randomTitle();
  } catch (err) {
    setStatus((err as Error).message, true);
  } finally {
    randomButton.disabled = false;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  goButton.disabled = true;
  try {
    setStatus('Checking pages…');
    const [start, target] = await Promise.all([resolveTitle(startInput.value), resolveTitle(targetInput.value)]);
    if (start === target) throw new Error('Start and target are the same article');
    startInput.value = start;
    targetInput.value = target;
    setStatus(`Building "${start}"…`);
    await app.start({ start, target, roomSeed: newRoomSeed() });
    setStatus('');
    menu.classList.add('hidden');
    app.setInputEnabled(true);
    hud.setPaused(true, GRID_PROMPT);
  } catch (err) {
    setStatus((err as Error).message, true);
  } finally {
    goButton.disabled = false;
  }
});

function showMenu(): void {
  app.setInputEnabled(false);
  hud.setPaused(false);
  hud.hideFinish();
  menu.classList.remove('hidden');
  startInput.focus();
}

openMenu.addEventListener('click', showMenu);
finishNew.addEventListener('click', showMenu);
finishExplore.addEventListener('click', () => app.keepExploring());

// Same two pages, a new room: every page may become a different world this time.
finishAgain.addEventListener('click', async () => {
  const config = app.raceConfig;
  if (!config) return;
  finishAgain.disabled = true;
  hud.hideFinish();
  hud.setStatus(`Building "${config.start}"…`);
  try {
    await app.start({ ...config, roomSeed: newRoomSeed() });
    hud.setPaused(true, GRID_PROMPT);
  } catch (err) {
    setStatus((err as Error).message, true);
    showMenu();
  } finally {
    hud.setStatus(null);
    finishAgain.disabled = false;
  }
});
