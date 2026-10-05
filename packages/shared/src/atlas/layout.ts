import { LAYOUT as L, WALL_HALF } from '../constants';
import { hashString, mulberry32 } from '../rng';
import type { ParsedPage } from '../wiki/types';
import { BIOMES } from './biomes';
import { buildSections, infoboxLinks, placeItems, type PlacedItem } from './flow';
import { Furnisher } from './furnish';
import { STRUCTURES } from './structures';
import { buildTerrain } from './terrain';
import { Track } from './track';
import type { WorldLayout, WorldSpec } from './types';

/** Slots per infobox link in the pit lane (one wall only, so each cave needs more road). */
const PIT_SLOTS_PER_LINK = 3;

/**
 * Atlas: article + world spec → race track.
 * 1. The article becomes sections, each a flow of slots (flow.ts).
 * 2. The structure picked for this page lays out the Seedpod and canyons (structures/).
 * 3. The Furnisher fills each section's stretch of canyon: caves in reading order, banners,
 *    boulders, arches, paintings, billboards — and the Seedpod (furnish.ts).
 * 4. The terrain is carved around everything in the biome's style; landmarks go on top.
 * Pure and deterministic: same page + spec → same world, on every machine.
 */
export function layoutPage(page: ParsedPage, spec: WorldSpec): WorldLayout {
  const seed = hashString(`${spec.roomSeed}:${page.title}`);
  const rng = mulberry32(seed);
  const biome = BIOMES[spec.biome];

  const sections = buildSections(page).map((s) => ({ title: s.title, ...placeItems(s.items) }));
  const pitLinks = infoboxLinks(page);
  const plan = STRUCTURES[spec.structure].plan({
    rng,
    title: page.title,
    sections: sections.map((s) => ({ title: s.title, lines: s.lines })),
    pitLines: pitLinks.length * PIT_SLOTS_PER_LINK,
    biome,
  });

  // Carve the ground first, so caves can check there's real rock behind them.
  const terrain = buildTerrain(plan.extent, plan.carves, plan.basins, seed, biome, plan.base);
  const f = new Furnisher(rng, biome);

  // Seedpod, with the infobox links as gates in the grandstand wall (as many as fit).
  let pitTrack: Track | null = null;
  const pitPlaced: PlacedItem[] = [];
  if (plan.pit) {
    pitTrack = new Track(plan.pit.path, plan.pit.s0, plan.pit.lines);
    pitLinks.forEach((link, i) => {
      const line = i * PIT_SLOTS_PER_LINK;
      if (line < plan.pit!.lines) pitPlaced.push({ item: { t: 'para', links: [link] }, line });
    });
  }
  f.seedpod(page.title, plan.arena, pitTrack, pitPlaced, plan.carves.map((c) => c.path));

  // Sections, in reading order.
  for (const t of plan.tracks) {
    const sec = sections[t.section];
    f.gantry(t.path.at(t.gatewayS), WALL_HALF, sec.title, L.gatewayClearance, 2.6);
    const track = new Track(t.path, t.s0, t.lines, terrain);
    for (const b of t.blocks) track.block(b.side, b.sa, b.sb);
    f.section(track, sec.placed);
    f.arches(t.path, WALL_HALF, t.s0, t.s0 + t.lines * L.lineH, t.exits);
  }
  for (const span of plan.archSpans) f.arches(span.path, span.half, span.from, span.to);
  for (const d of plan.decks) f.box('bridge', d.center, d.size, d.rot);

  f.landmarks(plan.landmarkPaths, terrain);
  f.backdrop(plan.arena, terrain);

  return {
    title: page.title,
    seed,
    biome: spec.biome,
    structure: spec.structure,
    terrain,
    boxes: f.boxes,
    texts: f.texts,
    gates: f.gates,
    panels: f.panels,
    regions: plan.regions,
    spawns: f.spawns(plan.arrival),
    arrival: plan.arrival,
    arrivalDir: plan.arrivalDir,
    bounds: {
      minX: terrain.x0,
      maxX: terrain.x0 + (terrain.cols - 1) * terrain.cell,
      minZ: terrain.z0,
      maxZ: terrain.z0 + (terrain.rows - 1) * terrain.cell,
    },
  };
}
