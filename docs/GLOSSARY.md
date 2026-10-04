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
