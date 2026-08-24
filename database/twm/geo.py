"""Geodesy and the arithmetic tying the database to the physical product.

The printed map's dimensions are inputs to the data model, not consequences of
it. Pin spacing sets the minimum distance between two places on the printed map,
and therefore the catchment radius used when assigning assets.
"""
from __future__ import annotations

import math

from twm.config import PARAMS, ModelParams

# Doc 5 §3.4: union of region polygons equals country land within a documented
# tolerance for coastlines. 2% of the country polygon's area covers digitising
# mismatch between 10m admin-1 and the published country plate. Countries whose
# plate is smaller than 0.5 deg² (small islands) use 8%: that plate is coarser
# than admin-1 there. Larger leftover is a tessellation hole, not a coastline.
REGION_UNION_TOLERANCE = 0.02
SMALL_LAND_DEG2 = 0.5
SMALL_LAND_TOLERANCE = 0.08
COASTLINE_BUFFER_DEG = 0.02
"""~2 km. Leftover land inside this buffer of the region union is a coastline
sliver between 10m admin-1 and the published country plate, not a hole."""


def union_tolerance_for(land) -> float:
    area = getattr(land, "area", 0.0) or 0.0
    if area < SMALL_LAND_DEG2:
        return SMALL_LAND_TOLERANCE
    return REGION_UNION_TOLERANCE
SIMPLIFY_DEG = 0.01
COORD_PRECISION = 4

EARTH_RADIUS_KM = 6371.0088
EQUATOR_KM = 40_075.017


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres.

    >>> round(haversine_km(48.8566, 2.3522, 48.8049, 2.1204))  # Paris - Versailles
    18
    """
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


# ------------------------------------------------------------------ the printed map
class PrintedMap:
    """Scale arithmetic for the physical product.

    >>> pm = PrintedMap(width_m=3.0)
    >>> round(pm.km_per_mm, 1)
    13.4
    >>> round(pm.min_place_separation_km)
    60
    >>> round(pm.width_m_for_separation(15.0), 1)   # Kathmandu valley
    12.0
    """

    PIN_SPACING_MM = 4.5
    MIN_TILE_MM = 12.0
    EQUAL_EARTH_ASPECT = 2.05

    def __init__(self, width_m: float = 3.0):
        self.width_m = width_m

    @property
    def height_m(self) -> float:
        return self.width_m / self.EQUAL_EARTH_ASPECT

    @property
    def scale_denominator(self) -> float:
        return EQUATOR_KM * 1000.0 / self.width_m

    @property
    def km_per_mm(self) -> float:
        return EQUATOR_KM / (self.width_m * 1000.0)

    @property
    def min_place_separation_km(self) -> float:
        return self.PIN_SPACING_MM * self.km_per_mm

    @property
    def min_tile_extent_km(self) -> float:
        return self.MIN_TILE_MM * self.km_per_mm

    def width_m_for_separation(self, km: float) -> float:
        """How wide the map would have to be to separate places `km` apart."""
        return self.PIN_SPACING_MM * EQUATOR_KM / (km * 1000.0)

    def inset_factor_for(self, km: float) -> float:
        """Magnification an inset panel needs to separate places `km` apart."""
        return max(1.0, self.width_m_for_separation(km) / self.width_m)


def min_spacing_km(area_km2: float, n_places: int, params: ModelParams = PARAMS) -> float:
    """Spacing follows pin density, not raw area.

    Scaling by raw area gives ~470 km across a country the size of the United
    States, which would forbid two famous canyons 250 km apart from both existing.

    >>> round(min_spacing_km(446_550, 8))
    83
    >>> round(min_spacing_km(9_834_000, 12))
    317
    """
    density = params.spacing_density_coef * math.sqrt(area_km2 / max(n_places, 1))
    return max(params.pin_spacing_km, density)


# ----------------------------------------------------------------------- spatial index
class GridIndex:
    """Coarse lat/lon bucket index. Enough for 70k candidates against millions of
    assets without pulling in a spatial database for the neighbour search."""

    def __init__(self, cell_deg: float = 1.0):
        self.cell = cell_deg
        self._cells: dict[tuple[int, int], list] = {}

    def _key(self, lat: float, lon: float) -> tuple[int, int]:
        return (int(math.floor(lat / self.cell)), int(math.floor(lon / self.cell)))

    def add(self, lat: float, lon: float, payload) -> None:
        self._cells.setdefault(self._key(lat, lon), []).append((lat, lon, payload))

    def near(self, lat: float, lon: float, radius_km: float):
        """Yield (distance_km, payload) within radius, nearest first."""
        # widen the cell search by the radius expressed in degrees of latitude,
        # then again by 1/cos(lat) for longitude convergence near the poles
        dlat = radius_km / 111.32
        coslat = max(math.cos(math.radians(lat)), 1e-6)
        dlon = dlat / coslat
        lat0, lon0 = self._key(lat - dlat, lon - dlon)
        lat1, lon1 = self._key(lat + dlat, lon + dlon)
        found = []
        for i in range(lat0, lat1 + 1):
            for j in range(lon0, lon1 + 1):
                for (la, lo, payload) in self._cells.get((i, j), ()):
                    d = haversine_km(lat, lon, la, lo)
                    if d <= radius_km:
                        found.append((d, payload))
        found.sort(key=lambda t: t[0])
        return found

    def nearest(self, lat: float, lon: float, radius_km: float):
        hits = self.near(lat, lon, radius_km)
        return hits[0] if hits else None

    def __len__(self) -> int:
        return sum(len(v) for v in self._cells.values())


# ---------------------------------------------------------- web regions / tile ids
def iso3_id(iso3: str, kind: str, index: int) -> str:
    """Stable ids from ISO 3166-1 alpha-3, never the first three letters of the
    English name. Australia and Austria both slug to AUS; MAR-R01 does not.
    `kind` is R for a web region, T for a printed tile.
    """
    code = (iso3 or "").strip().upper()
    if len(code) != 3 or not code.isalpha():
        raise ValueError(f"region/tile ids need a 3-letter ISO3, not {iso3!r}")
    if kind not in {"R", "T"}:
        raise ValueError(f"kind must be R or T, not {kind!r}")
    return f"{code}-{kind}{index:02d}"


def fold_name(text: str) -> str:
    import unicodedata

    nfd = unicodedata.normalize("NFD", text or "")
    stripped = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    return stripped.casefold()


_NAMESAKE_ALIASES = {
    "tanger": "tangier",
    "tangiers": "tangier",
    "fès": "fes",
    "fez": "fes",
}


def namesake_in_name(region_name: str, settlement: str) -> bool:
    """Doc 5 §3.6: a name that does not contain its namesake, when that
    settlement exists in the polygon, fails. Tanger counts as Tangier.
    """
    region = fold_name(region_name)
    settle = fold_name(settlement)
    if not settle:
        return False
    if settle in region:
        return True
    alias = _NAMESAKE_ALIASES.get(settle, settle)
    if alias != settle and alias in region:
        return True
    if _NAMESAKE_ALIASES.get(fold_name(region_name.split("-")[0].split()[0]), "") == settle:
        return True
    # Admin-1 "Tanger-Tetouan-Al Hoceima" vs settlement "Tangier".
    head = fold_name(region_name.replace("-", " ").split()[0]) if region_name else ""
    return _NAMESAKE_ALIASES.get(head, head) == settle


def compass_qualifier(lon: float, lat: float,
                      country_lon: float, country_lat: float,
                      country_name: str) -> str:
    """Last-resort region name: a compass from the country centroid."""
    dlat = lat - country_lat
    dlon = lon - country_lon
    if abs(dlat) < 1e-9 and abs(dlon) < 1e-9:
        return country_name
    angle = math.degrees(math.atan2(dlon, dlat)) % 360
    winds = (
        (22.5, "Northern"), (67.5, "North-eastern"), (112.5, "Eastern"),
        (157.5, "South-eastern"), (202.5, "Southern"), (247.5, "South-western"),
        (292.5, "Western"), (337.5, "North-western"), (360.0, "Northern"),
    )
    wind = next(name for limit, name in winds if angle <= limit)
    return f"{wind} {country_name}"


def name_from_polygon(
    geom,
    admin_units: list[tuple[str, object]],
    settlements: list[tuple[str, float, float, float]],
    country_name: str,
    country_centroid: tuple[float, float] | None = None,
) -> str:
    """Name a polygon from the polygon, never from a merge accumulator.

    Order (doc 5 §3.6 / Stage 3): centroid's admin-1, else the largest
    settlement inside, else a compass qualifier.
    """
    from shapely.geometry import Point

    if geom is None or geom.is_empty:
        return country_name
    centroid = geom.centroid
    for name, unit_geom in admin_units:
        if unit_geom is None or getattr(unit_geom, "is_empty", True):
            continue
        try:
            if unit_geom.contains(centroid) or unit_geom.intersects(centroid):
                return name
        except Exception:
            continue
    inside: list[tuple[float, str]] = []
    minx, miny, maxx, maxy = geom.bounds
    for name, lat, lon, pop in settlements:
        if lat < miny or lat > maxy or lon < minx or lon > maxx:
            continue
        try:
            if geom.contains(Point(lon, lat)):
                inside.append((pop, name))
        except Exception:
            continue
    if inside:
        inside.sort(key=lambda t: (-t[0], t[1]))
        return inside[0][1]
    clon, clat = (country_centroid
                  if country_centroid is not None
                  else (centroid.x, centroid.y))
    return compass_qualifier(centroid.x, centroid.y, clon, clat, country_name)
