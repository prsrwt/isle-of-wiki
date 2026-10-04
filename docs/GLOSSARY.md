# Isle of Wiki — Glossary

Every part of the game has a name so contributors can talk about, and own, specific pieces.
Use these names in code (folders, types, functions) and in issues.

## Engines

| Name | What it is | Lives in |
|---|---|---|
| **Heartbeat** | Runtime: fixed-step clock (60 ticks/s), systems, entity registry. Same code on client and server. | `packages/shared/src/heartbeat/`, `apps/client/src/heartbeat/` (loop, input) |
| **GNME** — Goodnight Moon Engine | Says "goodnight" to whatever you don't need right now (far chunks, text, detail, images) and "good morning" when you come back. Also builds the world off the main thread and nearest-first. **Lights out**: while Folio covers the screen, every cell sleeps and the 3D scene isn't drawn. | `packages/shared/src/gnme/` (chunk maths), `apps/client/src/gnme/` |
| **Atlas** | Track engine: Wikipedia article → world. Plug-in *structures* (`atlas/structures/`) and *biomes* (`atlas/biomes/` for shape, `apps/client/src/render/biomes/` for colours). The **Furnisher** fills canyons with caves and props. | `packages/shared/src/atlas/` |
| **Guestbook** | Room memory: the first player to reach a page "signs" which biome and structure it gets (never the arriving player's current biome); everyone after reads it. Keyed by canonical article title. | `packages/shared/src/guestbook/` |
| **Folio** | The article map overlay (Tab): the whole page, clickable links, "you are here". Opening it pauses nothing. | `apps/client/src/folio/` |
| **Thread** | Navigation to the link you chose in Folio: HUD arrow + distance, a marker over the cave when it's in view, and the "Your cave" callout when you're close. | `packages/shared/src/thread/` (maths, link → cave), `apps/client/src/ui/hud.ts` |
| **Physics** | One Rapier world per page, built from the same `WorldLayout` the renderer draws: the ground as a heightfield (laid out a quarter turn round so its triangles match the drawn ones), every prop as a box. Deterministic build, stepped by Heartbeat at 60 Hz. Debug view: **P** (props orange, ground cyan), **B** drops test balls. | `packages/shared/src/physics/` (import from `@isle-of-wiki/shared/physics`), `apps/client/src/physics/` (debug view) |
| **Pod** | Your hover racer: a cockpit and two engines out front, which the physics engine sees as five spheres turning with it. Driven by setting its velocity each fixed step (arcade handling); steering is car-like: none at a standstill, tight turns when slow, wider when fast, reversed in reverse. Space (or gamepad B) brakes hard to a stop, never into reverse. Hovers 1.8 m over the ground and *decks* (bridges); rocks, grandstands, every other prop and any slope steeper than 45° are obstacles it collides with and scrapes along. Falls more than 25 m → back to the last safe spot. Only + − × ÷ and square roots, so it stays deterministic. **J** in front of a cave (within 25 m) travels to that page. | `packages/shared/src/pod/` (`pod.ts` from `@isle-of-wiki/shared/physics`; `gates.ts` cave reach), `apps/client/src/pod/` (driver, chase camera, origami model, speed and scrape effects) |

| **Marshal** | Runs one racer's race: holds them on the **grid** until they take control, counts down 3, 2, 1, GO, keeps the **race clock** in Heartbeat ticks (so every machine and the server time it the same), logs each **hop**, and finishes the race on reaching the target. Every trip through a link tunnel costs exactly 2 s on the clock, however long the page takes to load. After the finish you can keep exploring, untimed. | `packages/shared/src/race/` |
| **Link tunnel** | The folded-paper tube you fly through between pages: twisted hexagonal paper rings on a treadmill, speed streaks, a white flash in and out. Its walls fade from the colours of the world you left to the one you're heading for once the Guestbook has signed it. The next world is built behind it. WASD drifts the pod around the tube. | `apps/client/src/tunnel/` |

## Structures (Atlas layouts)

| Name | Shape |
|---|---|
| **The Hidden Lotus** *(default)* | Arena in the centre; each article section is a looping petal canyon out of and back into it. From inside a canyon you never see the flower — only from the sky or in Folio. |
| **Vine** | One long winding circuit through the whole article. |
| **Lilypad** | Floating islands joined by bridges. |

### Parts of the Hidden Lotus

| Name | What it is |
|---|---|
| **Seedpod** | The central arena: grandstands, crowd, pit lane. |
| **Petal** | One section's looping canyon. |
| **Petal layer** | A petal with a long section grows an outer **lobe**: past a neck it widens over shorter neighbouring petals (which tuck in beneath it), so the canyon stays closer to the Seedpod. Still one loop, read in order. |
| **Stem gate** | Where a petal leaves or rejoins the Seedpod. |
| **Calyx** | Optional outer ring joining the petal tips. |

## Biomes (Atlas modules)

| Name | Look |
|---|---|
| **Dune** | Desert canyon |
| **Frost** | Ice |
| **Canopy** | Jungle |
| **Ember** | Volcanic |
| **Relic** | Ruins |

## World vocabulary

| Name | What it is |
|---|---|
| **Cave** | A link portal in a canyon wall: glowing mouth, uneven rock arch, **cave plaque** with the destination. |
| **Painting** | Trackside board showing one of the article's images (halftone). |
| **Billboard** | Trackside ad slot, numbered per page so every player sees the same ad in the same place. |
| **Pit lane** | The infobox, laid out in the Seedpod. |
| **Gateway** | Arch with a section title where a canyon begins. |
| **Chunk / Region** | GNME's square tiles of world: 256 m chunks hold close-up detail, 1 km regions hold big shapes. |
| **Furnisher** | Atlas step that puts the article into canyons: caves in reading order, banners, boulder fields, arches, paintings, billboards. |
| **Slot** | One 4.5 m step along a canyon; the article flows along each canyon in slots. |
| **Awake / Drowsy / Asleep** | GNME states: full detail / big shapes only / not drawn. |
| **Room** | One multiplayer race; shares a room seed and a Guestbook. |
| **Grid** | The start page before the race begins: the pod waits there until you take control, then the countdown runs. |
| **Hop** | One trip through a cave to another page. The finish card lists every page you hopped through. |
| **Finish card** | Your time, hops and path when you reach the target, with your best time for that start and target (kept in the browser). Race again (same pages, a new room) or start a new race. |
