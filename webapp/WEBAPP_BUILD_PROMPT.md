# Travelers World Map — build the web application

Paste this whole file as the first message of a fresh session, with the project
folder connected.

---

You are building the web application for **Travelers World Map**. The place
database is finished and validated — 15,770 places across 235 countries, built
from UNESCO, WDPA, Wikidata, OSM, GHSL and Natural Earth. Your job is the client, not the data.

Project folder (connect it before you start):

```
C:\Users\ADIL\OneDrive\Desktop\folders\travel\Travelers world map project
```

## 0. Read these first, in this order

| File | Why |
|---|---|
| `docs/1 - The Place Model - Specification.docx` | What a place is and how it was scored. Everything else assumes it. |
| `docs/2 - Web Application - Product Specification.docx` | What the product does, screen by screen. **This is your requirements document.** |
| `docs/3 - Web Application - Ergonomics and Design System.docx` | Exact colour tokens, type scale, spacing, component states, accessibility bar. |
| `docs/4 - Web Application - Technical Architecture.docx` | Stack, data flow, performance budget, rendering approach. |
| `database/dist/verification.txt` | The state of the database as built. |

Do not restate these documents back to the owner. They wrote them. Read them,
then build.

## 1. The product in one paragraph

A traveler marks the places they have been. The map answers a question no travel
product answers today: not *how many* places you have visited, but **which kinds
of place you have never been to**. Every place carries the archetypes it
represents — living old town, high mountain, desert, sacred site, and eight
others — so a traveler who has been to a country six times can be shown, truly,
that they have never seen one of the things that country is.

The sentence a traveler should see after marking five places in a country is:
*"Still unseen: desert and steppe, sacred and pilgrimage."* That sentence is the
product. Everything else is table stakes.

## 2. The data

Unzip `database/dist/twm-app-bundle.zip` — that is the bundle the client loads.
The flat files it was derived from (`app_places.json`, `territories.json`,
`printed_places.json`, `build_report.json`, `twm.duckdb.gz`) sit alongside it in
`database/dist/` and are the source of truth if you need a field the bundle
trimmed.

```
app/
  manifest.json            29 KB   build id, model params, archetype labels, country index
  places.geojson          2.9 MB   15,770 points, properties trimmed to what the map paints
  territories.geojson     4.1 MB   803 tile outlines
  countries.geojson       3.5 MB   249 country outlines
  countries/{ISO3}.json   5.5 MB   235 files — the register, fetched per country
                                   (median 7 KB, largest IND at 409 KB)
```

### `places.geojson` — the pin layer

Properties are single-letter on purpose; 15,770 features go through a tile
pipeline.

| Key | Meaning |
|---|---|
| `id` | `place_id`, e.g. `ITA-c3169070`. **Stable across rebuilds. This is the hard contract** — a traveler's record is a list of these. |
| `n` | Name |
| `s` | Score 0–100 — see the warning in §3 |
| `k` | Strongest archetype code |
| `site` | 1 = natural or archaeological feature, 0 = settlement. Drives marker shape: square vs circle. |
| `hole` | 1 = survives onto the printed map. Drives the extra outer ring. |
| `whs` | Count of World Heritage inscriptions |
| `t` | `territory_id` of the tile it sits in, `""` if none |

### `countries/{ISO3}.json` — the register

```jsonc
{
  "country": "Italy", "iso3": "ITA", "area_km2": 301230.0,
  "places": [ /* 395 full place records, sorted by score descending */ ],
  "kinds":  { "A2": 5, "A3": 191, "A4": 13, "A5": 7, "A7": 8,
              "A9": 29, "A10": 130, "A11": 387, "A12": 4 },
  "territories": [ /* the tiles in this country */ ]
}
```

A full place record:

```jsonc
{
  "place_id": "ITA-c3169070",
  "name": "Rome",
  "country": "Italy",
  "lat": 41.8919, "lon": 12.5113,
  "is_site": false,
  "score": 100,
  "archetypes": ["A10", "A12", "A11"],
  "archetype_weights": [0.81, 0.61, 0.6],   // parallel array, same order
  "whs": 3,
  "reach": "near",
  "best_months": [],
  "on_printed_map": true,
  "printed_rank": 1,
  "territory_id": "ITA-T06",
  "sources": ["cuisine", "ghsl-ucdb", "osm", "unesco-whs", "wikidata"]
}
```

### `territories.geojson` — the tiles

One feature per magnetic tile on the printed map. Properties: `territory_id`
(`ITA-T06`), `name`, `country`, `iso3`, `printable` (false = too small to cut,
becomes an inset panel), `places` (everything inside it), `holes` (the drilled
subset), `kinds` (dominant archetypes).

`territories.json` in `dist/` carries the same tiles with two id lists:
`place_ids` = the drilled subset, `app_place_ids` = everything the tile contains.

### The archetype vocabulary

Twelve codes. `manifest.json.archetypes` has the labels; **never show the code
to a traveler, and never use the word "archetype" in the interface** — doc 3 §13
is explicit about this. They are "kinds of place".

```
A1  Imperial & historic capital      A7   Lake & river
A2  Living old town / medina         A8   Volcanic & geothermal
A3  Coastal & maritime               A9   Wildlife & wilderness
A4  High mountain                    A10  Sacred & pilgrimage
A5  Desert & steppe                  A11  Rural vernacular & agrarian
A6  Forest & jungle                  A12  Modern metropolis & industry
```

## 3. Three things about the data that will bite you if you miss them

**Score is country-relative and never comparable across borders.** 100 means
"the best place in this country". Rome is 100 and so is Kathmandu, and so is
Reykjavík. Sorting the world by score produces nonsense. In the interface, always
render it with its frame — "top in Italy", "86 of 100 in Morocco" — never as a
bare global number, and never sort a world-wide list by it.

**Only 9 of the 12 kinds are populated.** The live spread across all 15,770
places:

```
A1  imperial capital          0     A7  lake & river           952
A2  living old town          49     A8  volcanic & geothermal    0
A3  coastal & maritime    3,967     A9  wildlife & wilderness 4,067
A4  high mountain           472     A10 sacred & pilgrimage     781
A5  desert & steppe       4,996     A11 rural vernacular      5,299
A6  forest & jungle           0     A12 modern metropolis     1,131
```

A1, A6 and A8 are **empty**, and A4 is thin — it comes from named summits, of
which a global public-domain gazetteer holds only 492 above 1,500 m, so Cusco,
Kathmandu and Lhasa currently read as flat. A8 and A4 are being fixed right now:
an OSM harvest for `natural=volcano` and `natural=peak` is running, and the
build already reads the file it will produce. A1 (Wikidata "capital of",
including former states — current capitals alone would make Brasília an imperial
capital) and A6 (real land cover, not climate) are not yet scheduled.

So the coverage meter, which is the product's core feature, cannot yet report on
three kinds. **Build it against all 12 and drive it from
`manifest.json.archetypes`,** so the three that arrive later light up without a
code change. Do not hardcode the nine that happen to have data today.

**`best_months` is climate-derived, and `reach` is inert.** `best_months` comes
from the Köppen class and hemisphere — Rome Apr–Jun and Sep–Oct, Reykjavík
May–Sep, Marrakesh Oct–Apr, Cusco May–Sep. 15,487 of 15,770 places have it; an
`Af` tropical place carries all twelve months, meaning "any month", and 283
places carry none. It is a climate rule, not researched per-place seasonality:
it knows nothing about monsoon onset dates, altitude within a class, or a
festival worth travelling for. Show it as guidance, never as a promise, and
treat an empty array as "we don't know" rather than "never".

`reach` is `"near"` for every place, so the model's feasibility multiplier is
currently 1.0 everywhere and the term does nothing. Nothing in the interface
should present travel effort until a real gateway-time source exists — straight
-line distance to an airport is not one.

## 4. The interaction the owner asked for

> *"develop it in google maps style — clicking on countries / tiles / places to
> show details, with possible filter"*

A conventional, familiar map interaction, with a **three-level click hierarchy**.
Each level opens the same panel with a different scope, and each level's detail
answers "what is here, and what have I not seen here".

| Click | Panel shows |
|---|---|
| **Country** (the fill or outline in `countries.geojson`) | Country name, places, drilled holes, tiles. The coverage meter for the country: kinds seen of kinds available, with the gap sentence. The top places, tappable. |
| **Territory tile** (`territories.geojson`) | Tile name and country, whether it is printable or an inset, the places inside it, its dominant kinds, and the same coverage meter scoped to the tile. |
| **Place** (a point in `places.geojson`) | The place panel — doc 2 §8 specifies its seven sections exactly. |

Rules the map must obey (doc 3 §6.1, and these are not negotiable):

- **Selecting never zooms.** Selection opens the panel; the camera is the
  traveler's business.
- **Marking never moves the map.** Recentring after a tap is the fastest way to
  make a map feel hostile.
- **Clusters state their contents** — total and visited counts, so an untouched
  region is visible without zooming into it.
- **Hit targets exceed the visual mark.** Pins render at 8–12px and take taps at
  44px.
- **The map is never the only route to anything.** Every place is reachable
  through the register. That is what makes the product usable by keyboard and by
  screen reader, and it is also what makes it usable on a slow connection.

Zoom behaviour: globe at world zoom easing into Mercator as the traveler zooms
in (doc 4 §5.1). Country level brings territory outlines in; region level
dissolves clusters into individual pins and shows labels.

## 5. Filters

The register and the map read from one filter state — filtering the list filters
the pins, always. Dimensions:

| Filter | Source |
|---|---|
| Visited / not visited | User record. Not-visited is the default working state for planning. |
| Kind of place | `archetypes[]` — twelve chips, driven from the manifest |
| On the printed map | `on_printed_map` — the bridge between the two products |
| World Heritage | `whs > 0` |
| Country | `country` |
| Territory tile | `territory_id` |
| Score band | `score`, **within a country only** — see §3 |
| Best months | `best_months` — build it, hide it until the data lands |

Sorting: by score (within a country), by name, by distance from a chosen point,
by how recently marked.

**The coverage meter is a control, not a readout.** Tapping a gap in the meter
activates the matching kind chip and filters the register to it. That single
interaction — see the gap, tap it, get the list — is the product's core loop and
the thing to measure.

## 6. Decisions already made — do not relitigate these

They are recorded in the project memory and in doc 4 §2, each with its reasoning.

| Decision | Why |
|---|---|
| **MapLibre GL JS, recent major version** | Open licence, no per-load billing, and it renders extruded polygons with true interior rings — which is what makes a drilled hole look drilled. Older majors stalled for several frames at ~20,000 feature-state entries, which is exactly this scale. Pin the version and spike feature-state against all 15,770 places early. |
| **Self-hosted vector basemap (PMTiles) on zero-egress object storage** | A commercial basemap bills per map load and ties cost to success. |
| **Visited state rides on feature-state**, keyed by a promoted `place_id` | Marking repaints without re-uploading geometry. This is the exact pattern that stalled on older renderers — verify at full scale before you build on it. |
| **Places ship as vector tiles, not one GeoJSON blob** | 15,770 points today, 25,000 at target. |
| **Globe easing into Mercator** | Equal Earth is unavailable on the web and would be wrong anyway. The printed map and the app differ in projection: deliberate and documented. |
| **Managed Postgres + auth, for user records only** | Place data is static files; user data is dynamic. They never share a database. |
| **Local-first marking** | Writes to local storage immediately, queues for sync. The product works before an account exists. |
| **No contested borders are drawn** | Western Sahara dissolves into Morocco (`DISSOLVE_INTO` in `twm/config.py`). Kosovo, Taiwan, Palestine, Northern Cyprus, Somaliland, Crimea and Kashmir **still need explicit rulings** — ask the owner, do not decide silently. |
| **The tile view is a separate mode**, not always-on | A permanently pitched map costs vertical space and taxes every routine interaction. |
| **No points, badges, streaks or leaderboards** | Extrinsic rewards degrade the intrinsic motivation, and volume is what this model exists to reject. |

## 7. On "Google Maps"

Read as **the interaction style** — a familiar, conventional map: click a thing,
a panel tells you about it; filters narrow what is drawn; the map is the page.
Build that.

Read as **the Google Maps JavaScript API**, it collides with two rulings above,
and the collision is in the documents rather than a matter of taste. Doc 2 §11
and doc 4 §9.1: the platform's terms restrict caching its place content and
restrict displaying that content on a non-vendor basemap, so with our own
basemap its place data is unusable inside the product — and its billing is
per-map-load, which ties cost to success. The workable pattern is the inverse,
and it is already the plan: store the stable Google place identifier, which the
terms permit keeping, and use it **only to link out** from the place panel
("Open in Maps"). The traveler gets live hours and reviews from a service built
for that, and our database never depends on it.

If the owner does want the Google renderer specifically, say what it costs
before building it: per-load billing, no true interior rings so the drilled-hole
tile view is off the table, and the basemap constraint above. That is a
conversation to have, not a decision to make for them.

## 8. Build order

The flat Atlas view is a complete product. The tile view is separable and is the
largest single piece of front-end work — doc 4 §15 says ship the flat view
first, and that is right.

1. **Spike the renderer first.** All 15,770 places, all marked, feature-state
   driven, on a mid-range phone. Doc 4 §11: mark-to-repaint under 100 ms, ≥50 fps
   panning at world zoom. If this fails, everything downstream changes, so find
   out now rather than in beta.
2. Atlas view: pins, clusters, country and tile layers, the three-level click.
3. The register, as a first-class surface that mirrors the map exactly. Hovering
   either highlights both — that is what teaches a traveler the two surfaces are
   the same data.
4. Marking: one tap, no confirmation, no dialog, undo by the same tap. Nothing is
   ever hard-deleted; unmarking sets a flag so an attached note survives an
   accidental tap.
5. The coverage meter and the gap sentence. This is the product.
6. Filters wired to both surfaces from one state.
7. Onboarding, including **bulk marking** — someone with thirty years of travel
   behind them will not tap two hundred pins one at a time. Doc 4 §15 calls this
   the critical path, not a nice-to-have.
8. Trips: save → assign to day → see connected. Straight lines, not routes. No
   times, no durations, no collaboration.
9. Tile view: holes cut in the pipeline as true interior rings, bevelled corners,
   a faked grounding shadow, height as a function of zoom, camera easing into
   35–50° pitch.

Accessibility is not a phase. WCAG 2.1 AA including the map, from the first
commit — the register exists partly because it is the accessible equivalent of
the map, and retrofitting that is far more expensive than building it.

## 9. Design

Doc 3 has the exact tokens. Two things carry the whole aesthetic:

**The governing contrast is a ring against a filled dot** — an empty hole and a
placed pin. Everything else is quiet so that one distinction reads at a glance,
at any zoom, in either theme.

**The accent (`#A87B22` light, `#DBA83E` dark) means visited and nothing else.**
No button, heading, link or chart may use it. The moment it decorates something,
the map stops being readable at a glance, which is the one thing this interface
has to do.

The twelve kinds are distinguished by **shape and label, not colour** — twelve
categorical colours cannot be made accessible, and they would compete with the
accent for meaning.

There is a static prototype at `webapp/twm_webapp_source.zip` (`gen.py` injects
JSON into `template.html` at a `/*__DATA__*/` placeholder). It covers five
countries and has no real map in it. Treat it as a **styling reference** — the
palette, the type stack (Bodoni Moda / Archivo / IBM Plex Mono), the dark-mode
token structure are all worth keeping — and not as an architecture to extend.

## 10. Traps

- **`place_id` stability is a migration contract, and it is now measured.**
  `build/verify.py` diffs every build against the previous one. Across the last
  three rebuilds: **11,883 of 11,918 ids kept their place, zero were reused for
  a different place**, 35 dropped out (all scoring 10–12, right at the score
  floor) and 3,887 were added. Reuse fails the build, because it silently moves
  someone's visit to somewhere they have never been; a disappearance only
  dangles a mark, which is recoverable. Expect a small trickle of dropped ids on
  every rebuild and design the visit store to tolerate an id it can no longer
  resolve — show it as "no longer in the database", never delete the record.
- **676 places have no `territory_id`** and 8 printed places have none either —
  tiles only cover the parts of a country that carry a drilled hole. Null is a
  legitimate value; do not assume every place has a tile.
- **The livability pillar is empty for 194 of the 235 countries.** Markets,
  institutions and craft clusters come from OpenStreetMap, and the harvest has
  reached 41 countries so far — Germany, France, Italy, Japan, Spain, China,
  India and 34 others. Elsewhere a place is scored on heritage and nature alone,
  which is why a few countries currently rank an oasis or a lake town above
  their great city. It is a known gap with a harvest in progress, not a scoring
  bug, and no interface change should try to compensate for it.
- **One country has no tiles at all** — United States Minor Outlying Islands,
  which Natural Earth gives no admin-1 polygon. Its 8 places are the only tile
  orphans left in the world.
- **Never show a completion percentage for a country.** Doc 3 §13: a country is
  not a task, and a traveler who has seen everything on our list has not
  finished it. "Still unseen" is the register's voice.
- **Do not add population back as anything.** It was removed from scoring
  deliberately, and surfacing it in the interface reintroduces the country-
  counting frame the product exists to reject.
- **"Why it is here"** (doc 2 §8) is not decoration. It is how a traveler decides
  whether to trust the database, and a sentence that reads oddly is a scoring bug
  with a human-readable symptom. Derive it from `sources[]` and `whs`.

## 11. When you are unsure

Ask the owner. Specifically: the seven contested-border rulings, whether the
score band filter should be visible at all before the cross-country problem is
explained in the interface, and anything where doc 2 and this brief disagree —
**doc 2 wins**, it is the requirements document and this is a summary of it.
