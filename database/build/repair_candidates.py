"""Apply the Stage 1 candidate-set rules to the published bundle.

A full world rebuild is not possible here (no app_places.json, no OSM harvest).
The published registers are the candidate set the client already loads, so the
same transforms the pipeline now runs are applied to those registers. Every
absorbed id is written to place_id_map.json — this is a migration, not a
silent renumber.
"""
from __future__ import annotations

import csv
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
from twm.candidates import (  # noqa: E402
    absorb_near_duplicates,
    agglomerate_settlements,
    absorption_by_country,
    cap_harvest_density,
    close_pairs,
    merge_transliterations,
    summarise_candidate_set,
)
from twm.identity import build_number, write_json  # noqa: E402
from twm.types import Candidate  # noqa: E402

DATA = Path(os.environ.get("TWM_DATA", str(_DB / "data")))
DIST = Path(os.environ.get("TWM_DIST", str(_DB / "dist")))
BUNDLE = Path(os.environ.get(
    "TWM_BUNDLE", str(_REPO / "webapp" / "twm-app" / "public" / "data")))


def _pop_by_geoname() -> dict[str, float]:
    path = DATA / "settlements_ucdb.csv"
    out = {}
    if not path.is_file():
        return out
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            out[str(row["ID_UC_G0"])] = float(row["population"] or 0)
    return out


def _geoname_id(place_id: str) -> str:
    tail = place_id.split("-", 1)[-1]
    return tail[1:] if tail[:1].isalpha() and tail[1:].isdigit() else tail


def _kindmask(codes) -> int:
    m = 0
    for code in codes:
        try:
            m |= 1 << (int(code[1:]) - 1)
        except (TypeError, ValueError, IndexError):
            continue
    return m


def place_to_candidate(p: dict, pops: dict[str, float]) -> Candidate:
    weights = p.get("archetype_weights") or []
    arch = {}
    for i, code in enumerate(p.get("archetypes") or []):
        arch[code] = float(weights[i]) if i < len(weights) else 0.5
    return Candidate(
        candidate_id=p["place_id"],
        name=p["name"],
        country=p["country"],
        lat=float(p["lat"]),
        lon=float(p["lon"]),
        is_site=bool(p.get("is_site")),
        population=pops.get(_geoname_id(p["place_id"]), 0.0),
        archetypes=arch,
        sources=set(p.get("sources") or []),
        merged_from=list(p.get("merged_from") or []),
        historic_capital=bool(p.get("historic_capital")),
    )


def candidate_to_place(c: Candidate, originals: dict[str, dict]) -> dict:
    base = json.loads(json.dumps(originals[c.candidate_id]))
    for mid in c.merged_from:
        other = originals.get(mid)
        if not other:
            continue
        if other.get("on_printed_map"):
            base["on_printed_map"] = True
            if not base.get("printed_rank") and other.get("printed_rank"):
                base["printed_rank"] = other["printed_rank"]
        if (other.get("whs") or 0) > (base.get("whs") or 0):
            base["whs"] = other["whs"]
    arch = sorted(c.archetypes, key=lambda a: -c.archetypes[a])
    base["archetypes"] = arch
    base["archetype_weights"] = [round(c.archetypes[a], 2) for a in arch]
    base["sources"] = sorted(c.sources)
    if c.merged_from:
        base["merged_from"] = list(c.merged_from)
    elif "merged_from" in base:
        del base["merged_from"]
    return base


def main() -> int:
    global BUNDLE
    gated = "TWM_BUNDLE" not in os.environ
    if gated:
        BUNDLE = begin_repair()
    pops = _pop_by_geoname()
    countries_raw = json.loads((DATA / "countries.json").read_text(encoding="utf-8"))
    areas = {n: f.get("area_km2") or 100_000.0 for n, f in countries_raw.items()}

    originals: dict[str, dict] = {}
    registers = []
    for path in sorted((BUNDLE / "countries").glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        registers.append((path, doc))
        for p in doc.get("places") or []:
            originals[p["place_id"]] = p

    candidates = [place_to_candidate(p, pops) for p in originals.values()]
    print(f"loaded           {len(candidates):>7} places")

    candidates, t_log = merge_transliterations(candidates)
    print(f"transliteration  {len(t_log):>7} folded")
    candidates, g_log = agglomerate_settlements(candidates)
    print(f"agglomerated     {len(g_log):>7} folded")
    candidates, c_log = absorb_near_duplicates(candidates)
    print(f"close same-kind  {len(c_log):>7} folded")
    candidates, d_log = cap_harvest_density(candidates, areas)
    print(f"harvest density  {len(d_log):>7} folded")

    log = t_log + g_log + c_log + d_log
    kept_ids = {c.candidate_id for c in candidates}
    moved = {}
    for c in candidates:
        for mid in c.merged_from:
            if mid in originals and mid not in kept_ids:
                moved[mid] = c.candidate_id

    places = [candidate_to_place(c, originals) for c in candidates]
    by_country = defaultdict(list)
    for p in places:
        by_country[p["country"]].append(p)

    for path, doc in registers:
        country = doc["country"]
        ps = sorted(by_country.get(country, []), key=lambda p: -p.get("score", 0))
        kinds = defaultdict(int)
        for p in ps:
            for a in p.get("archetypes") or []:
                kinds[a] += 1
        doc["places"] = ps
        doc["kinds"] = dict(sorted(kinds.items(), key=lambda kv: int(kv[0][1:])))
        for t in doc.get("territories") or []:
            t["app_place_ids"] = [i for i in t.get("app_place_ids") or [] if i in kept_ids]
            t["place_ids"] = [i for i in t.get("place_ids") or [] if i in kept_ids]
            t["app_places"] = len(t["app_place_ids"])
            t["places"] = len(t["place_ids"])
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
    } for p in places]
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
        cpath = BUNDLE / c["file"]
        c["bytes"] = cpath.stat().st_size if cpath.is_file() else c.get("bytes", 0)
        index.append(c)

    number = build_number(p["place_id"] for p in places)
    man["build"] = number
    man["countries"] = index
    man["archetype_counts"] = {
        a: sum(1 for p in places if a in (p.get("archetypes") or []))
        for a in man.get("archetypes", {})
    }
    man["totals"]["places"] = len(places)
    man["totals"]["printed"] = sum(1 for p in places if p.get("on_printed_map"))
    man["totals"]["countries"] = len(index)
    write_json(BUNDLE / "manifest.json", man)

    mapping_path = DIST / "place_id_map.json"
    mapping = {
        "_comment": (
            "Maps old place_ids to new ones. A rebuild that changes an existing id "
            "fails unless that id appears here. Do not reuse an id for a different place."
        ),
        "moved": moved,
    }
    mapping_path.write_text(json.dumps(mapping, indent=2) + "\n", encoding="utf-8")

    remaining = close_pairs(candidates)
    allow = {
        "_comment": (
            "Same-country pairs under 2 km that are genuinely different kinds of "
            "place. Enumerated, not inferred. Stage 1 exit test."
        ),
        "pairs": [
            {"id_a": r["id_a"], "id_b": r["id_b"], "country": r["country"],
             "a": r["a"], "b": r["b"], "km": r["km"],
             "kinds_a": r["kinds_a"], "kinds_b": r["kinds_b"]}
            for r in remaining if not r["same_kind"]
        ],
    }
    (DATA / "close_pairs_allowed.json").write_text(
        json.dumps(allow, indent=2) + "\n", encoding="utf-8")

    report_path = DIST / "build_report.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.is_file() else {}
    stats = report.get("stats") or {}
    stats["absorbed"] = len(log)
    stats["absorption_by_country"] = absorption_by_country(log)
    stats["candidate_set"] = summarise_candidate_set(log)
    stats["places_in_app"] = len(places)
    stats["places_on_printed_map"] = man["totals"]["printed"]
    report["stats"] = stats
    report["absorption"] = log
    report["build"] = number
    report_path.write_text(json.dumps(report, indent=1, default=str) + "\n", encoding="utf-8")
    print(f"kept             {len(places):>7}")
    print(f"moved ids        {len(moved):>7}")
    print(f"close pairs kept {len(allow['pairs']):>7} (enumerated different kinds)")
    print(f"build            {number}")
    deu = next(c for c in index if c["iso3"] == "DEU")
    mar = next(c for c in index if c["iso3"] == "MAR")
    print(f"Germany/Morocco  {deu['places']}/{mar['places']} "
          f"({deu['places']/deu['kinds']:.1f} vs {mar['places']/mar['kinds']:.1f} per kind)")
    if gated:
        return finish_repair()
    return 0


if __name__ == "__main__":
    sys.exit(main())
