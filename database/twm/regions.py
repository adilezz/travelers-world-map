"""Web regions: a tessellation of country land, not a manufacturing lot.

Printed tiles skip empty land and merge until they carry enough holes. Web
regions keep empty units, do not share polygons with those tiles, and name
every piece from the polygon itself. Stage 3 / document 5 §3.4–§3.6.
"""
from __future__ import annotations

from twm.config import unruled_hits
from twm.geo import (
    REGION_UNION_TOLERANCE,
    iso3_id,
    name_from_polygon,
    union_tolerance_for,
)
from twm.territories import AdminUnit
from twm.types import Place, Region


TINY_DEG2 = 1e-8
"""Drop slivers smaller than about 0.1 km². Anything larger is a region."""


def build_regions(
    units: list[AdminUnit],
    places: list[Place],
    iso3_of: dict[str, str],
    country_land: dict[str, object] | None = None,
    settlements: list[tuple[str, float, float, float]] | None = None,
) -> list[Region]:
    """Tessellate each country's land. Empty regions are kept.

    `country_land` is name -> shapely geometry. When present, leftover land
    after clipping admin-1 becomes its own region (the Sahara stays on the
    web). When absent, admin-1 units themselves are the tessellation.
    """
    from shapely.geometry import Point
    from shapely.ops import unary_union

    towns = settlements or [
        (p.name, p.lat, p.lon, float(p.score)) for p in places
    ]
    by_country_units: dict[str, list[AdminUnit]] = {}
    for u in units:
        by_country_units.setdefault(u.country, []).append(u)

    countries = set(by_country_units) | set(country_land or {}) | {p.country for p in places}
    out: list[Region] = []
    ordered = sorted(countries)

    for n_done, country in enumerate(ordered, start=1):
        if n_done == 1 or n_done % 20 == 0 or n_done == len(ordered):
            print(f"  regions {n_done}/{len(ordered)} {country}", flush=True)
        iso3 = iso3_of.get(country)
        if not iso3:
            raise KeyError(
                f"no ISO3 for {country!r}; region ids must not slug the English name"
            )
        land = (country_land or {}).get(country)
        pool = list(by_country_units.get(country, []))
        local_towns = towns
        if land is not None:
            minx, miny, maxx, maxy = land.bounds
            local_towns = [
                t for t in towns
                if miny <= t[1] <= maxy and minx <= t[2] <= maxx
            ]
        pieces: list[tuple[str, object, list[str]]] = []
        admin_pairs = [(u.name, u.geometry) for u in pool]
        clipped = []

        for u in pool:
            geom = u.geometry
            if land is not None:
                try:
                    geom = geom.intersection(land)
                except Exception:
                    try:
                        geom = geom.buffer(0).intersection(land.buffer(0))
                    except Exception:
                        continue
            if geom is None or geom.is_empty or geom.area < TINY_DEG2:
                if land is None and u.geometry is not None and not u.geometry.is_empty:
                    geom = u.geometry
                else:
                    continue
            clipped.append(geom)
            pieces.append((u.name, geom, list(u.merged_ids or [u.unit_id])))

        remainder = None
        if land is not None and clipped:
            try:
                remainder = land.difference(unary_union(clipped))
            except Exception:
                try:
                    remainder = land.buffer(0).difference(unary_union(
                        [g.buffer(0) for g in clipped]))
                except Exception:
                    remainder = None
        elif land is not None and not clipped:
            remainder = land

        local_towns = towns
        if land is not None:
            minx, miny, maxx, maxy = land.bounds
            local_towns = [
                t for t in towns
                if miny <= t[1] <= maxy and minx <= t[2] <= maxx
            ]

        if remainder is not None and not remainder.is_empty:
            land_area = land.area if land is not None and land.area else 0.0
            if land_area and remainder.area < REGION_UNION_TOLERANCE * land_area:
                remainder = None
        if remainder is not None and not remainder.is_empty:
            for part in _parts(remainder):
                if part.area < TINY_DEG2:
                    continue
                if land_area and part.area < REGION_UNION_TOLERANCE * land_area:
                    continue
                centroid = (land.centroid.x, land.centroid.y) if land is not None else None
                name = name_from_polygon(
                    part, admin_pairs, local_towns, country, centroid)
                pieces.append((name, part, []))

        if not pieces and land is not None and not land.is_empty:
            pieces.append((country, land, []))

        if not pieces:
            # Register country with no land polygon: one region so every place
            # still has a region_id. Geometry is filled later from a hull.
            pieces.append((country, None, []))

        # Assign places by point-in-polygon, then nearest in the same country.
        country_places = [p for p in places if p.country == country]
        assigned: dict[int, list[str]] = {i: [] for i in range(len(pieces))}
        leftover: list[Place] = []
        for p in country_places:
            pt = Point(p.lon, p.lat)
            host = None
            for i, (_n, geom, _ids) in enumerate(pieces):
                if geom is None or geom.is_empty:
                    continue
                try:
                    if geom.contains(pt):
                        host = i
                        break
                except Exception:
                    continue
            if host is None:
                leftover.append(p)
            else:
                assigned[host].append(p.place_id)

        for p in leftover:
            pt = Point(p.lon, p.lat)
            nearest, best = None, float("inf")
            for i, (_n, geom, _ids) in enumerate(pieces):
                if geom is None or geom.is_empty:
                    continue
                try:
                    d = geom.distance(pt)
                except Exception:
                    continue
                if d < best:
                    nearest, best = i, d
            if nearest is None:
                nearest = 0
            assigned[nearest].append(p.place_id)

        for i, (name, geom, admin_ids) in enumerate(pieces, start=1):
            wkt = ""
            if geom is not None and not geom.is_empty:
                wkt = geom.wkt
            out.append(Region(
                region_id=iso3_id(iso3, "R", i),
                name=name,
                country=country,
                place_ids=list(assigned[i - 1]),
                admin_units=admin_ids,
                geometry_wkt=wkt,
            ))
    return out


def coverage_gap(geoms, land) -> float:
    """Share of `land` not covered, after the documented coastline buffer."""
    from shapely.ops import unary_union

    from twm.geo import COASTLINE_BUFFER_DEG

    if land is None or land.is_empty or land.area <= 0:
        return 0.0
    real = [g for g in geoms if g is not None and not g.is_empty]
    if not real:
        return 1.0
    covered = unary_union(real)
    try:
        leftover = land.difference(covered.buffer(COASTLINE_BUFFER_DEG))
    except Exception:
        leftover = land.difference(covered)
    if leftover.is_empty:
        return 0.0
    return leftover.area / land.area


def union_coverage(regions: list[Region], land) -> float:
    """Share of `land` not covered by the regions (0 = exact tessellation)."""
    from shapely.wkt import loads

    geoms = []
    for r in regions:
        if not r.geometry_wkt:
            continue
        g = loads(r.geometry_wkt)
        if not g.is_empty:
            geoms.append(g)
    return coverage_gap(geoms, land)


def coverage_ok(regions: list[Region], land,
                tolerance: float | None = None) -> bool:
    tol = union_tolerance_for(land) if tolerance is None else tolerance
    return union_coverage(regions, land) <= tol


def warn_unruled(labels) -> list[str]:
    return unruled_hits(labels)


def _parts(geom):
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    if geom.geom_type in {"MultiPolygon", "GeometryCollection"}:
        out = []
        for g in geom.geoms:
            out.extend(_parts(g))
        return out
    return []
