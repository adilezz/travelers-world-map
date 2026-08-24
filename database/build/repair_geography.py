"""Stage 3: tessellate the published bundle without a world rebuild.

Does not rescore, does not invent months/reach, does not change place_ids.
Western Sahara outlines dissolve into Morocco; places keep coordinates and
gain disputed: "ESH". Web regions are a new layer. Printed tiles stay tiles.
"""
from __future__ import annotations

import csv
import json
import os
import sys
import warnings
from collections import defaultdict
from pathlib import Path

_HERE = Path(__file__).resolve()
_DB = _HERE.parents[1]
_REPO = _HERE.parents[2]
sys.path.insert(0, os.environ.get("TWM_PKG", str(_DB)))
sys.path.insert(0, str(_HERE.parent))

from publish import begin_repair, finish_repair  # noqa: E402

from twm.config import (  # noqa: E402
    canonical_country,
    canonical_iso3,
    unruled_hits,
)
from twm.geo import (  # noqa: E402
    COORD_PRECISION,
    REGION_UNION_TOLERANCE,
    SIMPLIFY_DEG,
    iso3_id,
    name_from_polygon,
    namesake_in_name,
    union_tolerance_for,
)
from twm.identity import build_number, write_json  # noqa: E402
from twm.regions import TINY_DEG2, build_regions  # noqa: E402
from twm.territories import AdminUnit  # noqa: E402
from twm.types import Place  # noqa: E402

DATA = Path(os.environ.get("TWM_DATA", str(_DB / "data")))
DIST = Path(os.environ.get("TWM_DIST", str(_DB / "dist")))
BUNDLE = Path(os.environ.get(
    "TWM_BUNDLE", str(_REPO / "webapp" / "twm-app" / "public" / "data")))

ADMIN1_URLS = (
    "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip",
    "https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip",
)


def _kindmask(codes) -> int:
    m = 0
    for code in codes:
        try:
            m |= 1 << (int(code[1:]) - 1)
        except (TypeError, ValueError, IndexError):
            continue
    return m


def _round_geom(geom, nd=COORD_PRECISION):
    if isinstance(geom, (list, tuple)):
        if geom and isinstance(geom[0], (int, float)):
            return [round(float(v), nd) for v in geom]
        return [_round_geom(g, nd) for g in geom]
    return geom


def _fetch_admin1(cache_zip: Path) -> Path:
    """Natural Earth 10m admin-1. 50m only covers nine large countries."""
    if cache_zip.is_file() and cache_zip.stat().st_size > 1_000_000:
        print(f"admin-1 cache   {cache_zip}", flush=True)
        return cache_zip
    import urllib.request

    cache_zip.parent.mkdir(parents=True, exist_ok=True)
    last_err = None
    for url in ADMIN1_URLS:
        try:
            print(f"admin-1 fetch   {url}", flush=True)
            req = urllib.request.Request(url, headers={"User-Agent": "TravelersWorldMap/1.0"})
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read()
            if len(raw) < 1_000_000:
                raise RuntimeError(f"too small ({len(raw)} bytes)")
            cache_zip.write_bytes(raw)
            print(f"admin-1 wrote   {len(raw)} bytes", flush=True)
            return cache_zip
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            print(f"admin-1 miss    {exc}", flush=True)
    raise RuntimeError(f"could not fetch Natural Earth admin-1: {last_err}")


def admin_units_from_ne(zip_path: Path, iso2_to_name: dict[str, str],
                        iso3_to_name: dict[str, str]) -> list[AdminUnit]:
    import shapefile
    from shapely.geometry import shape

    reader = shapefile.Reader(str(zip_path))
    fields = [f[0] for f in reader.fields[1:]]
    units, skipped = [], 0
    for i, (rec, shp) in enumerate(zip(reader.records(), reader.shapes(), strict=False)):
        p = dict(zip(fields, rec, strict=False))
        a3 = canonical_iso3(str(p.get("adm0_a3") or p.get("ADM0_A3") or "").strip())
        a2 = str(p.get("iso_a2") or p.get("ISO_A2") or "").strip()
        country = iso3_to_name.get(a3) or iso2_to_name.get(a2.lower())
        country = canonical_country(country or "")
        if not country:
            skipped += 1
            continue
        try:
            g = shape(shp.__geo_interface__)
        except Exception:
            skipped += 1
            continue
        if g is None or g.is_empty:
            skipped += 1
            continue
        if not g.is_valid:
            g = g.buffer(0)
        name = (str(p.get("name_en") or p.get("name") or p.get("NAME_EN")
                    or p.get("NAME") or "").strip() or "unnamed")
        units.append(AdminUnit(
            unit_id=str(p.get("adm1_code") or p.get("ADM1_CODE") or f"{a3}-{i}"),
            name=name,
            country=country,
            geometry=g,
            level=1,
        ))
    print(f"admin units      {len(units):>7}   ({skipped} skipped)", flush=True)
    return units


def _load_settlements() -> list[tuple[str, float, float, float]]:
    path = DATA / "world_settlements.csv"
    out = []
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                pop = float(row.get("population") or 0)
                lat = float(row["lat"])
                lon = float(row["lon"])
            except (TypeError, ValueError, KeyError):
                continue
            out.append((row.get("settlement") or "", lat, lon, pop))
    return out


def dissolve_countries(geo: dict) -> dict:
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union

    keep, absorb = [], []
    for f in geo["features"]:
        iso = canonical_iso3(f["properties"].get("iso3") or "")
        name = canonical_country(f["properties"].get("country") or "")
        f["properties"]["iso3"] = iso
        f["properties"]["country"] = name
        if iso == "MAR" or name == "Morocco":
            absorb.append(f)
        else:
            keep.append(f)
    if len(absorb) > 1:
        geoms = []
        props = None
        for f in absorb:
            g = shape(f["geometry"])
            if not g.is_valid:
                g = g.buffer(0)
            geoms.append(g)
            if f["properties"].get("iso3") == "MAR" and f["properties"].get("country") == "Morocco":
                props = f["properties"]
        props = props or absorb[0]["properties"]
        props["iso3"] = "MAR"
        props["country"] = "Morocco"
        unioned = unary_union(geoms)
        if not unioned.is_valid:
            unioned = unioned.buffer(0)
        keep.append({
            "type": "Feature",
            "properties": props,
            "geometry": _round_geom(mapping(unioned.simplify(SIMPLIFY_DEG))),
        })
    elif absorb:
        keep.extend(absorb)
    geo["features"] = keep
    return geo


def relabel_territories(geo: dict) -> tuple[dict, str]:
    """No ESH polygon: the printed tile stays, under Morocco."""
    used = {f["properties"].get("territory_id") for f in geo["features"]}
    n = 1
    while iso3_id("MAR", "T", n) in used:
        n += 1
    new_id = iso3_id("MAR", "T", n)
    for f in geo["features"]:
        p = f["properties"]
        raw_iso = p.get("iso3") or ""
        raw_country = p.get("country") or ""
        if (
            str(p.get("territory_id", "")).startswith("ESH")
            or raw_iso == "ESH"
            or "Sahara" in raw_country
        ):
            p["territory_id"] = new_id
            p["iso3"] = "MAR"
            p["country"] = "Morocco"
        else:
            p["iso3"] = canonical_iso3(raw_iso) or raw_iso
            p["country"] = canonical_country(raw_country) or raw_country
    return geo, new_id


def country_land_from_geo(geo: dict) -> dict[str, object]:
    from shapely.geometry import shape
    from shapely.ops import unary_union

    by_name: dict[str, list] = defaultdict(list)
    for f in geo["features"]:
        name = f["properties"].get("country")
        if not name:
            continue
        g = shape(f["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        by_name[name].append(g)
    return {n: unary_union(gs) if len(gs) > 1 else gs[0] for n, gs in by_name.items()}


def hull_for_places(places: list[Place]):
    from shapely.geometry import MultiPoint

    if not places:
        return None
    pts = MultiPoint([(p.lon, p.lat) for p in places])
    hull = pts.convex_hull
    if hull.geom_type == "Point":
        hull = hull.buffer(0.3)
    elif hull.geom_type == "LineString":
        hull = hull.buffer(0.3)
    else:
        hull = hull.buffer(0.15)
    return hull


def _to_place(p: dict) -> Place:
    country = canonical_country(p["country"])
    disputed = p.get("disputed")
    if p.get("country") != country and not disputed:
        # Dissolved Western Sahara (any spelling / ISO) keeps the legal flag.
        if canonical_iso3(str(p.get("iso3") or "")) == "MAR" and country == "Morocco":
            pass
        orig = p.get("country")
        if canonical_country(str(orig)) == "Morocco" and str(orig) != "Morocco":
            disputed = "ESH"
    return Place(
        place_id=p["place_id"], name=p["name"], country=country,
        lat=p["lat"], lon=p["lon"], is_site=bool(p.get("is_site")),
        score=int(p.get("score") or 0),
        archetypes=list(p.get("archetypes") or []),
        archetype_weights=list(p.get("archetype_weights") or []),
        whs=int(p.get("whs") or 0),
        reach=p.get("reach") or "",
        best_months=list(p.get("best_months") or []),
        on_printed_map=bool(p.get("on_printed_map")),
        printed_rank=p.get("printed_rank"),
        territory_id=p.get("territory_id"),
        disputed=disputed,
        sources=list(p.get("sources") or []),
        merged_from=list(p.get("merged_from") or []),
    )


def main() -> int:
    global BUNDLE
    gated = "TWM_BUNDLE" not in os.environ
    if gated:
        BUNDLE = begin_repair()
    from shapely.geometry import mapping, shape
    from shapely.wkt import loads

    man = json.loads((BUNDLE / "manifest.json").read_text(encoding="utf-8"))
    countries_raw = json.loads((DATA / "countries.json").read_text(encoding="utf-8"))
    iso2_to_name = {
        str(v.get("iso", "")).lower(): canonical_country(k)
        for k, v in countries_raw.items() if v.get("iso")
    }
    iso3_to_name = {c["iso3"]: c["country"] for c in man.get("countries", [])}
    iso3_to_name["MAR"] = "Morocco"
    iso3_to_name.pop("ESH", None)
    name_to_iso3 = {v: k for k, v in iso3_to_name.items()}
    name_to_iso3["Morocco"] = "MAR"

    registers = []
    originals: list[dict] = []
    for path in sorted((BUNDLE / "countries").glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        registers.append((path, doc))
        originals.extend(doc.get("places") or [])
    print(f"loaded           {len(originals):>7} places", flush=True)

    # Dissolve country labels on the records. Coordinates stay.
    esh_ids = set()
    for p in originals:
        orig = p.get("country")
        iso_guess = ""
        if orig != canonical_country(orig or ""):
            esh_ids.add(p["place_id"])
            p["disputed"] = "ESH"
            p["country"] = "Morocco"
        # Pins currently tagged ESH in places.geojson.
    geo_places = json.loads((BUNDLE / man["layers"]["places"]).read_text(encoding="utf-8"))
    pin_esh = {f["properties"]["id"] for f in geo_places["features"]
               if f["properties"].get("c") == "ESH"}
    for p in originals:
        if p["place_id"] in pin_esh:
            p["country"] = "Morocco"
            p["disputed"] = "ESH"
            esh_ids.add(p["place_id"])

    countries_geo = json.loads((BUNDLE / man["layers"]["countries"]).read_text(encoding="utf-8"))
    n_before = len(countries_geo["features"])
    countries_geo = dissolve_countries(countries_geo)
    print(f"countries poly   {n_before} -> {len(countries_geo['features'])} (ESH dissolved)", flush=True)

    terr_geo = json.loads((BUNDLE / man["layers"]["territories"]).read_text(encoding="utf-8"))
    terr_geo, esh_tile = relabel_territories(terr_geo)
    for p in originals:
        if str(p.get("territory_id") or "").startswith("ESH"):
            p["territory_id"] = esh_tile
    # Name the former ESH tile from its polygon, not "Western Sahara".
    towns = _load_settlements()
    for f in terr_geo["features"]:
        if f["properties"].get("territory_id") == esh_tile:
            g = shape(f["geometry"])
            f["properties"]["name"] = name_from_polygon(
                g, [], towns, "Morocco")
            f["properties"]["iso3"] = "MAR"
            f["properties"]["country"] = "Morocco"

    cache = DATA / "cache" / "ne_10m_admin_1.zip"
    zip_path = _fetch_admin1(cache)
    units = admin_units_from_ne(zip_path, iso2_to_name, iso3_to_name)
    land = country_land_from_geo(countries_geo)

    place_objs = [_to_place(p) for p in originals]
    # Countries in the register with no land polygon still need a region.
    by_c: dict[str, list[Place]] = defaultdict(list)
    for p in place_objs:
        by_c[p.country].append(p)
    for country, ps in by_c.items():
        if country not in land:
            hull = hull_for_places(ps)
            if hull is not None:
                land[country] = hull

    iso3_of = {c: name_to_iso3[c] for c in land if c in name_to_iso3}
    for p in place_objs:
        if p.country not in iso3_of:
            # Fallback from the register files.
            pass
    for path, doc in registers:
        name = canonical_country(doc.get("country") or "")
        iso3_of.setdefault(name, canonical_iso3(doc.get("iso3") or ""))

    for f in countries_geo["features"]:
        iso3_of.setdefault(
            f["properties"].get("country") or "",
            f["properties"].get("iso3") or "",
        )
    iso3_of = {k: v for k, v in iso3_of.items() if k and v}

    print("tessellating...", flush=True)
    regions = build_regions(
        units, place_objs, iso3_of, country_land=land, settlements=towns)
    print(f"regions          {len(regions):>7}", flush=True)

    rid_of = {}
    for r in regions:
        for pid in r.place_ids:
            rid_of[pid] = r.region_id
    missing = [p.place_id for p in place_objs if p.place_id not in rid_of]
    if missing:
        raise SystemExit(f"{len(missing)} places without region_id e.g. {missing[:5]}")

    # Coverage is a Stage 4 gate: abort before writing so the live bundle stays.
    from twm.regions import union_coverage
    worst = []
    by_reg_country: dict[str, list] = defaultdict(list)
    for r in regions:
        by_reg_country[r.country].append(r)
    for country, rs in by_reg_country.items():
        geom = land.get(country)
        if geom is None:
            continue
        gap = union_coverage(rs, geom)
        if gap > union_tolerance_for(geom):
            worst.append((country, round(gap, 4)))
    print(f"union gaps       {len(worst)} countries over documented tolerance"
          + (f" e.g. {worst[:4]}" if worst else " (all within tolerance)"), flush=True)
    if worst:
        raise SystemExit(
            "region_coverage gate: union of regions is not country land "
            f"within documented tolerance: {worst[:8]}"
        )

    labels = [c["country"] for c in man.get("countries", [])]
    labels += [p.country for p in place_objs]
    labels += [u.country for u in units]
    unruled = unruled_hits(labels)
    if unruled:
        warnings.warn(
            f"unruled disputed cases encountered: {unruled}. "
            "Parked — Adil fills DISPUTED_RULINGS; the build does not decide.",
            stacklevel=1,
        )
        print(f"unruled warn     {unruled}")

    # Write regions.geojson
    rfeat = []
    for r in regions:
        geom = None
        if r.geometry_wkt:
            g = loads(r.geometry_wkt)
            if not g.is_empty:
                if not g.is_valid:
                    g = g.buffer(0)
                g = g.simplify(SIMPLIFY_DEG)
                geom = _round_geom(mapping(g))
        rfeat.append({
            "type": "Feature",
            "properties": {
                "region_id": r.region_id,
                "name": r.name,
                "country": r.country,
                "iso3": iso3_of.get(r.country, ""),
                "places": len(r.place_ids),
                "type": "region",
            },
            "geometry": geom,
        })
    (BUNDLE / "regions.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": rfeat},
                   separators=(",", ":")),
        encoding="utf-8",
    )

    # Merge ESH register into MAR, drop ESH.json.
    by_country: dict[str, list[dict]] = defaultdict(list)
    for p in originals:
        p["region_id"] = rid_of[p["place_id"]]
        if str(p.get("territory_id") or "").startswith("ESH"):
            p["territory_id"] = esh_tile
        by_country[p["country"]].append(p)

    esh_path = BUNDLE / "countries" / "ESH.json"
    mar_path = BUNDLE / "countries" / "MAR.json"
    kept_registers = []
    for path, doc in registers:
        name = canonical_country(doc.get("country") or "")
        iso3 = canonical_iso3(doc.get("iso3") or "")
        if iso3 == "ESH" or path.name == "ESH.json":
            continue
        if iso3 == "MAR":
            doc["country"] = "Morocco"
            doc["iso3"] = "MAR"
        ps = by_country.get(doc["country"], [])
        kinds = defaultdict(int)
        for p in ps:
            for a in p.get("archetypes") or []:
                kinds[a] += 1
        doc["places"] = ps
        doc["kinds"] = dict(sorted(kinds.items(), key=lambda kv: int(kv[0][1:])))
        # Relabel printed-tile metadata that still says Western Sahara.
        for t in doc.get("territories") or []:
            t["country"] = canonical_country(t.get("country") or doc["country"])
            if str(t.get("territory_id", "")).startswith("ESH"):
                t["territory_id"] = esh_tile
                t["country"] = "Morocco"
                t["name"] = next(
                    (f["properties"]["name"] for f in terr_geo["features"]
                     if f["properties"]["territory_id"] == esh_tile),
                    t.get("name"),
                )
        path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        kept_registers.append((path, doc))
    if esh_path.is_file():
        esh_path.unlink()
        print("removed          countries/ESH.json")

    # places.geojson
    iso3 = {c["country"]: c["iso3"] for _, c in (
        (None, d) for _, d in kept_registers)}
    iso3 = {doc["country"]: doc["iso3"] for _, doc in kept_registers}
    pfeat = [{
        "type": "Feature",
        "properties": {
            "id": p["place_id"], "n": p["name"], "s": p["score"],
            "k": (p["archetypes"] or [""])[0],
            "a": _kindmask(p.get("archetypes") or []),
            "c": iso3.get(p["country"], ""),
            "site": 1 if p.get("is_site") else 0,
            "hole": 1 if p.get("on_printed_map") else 0,
            "whs": p.get("whs") or 0,
            "t": p.get("territory_id") or "",
            "r": p.get("region_id") or "",
        },
        "geometry": {"type": "Point", "coordinates": [
            round(p["lon"], 4), round(p["lat"], 4)]},
    } for p in originals]
    (BUNDLE / "places.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": pfeat},
                   separators=(",", ":")),
        encoding="utf-8",
    )

    (BUNDLE / man["layers"]["countries"]).write_text(
        json.dumps(countries_geo, separators=(",", ":")), encoding="utf-8")
    (BUNDLE / man["layers"]["territories"]).write_text(
        json.dumps(terr_geo, separators=(",", ":")), encoding="utf-8")

    # Manifest
    index = []
    for c in man["countries"]:
        if c.get("iso3") == "ESH" or c.get("country") == "Western Sahara":
            continue
        if c.get("iso3") == "MAR":
            c["country"] = "Morocco"
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
    number = build_number(p["place_id"] for p in originals)
    man["build"] = number
    man["countries"] = index
    man["totals"]["countries"] = len(index)
    man["totals"]["places"] = len(originals)
    man["totals"]["printed"] = sum(1 for p in originals if p.get("on_printed_map"))
    man["layers"]["regions"] = "regions.geojson"
    passports = man.get("passports") or {}
    uncovered = [
        x for x in (json.loads((BUNDLE / "passports" / "index.json").read_text(encoding="utf-8"))
                    .get("uncovered") or [])
        if x != "ESH"
    ]
    # Keep the passport index honest: ESH is no longer a register country.
    pindex_path = BUNDLE / "passports" / "index.json"
    pindex = json.loads(pindex_path.read_text(encoding="utf-8"))
    if "ESH" in (pindex.get("uncovered") or []):
        pindex["uncovered"] = [x for x in pindex["uncovered"] if x != "ESH"]
        pindex_path.write_text(json.dumps(pindex, separators=(",", ":")), encoding="utf-8")
    passports["uncovered_in_register"] = len(pindex.get("uncovered") or [])
    man["passports"] = passports
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
    report["geography"] = {
        "regions": len(regions),
        "esh_dissolved": True,
        "esh_places": sorted(esh_ids),
        "esh_tile": esh_tile,
        "union_gaps": worst,
        "unruled": unruled,
        "union_tolerance": REGION_UNION_TOLERANCE,
    }
    report_path.write_text(json.dumps(report, indent=1, default=str) + "\n", encoding="utf-8")

    tangier = next((p for p in originals if p.get("name") == "Tangier"), None)
    t_region = next((r for r in regions if tangier and tangier["place_id"] in r.place_ids), None)
    print(f"build            {number}")
    print(f"ESH places       {len(esh_ids)} -> Morocco, disputed=ESH")
    if t_region:
        ok = namesake_in_name(t_region.name, "Tangier")
        print(f"Tangier region   {t_region.region_id} {t_region.name!r} namesake={ok}")
    mar = next(c for c in index if c["iso3"] == "MAR")
    print(f"Morocco          {mar['places']} places, {mar['holes']} holes")
    if gated:
        return finish_repair()
    return 0


if __name__ == "__main__":
    sys.exit(main())
