"""
Publish the DuckDB place database as the static client bundle.

twm-app-bundle.zip is the previous 11,918-place build. The live database
(verification.txt) is 15,770 places / 235 countries / 803 tiles in
twm.duckdb. Country outlines come from the previous bundle; tile outlines
are reused where the id still exists, and new tiles get a padded hull.
"""
from __future__ import annotations

import json
import math
import shutil
from collections import defaultdict
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[3]
DB = ROOT / "database" / "dist" / "twm.duckdb"
OUT = Path(__file__).resolve().parents[1] / "public" / "data"
ZIP_APP = Path.home() / "AppData" / "Local" / "Temp" / "twm-bundle-inspect" / "app"

ARCHETYPES = {
    "A1": "Imperial & historic capital",
    "A2": "Living old town / medina",
    "A3": "Coastal & maritime",
    "A4": "High mountain",
    "A5": "Desert & steppe",
    "A6": "Forest & jungle",
    "A7": "Lake & river",
    "A8": "Volcanic & geothermal",
    "A9": "Wildlife & wilderness",
    "A10": "Sacred & pilgrimage",
    "A11": "Rural vernacular & agrarian",
    "A12": "Modern metropolis & industry",
}

EXTRA_ISO3 = {
    "Cook Islands": "COK",
    "Faroe Islands": "FRO",
}


def bit_kind(code: str) -> int:
    return 1 << (int(code[1:]) - 1)


def bit_months(months) -> int:
    m = 0
    for n in months or []:
        if 1 <= int(n) <= 12:
            m |= 1 << (int(n) - 1)
    return m


def ring_contains(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    n = len(ring)
    if n < 4:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersects = ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def geom_contains(lon: float, lat: float, geom: dict) -> bool:
    if geom["type"] == "Polygon":
        polys = [geom["coordinates"]]
    elif geom["type"] == "MultiPolygon":
        polys = geom["coordinates"]
    else:
        return False
    for rings in polys:
        if not rings:
            continue
        if ring_contains(lon, lat, rings[0]) and not any(
            ring_contains(lon, lat, hole) for hole in rings[1:]
        ):
            return True
    return False


def geom_bbox(geom: dict) -> tuple[float, float, float, float]:
    xs, ys = [], []

    def walk(coords):
        if coords and isinstance(coords[0], (int, float)):
            xs.append(coords[0])
            ys.append(coords[1])
        else:
            for c in coords:
                walk(c)

    walk(geom["coordinates"])
    return min(xs), min(ys), max(xs), max(ys)


def hull_polygon(points: list[tuple[float, float]]) -> dict:
    """Padded bounding box as a polygon. Fine for the 87 new tiles."""
    lons = [p[0] for p in points]
    lats = [p[1] for p in points]
    pad = 0.35
    if len(points) == 1:
        pad = 0.55
    w, e = min(lons) - pad, max(lons) + pad
    s, n = min(lats) - pad, max(lats) + pad
    # Keep a usable minimum so a single hole still reads as a tile.
    if e - w < 0.8:
        mid = (e + w) / 2
        w, e = mid - 0.4, mid + 0.4
    if n - s < 0.8:
        mid = (n + s) / 2
        s, n = mid - 0.4, mid + 0.4
    ring = [[w, s], [e, s], [e, n], [w, n], [w, s]]
    return {"type": "Polygon", "coordinates": [ring]}


def load_iso3() -> dict[str, str]:
    man = json.loads((ZIP_APP / "manifest.json").read_text(encoding="utf8"))
    out = {c["country"]: c["iso3"] for c in man["countries"]}
    out.update(EXTRA_ISO3)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    countries_dir = OUT / "countries"
    if countries_dir.exists():
        shutil.rmtree(countries_dir)
    countries_dir.mkdir()

    # Restore outlines from the previous bundle (Natural Earth, not in DuckDB).
    shutil.copy2(ZIP_APP / "countries.geojson", OUT / "countries.geojson")

    iso3_of_name = load_iso3()
    old_tiles = json.loads((ZIP_APP / "territories.geojson").read_text(encoding="utf8"))
    geom_by_tid = {
        f["properties"]["territory_id"]: f["geometry"]
        for f in old_tiles["features"]
        if f.get("geometry")
    }

    con = duckdb.connect(str(DB), read_only=True)
    places = con.sql(
        """
        select place_id, name, country, lat, lon, is_site, score,
               archetypes, archetype_weights, whs, reach, best_months,
               on_printed_map, printed_rank, territory_id, sources
        from places
        """
    ).fetchall()
    tiles = con.sql(
        """
        select territory_id, name, country, place_ids, dominant_archetypes, printable
        from territories
        """
    ).fetchall()
    con.close()

    recs: list[dict] = []
    by_id: dict[str, dict] = {}
    kind_counts_world = {k: 0 for k in ARCHETYPES}
    printed = 0

    for row in places:
        (
            place_id, name, country, lat, lon, is_site, score,
            archetypes, weights, whs, reach, best_months,
            on_printed, printed_rank, _tid, sources,
        ) = row
        iso3 = iso3_of_name.get(country)
        if not iso3:
            raise SystemExit(f"no ISO3 for {country}")
        arch = list(archetypes or [])
        months = [int(x) for x in (best_months or [])]
        mask = 0
        for k in arch:
            if k in ARCHETYPES:
                mask |= bit_kind(k)
                kind_counts_world[k] += 1
        if on_printed:
            printed += 1
        rec = {
            "place_id": place_id,
            "name": name,
            "country": country,
            "iso3": iso3,
            "lat": float(lat),
            "lon": float(lon),
            "is_site": bool(is_site),
            "score": int(score),
            "archetypes": arch,
            "archetype_weights": [float(x) for x in (weights or [])],
            "whs": int(whs or 0),
            "reach": reach or "near",
            "best_months": months,
            "on_printed_map": bool(on_printed),
            "printed_rank": int(printed_rank) if printed_rank is not None else None,
            "territory_id": None,
            "sources": list(sources or []),
            "kinds_mask": mask,
        }
        recs.append(rec)
        by_id[place_id] = rec

    # Tile membership: drilled ids first, then point-in-polygon for the rest.
    tile_meta = []
    drilled_of: dict[str, list[str]] = {}
    for tid, name, country, place_ids, kinds, printable in tiles:
        iso3 = iso3_of_name[country]
        drilled = [pid for pid in (place_ids or []) if pid in by_id]
        drilled_of[tid] = drilled
        for pid in drilled:
            by_id[pid]["territory_id"] = tid
        pts = [(by_id[pid]["lon"], by_id[pid]["lat"]) for pid in drilled]
        geom = geom_by_tid.get(tid) or (hull_polygon(pts) if pts else None)
        bbox = geom_bbox(geom) if geom else None
        tile_meta.append({
            "territory_id": tid,
            "name": name,
            "country": country,
            "iso3": iso3,
            "printable": bool(printable),
            "kinds": list(kinds or []),
            "geom": geom,
            "bbox": bbox,
            "drilled": drilled,
        })

    assigned = sum(1 for r in recs if r["territory_id"])
    for rec in recs:
        if rec["territory_id"]:
            continue
        lon, lat = rec["lon"], rec["lat"]
        for t in tile_meta:
            bb = t["bbox"]
            if not bb or not t["geom"]:
                continue
            if lon < bb[0] or lon > bb[2] or lat < bb[1] or lat > bb[3]:
                continue
            if geom_contains(lon, lat, t["geom"]):
                rec["territory_id"] = t["territory_id"]
                break
    assigned2 = sum(1 for r in recs if r["territory_id"])

    places_in_tile: dict[str, list[str]] = defaultdict(list)
    holes_in_tile: dict[str, list[str]] = defaultdict(list)
    for rec in recs:
        if not rec["territory_id"]:
            continue
        places_in_tile[rec["territory_id"]].append(rec["place_id"])
        if rec["on_printed_map"]:
            holes_in_tile[rec["territory_id"]].append(rec["place_id"])

    by_iso: dict[str, list[dict]] = defaultdict(list)
    pin_features = []
    for rec in recs:
        public = {k: v for k, v in rec.items() if k not in ("iso3", "kinds_mask")}
        by_iso[rec["iso3"]].append(public)
        pin_features.append({
            "type": "Feature",
            "properties": {
                "id": rec["place_id"],
                "n": rec["name"],
                "s": rec["score"],
                "k": rec["archetypes"][0] if rec["archetypes"] else "",
                "a": rec["kinds_mask"],
                "c": rec["iso3"],
                "m": bit_months(rec["best_months"]),
                "site": 1 if rec["is_site"] else 0,
                "hole": 1 if rec["on_printed_map"] else 0,
                "whs": rec["whs"],
                "t": rec["territory_id"] or "",
            },
            "geometry": {"type": "Point", "coordinates": [rec["lon"], rec["lat"]]},
        })
    for lst in by_iso.values():
        lst.sort(key=lambda p: (-p["score"], p["name"]))

    terr_by_iso: dict[str, list[dict]] = defaultdict(list)
    terr_features = []
    printable_n = 0
    for t in tile_meta:
        if t["printable"]:
            printable_n += 1
        app_ids = places_in_tile.get(t["territory_id"], t["drilled"])
        hole_ids = holes_in_tile.get(t["territory_id"], t["drilled"])
        rec = {
            "territory_id": t["territory_id"],
            "name": t["name"],
            "country": t["country"],
            "place_ids": hole_ids,
            "app_place_ids": app_ids,
            "dominant_archetypes": t["kinds"],
            "printable": t["printable"],
            "places": len(hole_ids),
            "app_places": len(app_ids),
        }
        terr_by_iso[t["iso3"]].append(rec)
        if t["geom"]:
            terr_features.append({
                "type": "Feature",
                "properties": {
                    "territory_id": t["territory_id"],
                    "name": t["name"],
                    "country": t["country"],
                    "iso3": t["iso3"],
                    "printable": t["printable"],
                    "holes": len(hole_ids),
                    "places": len(app_ids),
                    "kinds": t["kinds"],
                },
                "geometry": t["geom"],
            })

    index = []
    for iso3, plist in sorted(by_iso.items(), key=lambda kv: plist_country(kv[1])):
        kinds = defaultdict(int)
        for p in plist:
            for k in p["archetypes"]:
                kinds[k] += 1
        tiles_here = terr_by_iso.get(iso3, [])
        holes = sum(1 for p in plist if p["on_printed_map"])
        payload = {
            "country": plist[0]["country"],
            "iso3": iso3,
            "area_km2": None,
            "places": plist,
            "kinds": dict(kinds),
            "territories": tiles_here,
        }
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        (countries_dir / f"{iso3}.json").write_text(raw, encoding="utf8")
        index.append({
            "country": plist[0]["country"],
            "iso3": iso3,
            "file": f"countries/{iso3}.json",
            "places": len(plist),
            "holes": holes,
            "tiles": len(tiles_here),
            "kinds": len(kinds),
            "kind_counts": dict(kinds),
            "bytes": len(raw.encode("utf8")),
        })

    (OUT / "places.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": pin_features},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf8",
    )
    (OUT / "territories.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": terr_features},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf8",
    )

    manifest = {
        "build": "duckdb-15770",
        "model": {
            "weights": {"heritage": 0.3, "nature": 0.35, "livability": 0.35},
            "power_mean_p": 2,
            "normalisation": "linear, country-relative",
            "score_note": "0-100 against the top place in the same country; never comparable across borders",
        },
        "archetypes": ARCHETYPES,
        "archetype_counts": kind_counts_world,
        "totals": {
            "places": len(recs),
            "printed": printed,
            "countries": len(by_iso),
            "territories": len(tiles),
            "printable_territories": printable_n,
            "hole_budget": 3000,
        },
        "printed_map": {
            "min_tile_extent_km": 160.3,
            "map_width_m": 3.0,
            "min_spacing_km": 60,
        },
        "layers": {
            "places": "places.geojson",
            "territories": "territories.geojson",
            "countries": "countries.geojson",
            "register": "countries/{iso3}.json",
            "passports": "passports/{iso3}.json",
        },
        "countries": index,
    }

    pidx_path = OUT / "passports" / "index.json"
    if pidx_path.exists():
        pidx = json.loads(pidx_path.read_text(encoding="utf8"))
        covered = {p["iso3"] for p in pidx.get("passports", [])}
        uncovered = [c["iso3"] for c in index if c["iso3"] not in covered]
        manifest["passports"] = {
            "source": "ilyankou/passport-index-dataset",
            "licence": "MIT",
            "count": len(pidx.get("passports", [])),
            "destinations": len(pidx.get("passports", [])),
            "uncovered_in_register": len(uncovered),
            "states": {
                "vf": "no visa needed",
                "voa": "visa on arrival",
                "ev": "apply online first",
                "vr": "apply in advance",
                "na": "no admission",
                "home": "your own country",
            },
            "index": "passports/index.json",
            "note": "A planning snapshot, not legal advice. The destination's own mission is the authority.",
        }

    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
        encoding="utf8",
    )

    print(f"places {len(recs)}  printed {printed}  countries {len(by_iso)}")
    print(f"tiles with geometry {len(terr_features)} / {len(tiles)}")
    print(f"territory assigned: drilled {assigned}, after pip {assigned2}")
    print(f"kinds {kind_counts_world}")
    print(f"wrote {OUT}")


def plist_country(lst: list[dict]) -> str:
    return lst[0]["country"]


if __name__ == "__main__":
    main()
