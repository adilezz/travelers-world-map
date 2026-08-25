"""Build the geographic layer: physical vectors + shaded relief.

Two outputs, one source of truth:

  geo/physical/*.geojson   Natural Earth 1:10m physical vectors. Sharp in
                           print at any size, and the only geography that
                           stays crisp on a country poster.
  geo/relief/{z}/{x}/{y}.webp
                           Web Mercator pyramid of Natural Earth's shaded
                           relief, for the screen basemap.
  geo/relief-print.jpg     The same relief, equirectangular, for the PDF.
                           Equirectangular because the poster projects from
                           lon/lat itself and a row of constant latitude maps
                           to a horizontal strip -- see poster projection.

Provenance. The relief raster is Natural Earth's "Natural Earth I with Shaded
Relief, Water and Drainages" at 1:50m, which Natural Earth places in the
public domain. It arrives here through the `basemap_data` wheel on PyPI
because naciscdn.com is unreachable from this build environment; the image is
byte-identical to the upstream product downsampled to 10800x5400. The vectors
are Natural Earth 1:10m physical, also public domain, from the
nvkelso/natural-earth-vector mirror on GitHub.
"""
from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

SRC = Path("/home/claude/geo")
RELIEF = Path("/tmp/bm/x/mpl_toolkits/basemap_data/shadedrelief.jpg")
OUT = SRC / "out"

# The pyramid stops where the source stops. 10800 px of world is 8192 px of
# Web Mercator at z5; z6 would be upsampling and shipping the blur twice.
MAX_Z = 5
TILE = 256
PRINT_W = 8192          # equirectangular, for the PDF. 292 dpi at 700 mm.


# --------------------------------------------------------------------------
# vectors
# --------------------------------------------------------------------------

def rounded(coords, nd: int):
    if not coords:
        return []
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], nd), round(coords[1], nd)]
    return [rounded(c, nd) for c in coords]


def drop_dupes(geom, nd):
    """Round to nd decimals and collapse the points that collapse."""
    def clean_line(pts):
        out = []
        for p in pts:
            if not out or p != out[-1]:
                out.append(p)
        return out

    g = dict(geom)
    t = g["type"]
    c = rounded(g["coordinates"], nd)
    if t == "LineString":
        c = clean_line(c)
        if len(c) < 2:
            return None
    elif t == "MultiLineString":
        c = [clean_line(l) for l in c]
        c = [l for l in c if len(l) >= 2]
        if not c:
            return None
    elif t == "Polygon":
        c = [clean_line(r) for r in c]
        c = [r for r in c if len(r) >= 4]
        if not c:
            return None
    elif t == "MultiPolygon":
        c = [[clean_line(r) for r in poly] for poly in c]
        c = [[r for r in poly if len(r) >= 4] for poly in c]
        c = [p for p in c if p]
        if not c:
            return None
    g["coordinates"] = c
    return g


def load(name: str):
    return json.loads((SRC / f"{name}.geojson").read_text(encoding="utf-8"))


def prop(p: dict, *names, default=None):
    for n in names:
        for key in (n, n.upper(), n.lower()):
            if key in p and p[key] not in (None, ""):
                return p[key]
    return default


def build_vectors():
    """Simplify hard. These layers are scenery, not measurement.

    Tolerances are in degrees. 0.01 deg is about 1.1 km, which is a third of
    a pixel on the relief raster underneath and invisible at any size this
    map prints at. The layers that carry meaning at close zoom -- lakes and
    rivers -- get the tightest tolerance; ice and named regions get the
    loosest, because nobody reads a glacier's outline.
    """
    from shapely.geometry import mapping, shape

    (OUT / "physical").mkdir(parents=True, exist_ok=True)
    report = {}

    def write(name, feats, nd=3, tol=0.0, min_area=0.0):
        out = []
        for f in feats:
            geom = f.get("geometry")
            if not geom:
                continue
            if tol or min_area:
                try:
                    g = shape(geom)
                    if not g.is_valid:
                        g = g.buffer(0)
                    if min_area and g.area < min_area:
                        continue
                    if tol:
                        g = g.simplify(tol, preserve_topology=True)
                    if g.is_empty:
                        continue
                    geom = mapping(g)
                except Exception:                                  # noqa: BLE001
                    pass
            g = drop_dupes(geom, nd)
            if g:
                out.append({"type": "Feature", "properties": f["properties"], "geometry": g})
        path = OUT / "physical" / f"{name}.geojson"
        path.write_text(json.dumps(
            {"type": "FeatureCollection", "features": out}, separators=(",", ":")),
            encoding="utf-8")
        report[name] = {"features": len(out), "bytes": path.stat().st_size}
        print(f"  {name:<12} {len(out):>6} features  {path.stat().st_size/1e6:>6.2f} MB")

    # Rivers. scalerank is Natural Earth's own judgement of which rivers a map
    # at a given scale should carry; `min_zoom` is the same call in web zooms.
    # Both ship, so the style can thin the layer instead of the build doing it.
    riv = load("ne_10m_rivers_lake_centerlines")
    write("rivers", [{
        "properties": {
            "n": prop(f["properties"], "name_en", "name", default=""),
            "r": int(prop(f["properties"], "scalerank", default=10) or 10),
            "z": float(prop(f["properties"], "min_zoom", default=6) or 6),
        },
        "geometry": f["geometry"],
    } for f in riv["features"]], nd=3, tol=0.006)

    lak = load("ne_10m_lakes")
    write("lakes", [{
        "properties": {
            "n": prop(f["properties"], "name_en", "name", default=""),
            "r": int(prop(f["properties"], "scalerank", default=10) or 10),
            "z": float(prop(f["properties"], "min_zoom", default=6) or 6),
        },
        "geometry": f["geometry"],
    } for f in lak["features"]], nd=3, tol=0.006, min_area=2e-4)

    # Glaciers and ice shelves paint the same white; keeping them apart lets
    # the poster drop shelves (which are floating ice, not land) if it wants.
    gla = load("ne_10m_glaciated_areas")
    ice = load("ne_10m_antarctic_ice_shelves_polys")
    write("glaciers", [{
        "properties": {"n": prop(f["properties"], "name", default=""),
                       "shelf": 0},
        "geometry": f["geometry"],
    } for f in gla["features"]] + [{
        "properties": {"n": prop(f["properties"], "name", default=""),
                       "shelf": 1},
        "geometry": f["geometry"],
    } for f in ice["features"]], nd=3, tol=0.02, min_area=1e-3)

    # Named physical regions. This layer is a *labelling* layer -- see the
    # standing ruling in build status: "ATLAS MOUNTAINS" is one 814,000 km2
    # blob. It is used here only to draw and to letter, never for containment,
    # and the ranges ship as label anchors rather than as filled polygons.
    reg = load("ne_10m_geography_regions_polys")
    keep_fill = {"Desert", "Plateau", "Basin", "Plain", "Lowland", "Tundra",
                 "Wetlands", "Delta", "Valley", "Gorge"}
    write("terrain", [{
        "properties": {
            "n": prop(f["properties"], "name_en", "name", default=""),
            "cla": prop(f["properties"], "featurecla", default=""),
            "min": float(prop(f["properties"], "min_label", default=3) or 3),
        },
        "geometry": f["geometry"],
    } for f in reg["features"]
        if prop(f["properties"], "featurecla") in keep_fill], nd=2, tol=0.03)

    ranges = [f for f in reg["features"]
              if prop(f["properties"], "featurecla") == "Range/mtn"]
    write("ranges", [{
        "properties": {
            "n": prop(f["properties"], "name_en", "name", default=""),
            "min": float(prop(f["properties"], "min_label", default=4) or 4),
        },
        "geometry": f["geometry"],
    } for f in ranges], nd=2, tol=0.03)

    # Named summits, with their elevation. This is the layer that makes a
    # mountain readable as a mountain rather than as brown shading.
    pk = load("ne_10m_geography_regions_elevation_points")
    peaks = []
    for f in pk["features"]:
        p = f["properties"]
        if prop(p, "featurecla") not in ("mountain", "spot elevation", "plateau", "pass"):
            continue
        peaks.append({
            "properties": {
                "n": prop(p, "name_en", "name", default=""),
                "m": int(prop(p, "elevation", default=0) or 0),
                "cla": prop(p, "featurecla", default=""),
                "r": int(prop(p, "scalerank", default=9) or 9),
            },
            "geometry": f["geometry"],
        })
    peaks.sort(key=lambda f: -f["properties"]["m"])
    write("peaks", peaks, nd=3)

    playas = load("ne_10m_playas")
    reefs = load("ne_10m_reefs")
    write("saltflats", [{
        "properties": {"n": prop(f["properties"], "name", default="")},
        "geometry": f["geometry"]} for f in playas["features"]], nd=3, tol=0.01)
    write("reefs", [{"properties": {}, "geometry": f["geometry"]}
                    for f in reefs["features"]], nd=3, tol=0.01)

    return report


# --------------------------------------------------------------------------
# relief
# --------------------------------------------------------------------------

def merc_y(lat: float) -> float:
    """Web Mercator northing, normalised to 0..1 from the north edge."""
    s = math.sin(math.radians(lat))
    y = 0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)
    return y


def build_relief_pyramid(src: Image.Image):
    """Equirectangular -> Web Mercator tiles.

    A row of constant latitude is a horizontal line in both projections, so
    the reprojection is a per-row vertical resample and nothing else. Done by
    building one full-width Mercator image per zoom, then slicing it.
    """
    import numpy as np

    root = OUT / "relief"
    if root.exists():
        shutil.rmtree(root)
    total = 0
    src_w, src_h = src.size
    arr = np.asarray(src, dtype=np.uint8)

    for z in range(MAX_Z + 1):
        side = TILE * (1 << z)
        # For each Mercator output row, the source row it samples.
        ys = (np.arange(side) + 0.5) / side              # 0..1 down the map
        lat = np.degrees(np.arctan(np.sinh((0.5 - ys) * 2 * math.pi)))
        srow = np.clip(((90.0 - lat) / 180.0 * src_h).astype(np.int32), 0, src_h - 1)

        # Horizontal resample first (cheap, exact), then gather rows.
        wide = np.asarray(src.resize((side, src_h), Image.LANCZOS), dtype=np.uint8)
        merc = wide[srow]
        img = Image.fromarray(merc)

        n = 1 << z
        for tx in range(n):
            for ty in range(n):
                box = (tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE)
                tile = img.crop(box)
                d = root / str(z) / str(tx)
                d.mkdir(parents=True, exist_ok=True)
                tile.save(d / f"{ty}.webp", "WEBP", quality=78, method=4)
                total += 1
        print(f"  z{z}  {n*n:>5} tiles  ({side}px)")
    size = sum(p.stat().st_size for p in root.rglob("*.webp"))
    print(f"  pyramid {total} tiles, {size/1e6:.1f} MB")
    return {"tiles": total, "bytes": size, "maxzoom": MAX_Z, "tileSize": TILE}


def build_relief_print(src: Image.Image):
    w = PRINT_W
    h = w // 2
    im = src.resize((w, h), Image.LANCZOS)
    path = OUT / "relief-print.jpg"
    im.save(path, "JPEG", quality=84, optimize=True, progressive=False)
    print(f"  relief-print.jpg {w}x{h}  {path.stat().st_size/1e6:.2f} MB")
    return {"width": w, "height": h, "bytes": path.stat().st_size}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print("vectors")
    vec = build_vectors()
    print("relief")
    src = Image.open(RELIEF).convert("RGB")
    print(f"  source {src.size[0]}x{src.size[1]}")
    pyr = build_relief_pyramid(src)
    pr = build_relief_print(src)

    manifest = {
        "attribution": "Natural Earth (public domain)",
        "vectors": {
            "source": "Natural Earth 1:10m physical",
            "licence": "public domain",
            "layers": vec,
        },
        "relief": {
            "source": "Natural Earth I with Shaded Relief, Water and Drainages, 1:50m",
            "licence": "public domain",
            "native": "10800x5400 equirectangular",
            "screen": pyr,
            "print": pr,
        },
    }
    (OUT / "geo-manifest.json").write_text(
        json.dumps(manifest, indent=1), encoding="utf-8")
    tot = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"\ntotal geo layer {tot/1e6:.1f} MB")


if __name__ == "__main__":
    main()
