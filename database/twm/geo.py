"""Geodesy and the arithmetic tying the database to the physical product.

The printed map's dimensions are inputs to the data model, not consequences of
it. Pin spacing sets the minimum distance between two places on the printed map,
and therefore the catchment radius used when assigning assets.
"""
from __future__ import annotations

import math

from twm.config import PARAMS, ModelParams

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
