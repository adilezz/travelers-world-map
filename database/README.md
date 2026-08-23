# Travelers World Map — database construction

Builds the place database that both products read: the web application, which
shows every place, and the printed map, which shows the subset that fits 3,000
drilled holes.

One database, two renderings. The printed map's constraints — a hole budget and a
physical minimum distance between two holes — filter the output. They never
remove a place from the database. That separation is deliberate: about a third of
the world's essential places sit within 60 km of another one, and at world scale
they cannot be separate holes. In the app they are separate entries.

## Install

```bash
pip install -e ".[dev]"
twm --help
```

## Use

```bash
twm sources                          # adapters, licences, and which may cross a border
twm scale --width-m 3.0              # the printed map's arithmetic
twm build --config build.json        # run the pipeline
twm inspect --country Nepal          # what was chosen, and what did not make the map
twm conflicts                        # places too close to both be holes → inset panels
```

A build configuration names the adapters and where operator-supplied files live:

```json
{
  "countries": { "Morocco": { "area_km2": 446550, "iso": "MA" } },
  "sources": {
    "unesco-whs": {},
    "wikidata":   {},
    "osm":        { "iso_codes": ["MA"] },
    "ghsl-ucdb":  { "path": "data/ucdb.csv" },
    "wdpa":       { "path": "data/wdpa.csv" },
    "unesco-ich": { "path": "data/ich.csv" },
    "cuisine":    { "path": "data/cuisine.csv", "strict": true }
  }
}
```

Outputs land in `dist/`: `app_places.json` (everything), `printed_places.json`
(the subset plus the pairs that need inset panels), `build_report.json`, and a
DuckDB file holding the full tables.

## How it works

```
sources → candidates → assets → catchments → absorption → archetypes
        → scoring → app database
        → quotas → coverage selection → territories → printed map
```

| Module | Does |
|---|---|
| `config.py` | Every parameter, with the reasoning attached to each one |
| `types.py` | Asset, Candidate, Scored, Place, Territory |
| `sources/` | One adapter per dataset; see `base.py` for the contract |
| `assets.py` | Catchment assignment, absorption, coherence |
| `archetypes.py` | Deriving what *kind* of place something is |
| `scoring.py` | The model: tiered sums, pillars, feasibility, composite |
| `select.py` | Quotas and coverage selection for the printed map |
| `territories.py` | Merging administrative units into physical tiles |
| `pipeline.py` | Orchestration |
| `store.py` | DuckDB persistence and the two exports |

## Five things that will look wrong until you know why

**Asset tiers discount *within* a tier, not across the whole list.** Discounting
across one sorted list saturates the entire pillar at ~6.7× the top asset, which
made a great capital and a mid-sized walled town score within 7% of each other.
Within a tier, the fortieth church still stops counting but heritage depth stays
visible.

**Pillars combine through a power mean, not an average.** An average rewards
being balanced. The most essential places are extreme specialists — a great
national park has no monuments and must not lose to a town that is adequate at
everything.

**Normalisation is linear against the country maximum.** Percentile ranks are
ordinal and throw away the gap that matters. Log normalisation over-compresses
the top. And normalising per country is what stops a national heritage register
crossing a border: registers measure how thoroughly a country catalogued itself,
so `CROSS_COUNTRY_SOURCES` in `config.py` is the list allowed into any comparison
*between* countries.

**Feasibility is capped at 1.0.** It can only penalise. If good connectivity
earned points, the capital-city bias would come back through the door the rest of
the model just closed. Seasonality is metadata, never a penalty: a place
reachable four months a year is a place with a window.

**Distinctiveness ships disabled (`beta = 0`).** The mechanism and all four
profile components are retained, but every positive value scored worse on
validation — including on the places it was designed to rescue. What makes a blue
mountain town remarkable is that it is painted blue, and no vector of language,
religion, building class and cuisine encodes that. Redesign it before enabling it.
It is an internal quantity: never a user-visible number, label, sort order or
export field.

## Tests

```bash
pytest            # unit, integration and doctests
ruff check .
```

The suite runs offline against `fixtures/pilot.json` — 166 hand-checked
candidates across five countries chosen to stress different failure modes. Each
test in `test_scoring.py` corresponds to a failure measured on real data before
the model was changed, so they are regression tests for judgement as much as for
code.

One caveat when reading `test_pipeline.py`: with only five countries, a pro-rated
world hole budget hands each of them a third to a half of its own candidate pool.
At that ratio nearly everything is selected and coverage selection necessarily
converges with ranking. The diversity tests therefore run at a realistic quota
(5–8 per country), which is the regime the printed map is actually in. There,
coverage roughly halves archetype redundancy against a ranking baseline held to
the same spacing constraint.

## Licensing

Every asset record carries `source`, `source_url` and `retrieved`. Without
per-record provenance a licence audit means rebuilding the database instead of
filtering it — cheap now, expensive later.

Two live constraints:

- **OpenStreetMap is ODbL.** Share-alike attaches on *distribution*, not on
  revenue. A publicly reachable application built on an OSM-derived database can
  trigger it whether or not money changes hands.
- **WDPA is non-commercial by default.** Fine during a proof of concept; check
  the position before the product earns anything.

## Disputed territories

No contested boundary is drawn. A disputed territory's outline dissolves into the
state administering it, and its places stay in the database with their own
coordinates — nothing is deleted. `DISSOLVE_INTO` in `config.py` holds the
mapping.

Cases where "the state administering it" is itself contested are deliberately
absent from that mapping and listed in `NEEDS_EXPLICIT_RULING`. `naturalearth.py`
warns when one appears in a build. Each needs a decision made on purpose rather
than inherited from whatever a data source happened to ship.
