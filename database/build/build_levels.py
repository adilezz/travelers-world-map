"""Nest the tiles into cuttable levels.

The base tessellation covers the planet, and on a 700 x 500 mm sheet its
median tile prints 4.1 mm across. That is not a jigsaw piece, it is a crumb.
A tile has to survive scissors, a thumb and a dab of glue, so the tile set has
to be chosen for the paper rather than for the database.

The criterion is the tile's printed size, not a tile count. A level is
defined as "every tile is at least CUT_MM across on a wall map W mm wide",
and it is built by merging the smallest tile into its best neighbour until
that holds. Levels are named for W, because that is the number the traveler
actually types into the export dialog:

  L0     the base tessellation, 1059 tiles, all the detail there is
  w2000  cuttable on a 2 m wall map
  w1400  cuttable on a 1.4 m wall map
  w1000
  w700   cuttable on the suggested 700 x 500 poster

A count target was tried first and is the wrong criterion: it merges tiles in
Siberia that were already 40 mm across while leaving Malta at 1 mm, because
the quota is spent per country rather than per tile.

Two things are deliberately left un-merged. An island with no land neighbour
stays its own tile -- merging it would make a piece that cannot be cut out in
one go. And a country's last tile is never merged into another country's:
a tile spanning a border could not carry a country's name, could not be
scored, and would make the coverage meter lie. So some tiles stay below the
threshold, and the export names them rather than pretending otherwise.

Levels nest. Every L0 tile lies wholly inside exactly one tile at every
coarser level, so a traveler who prints the world at w700 and later reprints
one country at L0 gets pieces that still fit the same holes.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import unary_union

OUT = Path("/home/claude/geo/out")

CUT_MM = 12.0                      # the smallest square a person can cut and place
WIDTHS = [2000, 1400, 1000, 700]   # wall-map widths a level is built for


def side_deg(width_mm: float) -> float:
    """The side, in degrees, that prints as CUT_MM on a map width_mm wide."""
    return CUT_MM / (width_mm / 360.0)


def valid(g):
    """Quantising to a grid can fold a thin spur into a bow tie. Repair it."""
    if g is None or g.is_empty:
        return g
    if g.is_valid:
        return g
    try:
        from shapely import make_valid
        g2 = make_valid(g)
    except Exception:                                              # noqa: BLE001
        g2 = g.buffer(0)
    if g2.geom_type not in ("Polygon", "MultiPolygon"):
        parts = [p for p in getattr(g2, "geoms", [g2])
                 if p.geom_type in ("Polygon", "MultiPolygon")]
        g2 = unary_union(parts) if parts else g.buffer(0)
    return g2


def safe_union(a, b):
    for attempt in (
        lambda: unary_union([a, b]),
        lambda: unary_union([valid(a).buffer(0), valid(b).buffer(0)]),
        lambda: unary_union([a.buffer(1e-9), b.buffer(1e-9)]),
    ):
        try:
            return valid(attempt())
        except Exception:                                          # noqa: BLE001
            continue
    return a


def deg2(g) -> float:
    """Area in square degrees -- paper area, before any scaling."""
    return abs(g.area)


def adjacency(geoms: list):
    """Shared boundary length between every touching pair, in degrees."""
    n = len(geoms)
    adj = defaultdict(float)
    for i in range(n):
        gi, bi = geoms[i], geoms[i].bounds
        for j in range(i + 1, n):
            gj, bj = geoms[j], geoms[j].bounds
            if bi[2] < bj[0] - 1e-6 or bj[2] < bi[0] - 1e-6:
                continue
            if bi[3] < bj[1] - 1e-6 or bj[3] < bi[1] - 1e-6:
                continue
            try:
                inter = gi.intersection(gj)
            except Exception:                                      # noqa: BLE001
                try:
                    inter = valid(gi).intersection(valid(gj))
                except Exception:                                  # noqa: BLE001
                    continue
            ln = getattr(inter, "length", 0.0)
            if ln > 1e-9:
                adj[(i, j)] = adj[(j, i)] = ln
    return adj


def merge_to_size(items, min_area, cap_mult=3.0):
    """Merge the smallest undersized tile into its best neighbour, repeatedly.

    Best means the longest shared border: it keeps the merged tile compact and
    stops a coastal strip from swallowing an inland province it only touches
    at a corner.
    """
    n = len(items)
    groups = [[i] for i in range(n)]
    geoms = [it["geom"] for it in items]
    areas = [deg2(g) for g in geoms]
    adj = adjacency(geoms)
    alive = set(range(n))
    stuck: set[int] = set()
    cap = min_area * cap_mult

    while True:
        small = [i for i in alive if areas[i] < min_area and i not in stuck]
        if not small:
            break
        i = min(small, key=lambda k: areas[k])
        nb = [(adj.get((i, j), 0.0), j) for j in alive if j != i]
        nb = [(ln, j) for ln, j in nb if ln > 0]
        if not nb:
            stuck.add(i)               # an island; nothing to merge it with
            continue
        # Longest shared border wins, but not into a tile that is already
        # comfortably over size: without this the level ends up as a handful
        # of continent-sized slabs beside the islands it could never fix,
        # and the median tile comes out *smaller* than the level above it.
        fits = [(ln, j) for ln, j in nb if areas[j] + areas[i] <= cap]
        _, j = max(fits) if fits else min((areas[j], j) for _, j in nb)
        groups[j].extend(groups[i])
        geoms[j] = safe_union(geoms[j], geoms[i])
        areas[j] = deg2(geoms[j])
        for k in list(alive):
            if k in (i, j):
                continue
            ln = adj.get((i, k), 0.0)
            if ln:
                adj[(j, k)] = adj[(k, j)] = adj.get((j, k), 0.0) + ln
        alive.discard(i)
        stuck.discard(j)

    order = sorted(alive)
    return [groups[i] for i in order], [geoms[i] for i in order]


def report(sizes_deg, label):
    n = len(sizes_deg)
    s = sorted(math.sqrt(a) for a in sizes_deg)
    out = {"tiles": n}
    for w in WIDTHS:
        k = w / 360.0
        under = sum(1 for x in s if x * k < CUT_MM)
        out[f"under_{w}"] = under
    med = s[n // 2]
    print(f"  {label:<6} {n:>5} tiles   median "
          + "  ".join(f"{med*(w/360.0):5.1f}mm@{w}" for w in WIDTHS))
    print(f"         {'':>5}          too small "
          + "  ".join(f"{out[f'under_{w}']:>5}@{w}" for w in WIDTHS))
    return out


def main():
    d = json.loads((OUT / "_q0.005.geojson").read_text())
    feats = d["features"]
    print(f"base {len(feats)} tiles\n")

    by_id = {f["properties"]["territory_id"]: f for f in feats}
    units = {k: [k] for k in by_id}
    unit_geom = {k: valid(shape(f["geometry"])) for k, f in by_id.items()}
    parent = {k: k for k in by_id}

    ladder = [report([deg2(g) for g in unit_geom.values()], "L0")]
    ladder[0]["level"] = "L0"
    ladder[0]["for_map_mm"] = None

    for w in WIDTHS:
        lname = f"w{w}"
        min_area = side_deg(w) ** 2
        by_country = defaultdict(list)
        for uid, members in units.items():
            by_country[by_id[members[0]]["properties"]["iso3"]].append(uid)

        new_units, new_geom = {}, {}
        for iso3, us in sorted(by_country.items()):
            if len(us) == 1:
                new_units[us[0]] = units[us[0]]
                new_geom[us[0]] = unit_geom[us[0]]
                continue
            items = [{"uid": u, "geom": unit_geom[u]} for u in us]
            groups, geoms = merge_to_size(items, min_area)
            for grp, g in zip(groups, geoms):
                members = [items[i]["uid"] for i in grp]
                best = max(members, key=lambda u: (
                    sum(by_id[b]["properties"]["app_places"] for b in units[u]),
                    deg2(unit_geom[u])))
                new_units[best] = [b for u in members for b in units[u]]
                new_geom[best] = g

        for uid, base_ids in new_units.items():
            for b in base_ids:
                parent[b] = uid
        for f in feats:
            f["properties"][lname] = parent[f["properties"]["territory_id"]]
        units, unit_geom = new_units, new_geom

        r = report([deg2(g) for g in unit_geom.values()], lname)
        r["level"] = lname
        r["for_map_mm"] = w
        ladder.append(r)

    for f in feats:
        f["properties"]["L0"] = f["properties"]["territory_id"]

    path = OUT / "tiles.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                               separators=(",", ":")), encoding="utf-8")
    print(f"\nwrote {path.name}  {path.stat().st_size/1e6:.2f} MB")
    (OUT / "tile-levels.json").write_text(json.dumps(
        {"cut_mm": CUT_MM, "levels": ladder}, indent=1))


if __name__ == "__main__":
    main()
