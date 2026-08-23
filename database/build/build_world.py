"""Run the twm pipeline over the real world.

Uses the project's own adapters unchanged. The two shims exist because this
machine cannot reach the upstream hosts, not because the adapters are wrong:
`LocalWorldHeritage` is the shipped adapter with `fetch()` pointed at a file,
and `LocalWikidata` reads a CSV harvested from WDQS in the browser.
"""
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.environ.get("TWM_PKG", "/home/claude/twm/db"))

from twm.pipeline import CountryFacts, build
from twm.sources import ghsl, protected, unesco
from twm.store import export_app, export_printed, export_report

DATA = Path(os.environ.get("TWM_DATA", "/home/claude/twm/data"))
DIST = Path(os.environ.get("TWM_DIST", "/home/claude/twm/dist"))


class LocalWorldHeritage(unesco.WorldHeritage):
    """The shipped World Heritage adapter, reading the export from disk."""

    def __init__(self, path):
        super().__init__()
        self._path = Path(path)

    def fetch(self):
        return self._path


class LocalTieredCSV:
    """A harvested asset layer: `qid,tier,lat,lon,[sitelinks|radius_km],iso`.

    One reader for every layer collected in the browser, because they all share
    a shape. Each carries its own `source` so a later licence audit can filter
    the database rather than rebuild it -- OSM records are ODbL and must stay
    distinguishable from the CC0 Wikidata ones.

    Labels are not kept. The WDQS label service made every query exceed the
    endpoint's timeout, and nothing reads an asset's name below weight 4.0 --
    `orphans_to_sites` never promotes an asset that light into a place, so no
    place can inherit a blank name. Every tier read here is below that bar.
    """

    URLS = {
        "wikidata": "https://www.wikidata.org/entity/{}",
        "osm": "https://www.openstreetmap.org/{}",
    }

    def __init__(self, path, iso2_to_country, tier=None, prefix="x",
                 source="wikidata", skip_tiers=()):
        self.path = Path(path)
        self.iso2 = iso2_to_country
        self.tier = tier
        self.prefix = prefix
        self.name = source
        self.skip = set(skip_tiers)

    def load(self):
        import csv
        from datetime import date

        from twm.types import Asset
        today = date.today().isoformat()
        url = self.URLS.get(self.name, "")
        with open(self.path, encoding="utf-8-sig", newline="") as fh:
            for r in csv.DictReader(fh):
                try:
                    lat, lon = float(r["lat"]), float(r["lon"])
                except (TypeError, ValueError):
                    continue
                qid = r["qid"]
                tier = r.get("tier") or self.tier
                if not tier or tier in self.skip:
                    continue
                extra = {"sitelinks": int(r.get("sitelinks") or 0)}
                radius = float(r.get("radius_km") or 0)
                if radius > 0:
                    extra["radius_km"] = radius
                yield Asset(
                    asset_id=f"{self.prefix}-{qid}", tier=tier,
                    lat=lat, lon=lon, name=qid, source=self.name,
                    source_url=url.format(qid) if url else "",
                    retrieved=today,
                    country=self.iso2.get((r.get("iso") or "").lower(), ""),
                    extra=extra,
                )


LocalWikidata = LocalTieredCSV   # diagnose.py imports this name


def main():
    t0 = time.time()
    countries_raw = json.loads((DATA / "countries.json").read_text(encoding="utf-8"))
    countries = {n: CountryFacts(name=n, area_km2=f["area_km2"], iso=f.get("iso", ""))
                 for n, f in countries_raw.items()}

    candidates = list(ghsl.UrbanCentres(path=DATA / "settlements_agglomerated.csv").load())
    print(f"candidates       {len(candidates):>7}")

    assets, by_source = [], {}

    def add(src, label):
        got = list(src.load())
        assets.extend(got)
        by_source[label] = len(got)

    add(LocalWorldHeritage(DATA / "whs_expanded.xml"), "unesco-whs")
    if (DATA / "wdpa_normalised.csv").exists():
        add(protected.ProtectedAreas(path=DATA / "wdpa_normalised.csv"), "wdpa")
    if (DATA / "ramsar_geoparks.csv").exists():
        add(protected.RamsarAndGeoparks(path=DATA / "ramsar_geoparks.csv"), "ramsar-geopark")
    iso2 = {v.get("iso", "").lower(): k for k, v in countries_raw.items() if v.get("iso")}
    if (DATA / "wikidata_heritage.csv").exists():
        add(LocalTieredCSV(DATA / "wikidata_heritage.csv", iso2,
                           tier="wikidata_multilingual", prefix="wd-h"), "wikidata-heritage")
    if (DATA / "wikidata_livability.csv").exists():
        add(LocalTieredCSV(DATA / "wikidata_livability.csv", iso2, prefix="wd-l"),
            "wikidata-livability")
    # institution / market / craft_cluster come from OSM, not Wikidata: Wikidata
    # counts notability, OSM maps physical presence, and the Wikidata version
    # broke the Morocco regression check (Marrakesh 18 museums vs Fes 3).
    if (DATA / "osm_livability.csv").exists():
        add(LocalTieredCSV(DATA / "osm_livability.csv", iso2, prefix="osm",
                           source="osm"), "osm-livability")
    # ich_unesco is held back: only 129 of 1,092 Representative List elements
    # carry a location in Wikidata, and a 12% sample chosen by which items
    # editors happened to geolocate is documentation bias in a weight-8,
    # cross-country-safe tier. ich_national (weight 2, national-only) is safe.
    if (DATA / "ich_located.csv").exists():
        add(LocalTieredCSV(DATA / "ich_located.csv", iso2, prefix="ich",
                           skip_tiers={"ich_unesco"}), "ich-national")
    if (DATA / "cuisine_regions.csv").exists():
        from twm.sources import cuisine
        add(cuisine.CuisineRegions(path=DATA / "cuisine_regions.csv", strict=True),
            "cuisine")

    for k, v in by_source.items():
        print(f"assets {k:<16} {v:>7}")
    print(f"assets total     {len(assets):>7}")

    result = build(candidates, assets, countries)
    s = result.stats
    print(f"\nplaces in app        {s['places_in_app']:>7}")
    print(f"places on printed    {s['places_on_printed_map']:>7} of {s['hole_budget']}")
    print(f"countries with places{len(result.scored):>7}")
    print(f"absorbed sites       {s['absorbed']:>7}   retained {s['retained_sites']}")

    DIST.mkdir(parents=True, exist_ok=True)
    export_app(result, DIST)
    export_printed(result, DIST)
    export_report(result, DIST)

    try:
        from twm.store import Store
        st = Store(DIST / "twm.duckdb")
        st.write_places(result.places)
        st.write_manifest({"sources": by_source, "candidates": len(candidates),
                           "stats": s})
        st.close()
        print(f"duckdb           {(DIST / 'twm.duckdb').stat().st_size / 1e6:>7.1f} MB")
    except Exception as exc:                       # noqa: BLE001
        print(f"duckdb skipped: {exc}")

    print(f"\nbuilt in {time.time() - t0:.1f}s -> {DIST}")
    return result


def inspect(result, country, n=15):
    rows = sorted(result.for_country(country), key=lambda p: -p.score)[:n]
    total = len(result.for_country(country))
    print(f"\n=== {country} — top {len(rows)} of {total} "
          f"(quota {result.quotas.get(country)}) ===")
    for p in rows:
        mark = "*" if p.on_printed_map else " "
        print(f" {mark} {p.score:>3}  {p.name[:44]:<46} {','.join(p.archetypes[:3])}")


if __name__ == "__main__":
    r = main()
    for c in ["Morocco", "France", "Nepal", "Iceland", "Japan", "Peru", "Italy", "India"]:
        if c in r.scored:
            inspect(r, c)
