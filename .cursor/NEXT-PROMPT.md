# POC to MVP — the whole plan, in order

Written 2026-08-23. This replaces the round-by-round task file. It is not one
round's work; it is the whole brief through to MVP, and it stays here until
every stage below is finished.

Since the last round the ground moved. A full review of the database, the
bundle, the geography and the client is now in `docs/REVIEW-POC-TO-MVP.md`,
and its §12 is the plan this brief carries. `docs/5 - MVP Specification.md`
was accepted by the owner and is the requirements document. Documents 1 to 4
were edited against the review — document 1 §2.2, §16.2, the new §16.3 and
§19 changed materially, and if you have read them before, read those four
sections again. The interface layout is now drawn:
`docs/Travelers World Map — MVP interface specification.pdf`, seven pages.

---

## Read this first, it is the only part that is not optional

**One.** The ten stages are in **dependency order, not priority order**. Stage
0 first. Stages 1, 2, 3, 4 in that sequence. Do not start a stage whose
predecessor's exit test has not passed. The temptation will be to fix the
client, because the client is where things look broken and where the feedback
is fast. Resist it. §4 of the review found 4,251 place pairs inside 15 km and
absorption logged as zero; §3 found 2,081 places carrying no kind at all and
seven of the twelve kinds empty; §5 found that the union of the tiles is not a
country and that Western Sahara ships as one. **Every one of those is upstream
of every pixel.** A beautiful sheet drawn over a database that thinks Aït
Melloul and Agadir are two places is a more convincing wrong answer than an
ugly one.

**Two.** This is **two tracks in one repository**, and they are not the same
kind of work.

| | Stages | Language | Lives in | Governed by |
|---|---|---|---|---|
| Database | 0–4 | Python | `database/` | Document 1, review §12 |
| Client | 5–9 | TypeScript | `webapp/twm-app/`, and a new `server/` | Document 5, document 3, `travelers-world-map.mdc` |

`.cursor/rules/travelers-world-map.mdc` is always in your context and is
written almost entirely about the client. **It still binds you on the client.**
On the database track its product rules bind you (`place_id` stability,
never inventing values, kinds are kinds) and its renderer and CSS rules do not
apply. Where this brief and that file disagree about the client, that file
wins. Where either disagrees with document 5, document 5 wins.

**Three.** A stage is finished when its **exit test passes on the published
bundle**, not on your working directory and not on a report you read by hand.
Stage 4 exists to make that sentence enforceable. Until stage 4 lands you are
on your honour; after it, the build says.

**Four.** Write your notes. `.cursor/AGENT-REPLY.md`, four lines, every time
you stop. Six rounds went by with that file empty while the code changed
substantially, and two decisions had to be reversed because the only record of
them was a diff. An argued refusal is useful. A silent one costs a round.

---

## The rules that do not change, restated because the database track can break them

The full list is in `travelers-world-map.mdc`. These four are the ones the
pipeline can violate without a browser ever opening:

- **`place_id` is a migration contract.** A rebuild that reuses an id for a
  different place silently destroys a traveler's history. If ids must move,
  that is a migration and it carries a mapping table. It is never a quiet
  renumber. Stage 0 makes this a gate.
- **Never invent a value.** `reach: "near"` for every place on Earth and an
  empty `best_months` presented as knowledge are worse than a blank field.
  Compute it or omit it. The client is already built to hide what is absent.
- **Score is 0–100 against the top place in the same country.** It is not
  comparable across borders and there is no world ranking. Anything that sorts
  the world by score is wrong, in the pipeline as much as in the interface.
- **A country is never a percentage.** Not in the bundle, not in a report, not
  in the interface.

---

## Where you are

**Reviewed 24 August 2026. Stages 0 to 4 pass. Stage 5 is where you are.**

Verified here, not taken from your reply: `verify.py` on the published bundle
`twm-e6d7b2a99993` — all checks pass, two warnings, both correct. Absorption
3720 across 128 countries. Twelve kinds present, none empty, no place without
one. Fes 100 / Marrakesh 88 / Rabat 80 holds. A1 reads former capitals. 194
countries marked unscored on livability rather than quietly scored at zero —
that was the most dangerous absence in the bundle and you handled it the right
way round. `regions.geojson` union equals country land within tolerance,
Tangier sits in Tangier-Tetouan, `ESH.json` is gone and no ESH polygon
survives. pytest 82 passed. Six broken fixtures each trip their own gate.
`npm run check` clean. Acceptance grew 130 → 171 checks with none removed and
the error filter byte-identical. That is a good five stages of work.

**Your work was uncommitted — roughly 300 files.** I committed it for you as
`bc58fcd` (stages 0–4) and `c4a6f3d` (the client half). Commit at the end of
every round from now on. A night's work living only in a synced folder is one
sync conflict away from gone.

**The client half is unverified and you should treat it as suspect.** You
changed eight source files and did not re-run the suite. Neither could I: on
the Linux VM `npm run build` dies because `node_modules` carries win32 rollup
binaries from the OneDrive sync, and there is no Playwright browser there. So
171 checks are written and zero have executed. Run them on the Windows side
before building anything further on top.

### Three things before stage 5 proper

1. **Yes — route the repair scripts through `publish.py`.** You asked, and the
   answer is that a gate is only as strong as the narrowest path to the live
   bundle. `repair_candidates`, `repair_geography` and `repair_signals` writing
   straight into `public/data` is precisely the hole stage 4 exists to close;
   the six rejections passing does not help if the fix path walks around them.
   Do this first — stage 5 starts changing the client against that bundle.
2. **Run the 171 checks and report the number.** `N/171`, honestly, including
   failures. Until then stage 5's exit test cannot be assessed.
3. **Resolve `app_places.json`.** Its absence skips the pipeline shape checks,
   so a whole class of gate is silently inactive. Either produce it or remove
   the dependency on it and say which.

Minor: `atlas.ts:104` still points glyphs at `demotiles.maplibre.org`. Not a
billed basemap, so not urgent, but it is an external dependency on the render
path and it should end up self-hosted.

**For Adil, not for you:** the disputed table is empty and the build warns on
Kosovo, Palestine and Taiwan. Leave it warning. Do not fill it.

---

## Stage 0 — One build, one number

**Why first.** §1 of the review found three different stories about the same
product: the manifest, the build report and the client each described a
different bundle. Nothing below can be measured while the repository disagrees
with itself about what shipped.

**Do**

- Give the bundle a build number — monotonic, or a content hash, your choice,
  but one value — and write it into `database/dist/build_report.json`,
  `database/dist/verification.txt`, the published `manifest.json`, and the
  client's about line.
- Make the client refuse to start against a bundle whose manifest totals do
  not equal its actual file counts. Refuse loudly, with the two numbers named.
  A silent mismatch is what produced the three stories.
- Make a rebuild that changes any existing `place_id` fail the build unless a
  mapping table is present that accounts for every moved id.

**Files.** `database/build/export_app_bundle.py`, `database/build/verify.py`,
`webapp/twm-app/src/core/bundle.ts`, `webapp/twm-app/public/data/manifest.json`.

**Exit test.** The manifest build number, the file counts on disk and the
number the client reports all agree. `verify.py` rejects a manifest you have
deliberately corrupted — change one count by one and watch it fail. A rebuild
with a renamed `place_id` and no mapping table fails.

**Releases.** Every later exit test in this document.

---

## Stage 1 — The candidate set

**Why here.** Scores computed over a bad list are arithmetic, not knowledge.
§4 found 4,251 same-country pairs within 15 km, `absorbed` recorded as zero on
a world build, and Germany carrying 26× Morocco's place count — which is a
fact about how completely one source was crawled, not about Germany.

**Do**

- Re-enable absorption, with a per-country audit log. `absorbed` is never zero
  on a world build; if it is, absorption did not run.
- Merge exact-coordinate transliteration pairs — Dzuunmod and Zuunmod are one
  place — into a single record carrying a `merged_from` list.
- Make agglomeration fold suburbs into their city. Aït Melloul is Agadir.
- Cap harvest-driven density so a country's count reflects what the country
  has, not how deep the crawl went.

**Files.** `database/twm/select.py`, `database/build/agglomerate.py`,
`database/twm/pipeline.py`, `database/twm/config.py`.

**Exit test.** Zero same-country pairs under 2 km, except deliberate pairs of
genuinely different kinds — and those are enumerated, not inferred. The
absorption log names a country and a count for every country that has one.
Germany's ratio to Morocco is defensible against the kind audit rather than
against the crawl depth.

**Do not** solve density by truncating to a top-N. That is a world ranking
wearing a filter's clothes.

---

## Stage 2 — The missing signals

**Why here.** The product's sentence — *"Still unseen: desert and steppe,
sacred and pilgrimage"* — cannot be said about a database in which most kinds
do not exist. §3 and §6 found seven of twelve kinds empty, 2,081 places with
no kind at all, and livability empty for 194 countries.

**Do**

- Finish the OSM livability harvest, **or** mark a country explicitly unscored
  on livability and carry that flag through to the panel. An empty pillar must
  not be able to look like a low one. This is the single most dangerous
  absence in the bundle, because it is the one that silently becomes a number.
- Land the landform work so A3 to A8 exist as kinds rather than as comments.
- Derive A1 from *"capital of"*, including former capitals — Fes, Meknes,
  Kyoto — not from the current-capital list. The current list is why an
  imperial-capital kind reads as a government-seat kind.
- Compute `reach` from a real gateway-time source or omit the field. Compute
  `best_months` or omit it.

**Files.** `database/twm/archetypes.py`, `database/twm/assets.py`,
`database/twm/scoring.py`, `database/build/prepare.py`,
`database/build/build_world.py`.

**Exit test.** The kind audit passes **as a gate**: no place without a kind,
every one of the twelve present somewhere in the world, and no country missing
a kind it materially has. Morocco still reads Fes 100, Marrakesh 88, Rabat 80
— if that ordering moves, something in the scoring moved with it and you need
to know which.

**Releases.** Stage 3, the sheets in stage 6, and the entire coverage claim.

---

## Stage 3 — Geography

**Why here.** §5 found that the union of the tiles is not a country, that a
tile named Tangier has its centroid at Taza, and that Western Sahara ships as
a country the product explicitly promised not to draw. Document 1 §2.2 was
rewritten for this stage; read it before you start.

**The distinction that stage 3 is built on:** a **web region** is a complete
tessellation of a country's land — every app place sits in exactly one, and
empty regions are kept. A **printed tile** is a manufacturing subset that
exists only where drilled holes exist. They share `place_id`. They do not
share polygons, and the client must never draw one in place of the other.

**Do**

- Generate `regions.geojson`: the tessellation. Every app place carries
  exactly one `region_id`, never null.
- Keep `territories.geojson` as the printed subset. `territory_id` stays
  nullable — a place with no printed tile is a legitimate place.
- Apply the dissolve alias table on the ISO code **and every spelling**. For
  Western Sahara that is at least `ESH`, `W. Sahara`, `Western Sahara` and
  `Sahrawi`. Matching one string is how it shipped last time. Places there
  carry `country: Morocco` and a separate `disputed: "ESH"` flag; coordinates
  are unchanged.
- Name every polygon **from the polygon**: the centroid's admin-1, else the
  largest settlement inside it, else a compass qualifier. Never from the merge
  accumulator — naming from the merge is exactly how a piece labelled Tangier
  ended up centred on Taza.
- Fix `territories._slug` duplicate ids properly here. The renumber-on-ISO3
  workaround must not be carried into the region layer.

**Disputed cases are the owner's ruling, not yours.** Kosovo, Taiwan,
Palestine, Northern Cyprus, Somaliland, Crimea, Kashmir. Build the
configuration table and make the build **warn on any unruled case it
encounters**. Do not decide one yourself, and do not quietly adopt the
upstream dataset's opinion — that is a decision too, just an unattributed one.

**Files.** `database/twm/geo.py`, `database/twm/territories.py`,
`database/build/build_territories.py`, `database/twm/config.py`.

**Exit test.** Region union equals country land within the documented
tolerance. No place without a `region_id`. No `ESH` polygon anywhere in the
bundle. Tangier sits in a region named for Tangier, or for a parent that
contains it. The build warns on an unruled disputed case.

**Releases.** Stage 5's region layer and stage 6's region sheet.

---

## Stage 4 — The gates

**Why here.** Document 1 §19, as it was written, could not fail anything — it
described checks whose failure produced a line in a log. So the published
build could fail §19 and ship, which is what happened. §19 has been rewritten
around the distinction between a **gate**, which aborts the publish and leaves
the previous bundle in place, and a **report**, which informs. Everything in
stages 1 to 3 can regress silently until it is a gate.

**Do.** Turn each of these into an assertion in `database/build/verify.py`
that aborts the publish: the kind audit, region coverage, dissolve
resolution, polygon naming, `place_id` stability, manifest agreement. Reports
stay reports and stay useful. No gate is ever satisfied by a warning.

**Exit test.** Each gate is proved by a **deliberately broken bundle that it
rejects**. Six gates, six broken fixtures, six rejections. A gate you have not
watched fail is a gate you have not written. `database/fixtures/` is where
they go.

**Releases.** The right to publish without reading the report by hand — which
is the only thing that makes the five client stages safe to work on.

---

## Stage 5 — Layers, density, search

The first client stage, and the one that turns three mutually exclusive views
into a map. Page 5 of the interface PDF draws all three controls.

**Do**

- Independent toggles: our own land polygons (on, always available), a
  geographic raster basemap (off), a street raster basemap (off), the region
  layer, the place layer, the printed-tile preview. The two rasters are
  mutually exclusive **basemaps**; regions and places are **overlays**; the
  tile preview is a separate mode and never a fourth basemap.
- Density: how many places to show **per country**, ranked by country-relative
  score then by name, with the warning that the number is local to each
  country — twelve places in Malta are not twelve places in Canada. The map
  and the register read the same cap.
- Search matches places, regions and countries. Choosing a hit **opens the
  sheet and does not move the camera**. "Show on the map" remains the only
  camera move in the product.

**Files.** `src/map/atlas.ts`, `src/ui/filter-bar.ts`, `src/core/filters.ts`.

**Exit test.** The acceptance suite passes **unweakened**, plus a new check per
toggle, and a check that a search selection leaves the camera where it was.

**Do not** ship a raster basemap on by default. A commercial basemap is a
per-load bill and it is on the Parked list below.

---

## Stage 6 — The three sheets

Page 3 of the interface PDF draws all three at 480 px.

**Do**

- One sheet pattern serving country, region and place, with the same hide
  control on the page and in fullscreen, 44×44.
- Pillar bars for built heritage, natural setting and living culture, each
  against the country maximum. The composite score stays country-relative.
- "Why it is here" names the assets in a traveler's words — two World Heritage
  inscriptions, a living medina — never the source keys.
- **Absence is shown as absence.** No seasonality row when `best_months` is
  empty. No travel-effort row when `reach` was not computed. "Unscored on
  livability" wherever stage 2 could not reach. A hidden row is honest; a
  zero-length bar is a lie about a real value.

**Files.** `src/ui/detail.ts`, `src/ui/why.ts`, `src/ui/coverage-meter.ts`.
`src/core/coverage.ts` is correct and is not to be touched.

**Exit test.** A place carrying only a name, coordinates and one kind renders
as a legitimate row rather than an error state. No percentage appears
anywhere. A country sheet containing a disputed place carries the one-line
note: *"Some places sit in territory whose sovereignty is disputed. We do not
draw that border."*

---

## Stage 7 — Accounts

**Do**

- Create `server/` per document 4: managed Postgres, row-level security,
  `visit / trip / trip_place / profile`, idempotent PUT, no hard delete of a
  visit.
- Email magic link and Google OAuth as **linked identities on one user**. A
  further provider attaches to the same user rather than creating a second.
- Merge on first sign-in: last-write-wins per `place_id` by `marked_at`.
  Local-first stays — the product works fully signed out, and signing out
  keeps the local copy.
- **Place data stays static files and never shares a database with user
  data.** The bundle is published; visits are private. They do not meet.

**Exit test.** A merge test in which a traveler marks places offline, signs
in, and loses nothing. Delete-account removes the server rows and offers an
export first.

---

## Stage 8 — Exports

Page 6 of the interface PDF draws both dialogs with their real warning copy.
Both always apply the **current filters**.

**Do**

- XLSX of the filtered set, or of the ticked rows if any are ticked, with a
  warning above 10,000 rows. A real `.xlsx`, readable without this product —
  not HTML wearing the extension.
- Printable map: suggested millimetres and place count per scope (world
  700 × 500 mm / 800 places, country 400 × 500, region 300 × 300), both
  editable by the traveler. **The alerts are advisory and never block**: below
  A4, "this will be a diagram, not a wall map"; implied pin spacing under
  4.5 mm, "pins will overlap, raise the size or lower the count"; the world at
  every place, the sentence about 60 km spacing and the hole budget.

**Exit test.** The spreadsheet opens in Excel and its columns match the filter
that produced it. The spacing warning fires exactly when the arithmetic says
pins will collide — test it either side of the boundary, not just inside it.

---

## Stage 9 — Trips and routing

**Do.** Keep collect → assign to days → see connected. Keep the straight line
as the offline default, labelled **"not a route"**. Add `route(from, to)`
behind `server/`, one paid provider, attributed, never called from the browser
with a vendor key. A wrong duration is worse than no duration: show one only
with the provider's attribution and a line saying it is a sketch.

**Exit test.** With the provider disabled the trip still draws and says
plainly what it is.

---

## Parked — the owner's decisions, not yours

Anything here is Adil's call. Do not implement it, and **do not implement a
variant of it**. If a task appears to need one, build up to the boundary, stop,
and say so in your notes.

- **Licences.** WDPA is non-commercial; OSM is ODbL. Both need an answer
  before revenue and the answer may change which layers can ship.
- **Basemap cost.** A commercial raster basemap bills per map load. It stays
  behind configuration and off by default until Adil rules.
- **Cuisine's two-source rule.** Wikidata plus two Wikipedia language editions
  is currently counted as two independent sources. It is one source read
  twice. Needs a ruling before it keeps its weight.
- **`ich_unesco`.** Held back at a 12% located sample. A sample chosen by
  editor attention is documentation bias inside a weight-8 tier. Either find
  coordinates for the rest or leave it out.
- **Every disputed-territory ruling.** Build the table and the warning; Adil
  fills the table.
- **Bevelled tile extrusion.** Still parked until MapLibre grows the property.
  Fake the grounding shadow; do not pretend a `try`/`catch` rounded a corner.

---

## What runs in parallel, and what genuinely does not

Stages 0 → 1 → 2 → 3 → 4 are strictly sequential.

Of the client stages, **7, 8 and 9 have no hard dependency on the database
work** — accounts, the export dialogs and trip routing are specified
independently of what is in the bundle. If you are blocked on a database stage
and waiting on a ruling, those three are where to go, in that order. **5 and 6
do have hard dependencies**: stage 5's region layer needs stage 3's
`regions.geojson`, and stage 6's pillar bars and absence rows need stage 2's
signals. Building either early means building against placeholder data, which
is how the current bundle came to look finished while being wrong.

---

## When a stage cannot pass

Say so, in `.cursor/AGENT-REPLY.md`, before moving on. Specifically:

- If an exit test cannot pass because a **data source is missing or
  unlicensed**, that is a finding, not a failure to route around. Name the
  source and stop.
- If an exit test cannot pass because **the test as written is wrong**, argue
  it. Do not weaken it. Never widen an error filter or an `expected` set to
  make a change pass — console noise from a new dependency is a finding about
  that dependency.
- If a stage's work would require a **parked decision**, build to the boundary
  and stop there.

---

## Finishing

A round is not complete until your notes are in `.cursor/AGENT-REPLY.md`, under
the marker. Four lines:

```
Did:      <what you finished, and which exit test now passes>
Skipped:  <what you did not, and why>
Unsure:   <anything you guessed at>
Blocked:  <anything you need Adil or the reviewer to decide>
```

Before claiming any client stage is done: `npm run check` and
`webapp/twm-app/test/acceptance.mjs` both pass, with new checks added for new
behaviour, each quoting the rule it defends. Before claiming any database
stage is done: the exit test runs against the published bundle, not the
working directory.

The whole brief is finished when stage 9's exit test passes and the six gates
from stage 4 are still green.
