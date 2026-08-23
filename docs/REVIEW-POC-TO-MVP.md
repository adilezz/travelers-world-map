# Critic review: proof of concept → MVP

**Date:** 23 August 2026
**Scope:** place database (definition, scoring, selection), tiles, published artefacts, and the web client.
**Artefacts measured:** `database/dist/app_places.json` (11,918 places), `territories.json` (743 tiles), `twm-app-bundle.zip`, `build_report.json`, pipeline source in `database/twm-database.zip`, and `webapp/twm-app`.

This is a critic's report, not a build log. The model on paper is unusually careful. The published database does not yet keep the promises in documents 1–4. The web client is a working proof of the *coverage* idea, not an MVP of a traveler's atlas.

**Accepted 23 August 2026.** Document 5 is the requirements document for the web atlas. Document 2 is historical. This file is the critic record, not the product description.

---

## Verdict

The distinctive product is real and should be kept: **not how many countries, which kinds of place you have never been to.** That sentence is still the product.

The published map cannot yet be trusted as a picture of the Earth.

| Layer | Grade | Why |
|---|---|---|
| Place *model* (formula, pillars, country-relative score) | Strong | The power mean, within-tier discount, country-relative 0–100, and “feasibility only penalises” are the right shape. |
| Place *build* (what actually shipped) | Fail | 7 of 12 kinds empty; 2,081 places with no kind; absorption recorded **0**; every `reach` is `"near"`; every `best_months` is empty; OSM livability reached 41 countries. |
| Tile *model* (printed object) | Sound for a wall map | 3–6 holes, 160 km handling, no contested borders. |
| Tile *use on the web* | Fail | Empty land is dropped, so the union of tiles is not a country. Names come from the merge winner, not from where the polygon sits. |
| Web client | Proof of concept | Coverage meter, register, marking, passport, three-scope panel, trips as straight lines. No accounts, no tessellating tile layer, no density control, no spreadsheet or print export, no routing. |

**Do not ship this database as “the world.”** Ship it as a coverage prototype while a rebuild closes the defects below.

---

## 1. Two artefacts, two stories

The repo currently tells three different stories about the same product.

| Source | Places | Countries | Kinds with data | Tiles |
|---|---|---|---|---|
| Published bundle + `app_places.json` (what the app loads) | **11,918** | 233 | **5** (A2, A9–A12) | 743 |
| `build_report.json` / `verification.txt` (a later unpublished run) | 15,770 | 235 | 9 claimed | 803 |
| Root `README.md` | “five countries” | — | — | — |

The live client is the **11,918** build. Document 2's build prompt and the workspace rules were written against a mix of both. That is a release-engineering failure: a traveler's `place_id` history cannot be attached to a database that is not the one on disk.

**Edit required:** one numbered build, one manifest, one README figure. A rebuild that changes identifiers is a migration, not a publish.

---

## 2. Database definition — what is right

Document 1 is still the right model. Keep these without relitigation:

- One database, two renderings. The printed hole budget must never delete an app place.
- Score is 0–100 against the best place **in the same country**. Never a world ranking.
- Population is not a scoring input.
- National registers do not cross a border. Only globally adjudicated sources do.
- Feasibility is a cap at 1.0. Connectivity must not buy a higher score.
- Distinctiveness (`beta`) stays internal and stays off until it is redesigned. It is not a user-facing number.
- `place_id` is a migration contract.

The pipeline in `twm/config.py` matches that document. The problem is not the formula. It is that most of the formula's inputs are missing or idle.

---

## 3. Score calculation — per variable

Composite (document 1 §11, `twm/scoring.py`):

```
V = (0.30·Ĥ² + 0.35·N̂² + 0.35·L̂²)^(1/2)  ×  D  ×  F
```

Each pillar is linearly normalised to the country maximum, then combined with a power mean (`p = 2`). D ships at 1.0 (`beta = 0`). F ships at 1.0 for every published place (`reach = "near"` everywhere).

### 3.1 Built heritage (Ĥ) — weight 0.30

| Input | Source | Status in the published build |
|---|---|---|
| World Heritage cultural / mixed | UNESCO WHS XML | Present. 1,276 places carry `unesco-whs`. |
| Tentative list | UNESCO | Thin; not broken out in the export. |
| National top-rank designation | Wikidata | Partial. 6,802 places carry `wikidata`. |
| Multilingual encyclopaedia items | Wikidata sitelinks | Partial. |
| OSM historic / religious / museum / theatre | OSM Overpass, 41 countries | **Biased.** 5,842 places carry `osm`. Germany has **795** app places; Morocco has **30**. That is harvest coverage, not heritage. |

Coherence (intact quarter vs scattered monuments) is implemented. It cannot save a country whose OSM harvest never ran.

### 3.2 Natural setting (N̂) — weight 0.35

| Input | Source | Status |
|---|---|---|
| World Heritage natural / mixed | UNESCO | Present. |
| IUCN I–II, Ramsar, geopark, other WDPA | WDPA (non-commercial licence) | 4,803 places carry `wdpa`. Licence still unresolved before revenue. |
| Landform in catchment, rarity-weighted | Compiled `landforms.csv` + frequency table | **A4, A5, A6, A8 are empty** in the published build. The landform layer is not driving kinds. |
| Relief range, cap 3,000 m | Elevation | Not visible in the export; A4 still empty. |

The rarity function `1 + 1.6·(−log₂ f − 2)`, capped at 6 and further capped when a country has a single instance, is the right idea. It is not firing for forest, volcano, desert, or high mountain in the published set.

### 3.3 Living culture (L̂) — weight 0.35

| Input | Source | Status |
|---|---|---|
| UNESCO ICH | ICH lists + a located table | Partial. |
| Cuisine regions | Compiled CSV, two-source rule | 3,042 places carry `cuisine`. |
| Pilgrimage, markets, institutions, craft | OSM + Wikidata | OSM-bound, same 41-country hole. |
| Festivals | Wikidata | Thin. |

### 3.4 Distinctiveness (D)

Ships at `beta = 0`. Correct, given validation. Do not surface it. Do not “tune it on” for MVP.

### 3.5 Feasibility (F)

| Component | Specified | Published |
|---|---|---|
| Hours to international gateway | 1.0 / 0.9 / 0.7 / 0.5 | **All `near` (1.0)** |
| Lodging in catchment | 1.0 else 0.6 | Not discriminating |
| Closed / restricted / overtourism | Exclude or 0.85 / 0.8 | Not visible |
| Seasonality | Metadata, never a penalty | **`best_months` empty for every place** |

Until F varies, the composite is just the power mean of three incomplete pillars.

### 3.6 What the traveler is shown

The place panel's “why it is here” sentence is derived from `sources[]` and WHS count (`webapp/twm-app/src/ui/why.ts`). That is honest provenance. It is **not** a breakdown of Ĥ / N̂ / L̂, so a traveler cannot see *why this scores 86 in Morocco*. MVP must show the three pillars as country-relative bars, plus the assets that actually contributed.

**Edits required**

1. Finish landform harvest so A4, A5, A6, A8 exist as kinds, not as comments.
2. Finish OSM livability for all 235 countries, or drop livability from countries it has not reached and say so in the panel.
3. Compute reach from a real gateway-time source, or hide “when to go” and travel effort until that source exists. Do not invent months.
4. Show Ĥ / N̂ / L̂ in the place sheet. Keep the composite country-relative.
5. Assert in `verify.py`: no place without at least one kind; no country whose top place has empty pillars that the country actually has (kind audit, document 1 §19).

---

## 4. Place selection

**App inclusion** (`pipeline.py`): feasibility > 0 and score ≥ 10% of the country maximum.

**Printed inclusion:** greedy coverage under 60 km spacing, world hole budget 3,000, quota from area + kinds + global assets, floors of 1 and (if ≥ 6 kinds) 6.

That split is correct. What failed is the candidate set and absorption.

### 4.1 Near-duplicates (measured on 11,918 places)

| Distance | Pairs in the same country |
|---|---|
| ≤ 2 km | 82 |
| ≤ 5 km | 431 |
| ≤ 15 km | 4,251 |

Examples at ~0 km: **Dzuunmod / Zuunmod** (Mongolia, transliteration). At 0.2 km: Maasmechelen / Mechelen-aan-de-Maas; Sumayl / Simele; Yanacancha / Cerro de Pasco.

`build_report.json` records `"absorbed": 0` and `"retained_sites": 0`. Absorption is specified (`absorb_similarity = 0.5`) and implemented (`twm/assets.py`) and **did not run on the published build**, or ran on a candidate set that had already collapsed to settlements.

**Edits required**

1. Treat transliteration pairs (same coordinates, same country, Levenshtein/unidecode match) as one place. Keep a `merged_from` list.
2. Re-enable absorption with an audit log per country. A city and a mountain 55 km apart must still both survive.
3. Agglomeration (`settlements_agglomerated.csv`) must fold suburbs (Aït Melloul / Agadir at 12.6 km both present).
4. Cap OSM-derived density so Germany cannot have 26× Morocco's place count unless the kind audit says Morocco has 26× less to show — which it does not.

### 4.2 Selection quality vs the owner's examples

Morocco in the published app: **30 places**. Tangier is there. Laayoune is not in Morocco; it is a separate country row. Essaouira, Marrakesh, Fes, Chefchaouen, Rabat exist. The list is a thin OSM/GHSL skeleton, not “what a person who had lived there for generations would insist you see.”

Germany: **795 places**. That is not a more interesting country. It is a more complete Overpass harvest.

---

## 5. Tiles — definition, construction, and why they look absurd

### 5.1 How they are built

`twm/territories.py` + `build/build_territories.py`:

1. Load Natural Earth admin-1.
2. Dissolve `"W. Sahara"` → `"Morocco"` **if the country string matches**.
3. Assign **printed** places (not app places) to containing units.
4. **Drop units with zero printed places.**
5. Split units with more than 6 places along admin-2; merge units with fewer than 3.
6. Name the merge result after the fragment that had more places.
7. Flag extent < ~160 km as unprintable.

Document 1 §2.2 says territories exist for the printed map and **the web application has no use for them**. Document 2 then makes “Tiles” a first-class view. The web client treats those polygons as geography. They are not geography. They are **manufacturing lots around drilled holes.**

That single contradiction is the root of: “combining all tiles does not give a full map.”

### 5.2 Measured coverage

- 743 tiles, 610 printable.
- **598 app places have no `territory_id`** (5.0%).
- **45 printed places have no tile.**
- **11 countries with places have zero tiles** (French overseas departments, Svalbard, US minor outlying islands, …).
- Morocco: 4 tiles, bbox-overlap proxy **0.70** — the interior and much of the south are not in any tile.
- France: 17 tiles, proxy **0.017** — overseas polygons inflate the country bbox; Métropole is not a tessellation either.
- Netherlands: proxy **0.003**.

Empty land is dropped on purpose. On a wall map that is acceptable (you do not cut a blank magnetic piece). On a web globe it reads as a broken layer.

### 5.3 Tangier-Tetouan is not at Tangier

| | Latitude | Longitude |
|---|---|---|
| Tangier the city | 35.767 | −5.80 |
| Tile `MAR-T04` “Tangier-Tetouan” centroid | **34.084** | **−3.551** |

That centroid is ~200 km east-south-east of Tangier, pulled by **Oujda, Taza, Fes, Al Hoceïma, Midar** — all assigned to the same tile. The name is the merge winner (Tangier-Tetouan had more printed holes than Oriental / Fès-Boulemane when they were glued together). A traveler looking at Morocco sees a piece labelled Tangier sitting inland toward the Algerian border.

The southern tile is `MAR-T03` “Suss-Massa-Draa” (centroid 28.49, −9.89). It contains Agadir **and** Laayoune / Boujdour.

**Edit required:** name a tile from the polygon, not from the merge accumulator. Use, in order: (1) the admin-1 that contains the polygon centroid, (2) else the most populous settlement inside it, (3) else a compass qualifier (“Eastern Morocco”). Never keep “Tangier” for a blob whose centroid is at Taza.

### 5.4 Laayoune / Western Sahara

Documented policy (`DISSOLVE_INTO`): no contested border is drawn; Western Sahara's outline dissolves into Morocco; places keep coordinates.

What shipped:

| Place | `country` field | `territory_id` | Score |
|---|---|---|---|
| Laayoune | **Western Sahara** | MAR-T03 (Suss-Massa-Draa) | 20, **no kinds** |
| Boujdour | Western Sahara | MAR-T03 | 98 |
| Dakhla | Western Sahara | **none** | 100 |
| El Marsa | Western Sahara (unpublished report) | — | — |

`countries.geojson` includes a separate **Western Sahara / ESH** polygon. The dissolve key is `"W. Sahara"` (Natural Earth 110m `NAME`). Place rows say `"Western Sahara"`. The strings never meet, so the policy never applies.

Laayoune is therefore:

1. a country the product promised not to draw, and
2. a hole in a tile named for the Souss, 800 km from Agadir's name-sake.

**Edits required**

1. Alias table: `W. Sahara`, `Western Sahara`, `ESH`, `Sahrawi` → dissolve target Morocco for **outlines and `country` labels**. Coordinates stay.
2. Passport: do not silently inherit Morocco's visa regime for ESH; say “not stated — disputed territory” unless you have a sourced rule.
3. Add the same alias discipline for Kosovo, Taiwan, Palestine, Northern Cyprus, Somaliland, Crimea, Kashmir — still listed as needing an explicit ruling and still unruled.

### 5.5 What “tiles” must mean on the web

Split the object in two.

| Object | Job | Geometry |
|---|---|---|
| **Web region** | Navigation, filters, the side sheet | A complete tessellation of each country's land (and optionally EEZ later). Every app place sits in exactly one region. Empty regions are allowed; they read as “no places here yet.” |
| **Printed tile** | The magnetic piece | Subset of regions, 3–6 holes, 160 km minimum, insets for dense belts. May omit empty land. |

The web layer is not allowed to be the printed layer. That is the edit that makes “combining tiles gives a map” true.

---

## 6. Kinds of place — the product is hollow until twelve kinds exist

Published counts (a place may carry more than one kind):

| Code | Kind | Places |
|---|---|---|
| A1 | Imperial & historic capital | **0** |
| A2 | Living old town / medina | 60 |
| A3 | Coastal & maritime | **0** |
| A4 | High mountain | **0** |
| A5 | Desert & steppe | **0** |
| A6 | Forest & jungle | **0** |
| A7 | Lake & river | **0** |
| A8 | Volcanic & geothermal | **0** |
| A9 | Wildlife & wilderness | 3,543 |
| A10 | Sacred & pilgrimage | 775 |
| A11 | Rural vernacular & agrarian | 4,997 |
| A12 | Modern metropolis & industry | 1,894 |
| — | **No kind at all** | **2,081** |

A2 is almost unused (60 worldwide) because `historic_capital` is never set (A1) and medina coherence almost never fires. A3 is empty because `coast` never lands on candidates despite a coastline world. The coverage sentence cannot say “still unseen: desert and coast” if desert and coast are not in the database.

Document 1 §19: *no kind of place absent worldwide; no country lacking a place for a kind it materially has.* The published build fails both.

**Edits required:** landform + capital + coast signals in the same rebuild as the tessellation fix. Drive the UI from `manifest.archetypes` so new kinds light up without a client change (already the rule — keep it).

---

## 7. Web client vs the MVP you asked for

What the POC already does well (keep):

- Globe → Mercator; selecting does not zoom; marking does not move the camera.
- Atlas / street / tiles as a view switch; zoom and fullscreen controls exist.
- Horizontal filters (visited, kinds, passport, months, search) with a hide control.
- Three-scope detail: country, tile, place, including “why it is here” and outbound Maps / OSM / Wikipedia / Commons links.
- Register as the accessible equivalent of the map.
- Local-first marking, JSON export/import, bulk mark, trips as ordered days with straight lines.
- Accent reserved for visited. No completion percentage. No “archetype” in the UI.

What it does not do (MVP gaps):

| Ask | POC | MVP |
|---|---|---|
| Login, account, Google/Apple link | Onboarding copy only | Optional account; OAuth; merge-on-sign-in; local-first remains |
| Independent layers (geo, street, tiles, places) | Mutually exclusive *views* | Toggles: basemap geo **or** street; tiles on/off; places on/off |
| Density: N places, distributed across countries | None | View filter: top-N **per country** by country-relative score, with a warning that 10 in Luxembourg ≠ 10 in Russia |
| Search that flies the camera | Search filters; “Show on the map” is the only camera move | Keep that split. Search pick → opens sheet. A separate “Show on the map” flies. Do not zoom on select. |
| Trip routing (Rome2Rio etc.) | Straight lines, as document 2 required | Provider interface; one implementation behind a proxy; straight lines remain the offline default |
| Country / tile / place sheets, hideable in page and fullscreen | Mostly; fullscreen + hidden register is cramped | One sheet pattern; same hide control in both modes; 44×44 |
| XLSX of the current filter | JSON of visits only | Filtered rows → `.xlsx` |
| Printable map with suggested size and place count | None | Poster export; suggest dimensions and N; warn if the user overrides past the 60 km / 4.5 mm rule |

**Do not** replace MapLibre with the Google Maps JavaScript API. Document 2 §11 and document 4 §9.1 still hold: vendor place content cannot sit on our basemap; per-load billing ties cost to success; interior rings for drilled holes go away.

**Do not** add leaderboards, streaks, or a global score sort.

Commercial raster basemaps (CARTO) stay behind config, default **off**, until you rule on cost. Default ground remains our country polygons.

---

## 8. Architecture edits for MVP

1. **`server/`** as document 4: managed Postgres, RLS, `visit / trip / trip_place / profile`, the seven endpoints, idempotent PUT, merge on sign-in, no hard delete of visits.
2. OAuth (Google first) as *linked identity*, not as the place database.
3. Place data stays static files. User data never shares that database.
4. Routing: `GET /route?from=&to=` on the server; client draws whatever geometry comes back, or a straight line if the provider is down.
5. Export: client can write XLSX from the filtered pin list without the server; print layout can be client-side SVG/PDF.
6. Web regions generated in the pipeline as `regions.geojson` (full tessellation). Printed tiles stay `territories.geojson`. The client must not reuse printed tiles as the region layer.

---

## 9. UI direction (Material as structure, plate as skin)

Use Material 3 **roles**, not a generic Material travel skin:

| Material role | This product |
|---|---|
| Top app bar | Identity, search, account, export |
| Filter chips | Kinds, visited, passport, density |
| Standard side sheet | Country / region / place |
| FAB | None. Marking is the sheet control, 44×44, not a floating accent. |
| Navigation bar | Not used. The map is the navigation. |
| Dialog | Export options and dimension warnings only. Never for marking. |

Tokens stay document 3: cool neutrals, accent = visited only, 2px / 4px radius, hairline elevation. The canvas `mvp-ui-shell.canvas.tsx` is the layout contract.

---

## 10. Edit list (checklist)

### Data pipeline (blocks MVP)

- [ ] Single published build; README, manifest, and app bundle agree.
- [ ] Dissolve alias table; Laayoune's `country` is Morocco (or “Morocco (disputed)” in a legal note, not a second country polygon).
- [ ] No ESH polygon in `countries.geojson`.
- [ ] Absorption + transliteration merge; `absorbed` in the report is not zero on a world build.
- [ ] OSM livability world coverage, or explicit “unscored on livability” in the panel.
- [ ] Landform harvest: A3–A8 and A1 no longer worldwide-empty.
- [ ] Kind audit: 0 places with an empty kind list.
- [ ] Web `regions.geojson`: union equals country land; every app place has a `region_id`.
- [ ] Printed tiles remain a subset; naming from centroid / largest city.
- [ ] Tangier region contains Tangier and Tetouan, not Oujda.
- [ ] `verify.py` fails the build on dissolve misses, empty kinds, and region gaps.

### Scoring / panel

- [ ] Pillar bars Ĥ / N̂ / L̂ on the place sheet.
- [ ] Hide reach and months until values exist.
- [ ] “Why it is here” stays provenance-true; add asset names, not just source keys.

### Web MVP (after the rebuild)

- [ ] Accounts + OAuth + merge; local-first preserved.
- [ ] Layer toggles (basemap, regions, places), not three exclusive views.
- [ ] Density control, per country.
- [ ] Filter bar and sheet hide/show in page and fullscreen, 44×44.
- [ ] XLSX export of the current filter.
- [ ] Printable map: suggested mm and N, editable, with warnings.
- [ ] Trip provider interface; straight lines if offline.
- [ ] Basemap vendor still an owner cost decision; default off.

### Documentation

- [ ] Promote `docs/5 - MVP Specification.md` if you accept this review.
- [ ] Root README matches the 11,918 (or successor) build and the thesis.
- [ ] Documents 1–4 remain the POC contract until that promotion.

---

## 11. What not to do

- Do not add a second meaning-bearing colour on the map.
- Do not sort the world by score.
- Do not show a completion percentage for a country.
- Do not hard-delete visits.
- Do not zoom on select or mark.
- Do not implement a model-level site merge that rewrites `place_id`s.
- Do not treat Rome2Rio (or any vendor) as a source of place identity.
- Do not cut blank magnetic tiles for empty Sahara just to make the wall map look “full.” Emptiness on the wall is honest. Emptiness on the web region layer is a hole in the product.
