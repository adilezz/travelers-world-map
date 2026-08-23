"""
Protected areas: WDPA, Ramsar and UNESCO Global Geoparks.

WDPA's standard terms are non-commercial by default. During the proof of concept
that is acceptable; before the product earns revenue the position must be
checked, and because every asset carries its source the database can be filtered
rather than rebuilt.

IUCN categories are graded rather than flattened: a strict nature reserve or
national park (I-II) is a different traveler proposition from a protected
landscape (V), and collapsing them would let a well-designated agricultural
region outscore a wilderness.
"""
from __future__ import annotations

import csv
from collections.abc import Iterator

from twm.sources.base import LocalSource
from twm.types import Asset

IUCN_TIER = {
    "IA": "wdpa_iucn_i_ii", "IB": "wdpa_iucn_i_ii", "II": "wdpa_iucn_i_ii",
    "III": "wdpa_iucn_iii_iv", "IV": "wdpa_iucn_iii_iv",
}
MIN_AREA_KM2 = 25.0
"""Below this a protected area is a local amenity, not a destination."""


class ProtectedAreas(LocalSource):
    """WDPA point/centroid export.

    Columns used: WDPAID, NAME, IUCN_CAT, GIS_AREA (km2), ISO3, latitude, longitude.
    """

    name = "wdpa"
    licence = "Protected Planet terms -- non-commercial by default"
    attribution = "UNEP-WCMC and IUCN, Protected Planet"
    cross_country_safe = True
    instructions = (
        "Download from https://www.protectedplanet.net/en/thematic-areas/wdpa "
        "and export centroids to CSV with WDPAID,NAME,IUCN_CAT,GIS_AREA,ISO3,lat,lon"
    )

    def load(self) -> Iterator[Asset]:
        with open(self.fetch(), encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                cat = (row.get("IUCN_CAT") or "").strip().upper().replace(" ", "")
                tier = IUCN_TIER.get(cat)
                if not tier:
                    continue
                try:
                    lat = float(row.get("latitude") or row["lat"])
                    lon = float(row.get("longitude") or row["lon"])
                    area = float(row.get("GIS_AREA") or 0.0)
                except (KeyError, TypeError, ValueError):
                    continue
                if area < MIN_AREA_KM2:
                    continue
                yield Asset(
                    asset_id=f"wdpa-{row.get('WDPAID','')}", tier=tier,
                    lat=lat, lon=lon, name=(row.get("NAME") or "").strip(),
                    source=self.name, retrieved=self.today,
                    country=(row.get("ISO3") or "").strip(),
                    extra={"iucn": cat, "area_km2": area},
                )


class RamsarAndGeoparks(LocalSource):
    """Ramsar wetlands and UNESCO Global Geoparks, one CSV.

    Columns: id,name,country,lat,lon,kind  where kind is 'ramsar' or 'geopark'.
    """

    name = "ramsar-geopark"
    licence = "Ramsar / UNESCO terms, attribution required"
    attribution = "Ramsar Sites Information Service; UNESCO Global Geoparks"
    cross_country_safe = True
    instructions = (
        "Compile from https://rsis.ramsar.org/ and "
        "https://www.unesco.org/en/iggp/geoparks/list into one CSV: "
        "id,name,country,lat,lon,kind"
    )

    def load(self) -> Iterator[Asset]:
        with open(self.fetch(), encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                try:
                    lat, lon = float(row["lat"]), float(row["lon"])
                except (KeyError, TypeError, ValueError):
                    continue
                yield Asset(
                    asset_id=f"rg-{row.get('id','')}", tier="ramsar_geopark",
                    lat=lat, lon=lon, name=row.get("name", ""),
                    source=self.name, retrieved=self.today,
                    country=row.get("country", ""),
                    extra={"kind": row.get("kind", "")},
                )
