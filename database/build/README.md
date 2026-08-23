# Running a world build

These scripts turn the raw downloads in `../data/` into the place database. They
add nothing to the model: every parameter still comes from `twm/config.py`, and
`twm/pipeline.py` is untouched.

```bash
export TWM_DATA=../data TWM_PKG=.. TWM_DIST=../dist
python build/prepare.py         # repair the WHS XML, expand it per state party,
                                #   normalise the settlement layer, write countries.json
python build/agglomerate.py     # collapse GeoNames suburbs into urban centres
python build/normalise_wdpa.py  # merge WDPA parts, map ISO3 codes to country names
python build/build_world.py     # run the pipeline, write dist/
python build/build_territories.py   # merge admin-1 units into the printed map's tiles
python build/export_app_bundle.py   # reshape dist/ into the bundle the web client loads
python build/verify.py          # check the invariants the two products depend on
python build/diagnose.py France Lourdes Paris   # why did a place score what it scored
```

## What each script exists to fix

**prepare.py** — the World Heritage export carries unbalanced inline HTML inside
`short_description` and named HTML entities that are not XML entities, so a
strict parser rejects the file. It also expands each inscription to one row per
state party: a transnational site like the Carpathian beech forests is inscribed
on behalf of eighteen countries, and a single point would credit only one.
Deduplicated to one point per country, so a serial site inside one country still
counts once.

**agglomerate.py** — GeoNames' unit is the named populated place, so a city
appears repeatedly as its own districts. Because assets attach to the *nearest*
candidate, a suburb centroid closer to a medina than the city centroid steals
it. Fes lost its own medina to "New Fes" before this step existed. Absorbs a
settlement into a larger neighbour within a population-scaled radius
(5/8/12/18 km) only when it is under 40% of that neighbour's population, so two
comparable cities never merge. 33,980 → 26,007 candidates.

**normalise_wdpa.py** — WDPA labels a protected area with an ISO3 code while the
settlement layer uses country names, so every protected area promoted into a
place formed its own country bucket, with its own quota and its own
normalisation maximum. Also merges harvest parts and drops duplicate WDPAIDs,
since a transboundary area appears in the file of every country it touches.

**build_world.py** — wires the adapters to local files, because the build
machine has no route to the upstream hosts. `LocalWorldHeritage` is the shipped
adapter with `fetch()` pointed at a file. `LocalWikidata` reads a harvested CSV
because the WDQS label service made every live query exceed the endpoint's
timeout; it keeps no labels, which is safe only because `orphans_to_sites` never
promotes an asset below weight 4.0 and `wikidata_multilingual` weighs 2.0.

**export_app_bundle.py** — the pipeline emits places and territories in the
order it derives them, which leaves three things a client cannot work with:
every place has a null `territory_id` (territories are built after the app
export, and only *printed* places are ever assigned to one), `territories.json`
carries no geometry at all, and the whole world arrives as one 3.7 MB blob. This
assigns every place to its tile by point-in-polygon, dissolves the admin units
into tile and country outlines, and splits the register per country behind a
manifest. It changes no score, no selection and no id.

**diagnose.py** — prints tier counts, pillar values and the composite for named
candidates side by side. Reach for this before concluding the model is wrong: on
this build every surprising ranking turned out to be a gap in the asset layer.

## Where the data comes from

See the project memory note "Build status" for the exact URLs, the browser
download technique, and the traps — Chrome blocks `.zip` from a scripted
download and throttles repeated automatic downloads per origin; the WDPA CSV
export has no coordinates, so centroids must be read out of the shapefiles;
WDQS times out unless you drop the label service and page by country.
