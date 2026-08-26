"""Grow the tile set until it covers every square metre of land.

The standing rule was "the wall map may have empty land" -- true while the
tiles were magnets dropped onto a printed map. It stops being true the moment
the tiles are *cut out of* the map, because then land with no tile is a hole
in the paper. Adil's ruling of 2026-08-25: all inhabited land gets a tile,
uninhabited land gets a grey tile, everything but ocean is covered.

The method preserves what already exists. Every one of the 803 tiles keeps
its id, its name and its places; it simply grows to swallow the empty
administrative units next to it. Land no existing tile can reasonably claim
becomes a new grey tile, cut on real admin-1 boundaries so it still looks
like a place rather than a rectangle. Nothing about the model, the scoring or
the place-to-tile mapping changes -- `territory_id` on a place means exactly
what it meant before.

Coarser levels are unions of the base level and exist for one reason: a tile
has to be big enough to cut out with scissors. At 700 mm the world's land is
about 71,000 mm2 of paper; split 803 ways that is a 9 mm tile, which no one
can cut. Each level states the smallest wall map it is cuttable on.
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

SRC = Path("/mnt/user-data/uploads/Travelers world map project")
GEO = Path("/home/claude/geo")
OUT = GEO / "out"

# A leftover piece smaller than this is scenery, not a tile: it joins its
# neighbour instead of becoming a grey tile of its own.
ABSORB_KM2 = 6_000.0
# A grey tile below this is merged into the nearest one. Roughly the smallest
# thing worth cutting on a 1400 mm map.
MIN_GREY_KM2 = 12_000.0
# Above this a grey tile is split, so the Sahara is a handful of pieces
# rather than one continent-sized slab.
MAX_GREY_KM2 = 700_000.0

R = 6371.0088


def km2(g) -> float:
    """Spherical area of a lon/lat geometry, in km^2."""
    if g.is_empty:
        return 0.0
    total = 0.0
    for p in _parts(g):
        total += abs(_ring_km2(p.exterior.coords))
        for r in p.interiors:
            total -= abs(_ring_km2(r.coords))
    return abs(total)


def _parts(g):
    """Every Polygon inside g, at any nesting.

    Intersecting two polygons that share an edge returns a GeometryCollection
    of polygons *and* the shared lines. Treating that collection as a single
    non-polygon is how a country's whole tile set silently measured zero.
    """
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if g.geom_type in ("MultiPolygon", "GeometryCollection"):
        out = []
        for p in g.geoms:
            out.extend(_parts(p))
        return out
    return []


def _ring_km2(coords) -> float:
    c = list(coords)
    t = 0.0
    for i in range(len(c) - 1):
        lon1, lat1 = c[i][0], c[i][1]
        lon2, lat2 = c[i + 1][0], c[i + 1][1]
        t += math.radians(lon2 - lon1) * (
            2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2)))
    return t * R * R / 2.0


def clean(g):
    """Validate, and keep only the areal part.

    Every intersection and difference here can hand back stray lines and
    points where two polygons touch. They are not land and must not survive
    into a tile.
    """
    if g is None or g.is_empty:
        return g
    if not g.is_valid:
        g = g.buffer(0)
    if g.geom_type not in ("Polygon", "MultiPolygon"):
        ps = _parts(g)
        if not ps:
            return g.buffer(0) if g.geom_type == "GeometryCollection" else g
        g = ps[0] if len(ps) == 1 else unary_union(ps)
        if not g.is_valid:
            g = g.buffer(0)
    return g


def polys(g):
    return _parts(g)


# --------------------------------------------------------------------------

def load():
    print("loading")
    C = json.loads((SRC / "webapp/twm-app/public/data/countries.geojson").read_text())
    T = json.loads((SRC / "webapp/twm-app/public/data/territories.geojson").read_text())
    P = json.loads((SRC / "webapp/twm-app/public/data/places.geojson").read_text())
    A = json.loads((GEO / "ne_10m_admin_1.geojson").read_text())
    print(f"  countries {len(C['features'])}  tiles {len(T['features'])}"
          f"  places {len(P['features'])}  admin-1 {len(A['features'])}")
    return C, T, P, A


def admin_by_iso3(A, iso3_of_iso2):
    """Admin-1 units grouped by ISO3, used only to cut grey tiles nicely."""
    out = defaultdict(list)
    for f in A["features"]:
        p = f["properties"]
        code = (p.get("adm0_a3") or "").strip().upper()
        if not code:
            code = iso3_of_iso2.get((p.get("iso_a2") or "").strip().upper(), "")
        if not code or not f.get("geometry"):
            continue
        g = clean(shape(f["geometry"]))
        if g is None or g.is_empty:
            continue
        out[code].append((p.get("name_en") or p.get("name") or "", g))
    return out


def split_big(piece, name, cap_km2):
    """Cut an oversized grey piece on a lon/lat grid until every part fits.

    A grid is a poor border, which is why admin-1 is tried first and this only
    ever runs on land admin-1 does not describe -- ice sheets and empty desert
    interiors, where there is no real boundary to follow anyway.
    """
    out = []
    stack = [piece]
    guard = 0
    while stack and guard < 4000:
        guard += 1
        g = stack.pop()
        a = km2(g)
        if a <= cap_km2 or a < MIN_GREY_KM2 * 2:
            out.append(g)
            continue
        minx, miny, maxx, maxy = g.bounds
        from shapely.geometry import box
        if (maxx - minx) * math.cos(math.radians((miny + maxy) / 2)) >= (maxy - miny):
            mid = (minx + maxx) / 2
            halves = [box(minx, miny, mid, maxy), box(mid, miny, maxx, maxy)]
        else:
            mid = (miny + maxy) / 2
            halves = [box(minx, miny, maxx, mid), box(minx, mid, maxx, maxy)]
        made = False
        for h in halves:
            part = clean(g.intersection(h))
            for p in polys(part):
                if km2(p) > 1.0:
                    stack.append(p)
                    made = True
        if not made:
            out.append(g)
    out.extend(stack)
    return out


def grow_country(iso3, country, cgeom, tiles, admin_units):
    """Return the country's tiles, grown until they cover cgeom.

    tiles: list of dicts with 'geom' and the properties to keep.
    """
    cgeom = clean(cgeom)
    if cgeom is None or cgeom.is_empty:
        return []

    for t in tiles:
        t["geom"] = clean(t["geom"].intersection(cgeom))
    tiles = [t for t in tiles if t["geom"] is not None and not t["geom"].is_empty]

    if tiles:
        covered = clean(unary_union([t["geom"] for t in tiles]))
        leftover = clean(cgeom.difference(covered))
    else:
        leftover = cgeom

    pieces = []
    if leftover is not None and not leftover.is_empty:
        # Cut the leftover on admin-1 lines so grey tiles keep real borders.
        units = admin_units.get(iso3, [])
        if units:
            for name, u in units:
                part = clean(leftover.intersection(u))
                for p in polys(part):
                    if km2(p) > 0.5:
                        pieces.append((name, p))
            rest = clean(leftover.difference(unary_union([u for _, u in units])))
            for p in polys(rest):
                if km2(p) > 0.5:
                    pieces.append(("", p))
        else:
            for p in polys(leftover):
                if km2(p) > 0.5:
                    pieces.append(("", p))

    # Small pieces join the nearest tile. Big ones become grey tiles.
    grey = []
    if tiles:
        tree = STRtree([t["geom"] for t in tiles])
        absorbed = defaultdict(list)
        for name, p in pieces:
            a = km2(p)
            if a >= ABSORB_KM2:
                grey.append((name, p))
                continue
            try:
                idx = tree.nearest(p)
            except Exception:                                      # noqa: BLE001
                idx = None
            if idx is None:
                grey.append((name, p))
            else:
                absorbed[int(idx)].append(p)
        for i, ps in absorbed.items():
            tiles[i]["geom"] = clean(unary_union([tiles[i]["geom"]] + ps))
    else:
        grey = pieces

    # Merge undersized grey, split oversized grey.
    merged = []
    for name, p in grey:
        for part in split_big(p, name, MAX_GREY_KM2):
            merged.append((name, part))
    small = [(n, p) for n, p in merged if km2(p) < MIN_GREY_KM2]
    big = [(n, p) for n, p in merged if km2(p) >= MIN_GREY_KM2]
    if small:
        hosts = [t["geom"] for t in tiles] + [p for _, p in big]
        if hosts:
            tree = STRtree(hosts)
            add_t = defaultdict(list)
            add_b = defaultdict(list)
            for _, p in small:
                try:
                    i = int(tree.nearest(p))
                except Exception:                                  # noqa: BLE001
                    continue
                if i < len(tiles):
                    add_t[i].append(p)
                else:
                    add_b[i - len(tiles)].append(p)
            for i, ps in add_t.items():
                tiles[i]["geom"] = clean(unary_union([tiles[i]["geom"]] + ps))
            for i, ps in add_b.items():
                big[i] = (big[i][0], clean(unary_union([big[i][1]] + ps)))
        else:
            # No tile and no big piece to join: the whole country is smaller
            # than one grey tile, so it is one grey tile. Bermuda came out of
            # admin-1 as twenty parishes and must not print as twenty tiles.
            merged_small = clean(unary_union([p for _, p in small]))
            big = [(small[0][0], merged_small)] if merged_small is not None \
                and not merged_small.is_empty else []

    out = list(tiles)
    seq = 1
    for name, p in big:
        out.append({
            "territory_id": f"{iso3}-G{seq:02d}",
            "name": name or f"{country} — unsettled",
            "country": country,
            "iso3": iso3,
            "places": 0,
            "holes": 0,
            "kinds": [],
            "printable": False,
            "inhabited": 0,
            "geom": p,
        })
        seq += 1
    return out


def partition(tiles):
    """Force one country's tiles to be disjoint.

    The published tile set overlaps: CHN-T05 and CHN-T08 share 195 square
    degrees, about the area of Belarus, and 1,079 pairs overlap in all, 6.3%
    of the tile area. Under magnets that never showed -- two magnets can
    overlap on a printed map and nobody notices. Cut out of paper they cannot,
    so the overlap has to go.

    Upstream cause is in `_split_oversized`/`_merge_undersized`, which let the
    same admin unit end up on the id list of two tiles. This is the downstream
    guard, and it is worth keeping even after that is fixed: the tiles are a
    partition or the jigsaw does not close.

    Land goes to the tile with more places, then the larger one. A tile that
    loses everything is dropped and reported.
    """
    order = sorted(range(len(tiles)),
                   key=lambda i: (-tiles[i].get("app_places", 0),
                                  -tiles[i].get("places", 0),
                                  -km2(tiles[i]["geom"])))
    claimed = None
    out = []
    for i in order:
        t = tiles[i]
        g = t["geom"]
        if claimed is not None:
            try:
                g = clean(g.difference(claimed))
            except Exception:                                      # noqa: BLE001
                g = clean(clean(g).buffer(0).difference(claimed.buffer(0)))
        if g is None or g.is_empty or km2(g) < 0.05:
            continue
        t = dict(t)
        t["geom"] = g
        out.append(t)
        claimed = g if claimed is None else clean(unary_union([claimed, g]))
    return out


def quantise(g, q=0.005, nd=3):
    """Snap to a grid so shared edges stay bit-identical between tiles.

    Simplifying a tile on its own would open gaps along the seams. Snapping
    is decided per vertex, so two tiles that share an edge still share it
    exactly afterwards, which is what lets the pieces fit.
    """
    def ring(r):
        out = []
        for c in r:
            p = (round(round(c[0] / q) * q, nd), round(round(c[1] / q) * q, nd))
            if not out or p != out[-1]:
                out.append(p)
        if len(out) >= 3 and out[0] != out[-1]:
            out.append(out[0])
        return [list(p) for p in out] if len(out) >= 4 else None

    from shapely.geometry import mapping as _m
    m = _m(g)
    if m["type"] == "Polygon":
        rs = [ring(r) for r in m["coordinates"]]
        rs = [r for r in rs if r]
        return {"type": "Polygon", "coordinates": rs} if rs else None
    ps = []
    for poly in m["coordinates"]:
        rs = [ring(r) for r in poly]
        rs = [r for r in rs if r]
        if rs:
            ps.append(rs)
    return {"type": "MultiPolygon", "coordinates": ps} if ps else None


def main():
    C, T, P, A = load()

    iso3_of_iso2 = {}
    craw = json.loads((SRC / "database/data/countries.json").read_text())
    name_iso3 = {}
    for f in C["features"]:
        name_iso3[f["properties"]["country"]] = f["properties"]["iso3"]
    for name, rec in craw.items():
        i2 = (rec.get("iso") or "").strip().upper()
        i3 = name_iso3.get(name)
        if i2 and i3:
            iso3_of_iso2[i2] = i3

    admin = admin_by_iso3(A, iso3_of_iso2)
    print(f"  admin-1 grouped into {len(admin)} countries")

    by_country_tiles = defaultdict(list)
    for f in T["features"]:
        p = f["properties"]
        if not f.get("geometry"):
            continue
        g = clean(shape(f["geometry"]))
        if g is None or g.is_empty:
            continue
        by_country_tiles[p["iso3"]].append({
            "territory_id": p["territory_id"], "name": p["name"],
            "country": p["country"], "iso3": p["iso3"],
            "places": p.get("places", 0), "holes": p.get("holes", 0),
            "kinds": p.get("kinds", []), "printable": p.get("printable", False),
            "inhabited": 1, "geom": g,
        })

    result = []
    stats = []
    for i, f in enumerate(C["features"], 1):
        p = f["properties"]
        iso3, country = p["iso3"], p["country"]
        if not f.get("geometry"):
            continue
        cg = clean(shape(f["geometry"]))
        if cg is None or cg.is_empty:
            continue
        before = len(by_country_tiles.get(iso3, []))
        tiles = grow_country(iso3, country, cg, by_country_tiles.get(iso3, []), admin)
        tiles = partition(tiles)
        ca = km2(cg)
        ta = km2(clean(unary_union([t["geom"] for t in tiles]))) if tiles else 0.0
        stats.append((iso3, ca, ta, before, len(tiles)))
        result.extend(tiles)
        if i % 40 == 0:
            print(f"  {i}/{len(C['features'])}  {iso3} {before}->{len(tiles)}")

    print(f"\nbase level: {len(T['features'])} tiles -> {len(result)}")
    bad = [s for s in stats if s[1] > 500 and s[2] / max(s[1], 1e-9) < 0.995]
    tot_c = sum(s[1] for s in stats)
    tot_t = sum(s[2] for s in stats)
    print(f"coverage {tot_t/tot_c:.5f} of country area; "
          f"{len(bad)} countries under 0.995")
    for s in sorted(bad, key=lambda s: s[2] / s[1])[:12]:
        print(f"   {s[0]} {s[2]/s[1]:.3f}  {s[1]:,.0f} km2")

    # place counts, recomputed against the grown shapes
    tree = STRtree([t["geom"] for t in result])
    from shapely.geometry import Point
    counts = defaultdict(int)
    printed = defaultdict(int)
    for f in P["features"]:
        lon, lat = f["geometry"]["coordinates"]
        pt = Point(lon, lat)
        cand = tree.query(pt)
        hit = None
        for idx in cand:
            if result[int(idx)]["geom"].covers(pt):
                hit = int(idx)
                break
        if hit is None:
            try:
                hit = int(tree.nearest(pt))
            except Exception:                                      # noqa: BLE001
                continue
        counts[hit] += 1
        if f["properties"].get("p"):
            printed[hit] += 1
    for i, t in enumerate(result):
        t["app_places"] = counts.get(i, 0)
        t["inhabited"] = 1 if counts.get(i, 0) else 0

    empty = sum(1 for t in result if not t["app_places"])
    print(f"tiles with no place: {empty} of {len(result)}")

    OUT.mkdir(parents=True, exist_ok=True)
    write_level(result, "base")
    return result


def write_level(tiles, name):
    feats = []
    for t in tiles:
        g = quantise(t["geom"])
        if g is None:
            continue
        feats.append({
            "type": "Feature",
            "properties": {
                "territory_id": t["territory_id"], "name": t["name"],
                "country": t["country"], "iso3": t["iso3"],
                "places": t.get("places", 0), "holes": t.get("holes", 0),
                "app_places": t.get("app_places", 0),
                "kinds": t.get("kinds", []),
                "printable": t.get("printable", False),
                "inhabited": t.get("inhabited", 0),
                "km2": round(km2(shape(g))),
            },
            "geometry": g,
        })
    path = OUT / "_q0.005.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                               separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {path.name}  {len(feats)} tiles  {path.stat().st_size/1e6:.2f} MB")
    return path


if __name__ == "__main__":
    sys.setrecursionlimit(10000)
    main()
