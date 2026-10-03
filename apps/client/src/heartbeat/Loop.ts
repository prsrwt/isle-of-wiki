import type * as THREE from 'three';
import type { Heartbeat } from '@isle-of-wiki/shared';

/** Drives Heartbeat from the browser's frame timer (the server will drive it from a timer). */
export function startLoop(renderer: THREE.WebGLRenderer, heartbeat: Heartbeat): void {
  let last: number | null = null;
  renderer.setAnimationLoop((now) => {
    const elapsed = last === null ? 0 : (now - last) / 1000;
    last = now;
    heartbeat.advance(Math.min(elapsed, 0.25));
  });
}
