# Isle of Wiki

Wikipedia pod racing in low-poly origami canyons, inspired by Star Wars Episode I Racer.
Every article becomes a race track. You start in the Seedpod (the arena, where the infobox's
links are gates in the grandstand), and every section of the article is a canyon whose walls
are lined with caves — one per link, in reading order — leading to other articles. Images and
billboards stand trackside. Each page's world is picked by the engine: a structure (The Hidden
Lotus, Vine or Lilypad) and a biome (Dune, Frost, Canopy, Ember or Relic). Race from a start
article to a target article — no searching.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # parser + layout tests (Node, same code the server will run)
npm run typecheck
```

## Engines

The game is built from named engines — see [docs/GLOSSARY.md](docs/GLOSSARY.md) for every name.

| Engine | Job |
|---|---|
| **Heartbeat** | Fixed-step game loop (60 ticks/s), systems, entity registry, input actions |
| **GNME** (Goodnight Moon Engine) | Puts unneeded world cells to sleep (Awake / Drowsy / Asleep), builds them nearest-first, generates tracks in a worker |
| **Atlas** | Article → track: plug-in structures and biomes, Furnisher fills canyons |
| **Guestbook** | Room memory: the first arrival on a page decides its world; everyone else shares it |

## Layout

| Path | What lives there |
|---|---|
| `packages/shared` | Runs in browser **and** server: Wikipedia parser, deterministic page → world layout, multiplayer protocol types, world constants |
| `apps/client` | Three.js renderer, controls, HUD, Wikipedia API calls, ad provider (`src/ads`) |

The world layout is deterministic (no `Math.random`, seeded by page title), so every player and
the server build an identical map from the same article. Each world is determined by the article plus a `WorldSpec` (room seed, biome, structure). The ground is a heightfield (`WorldLayout.terrain`) and every prop is an oriented box
(`WorldLayout.boxes`); the renderer draws exactly these, and the physics engine (Rapier's official
deterministic build, `@isle-of-wiki/shared/physics`) turns the same data into colliders.

## Roadmap

1. ✅ Page → world generator with free-fly camera
   - ✅ 1b-A: canyon country (islands, newspaper-column canyons, mesas/buttes, slot canyons, caves, cliff panels)
   - ✅ 1b-B: origami ink style, starry void, halftone paintings, carved quotes, ad slots
   - ✅ 1c-A: race track — heightfield terrain, arena + trunk + winding section canyons, arches, spires
   - ✅ 1c-B: origami biomes per article (Dune, Frost, Canopy, Ember, Relic), arena dressing, shadows
   - ✅ A: Heartbeat runtime + GNME (regions/chunks, sleep states, worker generation, article cache)
   - ✅ B: Atlas — engine-picked structures (The Hidden Lotus, Vine, Lilypad) and biomes; Guestbook; floor text removed; shadows, crowds
   - ✅ C: Folio article map + Thread navigation
     - ✅ C1: Folio (Tab) — article text and zoomable track map, pick a link or cave
     - ✅ C2: Thread — HUD arrow, distance and on-screen marker for the picked cave
   - ✅ P: Petal layers — long Hidden Lotus petals grow outer lobes over shorter neighbours
2. Pod + chase-camera driving (Rapier physics)
   - ✅ 2A: physics world — every page's ground and props as solid colliders, stepped by Heartbeat (debug view: P, drop balls: B)
   - ✅ 2B: hover pod — W/S throttle, A/D steer (car-like: tighter slow, wider fast), Space brake, Shift boost, mouse orbits the chase camera, R respawn, J travel through the cave in front of you; rocks, grandstands and walls are solid; top-bar dashboard (RPM, speed, boost); H for stats & controls (F free-fly for debugging)
   - 2C: pod look and feel — origami pod, engine glow, speed effects, speedometer
3. Link tunnels + full single-player race
4. Online multiplayer
5. Polish (sound, minimap, themes, controls)
