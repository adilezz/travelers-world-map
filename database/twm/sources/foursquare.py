"""
Foursquare OS Places -- enrichment that we are actually allowed to keep.

Released under Apache 2.0, which means the records can be stored indefinitely,
redistributed, and shown on our own basemap. That combination is why enrichment
comes from here rather than from a mapping vendor whose terms restrict caching
and forbid displaying their content on a non-vendor map.

The dataset is Parquet on a public bucket, so DuckDB reads it directly without a
download step or an intermediate database.
"""
from __future__ import annotations

from collections.abc import Iterator

from twm.sources.base import Source, SourceError
from twm.types import Asset

PLACES_GLOB = "s3://fsq-os-places-us-east-1/release/dt=*/places/parquet/*.parquet"

CATEGORY_TIERS: dict[str, str] = {
    "museum": "institution",
    "performing arts venue": "institution",
    "theater": "institution",
    "market": "market",
    "farmers market": "market",
    "monument": "osm_heritage",
    "historic site": "osm_heritage",
}


class FoursquarePlaces(Source):
    """Reads the open dataset with DuckDB; no API key, no rate limit, no terms risk."""

    name = "foursquare-os"
    licence = "Apache-2.0"
    attribution = "Foursquare OS Places"
    cross_country_safe = False
    """Coverage is far denser in North America and Europe than elsewhere, so this
    ranks candidates within a country and never between countries."""

    def __init__(self, parquet_glob: str = PLACES_GLOB, cache_dir=None):
        super().__init__(cache_dir)
        self.glob = parquet_glob

    def fetch(self):
        return self.cache

    def _connect(self):
        try:
            import duckdb
        except ImportError as exc:
            raise SourceError("foursquare-os: duckdb is required") from exc
        con = duckdb.connect()
        con.execute("INSTALL httpfs; LOAD httpfs;")
        con.execute("SET s3_region='us-east-1';")
        return con

    def load(self, countries: list[str] | None = None) -> Iterator[Asset]:
        con = self._connect()
        where = ""
        if countries:
            joined = ",".join(f"'{c}'" for c in countries)
            where = f"AND country IN ({joined})"
        sql = f"""
            SELECT fsq_place_id, name, latitude, longitude, country,
                   lower(fsq_category_labels[1]) AS category
            FROM read_parquet('{self.glob}')
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
              AND fsq_category_labels IS NOT NULL {where}
        """
        for pid, name, lat, lon, country, category in con.execute(sql).fetchall():
            tier = _tier_for(category or "")
            if not tier:
                continue
            yield Asset(asset_id=f"fsq-{pid}", tier=tier, lat=float(lat),
                        lon=float(lon), name=name or "", source=self.name,
                        retrieved=self.today, country=country or "",
                        extra={"category": category})


def _tier_for(category: str) -> str | None:
    for needle, tier in CATEGORY_TIERS.items():
        if needle in category:
            return tier
    return None
