"""Write one file per cut level, with the tiles already merged and split.

A cut piece is one connected polygon, not one tile.

Merged by country, "United States tile 4" is Alaska *and* the Aleutians, whose
bounding box spans 1,396 mm on a 1,400 mm map because the Aleutians cross the
antimeridian. "France tile 5" is metropolitan France plus French Guiana and
Réunion. Neither is a jigsaw piece; neither can be cut out in one go. Ten tiles
at the 1.4 m level were wider or taller than 250 mm and every one of them was
this, not a genuinely large piece of land.

So each merged tile is split into its connected parts and each part is its own
cut piece, carrying the base tiles that fall inside it. Parts too small to cut
are still written out -- the wall map draws them as fixed background, and the
export names them rather than dropping them silently.

Recovering a merged outline in the browser by dropping every edge that appears
twice was tried and does not close: the partition step cuts one tile's edge
against another's and leaves T-junctions, so only 12-20% of edges cancel and a
fifth of the groups end with odd-degree vertices — open chains, not rings.
Shapely does the union exactly, once, at build time.

Each level is fetched only when the traveler exports at that level, so the
cost is one file per export rather than four files at boot.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

from shapely.geometry import Point, mapping, shape
from shapely.ops import unary_union

OUT = Path("/home/claude/geo/out")
LEVELS = ["w2000", "w1400", "w1000", "w700"]
# What a pair of scissors can actually do, measured on the piece's bounding
# box: at least CUT_MM the long way, and at least CUT_MIN_MM the short way.
#
# The first attempt tested the square root of the area and was wrong. Area
# punishes anything long or ragged: western Honshu came out at 10.8 mm and was
# refused, though its box is 26 x 12 mm and it is obviously cuttable; so did
# the Netherlands at 15 x 10.5 mm and Belgium at 15 x 7.8 mm. Between them
# they accounted for most of the "places on uncuttable tiles" figure, and none
# of them was uncuttable. `poster.ts:cuttable` applies exactly this test.
CUT_MM = 12.0
CUT_MIN_MM = 6.0


def valid(g):
    if g is None or g.is_empty or g.is_valid:
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


def quantise(m, q=0.005, nd=3):
    def ring(r):
        out = []
        for c in r:
            p = (round(round(c[0] / q) * q, nd), round(round(c[1] / q) * q, nd))
            if not out or p != out[-1]:
                out.append(p)
        if len(out) >= 3 and out[0] != out[-1]:
            out.append(out[0])
        return [list(p) for p in out] if len(out) >= 4 else None

    if m["type"] == "Polygon":
        rs = [x for x in (ring(r) for r in m["coordinates"]) if x]
        return {"type": "Polygon", "coordinates": rs} if rs else None
    ps = []
    for poly in m["coordinates"]:
        rs = [x for x in (ring(r) for r in poly) if x]
        if rs:
            ps.append(rs)
    return {"type": "MultiPolygon", "coordinates": ps} if ps else None


def parts_of(g):
    """Connected polygons, largest first."""
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    out = []
    for p in getattr(g, "geoms", []):
        out.extend(parts_of(p))
    out.sort(key=lambda p: -abs(p.area))
    return out


def main():
    d = json.loads((OUT / "tiles.geojson").read_text())
    feats = d["features"]
    geo = {f["properties"]["territory_id"]: valid(shape(f["geometry"]))
           for f in feats}
    by_id = {f["properties"]["territory_id"]: f["properties"] for f in feats}

    ladder = json.loads((OUT / "tile-levels.json").read_text())
    index = {l["level"]: l for l in ladder["levels"]}
    summary = []
    for level in LEVELS:
        width = int(level[1:])
        mm_per_deg = width / 360.0

        def is_cuttable(pc):
            minx, miny, maxx, maxy = pc.bounds
            w_deg, h_deg = maxx - minx, maxy - miny
            return (max(w_deg, h_deg) * mm_per_deg >= CUT_MM
                    and min(w_deg, h_deg) * mm_per_deg >= CUT_MIN_MM)
        dropped, dropped_places = 0, 0
        grp = defaultdict(list)
        for f in feats:
            grp[f["properties"][level]].append(f["properties"]["territory_id"])

        out = []
        for gid, members in grp.items():
            gs = [geo[m] for m in members if geo[m] is not None and not geo[m].is_empty]
            if not gs:
                continue
            g = valid(gs[0] if len(gs) == 1 else unary_union(gs))
            if g is None or g.is_empty:
                continue
            qm = quantise(mapping(g))
            if qm is None:
                continue
            try:
                rp = g.representative_point()
            except Exception:                                      # noqa: BLE001
                rp = g.centroid
            head = by_id[gid]
            pieces = parts_of(g)
            # Every base tile falls wholly inside one part, because the part is
            # a union of base tiles. Match on a point that is guaranteed to be
            # inside the base tile rather than on a centroid.
            homes: dict[int, list[str]] = {i: [] for i in range(len(pieces))}
            for m in members:
                mg = geo[m]
                if mg is None or mg.is_empty:
                    continue
                try:
                    pt = mg.representative_point()
                except Exception:                                  # noqa: BLE001
                    pt = mg.centroid
                idx = next((i for i, pc in enumerate(pieces) if pc.covers(pt)), None)
                if idx is None:
                    idx = min(range(len(pieces)),
                              key=lambda i: pieces[i].distance(pt))
                homes[idx].append(m)

            # Which parts survive as cut pieces, and where the rest go.
            #
            # A place on an islet too small to cut must not fall out of the
            # jigsaw: without this, 1,935 places sat on pieces nobody could
            # cut and were simply unreachable. Its base tile joins the largest
            # surviving part of the same tile instead, so the piece that is
            # administratively responsible for the island lists its places on
            # its face and the traveler can still collect them.
            keep, drop = [], []
            for i, pc in enumerate(pieces):
                if abs(pc.area) < 1e-7:
                    continue
                (keep if is_cuttable(pc) else drop).append(i)
            if not keep and drop:
                keep = [max(drop, key=lambda i: abs(pieces[i].area))]
                drop = [i for i in drop if i not in keep]
            host = max(keep, key=lambda i: abs(pieces[i].area)) if keep else None
            for i in drop:
                dropped += 1
                dropped_places += sum(by_id[m]["app_places"] for m in homes[i])
                if host is not None:
                    homes[host].extend(homes[i])

            for i in keep:
                pc = pieces[i]
                minx, miny, maxx, maxy = pc.bounds
                mine = homes[i]
                qm = quantise(mapping(pc))
                if qm is None:
                    continue
                try:
                    rp = pc.representative_point()
                except Exception:                                  # noqa: BLE001
                    rp = pc.centroid
                places = sum(by_id[m]["app_places"] for m in mine)
                holes = sum(by_id[m]["holes"] for m in mine)
                kinds: dict[str, int] = {}
                for m in mine:
                    for k in by_id[m].get("kinds") or []:
                        kinds[k] = kinds.get(k, 0) + 1
                # The piece is named for the base tile that holds most of its
                # places, so "France 5" does not label French Guiana.
                label = head["name"]
                if mine:
                    best = max(mine, key=lambda m: (by_id[m]["app_places"],
                                                    by_id[m]["km2"]))
                    label = by_id[best]["name"] or head["name"]
                out.append({
                    "type": "Feature",
                    "properties": {
                        "tile_id": gid if len(keep) == 1 else f"{gid}.{i + 1}",
                        "parent": gid,
                        "name": label,
                        "country": head["country"],
                        "iso3": head["iso3"],
                        "places": places,
                        "holes": holes,
                        "members": mine,
                        "kinds": [k for k, _ in sorted(kinds.items(),
                                                       key=lambda kv: -kv[1])][:3],
                        "inhabited": 1 if places else 0,
                        # Two numbers, because cuttability needs both: enough
                        # area to be worth cutting, and enough width across the
                        # narrow way to get scissors around. A 3 x 40 mm splinter
                        # passes an area test and cannot be handled.
                        "side_deg": round(math.sqrt(abs(pc.area)), 4),
                        "min_deg": round(min(maxx - minx, maxy - miny), 4),
                        "max_deg": round(max(maxx - minx, maxy - miny), 4),
                        "at": [round(rp.x, 4), round(rp.y, 4)],
                        "bbox": [round(v, 4) for v in pc.bounds],
                    },
                    "geometry": qm,
                })

        # A compact roster so the export dialog can warn about tile size on
        # every keystroke without fetching six megabytes of geometry.
        index[level]["pieces"] = len(out)
        index[level]["not_cuttable"] = dropped
        index[level]["not_cuttable_places"] = dropped_places
        index[level]["file"] = f"tiles-{level}.geojson"
        index[level]["roster"] = [
            [f["properties"]["iso3"], f["properties"]["min_deg"],
             f["properties"]["max_deg"], f["properties"]["places"]]
            for f in out]
        path = OUT / f"tiles-{level}.geojson"
        path.write_text(json.dumps(
            {"type": "FeatureCollection", "features": out},
            separators=(",", ":")), encoding="utf-8")
        mb = path.stat().st_size / 1e6
        summary.append((level, len(out), mb))
        print(f"  {level}: {len(out):>6} cut pieces  {mb:6.2f} MB   "
              f"({dropped} parts too small to cut, holding {dropped_places} places)")

    (OUT / "tile-levels.json").write_text(json.dumps(ladder, separators=(",", ":")))
    kb = (OUT / "tile-levels.json").stat().st_size / 1024
    print(f"\ntile-levels.json {kb:.0f} KB")
    print("\n".join(f"{l}: {n} tiles, {m:.2f} MB" for l, n, m in summary))


if __name__ == "__main__":
    main()
