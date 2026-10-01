# Travelers World Map — database

> **Status, 1 October 2026.** The v2 specification is in `../docs` (documents 1, 6, 7, 8). The code in this folder is the **v1 pipeline**. A measured review (`../docs/archive/v1/REVIEW-PLACE-DATABASE-2026-10.md`) found it builds places from towns and attaches landmarks to the nearest town, which is the root cause of most defects. It is kept as `legacy/` material until the v2 pipeline passes its gates. Do not publish new bundles from it.

## Where things are going

```
inputs/MANIFEST.json            pinned, hashed source snapshots
rules/                          classes.csv · kinds.csv · tiers.json
anchors/                        owner anchors, merge overrides, print overrides
registry/                       place_registry.parquet · v1_crosswalk.csv
golden/  holdout/               ground truth (document 7)
twm2/                           one module per stage
Makefile                        make build · make verify
legacy/                         the v1 pipeline below
```

The first milestone (M0, document 6 §10) writes the golden set, the holdout files and `make verify` as **failing tests**, then builds a five-country prototype: Egypt, Peru, Italy, Jordan, Tanzania.

## What the v1 code is still useful for

- `twm/geo.py`, `twm/regions.py`, `twm/territories.py`, `build/build_levels.py`, `build/build_full_tiles.py`: territory, region and tile geometry, to be reviewed against document 8.
- `twm/sources/unesco.py`: the World Heritage parser (repairs inline HTML, expands per state party).
- `data/`: harvested inputs. Nothing here is a source of truth for v2; sources are re-ingested from pinned snapshots.
- `tests/`, `fixtures/gates/`: gate fixtures worth porting.

## What v1 got wrong, in one list

Places from towns · assets attached to the nearest town · sites absorbed into settlements · score normalised to the country maximum · pillar harvest reaching 41 countries · broad kind signals without validation · identifiers from upstream ids with colliding prefixes · no assets table · two stores that disagree. Each is replaced in documents 1 and 6.

## Running the v1 pipeline (legacy)

```bash
pip install -e ".[dev]"
twm --help
pytest
```

See `build/README.md` for the v1 build scripts.
