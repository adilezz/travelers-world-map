"""
Building territories -- the physical tiles -- by merging official administrative units.

Territories are new subdivisions, but they are assembled from real administrative
boundaries rather than drawn freehand. Three reasons, all practical: the result
stays recognisable to residents, nobody can accuse the product of inventing
borders, and admin boundaries already follow coastlines and ridgelines, which
makes for better-looking physical objects.

Requires shapely. The geometry work is deliberately kept in one module so the
rest of the pipeline runs without a geometry stack.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from twm.config import DISSOLVE_INTO, PARAMS, ModelParams
from twm.geo import PrintedMap
from twm.types import Place, Territory

MIN_PLACES = 3
MAX_PLACES = 6


@dataclass
class AdminUnit:
    """One administrative unit, level 1 or 2, with its geometry."""

    unit_id: str
    name: str
    country: str
    geometry: object          # shapely Polygon or MultiPolygon
    level: int = 1
    place_ids: list[str] = field(default_factory=list)
    children: list[AdminUnit] = field(default_factory=list)
    merged_ids: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.merged_ids:
            self.merged_ids = [self.unit_id]


def dissolve_disputed(units: list[AdminUnit]) -> list[AdminUnit]:
    """Apply the no-contested-border rule.

    A disputed territory's outline dissolves into the state administering it. Its
    places keep their own coordinates and stay in the database -- the boundary
    simply is not drawn. Cases where the administering state is itself contested
    are absent from the mapping on purpose and must be ruled on explicitly.
    """
    for u in units:
        u.country = DISSOLVE_INTO.get(u.country, u.country)
    return units


def assign_places(units: list[AdminUnit], places: list[Place]) -> list[AdminUnit]:
    """Attach each place to the unit containing it, falling back to nearest."""
    from shapely.geometry import Point

    for p in places:
        pt = Point(p.lon, p.lat)
        host = next((u for u in units
                     if u.country == p.country and u.geometry.contains(pt)), None)
        if host is None:
            same = [u for u in units if u.country == p.country]
            if not same:
                continue
            host = min(same, key=lambda u: u.geometry.distance(pt))
        host.place_ids.append(p.place_id)
    return units


def build_territories(units: list[AdminUnit], places: list[Place],
                      params: ModelParams = PARAMS,
                      printed_map: PrintedMap | None = None) -> list[Territory]:
    """Merge and split admin units until each carries a workable number of places."""
    from shapely.ops import unary_union

    pm = printed_map or PrintedMap()
    by_id = {p.place_id: p for p in places}
    out: list[Territory] = []

    for country in sorted({u.country for u in units}):
        pool = [u for u in units if u.country == country]
        pool = _split_oversized(pool)
        pool = _merge_undersized(pool, by_id, unary_union)

        for i, u in enumerate(pool, start=1):
            if not u.place_ids:
                continue
            arch: dict[str, float] = {}
            for pid in u.place_ids:
                p = by_id.get(pid)
                if not p:
                    continue
                for code, w in zip(p.archetypes, p.archetype_weights, strict=False):
                    arch[code] = max(arch.get(code, 0.0), w)
            extent_km = _extent_km(u.geometry)
            out.append(Territory(
                territory_id=f"{_slug(country)}-T{i:02d}",
                name=u.name,
                country=country,
                place_ids=list(u.place_ids),
                admin_units=list(u.merged_ids),
                geometry_wkt=u.geometry.wkt,
                dominant_archetypes=sorted(arch, key=lambda k: -arch[k])[:3],
                printable=extent_km >= pm.min_tile_extent_km,
            ))
    return out


def _split_oversized(units: list[AdminUnit]) -> list[AdminUnit]:
    """A unit holding more than MAX_PLACES splits along its level-2 children."""
    out: list[AdminUnit] = []
    for u in units:
        if len(u.place_ids) > MAX_PLACES and u.children:
            for child in u.children:
                child.country = u.country
                out.append(child)
        else:
            out.append(u)
    return out


def _merge_undersized(units: list[AdminUnit], by_id, unary_union) -> list[AdminUnit]:
    """Merge the cheapest adjacent pair until nothing is undersized.

    Cost is added boundary length plus archetype dissimilarity. The second term is
    what stops a tile being half alpine and half coastal desert -- a physical
    object should read as one kind of place.
    """
    working = list(units)
    guard = 0
    while guard < 500:
        guard += 1
        thin = [u for u in working if 0 < len(u.place_ids) < MIN_PLACES]
        if not thin:
            break
        target = min(thin, key=lambda u: len(u.place_ids))
        best, best_cost = None, float("inf")
        for other in working:
            if other is target or not _adjacent(target, other):
                continue
            cost = _merge_cost(target, other, by_id, unary_union)
            if cost < best_cost:
                best, best_cost = other, cost
        if best is None:
            break
        merged = AdminUnit(
            unit_id=f"{target.unit_id}+{best.unit_id}",
            name=_merged_name(target, best),
            country=target.country,
            geometry=unary_union([target.geometry, best.geometry]),
            level=target.level,
            place_ids=target.place_ids + best.place_ids,
            merged_ids=target.merged_ids + best.merged_ids,
        )
        working = [u for u in working if u not in (target, best)] + [merged]
    return working


def _adjacent(a: AdminUnit, b: AdminUnit) -> bool:
    if a.country != b.country:
        return False   # a tile never crosses an international border
    try:
        return a.geometry.touches(b.geometry) or a.geometry.intersects(b.geometry)
    except Exception:
        return False


def _merge_cost(a: AdminUnit, b: AdminUnit, by_id, unary_union) -> float:
    merged = unary_union([a.geometry, b.geometry])
    added_perimeter = max(0.0, merged.length - max(a.geometry.length, b.geometry.length))
    dissim = 1.0 - _archetype_overlap(a, b, by_id)
    return added_perimeter + 4.0 * dissim


def _archetype_overlap(a: AdminUnit, b: AdminUnit, by_id) -> float:
    def codes(u: AdminUnit) -> set[str]:
        out: set[str] = set()
        for pid in u.place_ids:
            p = by_id.get(pid)
            if p:
                out |= set(p.archetypes)
        return out

    ca, cb = codes(a), codes(b)
    if not ca or not cb:
        return 0.0
    return len(ca & cb) / len(ca | cb)


def _extent_km(geom) -> float:
    minx, miny, maxx, maxy = geom.bounds
    import math

    mid = math.radians((miny + maxy) / 2)
    return max((maxx - minx) * 111.32 * math.cos(mid), (maxy - miny) * 111.32)


def _merged_name(a: AdminUnit, b: AdminUnit) -> str:
    return a.name if len(a.place_ids) >= len(b.place_ids) else b.name


def _slug(text: str) -> str:
    return "".join(ch for ch in text.upper() if ch.isalnum())[:3]
