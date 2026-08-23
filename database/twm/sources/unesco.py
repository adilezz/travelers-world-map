"""
UNESCO World Heritage and Intangible Cultural Heritage.

These two carry more weight than any other source, for a specific reason: their
inclusion criteria are set once, globally, by a body that is not any single
country's heritage ministry. That makes them the only asset class permitted to
inform a comparison between countries.

World Heritage publishes an XML export of the whole List. Intangible Cultural
Heritage has no equivalent bulk export -- its elements are georeferenced to a
practising region rather than a point, and the region is often described in prose
-- so the ICH adapter reads a curated CSV the operator maintains.
"""
from __future__ import annotations

import csv
import xml.etree.ElementTree as ET
from collections.abc import Iterator
from pathlib import Path

from twm.sources.base import LocalSource, Source, SourceError
from twm.types import Asset

WHS_XML_URL = "https://whc.unesco.org/en/list/xml/"


class WorldHeritage(Source):
    """The World Heritage List.

    Categories map to pillars directly: cultural properties are built heritage,
    natural are setting, and mixed properties count as both -- a mixed
    inscription genuinely is both, and splitting it would understate it.
    """

    name = "unesco-whs"
    licence = "UNESCO terms, attribution required"
    attribution = "UNESCO World Heritage Centre"
    cross_country_safe = True

    def fetch(self) -> Path:
        return self._cached(WHS_XML_URL, ".xml", max_age_days=30)

    def load(self) -> Iterator[Asset]:
        root = ET.parse(self.fetch()).getroot()
        rows = root.findall(".//row")
        if not rows:
            raise SourceError(
                "unesco-whs: no <row> elements. The XML layout changed -- inspect "
                "the cached file before trusting a rebuild."
            )
        for row in rows:
            lat, lon = _f(row, "latitude"), _f(row, "longitude")
            if lat is None or lon is None:
                continue
            uid = _t(row, "id_number") or _t(row, "unique_number") or ""
            name = _t(row, "site") or _t(row, "name_en") or f"WHS {uid}"
            category = (_t(row, "category") or "").strip().lower()
            country = _t(row, "states") or _t(row, "state") or ""
            danger = _t(row, "danger") or ""
            base = dict(lat=lat, lon=lon, name=name, source=self.name,
                        source_url=f"https://whc.unesco.org/en/list/{uid}",
                        retrieved=self.today, country=country,
                        extra={"category": category, "in_danger": bool(danger)})
            if category in ("cultural", "mixed"):
                yield Asset(asset_id=f"whs-c-{uid}", tier="whs_cultural", **base)
            if category in ("natural", "mixed"):
                yield Asset(asset_id=f"whs-n-{uid}", tier="whs_natural", **base)


class WorldHeritageTentative(LocalSource):
    """Tentative List entries.

    No stable machine-readable export exists; the operator exports the Tentative
    List to CSV with columns: id, name, lat, lon, country, category.
    """

    name = "unesco-whs-tentative"
    licence = "UNESCO terms, attribution required"
    attribution = "UNESCO World Heritage Centre"
    cross_country_safe = True
    instructions = (
        "Export the Tentative List from https://whc.unesco.org/en/tentativelists/ "
        "to CSV with columns: id,name,lat,lon,country,category"
    )

    def load(self) -> Iterator[Asset]:
        with open(self.fetch(), encoding="utf-8-sig", newline="") as fh:
            for r in csv.DictReader(fh):
                try:
                    lat, lon = float(r["lat"]), float(r["lon"])
                except (KeyError, TypeError, ValueError):
                    continue
                yield Asset(asset_id=f"whs-t-{r.get('id','')}", tier="whs_tentative",
                            lat=lat, lon=lon, name=r.get("name", ""),
                            source=self.name, retrieved=self.today,
                            country=r.get("country", ""))


class IntangibleHeritage(LocalSource):
    """Intangible Cultural Heritage elements, georeferenced to a practising region.

    ICH elements are practices, not points -- "falconry" spans a dozen countries.
    Each row therefore carries a centroid and a radius, and the pipeline attaches
    the element to every candidate inside that radius rather than to one point.

    Columns: id,name,country,lat,lon,radius_km,list
    """

    name = "unesco-ich"
    licence = "UNESCO terms, attribution required"
    attribution = "UNESCO Intangible Cultural Heritage"
    cross_country_safe = True
    instructions = (
        "Export the ICH lists from https://ich.unesco.org/en/lists and geolocate "
        "each element to a practising region. Columns: "
        "id,name,country,lat,lon,radius_km,list"
    )

    def load(self) -> Iterator[Asset]:
        with open(self.fetch(), encoding="utf-8-sig", newline="") as fh:
            for r in csv.DictReader(fh):
                try:
                    lat, lon = float(r["lat"]), float(r["lon"])
                except (KeyError, TypeError, ValueError):
                    continue
                radius = float(r.get("radius_km") or 60.0)
                yield Asset(asset_id=f"ich-{r.get('id','')}", tier="ich_unesco",
                            lat=lat, lon=lon, name=r.get("name", ""),
                            source=self.name, retrieved=self.today,
                            country=r.get("country", ""),
                            extra={"radius_km": radius, "list": r.get("list", "")})


def _t(row: ET.Element, tag: str) -> str | None:
    el = row.find(tag)
    return el.text.strip() if el is not None and el.text else None


def _f(row: ET.Element, tag: str) -> float | None:
    raw = _t(row, tag)
    try:
        return float(raw) if raw else None
    except ValueError:
        return None
