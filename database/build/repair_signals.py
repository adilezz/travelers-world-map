"""Apply Stage 2 signals to the published bundle without a world rebuild.

Does not invent months, reach, or kinds. Does not change scores or place_ids.
Countries the OSM livability harvest never reached are marked unscored.
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from pathlib import Path

_HERE = Path(__file__).resolve()
_DB = _HERE.parents[1]
_REPO = _HERE.parents[2]
sys.path.insert(0, os.environ.get("TWM_PKG", str(_DB)))
sys.path.insert(0, str(_HERE.parent))

from publish import begin_repair, finish_repair  # noqa: E402
from twm.identity import build_number, write_json  # noqa: E402
from twm.signals import apply_signals, livability_by_country, osm_livability_iso2  # noqa: E402

DATA = Path(os.environ.get("TWM_DATA", str(_DB / "data")))
DIST = Path(os.environ.get("TWM_DIST", str(_DB / "dist")))
BUNDLE = Path(os.environ.get(
    "TWM_BUNDLE", str(_REPO / "webapp" / "twm-app" / "public" / "data")))


def _kindmask(codes) -> int:
    m = 0
    for code in codes:
        try:
            m |= 1 << (int(code[1:]) - 1)
        except (TypeError, ValueError, IndexError):
            continue
    return m


def main() -> int:
    global BUNDLE
    gated = "TWM_BUNDLE" not in os.environ
    if gated:
        BUNDLE = begin_repair()
    countries_raw = json.loads((DATA / "countries.json").read_text(encoding="utf-8"))
    osm_iso = osm_livability_iso2(DATA / "osm_livability.csv")
    liv = livability_by_country(countries_raw, osm_iso)

    originals: list[dict] = []
    registers = []
    for path in sorted((BUNDLE / "countries").glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        registers.append((path, doc))
        originals.extend(doc.get("places") or [])

    print(f"loaded           {len(originals):>7} places")
    stats = apply_signals(originals, DATA)
    for key, n in stats.items():
        print(f"{key:<16} {n:>7}")

    by_country = defaultdict(list)
    for p in originals:
        by_country[p["country"]].append(p)

    for path, doc in registers:
        ps = by_country.get(doc["country"], [])
        kinds = defaultdict(int)
        for p in ps:
            for a in p.get("archetypes") or []:
                kinds[a] += 1
        doc["places"] = ps
        doc["kinds"] = dict(sorted(kinds.items(), key=lambda kv: int(kv[0][1:])))
        doc["livability"] = liv.get(doc["country"], "unscored")
        path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")

    man = json.loads((BUNDLE / "manifest.json").read_text(encoding="utf-8"))
    iso3 = {c["country"]: c["iso3"] for c in man.get("countries", [])}

    pfeat = [{
        "type": "Feature",
        "properties": {
            "id": p["place_id"], "n": p["name"], "s": p["score"],
            "k": (p["archetypes"] or [""])[0],
            "a": _kindmask(p.get("archetypes") or []),
            "c": iso3.get(p["country"], ""),
            "site": 1 if p.get("is_site") else 0,
            "hole": 1 if p.get("on_printed_map") else 0,
            "whs": p.get("whs") or 0, "t": p.get("territory_id") or "",
        },
        "geometry": {"type": "Point", "coordinates": [
            round(p["lon"], 4), round(p["lat"], 4)]},
    } for p in originals]
    (BUNDLE / "places.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": pfeat},
                   separators=(",", ":")),
        encoding="utf-8",
    )

    index = []
    for c in man["countries"]:
        ps = by_country.get(c["country"], [])
        kinds = defaultdict(int)
        for p in ps:
            for a in p.get("archetypes") or []:
                kinds[a] += 1
        c["places"] = len(ps)
        c["holes"] = sum(1 for p in ps if p.get("on_printed_map"))
        c["kinds"] = len(kinds)
        c["kind_counts"] = dict(sorted(kinds.items(), key=lambda kv: int(kv[0][1:])))
        c["livability"] = liv.get(c["country"], "unscored")
        cpath = BUNDLE / c["file"]
        c["bytes"] = cpath.stat().st_size if cpath.is_file() else c.get("bytes", 0)
        index.append(c)

    number = build_number(p["place_id"] for p in originals)
    man["build"] = number
    man["countries"] = index
    man["archetype_counts"] = {
        a: sum(1 for p in originals if a in (p.get("archetypes") or []))
        for a in man.get("archetypes", {})
    }
    man["livability"] = {
        "scored": sum(1 for c in index if c.get("livability") == "scored"),
        "unscored": sum(1 for c in index if c.get("livability") != "scored"),
        "note": (
            "OSM livability harvest reached 41 countries. The rest are "
            "unscored — an empty pillar must not look like a low one."
        ),
    }
    write_json(BUNDLE / "manifest.json", man)

    report_path = DIST / "build_report.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.is_file() else {}
    report["build"] = number
    report["signals"] = stats
    report_path.write_text(json.dumps(report, indent=1, default=str) + "\n", encoding="utf-8")

    empty = stats["still_empty"]
    counts = man["archetype_counts"]
    print(f"build            {number}")
    print(f"kinds            {counts}")
    print(f"empty kinds      {empty}")
    print(f"livability       scored={man['livability']['scored']} "
          f"unscored={man['livability']['unscored']}")
    mar = next(c for c in index if c["iso3"] == "MAR")
    print(f"Morocco kinds    {mar['kind_counts']} livability={mar['livability']}")
    if gated:
        return finish_repair()
    return 0


if __name__ == "__main__":
    sys.exit(main())
