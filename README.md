# Travelers World Map

A traveler’s atlas of the Earth.

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

**See the Earth.** A globe at world view, a conventional map as you zoom. Layers you choose: our own land, a geographic basemap, streets, web regions, places. Zoom, fullscreen, and hideable chrome on the page and in fullscreen.

**Search and filter.** A horizontal bar, hideable in both layouts. Visited or not. Kind of place. Country. Passport and entry rules. How many places to show — distributed **per country**, because a score of 86 is 86 in Morocco, not a world rank.

**Click the land.** Country, region, or place opens the same sheet, hideable.

- A **country** — entry rules for your passport, how many places, visited or not, by kind, still unseen.
- A **region** — the same, for that piece of land, and the places inside it.
- A **place** — why it is here, how it scores against the best place **in that country**, and why you might go.

**Mark what you have seen.** One tap. The same tap undoes it. Nothing is hard-deleted; a note survives an accidental mark.

**Plan a trip.** Collect places, put them on days, see them connected. Straight lines when you are offline. An optional route sketch from a routing provider, proxied, never as a booking engine.

**Leave when you need the live world.** Coordinates open in a maps app. Wikipedia, OSM, Wikimedia. We do not embed a vendor’s place database on our map.

**Take your record with you.** The current filter — countries, places, visited, kinds, density — to a spreadsheet, or to a printable map. The export suggests size and how many places; you may change both, and it warns when pins will collide or the sheet is too small to be a wall map.

**Keep it.** Optional account, Google (and other) sign-in, merge on first login. The product works with no account. A travel history is private. Export is one action and readable without this software.

## Why a place is on the map

A place is a location that would leave a hole in a traveler’s picture of its country if it were missing — closer to someone who had lived there than to a popularity list.

Each place is scored **inside its country** on three pillars: built heritage, natural setting, living culture. They combine with a power mean, so a great park is not beaten by a town that is merely adequate at everything. National registers never cross a border. Population is not a scoring input. Feasibility can only penalise. Distinctiveness is an internal quantity and is not shown.

Twelve **kinds of place** are derived from what is there, never painted as twelve colours:

Imperial and historic capital · living old town · coast and sea · high mountain · desert and steppe · forest and jungle · lake and river · volcanic and geothermal · wildlife and wilderness · sacred and pilgrimage · rural and agrarian · modern metropolis.

The coverage meter counts **kinds seen**, not a percentage of places. A country is not a task.

## Rules the interface will not break

- The accent means **visited** and nothing else.
- No completion percentage for a country.
- Never “archetype” or a raw code (`A10`) in the interface — they are kinds of place.
- Score is 0–100 against the top place in the **same** country. Never a world ranking.
- Selecting never zooms. Marking never moves the camera. The only camera move is “Show on the map.”
- Marking is one tap; the same tap undoes it. Nothing is hard-deleted.
- Forty-four pixels on every tap target, including pins.
- No points, badges, streaks, or leaderboards.
- `place_id` is a migration. A rebuild that reuses an id for a different place is a failed build.

## Repository

| Path | Role |
|---|---|
| `docs/1` | The place model — how a place is chosen, scored, and grouped. |
| `docs/5 - MVP Specification.md` | The web product. **This is the requirements document.** |
| `docs/3` | Ergonomics and design tokens. |
| `docs/4` | Architecture, except where document 5 conflicts. |
| `docs/2` | Earlier web spec. Historical. Document 5 wins. |
| `docs/REVIEW-POC-TO-MVP.md` | Critic review that led to document 5. Not the product description. |
| `database/` | Construction pipeline and published place files. |
| `webapp/twm-app/` | The atlas client. |

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

Place data is assembled from UNESCO, WDPA, Wikidata, OSM, GHSL and Natural Earth. WDPA is non-commercial by default. OSM is ODbL. Both must be resolved before revenue. A travel history is private by default and never a public profile.
