"""
Natural Earth: country outlines and administrative units.

Two things matter here.

First, resolution. The 1:110m tier holds about twenty points for a small island
nation, which is fine for a world overview and visibly wrong once someone zooms
into a country. Use 1:50m for country plates and 1:10m for territory boundaries.

Second, disputed territories. Natural Earth ships several as separate features.
The approved policy is that no contested boundary is drawn: the outline dissolves
into the state administering it and the places inside keep their coordinates.
Nothing is deleted.
"""
from __future__ import annotations

from pathlib import Path

from twm.config import DISSOLVE_INTO, NEEDS_EXPLICIT_RULING
from twm.sources.base import Source

CDN = "https://naciscdn.org/naturalearth"
URLS = {
    "countries_110m": f"{CDN}/110m/cultural/ne_110m_admin_0_countries.zip",
    "countries_50m": f"{CDN}/50m/cultural/ne_50m_admin_0_countries.zip",
    "countries_10m": f"{CDN}/10m/cultural/ne_10m_admin_0_countries.zip",
    "admin1_10m": f"{CDN}/10m/cultural/ne_10m_admin_1_states_provinces.zip",
}


class NaturalEarth(Source):
    name = "naturalearth"
    licence = "Public domain"
    attribution = "Made with Natural Earth"
    cross_country_safe = True

    def __init__(self, layer: str = "countries_50m", cache_dir=None):
        super().__init__(cache_dir)
        if layer not in URLS:
            raise KeyError(f"unknown layer {layer!r}; choose from {sorted(URLS)}")
        self.layer = layer

    def fetch(self) -> Path:
        return self._cached(URLS[self.layer], ".zip", max_age_days=365)

    def load(self) -> dict:
        """name -> shapely geometry, with the disputed-territory policy applied."""
        import shapefile
        from shapely.geometry import shape
        from shapely.ops import unary_union

        path = self.fetch()
        reader = shapefile.Reader(f"zip://{path}") if path.suffix == ".zip" \
            else shapefile.Reader(str(path))
        geoms: dict[str, object] = {}
        for rec, shp in zip(reader.records(), reader.shapes(), strict=False):
            name = _name_of(rec)
            if not name:
                continue
            geoms[name] = shape(shp.__geo_interface__)

        for disputed, host in DISSOLVE_INTO.items():
            if disputed in geoms and host in geoms:
                geoms[host] = unary_union([geoms[host], geoms.pop(disputed)])

        unruled = [n for n in geoms if n in NEEDS_EXPLICIT_RULING]
        if unruled:
            import warnings

            warnings.warn(
                f"naturalearth: {unruled} are rendered as-is. The approved policy "
                "requires an explicit ruling for each before any global print run.",
                stacklevel=2,
            )
        return geoms


def _name_of(rec) -> str:
    for field in ("NAME", "ADMIN", "NAME_EN", "name"):
        try:
            value = rec[field]
        except Exception:
            continue
        if value:
            return str(value)
    return ""
