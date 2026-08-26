# Travelers World Map — web application

The client for the place database. Atlas and tile views, register, marking,
coverage meter, filters, onboarding, bulk marking from a country or tile,
trips, and the passport layer.

Read `docs/5 - MVP Specification.md` before changing anything here. Where this
code and document 5 disagree, document 5 wins. Document 2 is historical.

## Run it

```bash
cd webapp/twm-app
npm install          # needs the npm registry. The mounted Linux VM has no
                     # network — run this where npm can reach it.
npm run dev          # http://127.0.0.1:5173
```

`public/data/` is the live 15,770-place bundle, published from
`database/dist/twm.duckdb`. To rebuild it after a pipeline run:

```bash
python scripts/publish-bundle.py
```

```bash
npm run check        # tsc, no emit
npm run build        # production build
npm run preview      # serve the build on :4173
npm run spike        # renderer spike, needs a server running
node test/acceptance.mjs http://127.0.0.1:4173/   # the rules from the docs
```

## What is here

| Path | Holds |
|---|---|
| `src/core/` | Bundle loading, the traveler's record, filters, coverage arithmetic, kinds, passports. No DOM. |
| `src/map/` | MapLibre setup, the two point sources, the marks drawn to canvas, the relief layers. |
| `src/ui/` | Register, coverage meter, filter bar, detail panel, bulk marking, onboarding, trips. |
| `spike/` | The full-scale renderer spike. Run it before trusting a MapLibre upgrade. |
| `test/acceptance.mjs` | The rules from doc 2 and doc 3, as executable checks. |

## Three things the code knows that the documents do not

These were measured, not assumed. Each one changed the architecture.

**1. `promoteId` does not survive `cluster: true`.** A clustered GeoJSON source
ignores it, so rendered features carry no stable id and `setFeatureState` can
never match one — feature-state marking and MapLibre's built-in clustering are
mutually exclusive. It fails silently, which is the dangerous part. This was
never going to work anyway: doc 2 §4.2 wants clusters that state *total and
visited* counts, and `clusterProperties` can only sum a data property, while
visited is user state. So clusters are built by hand below `CLUSTER_MAX_Z`
(2.9–10 ms for a whole-world pass, ~590 clusters) and the unclustered source
with `promoteId` takes over above it.

**2. `feature-state` is not allowed in layout properties.** `icon-image` is
layout, so the mark cannot switch from ring to filled dot on marking. The shape
comes from the data (`site`, `hole`), which layout does allow; visitedness comes
from `icon-opacity`, which is paint and does. Hence two stacked symbol layers,
`place-open` and `place-filled`, one visible at a time.

**3. The doc 4 §15 risk is cleared on MapLibre 5.24.** Marking the full
database costs tens of milliseconds of JavaScript, and one mark against a
full state table costs the same as against an empty one. Re-run `npm run
spike` on every upgrade — this is exactly the kind of regression that
returns quietly.

## Decisions taken here, and why

- **No component framework.** Doc 4 §2 calls for one and says the choice is
  "unremarkable on purpose". Vanilla TypeScript with a 40-line store keeps the
  marking path free of a re-render pass, and initial JS is **17 KB compressed**
  against a 300 KB budget. Swappable if you want the router.
- **Places ship as GeoJSON, not vector tiles.** Doc 4 §5.2 asks for tiles at
  25,000 points. At 15,770 the source is still a single GeoJSON that MapLibre
  tiles in a worker. Generate real tiles before the database grows; the
  source name is the only thing that changes.
- **The basemap is our own polygons.** Self-hosted PMTiles needs a planet build
  and object storage. Land, coastlines and tile outlines are drawn from
  `countries.geojson` in the doc 3 palette; the PMTiles URL is a one-line swap
  in `src/map/atlas.ts`.
- **Relief is wired to a working default; the satellite is not.** Different
  cost postures, not the same rule applied twice. The photograph is a
  third-party basemap and stays off at boot until an owner rules (doc 5 §4.3).
  Terrain Tiles on the AWS Open Data Registry bill nothing, carry an
  attribution licence, and — unlike the Natural Earth relief pyramid this
  replaces — are read over the wire rather than shipped in the bundle, which
  is what the earlier hillshade was dropped for. So relief ships on and the
  layer a traveler turns on actually turns on.
  `VITE_TWM_TERRAIN_DEM=off` removes the source from the style entirely; the
  controls stay and say they are unconfigured.
- **Relief and satellite compose.** Relief is not a basemap: the hillshade
  shades whatever ground is switched on, the photograph included, and
  `groundOpacity()` in `atlas.ts` is the single place that decides how much of
  our own land colour survives underneath.
- **Shading is translucent, and that is load-bearing.** The first pass painted
  sunlit slopes in an opaque near-white token and the whole globe went to
  paper: land and sea ended up the same tone with only the coastline hairline
  left between them. Alpha over the existing ground keeps `--land` and
  `--water` doing their job while the relief textures both.
- **The detail panel overlays the panel column** rather than taking a third
  column, because doc 3 §2.1 gives the map a floor of 60% at 1440px and a second
  400px column takes it to 44%.
- **Three properties added to `places.geojson`**: `a`, every kind as a bitmask;
  `c`, the iso3; `m`, best months as a bitmask. They let the register, the
  coverage meter and the seasonality filter work at world scope without
  fetching 235 register files.
- **Scope emphasises; filters remove.** Opening a country does not take the
  rest of the world off the map — out-of-scope places drop to 0.3 opacity and
  their clusters to 0.3, while filtered-out places drop to 0.08. A globe that
  empties itself when a country is opened reads as broken, and the product's
  claim is whole-world. The camera still only moves when asked, through
  "Show X on the map".
- **The world-scope score sort is named for what it does.** Score is 0-100
  against the top place in the *same* country, so at world scope the option
  reads "By country, best first" and groups by country before ordering within
  it; inside a country it reads "Best first". "Nearest the middle of the map"
  is doc 2 §5's "distance from a chosen point" — the camera is the only point
  the traveler has expressed an opinion about.

## What is not built

- **Accounts and sync.** Local-first works: marking writes to local storage
  immediately and queues. The queue has no endpoint behind it yet.
- **A self-hosted PMTiles basemap.** Land and coasts are drawn from
  `countries.geojson`. The PMTiles URL is a one-line swap in `src/map/atlas.ts`.
- **`reach`.** It is `"near"` for every place. Nothing in the interface
  presents travel effort.
- **Atmosphere on the globe.** MapLibre 5.24 has a `sky` root property with
  `atmosphere-blend`, and it renders nothing here: set to magenta at full
  blend, against both the SwiftShader and the Metal ANGLE backends, the
  viewport outside the globe stays empty, and the `background` layer paints
  only the globe's disc so it is not covering it either. Re-check it in `npm
  run spike` at the next renderer upgrade.

## Traps for whoever picks this up

- **The accent means visited and nothing else.** No button, heading, link or
  chart may use it. The acceptance test enforces this — do not weaken it.
- **The visual language is swappable; the meaning is not.** `tokens.css` was
  replaced wholesale on 25 August 2026 (cool neutrals and Bodoni out, warm
  paper and Fraunces in) and all 216 acceptance checks passed untouched,
  because the suite reads `--accent` at runtime rather than pinning a hex.
  That is the line: reskin freely, but the accent still means visited, kinds
  are still shape and label, status is still its own family, and 44×44 /
  4.5:1 / 3:1 still hold. Every value in `tokens.css` is measured against
  those three ratios — change one and re-measure.
- **Land is painted at 0.92, not washed at 0.28.** The old palette's land and
  water were 1.03:1 apart, so the wash cost nothing. They are different
  colours now, and a wash throws the difference away — the globe goes back to
  one pale mass with the coastline doing all the work.
- **Score is country-relative.** Never sort a world-wide list by it, never
  render it bare. `scoreText()` exists so that cannot happen by accident.
- **Never show a completion percentage for a country**, and never use the word
  "archetype" in the interface. Both are enforced in `test/acceptance.mjs`.
- **`place_id` stability is a migration contract.** A rebuild that renumbers
  places destroys travel histories.
- **Places without a tile are legitimate.** Tiles only cover the parts of a
  country that carry a drilled hole.
- **One cancelled elevation tile is not a broken elevation model.** The
  renderer aborts DEM requests on every camera move. Declaring relief
  unreachable on the first error takes the layer off for the rest of the
  session, which is a worse lie than the flat surface the check exists to
  prevent — `DEM_FAILURES_BEFORE_GIVING_UP` in `src/map/atlas.ts` and the
  `sourcedata` success latch are why.
- **37 register countries are not in the passport index** — dependencies and
  overseas territories. They are shown as not stated rather than inheriting a
  sovereign's policy, which would be inventing a legal claim.
