"""
Wikidata: heritage items, festivals, pilgrimage sites, and the cross-language
significance signal.

Counting how many separate language communities independently thought a place
worth writing about is a markedly less Eurocentric measure of significance than
any national heritage register, because no single authority controls it. That is
why `wikidata_multilingual` is one of the few tiers allowed across borders.
"""
from __future__ import annotations

import time
from collections.abc import Iterator

from twm.sources.base import Source, SourceError
from twm.types import Asset

ENDPOINT = "https://query.wikidata.org/sparql"
MIN_SITELINKS = 5

HERITAGE_QUERY = """
SELECT ?item ?itemLabel ?coord ?sitelinks ?countryLabel WHERE {
  ?item wdt:P1435 ?status .            # heritage designation of any kind
  ?item wdt:P625 ?coord .
  ?item wikibase:sitelinks ?sitelinks .
  OPTIONAL { ?item wdt:P17 ?country . }
  FILTER (?sitelinks >= %(min)d)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul" }
}
LIMIT %(limit)d OFFSET %(offset)d
"""

FESTIVAL_QUERY = """
SELECT ?item ?itemLabel ?coord ?sitelinks ?countryLabel WHERE {
  ?item wdt:P31/wdt:P279* wd:Q132241 . # festival
  ?item wdt:P625 ?coord .
  ?item wikibase:sitelinks ?sitelinks .
  OPTIONAL { ?item wdt:P17 ?country . }
  FILTER (?sitelinks >= 3)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul" }
}
LIMIT %(limit)d OFFSET %(offset)d
"""

PILGRIMAGE_QUERY = """
SELECT ?item ?itemLabel ?coord ?sitelinks ?countryLabel WHERE {
  ?item wdt:P31/wdt:P279* wd:Q1129470 . # pilgrimage destination
  ?item wdt:P625 ?coord .
  ?item wikibase:sitelinks ?sitelinks .
  OPTIONAL { ?item wdt:P17 ?country . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul" }
}
LIMIT %(limit)d OFFSET %(offset)d
"""


class Wikidata(Source):
    name = "wikidata"
    licence = "CC0-1.0"
    attribution = "Wikidata contributors"
    cross_country_safe = True

    PAGE = 5000
    PAUSE_S = 1.5   # the public endpoint is a shared resource; do not hammer it

    def fetch(self):
        return self.cache

    def load(self) -> Iterator[Asset]:
        yield from self._run(HERITAGE_QUERY, "wikidata_multilingual", "wd-h",
                             {"min": MIN_SITELINKS})
        yield from self._run(FESTIVAL_QUERY, "festival", "wd-f")
        yield from self._run(PILGRIMAGE_QUERY, "pilgrimage_major", "wd-p")

    def _run(self, query: str, tier: str, prefix: str, extra: dict | None = None):
        offset = 0
        while True:
            params = {"limit": self.PAGE, "offset": offset, **(extra or {})}
            rows = self._query(query % params)
            if not rows:
                return
            for r in rows:
                lat, lon = _parse_point(r.get("coord", {}).get("value", ""))
                if lat is None:
                    continue
                qid = r["item"]["value"].rsplit("/", 1)[-1]
                yield Asset(
                    asset_id=f"{prefix}-{qid}", tier=tier, lat=lat, lon=lon,
                    name=r.get("itemLabel", {}).get("value", qid),
                    source=self.name, source_url=r["item"]["value"],
                    retrieved=self.today,
                    country=r.get("countryLabel", {}).get("value", ""),
                    extra={"sitelinks": int(r.get("sitelinks", {}).get("value", 0))},
                )
            if len(rows) < self.PAGE:
                return
            offset += self.PAGE
            time.sleep(self.PAUSE_S)

    def _query(self, sparql: str) -> list[dict]:
        import requests

        from twm.sources.base import USER_AGENT

        try:
            resp = requests.get(
                ENDPOINT, params={"query": sparql, "format": "json"},
                headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"},
                timeout=180,
            )
            resp.raise_for_status()
            return resp.json()["results"]["bindings"]
        except Exception as exc:
            raise SourceError(f"wikidata: query failed: {exc}") from exc


def _parse_point(wkt: str) -> tuple[float | None, float | None]:
    """'Point(-7.59 33.57)' -> (33.57, -7.59). Longitude comes first in WKT."""
    if not wkt.startswith("Point("):
        return None, None
    try:
        lon_s, lat_s = wkt[6:].rstrip(")").split()
        return float(lat_s), float(lon_s)
    except ValueError:
        return None, None
