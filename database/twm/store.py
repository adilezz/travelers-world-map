"""
Persistence and export.

DuckDB is the store: it reads the Parquet the open datasets ship in, handles the
join volumes without a server, and exports the exact shapes the two products
need. The database file is a build artefact -- reproducible from sources plus the
pipeline, never edited by hand.

Two exports, one table:
  * app_places.json      every place, for the web application
  * printed_places.json  the subset that survives the hole budget and spacing rule
"""
from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from twm.pipeline import BuildResult
from twm.types import Place, Territory

SCHEMA = """
CREATE TABLE IF NOT EXISTS places (
    place_id        VARCHAR PRIMARY KEY,
    name            VARCHAR NOT NULL,
    country         VARCHAR NOT NULL,
    lat             DOUBLE  NOT NULL,
    lon             DOUBLE  NOT NULL,
    is_site         BOOLEAN NOT NULL,
    score           INTEGER NOT NULL,
    archetypes      VARCHAR[],
    archetype_weights DOUBLE[],
    whs             INTEGER,
    reach           VARCHAR,
    best_months     INTEGER[],
    on_printed_map  BOOLEAN NOT NULL,
    printed_rank    INTEGER,
    territory_id    VARCHAR,
    sources         VARCHAR[],
    merged_from     VARCHAR[]
);
CREATE TABLE IF NOT EXISTS territories (
    territory_id    VARCHAR PRIMARY KEY,
    name            VARCHAR,
    country         VARCHAR,
    place_ids       VARCHAR[],
    admin_units     VARCHAR[],
    geometry_wkt    VARCHAR,
    dominant_archetypes VARCHAR[],
    printable       BOOLEAN
);
CREATE TABLE IF NOT EXISTS build_manifest (
    key VARCHAR, value VARCHAR
);
CREATE INDEX IF NOT EXISTS places_country ON places(country);
CREATE INDEX IF NOT EXISTS places_printed ON places(on_printed_map);
"""


class Store:
    def __init__(self, path: str | Path = "twm.duckdb"):
        import duckdb

        self.path = Path(path)
        self.con = duckdb.connect(str(self.path))
        self.con.execute(SCHEMA)

    def write_places(self, places: list[Place]) -> int:
        self.con.execute("DELETE FROM places")
        self.con.executemany(
            "INSERT INTO places VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [(p.place_id, p.name, p.country, p.lat, p.lon, p.is_site, p.score,
              p.archetypes, p.archetype_weights, p.whs, p.reach, p.best_months,
              p.on_printed_map, p.printed_rank, p.territory_id, p.sources,
              p.merged_from) for p in places],
        )
        return len(places)

    def write_territories(self, territories: list[Territory]) -> int:
        self.con.execute("DELETE FROM territories")
        self.con.executemany(
            "INSERT INTO territories VALUES (?,?,?,?,?,?,?,?)",
            [(t.territory_id, t.name, t.country, t.place_ids, t.admin_units,
              t.geometry_wkt, t.dominant_archetypes, t.printable)
             for t in territories],
        )
        return len(territories)

    def write_manifest(self, manifest: dict) -> None:
        self.con.execute("DELETE FROM build_manifest")
        self.con.executemany(
            "INSERT INTO build_manifest VALUES (?,?)",
            [(k, json.dumps(v)) for k, v in manifest.items()],
        )

    def close(self) -> None:
        self.con.close()


# ------------------------------------------------------------------------ exports
def export_app(result: BuildResult, out_dir: str | Path,
               archetype_labels: dict[str, str] | None = None) -> Path:
    """Everything, for the web application. No spacing rule applies here."""
    from twm.config import ARCHETYPES

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    payload = {
        "places": [_thin(p) for p in result.places],
        "archetypes": archetype_labels or ARCHETYPES,
        "countries": {
            country: {
                "in_app": stats["in_app"],
                "on_printed_map": stats["on_printed_map"],
            }
            for country, stats in result.stats.get("per_country", {}).items()
        },
        "generated": result.stats.get("generated", ""),
    }
    path = out / "app_places.json"
    path.write_text(json.dumps(payload, separators=(",", ":")), "utf-8")
    return path


def export_printed(result: BuildResult, out_dir: str | Path) -> Path:
    """The subset that gets a drilled hole, plus the conflicts that need insets."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    payload = {
        "places": [_thin(p) for p in result.printed],
        "quotas": result.quotas,
        "inset_candidates": {
            country: conflicts
            for country, conflicts in result.conflicts.items() if conflicts
        },
        "hole_budget": result.stats.get("hole_budget"),
    }
    path = out / "printed_places.json"
    path.write_text(json.dumps(payload, separators=(",", ":")), "utf-8")
    return path


def export_report(result: BuildResult, out_dir: str | Path) -> Path:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    path = out / "build_report.json"
    path.write_text(json.dumps({
        "stats": result.stats,
        "absorption": result.absorption_log,
        "conflicts": result.conflicts,
    }, indent=1, default=str), "utf-8")
    return path


def _thin(p: Place) -> dict:
    """Trim to what a client needs. Coordinates to 4 dp -- about 11 m, far finer
    than the 60 km at which two places become one hole."""
    d = asdict(p)
    d["lat"] = round(p.lat, 4)
    d["lon"] = round(p.lon, 4)
    d["archetype_weights"] = [round(w, 2) for w in p.archetype_weights]
    if not p.merged_from:
        d.pop("merged_from")
    return d
