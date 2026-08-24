"""Turn the flat dist files into the bundle the application actually loads.

Three things are missing between `build_world.py` / `build_territories.py` and a
web client, and all three are geometry or shape problems rather than model ones:

1.  `territory_id` is null on every place. Territories are derived *after* the
    app export, and only printed places are ever assigned to one. The
    application needs the tile a place sits in whether or not it gets drilled,
    so every place is assigned here by point-in-polygon.

2.  `territories.json` carries no geometry at all. A tile is a physical object
    with an outline; without the polygon there is nothing to click and nothing
    to extrude.

3.  Everything is one 3.7 MB blob. Doc 4 §7 asks for a manifest plus per-country
    register files, fetched on demand and cached immutably.

Nothing here changes a score, a selection or an id. It reshapes what the
pipeline already decided.
"""
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

_HERE = Path(__file__).resolve()
sys.path.insert(0, os.environ.get("TWM_PKG", str(_HERE.parents[1])))

from twm.config import DISSOLVE_INTO  # noqa: E402
from twm.geo import haversine_km  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent))
from build_territories import _iso3_by_country  # noqa: E402

DATA = Path(os.environ.get("TWM_DATA", "/home/claude/twm/data"))
DIST = Path(os.environ.get("TWM_DIST", "/home/claude/twm/dist"))
OUT = DIST / "app"

# ~0.01deg is about 1.1 km at the equator. The tiles are 160 km at their
# smallest, so this is two orders of magnitude finer than the object it
# describes and still cuts the payload by roughly an order of magnitude.
SIMPLIFY_DEG = 0.01
COORD_PRECISION = 4
SNAP_KM = 50.0


def _round_geom(geom, nd=COORD_PRECISION):
    """Trim coordinate precision in place -- half the file is trailing digits."""
    if isinstance(geom, (list, tuple)):
        if geom and isinstance(geom[0], (int, float)):
            return [round(float(v), nd) for v in geom]
        return [_round_geom(g, nd) for g in geom]
    return geom


def load_units(iso2_to_country):
    from shapely.geometry import shape

    raw = json.loads((DATA / "ne_10m_admin_1.geojson").read_text(encoding="utf-8"))
    units = {}
    for f in raw["features"]:
        p = f["properties"]
        country = iso2_to_country.get((p.get("iso_a2") or "").strip().lower())
        geom = f.get("geometry")
        if not country or not geom:
            continue
        try:
            g = shape(geom)
        except Exception:                                          # noqa: BLE001
            continue
        if g.is_empty:
            continue
        if not g.is_valid:
            g = g.buffer(0)
        uid = p.get("adm1_code")
        if not uid:
            continue
        units[uid] = (DISSOLVE_INTO.get(country, country), g)
    print(f"admin units      {len(units):>7}")
    return units


def main():
    from shapely.geometry import Point, mapping
    from shapely.ops import nearest_points, unary_union
    from shapely.strtree import STRtree

    OUT.mkdir(parents=True, exist_ok=True)
    app = json.loads((DIST / "app_places.json").read_text(encoding="utf-8"))
    tdoc = json.loads((DIST / "territories.json").read_text(encoding="utf-8"))
    countries_raw = json.loads((DATA / "countries.json").read_text(encoding="utf-8"))
    iso2 = {v.get("iso", "").lower(): k for k, v in countries_raw.items() if v.get("iso")}
    iso3 = _iso3_by_country()

    units = load_units(iso2)

    # --- territory polygons -------------------------------------------------
    terr_geom, missing_units = {}, 0
    for t in tdoc["territories"]:
        gs = []
        for uid in t["admin_units"]:
            u = units.get(uid)
            if u is None:
                missing_units += 1
                continue
            gs.append(u[1])
        if not gs:
            continue
        g = unary_union(gs)
        if not g.is_valid:
            g = g.buffer(0)
        terr_geom[t["territory_id"]] = g
    print(f"tiles with shape {len(terr_geom):>7}   of {len(tdoc['territories'])} "
          f"({missing_units} admin units unresolved)")

    # --- country polygons ---------------------------------------------------
    by_country = defaultdict(list)
    for country, g in units.values():
        by_country[country].append(g)
    country_geom = {}
    for c, gs in by_country.items():
        g = unary_union(gs)
        country_geom[c] = g if g.is_valid else g.buffer(0)
    print(f"countries shaped {len(country_geom):>7}")

    # --- assign every place to a tile ---------------------------------------
    # Only printed places were assigned upstream. Clicking a tile in the
    # application has to reveal everything inside it, not the drilled subset.
    tids = list(terr_geom)
    tree = STRtree([terr_geom[t] for t in tids])
    tcountry = {t["territory_id"]: t["country"] for t in tdoc["territories"]}
    by_tile = defaultdict(list)
    hit = near = 0
    for p in app["places"]:
        pt = Point(p["lon"], p["lat"])
        host = None
        for i in tree.query(pt):
            tid = tids[i]
            if terr_geom[tid].contains(pt):
                host = tid
                break
        if host is None:
            # A coastal place lands just outside its admin polygon often enough
            # that dropping all of them would be wrong. But tiles only cover the
            # parts of a country that carry a drilled hole, so "nearest tile in
            # the same country" can be 3,000 km away across an archipelago.
            # SNAP_KM is under the 60 km hole spacing: a place attached this way
            # is closer to the tile than two holes on that tile ever are to each
            # other. Anything further genuinely has no tile, and says so.
            same = [t for t in tids if tcountry.get(t) == p["country"]]
            if same:
                cand = min(same, key=lambda t: terr_geom[t].distance(pt))
                q = nearest_points(terr_geom[cand], pt)[0]
                if haversine_km(p["lat"], p["lon"], q.y, q.x) <= SNAP_KM:
                    host = cand
                    near += 1
        else:
            hit += 1
        p["territory_id"] = host
        if host:
            by_tile[host].append(p["place_id"])
    unplaced = sum(1 for p in app["places"] if not p["territory_id"])
    print(f"places in a tile {hit + near:>7}   ({hit} inside, {near} nearest-in-country, "
          f"{unplaced} unplaced)")

    # --- write it out -------------------------------------------------------
    (DIST / "app_places.json").write_text(
        json.dumps(app, separators=(",", ":")), encoding="utf-8")

    for t in tdoc["territories"]:
        t["app_place_ids"] = by_tile.get(t["territory_id"], [])
        t["app_places"] = len(t["app_place_ids"])
    (DIST / "territories.json").write_text(
        json.dumps(tdoc, separators=(",", ":")), encoding="utf-8")

    def feature(geom, props):
        g = geom.simplify(SIMPLIFY_DEG, preserve_topology=True)
        m = mapping(g)
        m["coordinates"] = _round_geom(m["coordinates"])
        return {"type": "Feature", "properties": props, "geometry": m}

    tprops = {t["territory_id"]: t for t in tdoc["territories"]}
    tfeat = [feature(g, {
        "territory_id": tid, "name": tprops[tid]["name"],
        "country": tprops[tid]["country"], "iso3": iso3.get(tprops[tid]["country"], ""),
        "printable": tprops[tid]["printable"],
        "places": tprops[tid]["app_places"], "holes": tprops[tid]["places"],
        "kinds": tprops[tid]["dominant_archetypes"],
    }) for tid, g in terr_geom.items()]
    _write(OUT / "territories.geojson", {"type": "FeatureCollection", "features": tfeat})

    cstat = app["countries"]
    cfeat = [feature(g, {
        "country": c, "iso3": iso3.get(c, ""),
        "places": cstat.get(c, {}).get("in_app", 0),
        "holes": cstat.get(c, {}).get("on_printed_map", 0),
        "tiles": sum(1 for t in tdoc["territories"] if t["country"] == c),
    }) for c, g in country_geom.items()]
    _write(OUT / "countries.geojson", {"type": "FeatureCollection", "features": cfeat})

    # points: one compact feature per place, properties trimmed to what the map
    # actually paints -- plus the two the register and the coverage meter need
    # to work at world scope without fetching all 233 register files.
    #
    #   a  every archetype as a bitmask, bit (n-1) for An. The coverage meter
    #      is the product; computing it for the world from the pin layer alone
    #      is worth ten bytes a feature. Sending the codes as an array is not.
    #   c  iso3, so a register row can name and filter its country.
    def kindmask(codes):
        m = 0
        for code in codes:
            m |= 1 << (int(code[1:]) - 1)
        return m

    pfeat = [{
        "type": "Feature",
        "properties": {"id": p["place_id"], "n": p["name"], "s": p["score"],
                       "k": p["archetypes"][0] if p["archetypes"] else "",
                       "a": kindmask(p["archetypes"]),
                       "c": iso3.get(p["country"], ""),
                       "site": 1 if p["is_site"] else 0,
                       "hole": 1 if p["on_printed_map"] else 0,
                       "whs": p["whs"], "t": p["territory_id"] or ""},
        "geometry": {"type": "Point", "coordinates": [round(p["lon"], COORD_PRECISION),
                                                      round(p["lat"], COORD_PRECISION)]},
    } for p in app["places"]]
    _write(OUT / "places.geojson", {"type": "FeatureCollection", "features": pfeat})

    # per-country register
    (OUT / "countries").mkdir(exist_ok=True)
    per = defaultdict(list)
    for p in app["places"]:
        per[p["country"]].append(p)
    index = []
    for c, ps in sorted(per.items()):
        code = iso3.get(c) or "".join(ch for ch in c.upper() if ch.isalnum())[:3]
        ps.sort(key=lambda p: -p["score"])
        kinds = defaultdict(int)
        for p in ps:
            for a in p["archetypes"]:
                kinds[a] += 1
        payload = {
            "country": c, "iso3": code,
            "area_km2": countries_raw.get(c, {}).get("area_km2"),
            "places": ps,
            "kinds": dict(sorted(kinds.items(), key=lambda kv: int(kv[0][1:]))),
            "territories": [t for t in tdoc["territories"] if t["country"] == c],
        }
        path = OUT / "countries" / f"{code}.json"
        _write(path, payload)
        index.append({"country": c, "iso3": code, "file": f"countries/{code}.json",
                      "places": len(ps),
                      "holes": sum(1 for p in ps if p["on_printed_map"]),
                      "tiles": len(payload["territories"]),
                      "kinds": len(kinds),
                      # What kinds this country HAS. The coverage meter needs
                      # the denominator before the register file arrives --
                      # "still unseen" is a statement about what is available
                      # here, not about what exists somewhere.
                      "kind_counts": payload["kinds"],
                      "bytes": path.stat().st_size})

    from twm.identity import (
        build_number, check_place_id_stability, load_mapping, load_snapshot,
    )

    ids = [p["place_id"] for p in app["places"]]
    number = build_number(ids)
    previous = load_snapshot(DIST / "place_ids.json")
    mapping = load_mapping(DIST / "place_id_map.json")
    identity = [{
        "id": p["place_id"], "name": p["name"], "country": p["country"],
        "lat": p["lat"], "lon": p["lon"],
    } for p in app["places"]]
    moved = check_place_id_stability(previous, identity, mapping)
    if moved:
        print("place_id stability failed:")
        for err in moved:
            print(f"  {err}")
        raise SystemExit(
            "A rebuild that changes place_id is a migration. "
            "Add every moved id to dist/place_id_map.json."
        )

    manifest = {
        "build": number,
        "model": {"weights": {"heritage": 0.30, "nature": 0.35, "livability": 0.35},
                  "power_mean_p": 2, "normalisation": "linear, country-relative",
                  "score_note": "0-100 against the top place in the same country; "
                                "never comparable across borders"},
        "archetypes": app["archetypes"],
        # All twelve, always, with a live count each. Seven are zero today
        # because the landform and relief signals are not in the database yet;
        # the client drives the meter from this so they light up on the next
        # build without a code change.
        "archetype_counts": {
            a: sum(1 for p in app["places"] if a in p["archetypes"])
            for a in app["archetypes"]
        },
        "totals": {"places": len(app["places"]),
                   "printed": sum(1 for p in app["places"] if p["on_printed_map"]),
                   "countries": len(index), "territories": len(tdoc["territories"]),
                   "printable_territories": sum(1 for t in tdoc["territories"]
                                                if t["printable"]),
                   "hole_budget": 3000},
        "printed_map": {"min_tile_extent_km": tdoc["min_tile_extent_km"],
                        "map_width_m": tdoc["map_width_m"],
                        "min_spacing_km": 60},
        "layers": {"places": "places.geojson", "territories": "territories.geojson",
                   "countries": "countries.geojson", "register": "countries/{iso3}.json"},
        "countries": index,
    }
    _write(OUT / "manifest.json", manifest)

    report_path = DIST / "build_report.json"
    if report_path.is_file():
        report = json.loads(report_path.read_text(encoding="utf-8"))
    else:
        report = {}
    report["build"] = number
    report_path.write_text(json.dumps(report, indent=1, default=str) + "\n", encoding="utf-8")

    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"\nbundle           {total/1e6:>7.1f} MB in {OUT}")
    print(f"  build          {number}")
    for f in sorted(OUT.glob("*")):
        if f.is_file():
            print(f"  {f.name:<24}{f.stat().st_size/1e3:>9.0f} KB")
    reg = sum(f.stat().st_size for f in (OUT / "countries").glob("*.json"))
    print(f"  countries/{len(index)} files   {reg/1e3:>9.0f} KB "
          f"(largest {max(i['bytes'] for i in index)/1e3:.0f} KB)")


def _write(path, obj):
    path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")


def reconstruct_app_places(bundle: Path, dist: Path) -> int:
    """Rebuild dist/app_places.json from the published country registers.

    The pipeline shape checks in verify.py skip silently without this file.
    Fields are mapped to the names those checks read; nothing is invented.
    """
    def _get(p: dict, *keys):
        for k in keys:
            if k in p and p[k] is not None:
                return p[k]
        return None

    places = []
    countries_dir = bundle / "countries"
    if not countries_dir.is_dir():
        countries_dir = bundle / "countries"
    for path in sorted(countries_dir.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        for p in doc.get("places") or []:
            lat = _get(p, "lat", "lat")
            lon = _get(p, "lon", "lon")
            places.append({
                "place_id": p["place_id"],
                "name": p["name"],
                "country": p["country"],
                "lat": float(lat),
                "lon": float(lon),
                "score": p["score"],
                "sources": list(_get(p, "sources", "sources") or []),
                "on_printed_map": bool(_get(p, "on_printed_map", "on_printed_map")),
                "printed_rank": _get(p, "printed_rank", "printed_rank"),
            })
    dist.mkdir(parents=True, exist_ok=True)
    (dist / "app_places.json").write_text(
        json.dumps({"places": places}, separators=(",", ":")), encoding="utf-8")
    return len(places)


if __name__ == "__main__":
    if "--reconstruct" in sys.argv:
        here = Path(__file__).resolve()
        n = reconstruct_app_places(
            here.parents[2] / "webapp" / "twm-app" / "public" / "data",
            here.parents[1] / "dist",
        )
        print(f"app_places.json  {n} places")
    else:
        main()
