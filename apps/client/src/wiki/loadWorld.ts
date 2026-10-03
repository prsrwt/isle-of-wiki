import { parseArticle, type ParsedPage, type WorldLayout, type WorldSpec } from '@isle-of-wiki/shared';
import type { LayoutRequest, LayoutResponse } from '../atlas/layout.worker';

export interface LoadedWorld {
  page: ParsedPage;
  layout: WorldLayout;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (l: WorldLayout) => void; reject: (e: Error) => void }>();

function layoutWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../atlas/layout.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<LayoutResponse>) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    if ('error' in e.data) job.reject(new Error(e.data.error));
    else job.resolve(e.data.layout);
  };
  return worker;
}

/** Generates the track in the Atlas worker (deterministic: identical to running layoutPage here). */
function layoutOffThread(page: ParsedPage, spec: WorldSpec): Promise<WorldLayout> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const request: LayoutRequest = { id, page, spec };
    layoutWorker().postMessage(request);
  });
}

/**
 * Parse (main thread, needs the DOM) → layout (worker) for the Guestbook's world spec.
 * Fetch the article first (fetchArticleHtml) so the Guestbook can sign its *canonical*
 * title — two links to one article ("USA", "United States") must give the same world.
 */
export async function loadWorld(article: { title: string; html: string }, spec: WorldSpec): Promise<LoadedWorld> {
  const { title: canonical, html } = article;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('.mw-parser-output') ?? doc.body;
  const page = parseArticle(canonical, root);
  return { page, layout: await layoutOffThread(page, spec) };
}
