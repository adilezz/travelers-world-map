"""
OpenStreetMap, via Overpass, for the long tail: minor heritage, museums,
theatres, markets, craft clusters and lodging.

OSM is licensed ODbL. Share-alike attaches on DISTRIBUTION, not on revenue, so a
publicly reachable application built on an OSM-derived database can trigger it
whether or not money changes hands. Every asset from here is tagged with its
source so the database can be filtered rather than rebuilt if that position
changes.

OSM density varies enormously by country, so nothing sourced here may cross a
border: `osm_heritage`, `institution` and `market` are all national-only tiers.
"""
from __future__ import annotations

import json
import time
from collections.abc import Iterator

from twm.sources.base import Source, SourceError
from twm.types import Asset

ENDPOINT = "https://overpass-api.de/api/interpreter"

QUERIES: dict[str, str] = {
    "osm_heritage": """
        [out:json][timeout:180];
        area["ISO3166-1"="{iso}"]->.a;
        ( nwr(area.a)["historic"];
          nwr(area.a)["building"~"^(cathedral|mosque|temple|castle|palace|synagogue)$"];
          nwr(area.a)["heritage"]; );
        out center tags qt;
    """,
    "institution": """
        [out:json][timeout:180];
        area["ISO3166-1"="{iso}"]->.a;
        ( nwr(area.a)["tourism"="museum"];
          nwr(area.a)["amenity"~"^(theatre|arts_centre)$"]; );
        out center tags qt;
    """,
    "market": """
        [out:json][timeout:180];
        area["ISO3166-1"="{iso}"]->.a;
        nwr(area.a)["amenity"="marketplace"];
        out center tags qt;
    """,
    "craft_cluster": """
        [out:json][timeout:180];
        area["ISO3166-1"="{iso}"]->.a;
        nwr(area.a)["craft"];
        out center tags qt;
    """,
}

LODGING_QUERY = """
    [out:json][timeout:180];
    area["ISO3166-1"="{iso}"]->.a;
    nwr(area.a)["tourism"~"^(hotel|guest_house|hostel|camp_site|apartment)$"];
    out center qt;
"""


class OpenStreetMap(Source):
    name = "osm"
    licence = "ODbL-1.0"
    attribution = "(c) OpenStreetMap contributors"
    cross_country_safe = False

    PAUSE_S = 8.0   # Overpass is donated infrastructure; be a good citizen

    def __init__(self, iso_codes: list[str], cache_dir=None):
        super().__init__(cache_dir)
        self.iso_codes = iso_codes

    def fetch(self):
        return self.cache

    def load(self) -> Iterator[Asset]:
        for iso in self.iso_codes:
            for tier, template in QUERIES.items():
                for el in self._overpass(template.format(iso=iso), f"{iso}-{tier}"):
                    lat, lon = _centre(el)
                    if lat is None:
                        continue
                    tags = el.get("tags", {})
                    yield Asset(
                        asset_id=f"osm-{el['type']}-{el['id']}", tier=tier,
                        lat=lat, lon=lon,
                        name=tags.get("name", ""), source=self.name,
                        source_url=f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
                        retrieved=self.today, country=iso,
                    )
                time.sleep(self.PAUSE_S)

    def lodging_points(self, iso: str) -> list[tuple[float, float]]:
        """Used by the feasibility gate, not scored directly."""
        out = []
        for el in self._overpass(LODGING_QUERY.format(iso=iso), f"{iso}-lodging"):
            lat, lon = _centre(el)
            if lat is not None:
                out.append((lat, lon))
        return out

    def _overpass(self, query: str, key: str) -> list[dict]:
        path = self.cache / f"{key}.json"
        if path.exists() and path.stat().st_size > 0:
            return json.loads(path.read_text("utf-8")).get("elements", [])
        import requests

        from twm.sources.base import USER_AGENT

        try:
            resp = requests.post(ENDPOINT, data={"data": query},
                                 headers={"User-Agent": USER_AGENT}, timeout=300)
            resp.raise_for_status()
            payload = resp.json()
        except Exception as exc:
            raise SourceError(f"osm: overpass query {key} failed: {exc}") from exc
        path.write_text(json.dumps(payload), "utf-8")
        return payload.get("elements", [])


def _centre(el: dict) -> tuple[float | None, float | None]:
    if "lat" in el and "lon" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    return (c["lat"], c["lon"]) if c else (None, None)
