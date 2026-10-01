# Travelers World Map

A traveler’s atlas of the Earth — and a wall to hang it on.

This is a **personal** project. The first idea, and still the heart, is a printed world map, about 3 × 2 m, with the borders of territories, a magnetic piece for each territory, and pins for cities and places — so the owner can *see physically* where they have been and where they may go next. The web atlas is the second rendering of the same database.

Not how many countries you have been to. **Which kinds of place you have never been to.**

Mark five places in a country and the map should be able to say:

> Still unseen: desert and steppe, sacred and pilgrimage.

That sentence is the product. The globe, the register, the tiles, accounts, trips, and exports exist so that sentence is true, useful, and yours.

## Two objects, one database

| | Web atlas | Printed map |
|---|---|---|
| Holds | Every place in the database | A spaced subset of drilled holes |
| Geography | Full country land, in **web regions** | Magnetic **tiles** only where holes exist |
| Opens as | A globe that eases into a map | A ~3 × 2 m plate on a wall |
| Constraint | Honesty, speed, a private record | About 3,000 holes, 60 km apart, 160 km minimum tile |

The web atlas is not a brochure for the wall. It is the atlas. The printed map is the same database under pin geometry. They share `place_id`. They do not share polygons: a web region tessellates land; a printed tile is a piece you can hold.

## What you do with it

**See the Earth.** A globe at world view, a conventional map as you zoom. Layers you choose: our own land, satellite, web regions, places. Zoom, fullscreen, and hideable chrome on the page and in fullscreen.

**Search and filter.** A horizontal bar, hideable in both layouts. Visited or not. Kind of place. Country. Passport and entry rules. How many places to show — distributed **per country**, because a place’s tier is read inside its country, and there is no world ranking.

**Click the land.** Country, region, or place opens the same sheet, hideable.

- A **country** — entry rules for your passport, how many places, visited or not, by kind, still unseen.
- A **region** — the same, for that piece of land, and the places inside it.
- A **place** — why it is here, its tier (Icon, Major, Notable or Local) with the reason, the evidence, and why you might go.

**Mark what you have seen.** One tap. The same tap undoes it. Nothing is hard-deleted; a note survives an accidental mark.

**Plan a trip.** Collect places, put them on days, see them connected. Straight lines when you are offline. An optional route sketch from a routing provider, proxied, never as a booking engine.

**Leave when you need the live world.** Coordinates open in a maps app. Wikipedia, OSM, Wikimedia. We do not embed a vendor’s place database on our map.

**Take your record with you.** The current filter — countries, places, visited, kinds, density — to a spreadsheet, or to a printable map. The export suggests size and how many places; you may change both, and it warns when pins will collide or the sheet is too small to be a wall map.

**Keep it.** Optional account, Google (and other) sign-in, merge on first login. The product works with no account. A travel history is private. Export is one action and readable without this software.

## Why a place is on the map

A place is a destination a person would say “I went there” about — Machu Picchu, not the town below it; Florence, not a suburb. It is closer to someone who had lived in the country than to a popularity list.

Places are built from **evidence**, not from towns: World Heritage inscriptions, protected areas, Wikidata and Wikipedia attention, intangible heritage, Wikivoyage, OpenStreetMap. Each source record is stored as an *asset* with its provenance and linked to a place by identity — never silently attached to the nearest town. A place is **admitted** by explicit rules and ranked into four **tiers** (Icon, Major, Notable, Local) by absolute notability and by rank inside its own country, so a country’s best places are never crushed by another continent’s attention. No number is shown. Absence of data is never read as low value.

Twelve **kinds of place** are derived by rules from stored evidence, each with a reason you can read, and proven on a hand-labelled sample:

Imperial and historic capital · living old town · coast and sea · high mountain · desert and steppe · forest and jungle · lake and river · volcanic and geothermal · wildlife and wilderness · sacred and pilgrimage · rural and agrarian · modern metropolis.

The coverage meter counts **kinds seen**, not a percentage of places. A country is not a task.

## Rules the interface will not break

- The accent means **visited** and nothing else.
- No completion percentage for a country.
- Never “archetype” or a raw code (`A10`) in the interface — they are kinds of place.
- No numeric score anywhere: tiers only, and never a world ranking.
- Selecting never zooms. Marking never moves the camera. The only camera move is “Show on the map.”
- Marking is one tap; the same tap undoes it. Nothing is hard-deleted.
- Forty-four pixels on every tap target, including pins.
- No points, badges, streaks, or leaderboards.
- `place_id` is opaque and permanent. A rebuild that reuses an id for a different place is a failed build.
- The owner’s rulings (anchors, vetoes, disputed territories) always beat the algorithm.

## Repository

| Path | Role |
|---|---|
| `docs/1 - The Place Model.md` | What a place is, how it is admitted, ranked and grouped. **v2.** |
| `docs/6 - Database Architecture and Pipeline.md` | Storage, identity, pipeline, sources, schema. |
| `docs/7 - Validation and Ground Truth.md` | Golden set, holdout, gates, reports. |
| `docs/8 - The Printed Map.md` | The wall map: pieces, pins, selection, disputed rulings, editions. |
| `docs/5 - MVP Specification.md` | The web product. **The requirements document for the atlas.** |
| `docs/3` | Ergonomics and design tokens. |
| `docs/4` | Web architecture; its data-model section is superseded by document 6. |
| [Canva: *Travelers World Map — MVP interface specification*](https://www.canva.com/design/DAHTJP9ffYQ/edit) | The layout contract — seven drawn pages. Document 3 wins on tokens, document 5 wins on controls. |
| `database/` | Construction pipeline and published place files. |
| `webapp/twm-app/` | The atlas client. |
| `server/` | Optional accounts service. Place data is not here. |

## Run the atlas

```bash
cd webapp/twm-app
npm install
npm run dev          # http://127.0.0.1:5173
npm run check
npm run build
node test/acceptance.mjs http://127.0.0.1:4173/
```

Place files are published from `database/dist/`. After a pipeline run:

```bash
python webapp/twm-app/scripts/publish-bundle.py
```

## Licence and privacy

Place data is assembled from Wikidata, Wikipedia, Wikivoyage, UNESCO, WDPA, Ramsar, GeoNames, OSM and Natural Earth. This is a personal project, so licensing does not bound the design, but every record carries its source and licence so a later decision to share is a filter, not a rebuild (document 6 §1.1). A travel history is private by default and never a public profile.

## Status

The v2 documents are written. The v1 pipeline under `database/` is retained as `legacy` until the v2 pipeline passes its gates on the five-country prototype (Egypt, Peru, Italy, Jordan, Tanzania). Next: the golden set and failing gates (document 6 §10, M0).
