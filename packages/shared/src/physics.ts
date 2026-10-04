/**
 * Physics entry point (`@isle-of-wiki/shared/physics`). Kept out of the main index so code
 * that never simulates (the layout worker, world generation) doesn't bundle Rapier.
 */
export * from './physics/physics';
