/// <reference lib="webworker" />
import { layoutPage, type ParsedPage, type WorldLayout, type WorldSpec } from '@isle-of-wiki/shared';

/**
 * Atlas runs here, off the main thread, so generating a big track (~1.3 s for "Moon")
 * never freezes the game. Parsing stays on the main thread because it needs the DOM.
 */
export interface LayoutRequest {
  id: number;
  page: ParsedPage;
  spec: WorldSpec;
}

export type LayoutResponse = { id: number; layout: WorldLayout } | { id: number; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (e: MessageEvent<LayoutRequest>) => {
  const { id, page, spec } = e.data;
  try {
    const response: LayoutResponse = { id, layout: layoutPage(page, spec) };
    scope.postMessage(response);
  } catch (err) {
    const response: LayoutResponse = { id, error: err instanceof Error ? err.message : String(err) };
    scope.postMessage(response);
  }
};
