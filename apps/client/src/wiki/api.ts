/** Thin client for the public Wikipedia Action API (CORS-enabled via origin=*). */

const API = 'https://en.wikipedia.org/w/api.php';
const HEADERS = { 'Api-User-Agent': 'IsleOfWiki/0.1 (Wikipedia pod racing game)' };

interface ApiError {
  error?: { code: string; info: string };
}

async function getJson<T>(params: Record<string, string>): Promise<T & ApiError> {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('origin', '*');
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Wikipedia request failed (HTTP ${res.status})`);
  return (await res.json()) as T & ApiError;
}

interface QueryPagesResponse {
  query?: { pages: { title: string; ns: number; missing?: boolean; invalid?: boolean }[] };
}

/** Canonical article title after following redirects. Throws if it is not an existing article. */
export async function resolveTitle(title: string): Promise<string> {
  const data = await getJson<QueryPagesResponse>({ action: 'query', titles: title.trim(), redirects: '1' });
  const page = data.query?.pages[0];
  if (!page || page.missing || page.invalid) throw new Error(`No Wikipedia article named "${title}"`);
  if (page.ns !== 0) throw new Error(`"${page.title}" is not an article`);
  return page.title;
}

interface ParseResponse {
  parse?: { title: string; text: string };
}

/** Recently fetched articles, so revisiting a page (or one prefetched when you pull up at its cave) costs no download. */
const ARTICLE_CACHE_SIZE = 24;
const articleCache = new Map<string, Promise<{ title: string; html: string }>>();

/** Rendered article body HTML (cached per session). */
export function fetchArticleHtml(title: string): Promise<{ title: string; html: string }> {
  const key = title.trim().toLowerCase();
  const hit = articleCache.get(key);
  if (hit) {
    // Refresh its place in the least-recently-used order.
    articleCache.delete(key);
    articleCache.set(key, hit);
    return hit;
  }
  const request = downloadArticleHtml(title);
  articleCache.set(key, request);
  // A failed download must not be cached.
  request.catch(() => articleCache.delete(key));
  while (articleCache.size > ARTICLE_CACHE_SIZE) articleCache.delete(articleCache.keys().next().value as string);
  return request;
}

async function downloadArticleHtml(title: string): Promise<{ title: string; html: string }> {
  const data = await getJson<ParseResponse>({
    action: 'parse',
    page: title,
    prop: 'text',
    redirects: '1',
    disableeditsection: '1',
    disablelimitreport: '1',
    disabletoc: '1',
  });
  if (data.error || !data.parse) {
    throw new Error(data.error?.code === 'missingtitle' ? `No Wikipedia article named "${title}"` : data.error?.info ?? 'Parse failed');
  }
  return { title: data.parse.title, html: data.parse.text };
}

export async function suggestTitles(prefix: string): Promise<string[]> {
  const url = new URL(API);
  url.search = new URLSearchParams({
    action: 'opensearch',
    search: prefix,
    limit: '8',
    namespace: '0',
    format: 'json',
    origin: '*',
  }).toString();
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return [];
  const data = (await res.json()) as [string, string[]];
  return data[1] ?? [];
}

interface RandomResponse {
  query?: { random: { title: string }[] };
}

export async function randomTitle(): Promise<string> {
  const data = await getJson<RandomResponse>({ action: 'query', list: 'random', rnnamespace: '0', rnlimit: '1' });
  const title = data.query?.random[0]?.title;
  if (!title) throw new Error('Could not get a random article');
  return title;
}
