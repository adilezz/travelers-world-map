"""
The cuisine layer.

Food is one of the most common reasons people choose a destination and the only
pillar input with no usable global dataset, so this layer is compiled rather than
downloaded. That makes its record standard part of the code, not a convention:
the adapter REJECTS rows that do not meet it, because a silently thin cuisine
layer would quietly reweight the whole model.

Standard, per region:
  * an endonym and an English name
  * a centroid and an approximate radius
  * at least three signature dishes, each attributable
  * at least two independent sources
  * an explicit statement of whether it is the country's modal cuisine

Prefer bulk, openly-licensed routes: Wikipedia and Wikidata dumps cover regional
cuisine at scale, and UNESCO ICH already carries culinary inscriptions with
georeferences. Use targeted scraping only for what those cannot supply, honour
robots.txt and terms, rate-limit, and record the retrieval date. Several
aggregated food-atlas sites forbid scraping and republication -- read them as a
cross-check, never copy them.
"""
from __future__ import annotations

import csv
from collections.abc import Iterator
from dataclasses import dataclass, field

from twm.sources.base import LocalSource, SourceError
from twm.types import Asset

MIN_DISHES = 3
MIN_SOURCES = 2


@dataclass
class CuisineRegion:
    region_id: str
    name_en: str
    name_local: str
    country: str
    lat: float
    lon: float
    radius_km: float
    dishes: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    is_modal: bool = False
    retrieved: str = ""

    def problems(self) -> list[str]:
        out = []
        if len(self.dishes) < MIN_DISHES:
            out.append(f"only {len(self.dishes)} dishes, need {MIN_DISHES}")
        if len(self.sources) < MIN_SOURCES:
            out.append(f"only {len(self.sources)} sources, need {MIN_SOURCES}")
        if not self.name_local:
            out.append("missing endonym")
        if not self.retrieved:
            out.append("missing retrieval date")
        if not (0 < self.radius_km <= 600):
            out.append(f"implausible radius {self.radius_km} km")
        return out


class CuisineRegions(LocalSource):
    """Reads the compiled layer and refuses rows that fail the standard.

    CSV columns:
      id,name_en,name_local,country,lat,lon,radius_km,dishes,sources,is_modal,retrieved
    where `dishes` and `sources` are pipe-separated.
    """

    name = "cuisine"
    licence = "Own compilation; per-record source attribution required"
    attribution = "Compiled from openly-licensed sources; see per-record provenance"
    cross_country_safe = False
    instructions = "Compile per the record standard in twm/sources/cuisine.py"

    def __init__(self, path, cache_dir=None, strict: bool = True):
        super().__init__(path, cache_dir)
        self.strict = strict
        self.rejected: list[tuple[str, list[str]]] = []

    def regions(self) -> list[CuisineRegion]:
        out: list[CuisineRegion] = []
        with open(self.fetch(), encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                try:
                    region = CuisineRegion(
                        region_id=row["id"], name_en=row.get("name_en", ""),
                        name_local=row.get("name_local", ""),
                        country=row.get("country", ""),
                        lat=float(row["lat"]), lon=float(row["lon"]),
                        radius_km=float(row.get("radius_km") or 0),
                        dishes=[d for d in (row.get("dishes") or "").split("|") if d],
                        sources=[s for s in (row.get("sources") or "").split("|") if s],
                        is_modal=(row.get("is_modal", "").strip().lower()
                                  in ("1", "true", "yes")),
                        retrieved=row.get("retrieved", ""),
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    self.rejected.append((row.get("id", "?"), [f"unreadable: {exc}"]))
                    continue
                problems = region.problems()
                if problems:
                    self.rejected.append((region.region_id, problems))
                    continue
                out.append(region)

        if self.strict and self.rejected:
            detail = "; ".join(f"{rid}: {', '.join(p)}" for rid, p in self.rejected[:10])
            raise SourceError(
                f"cuisine: {len(self.rejected)} region(s) fail the record standard. "
                f"Fix them or pass strict=False to build without them. {detail}"
            )
        return out

    def load(self) -> Iterator[Asset]:
        for r in self.regions():
            yield Asset(
                asset_id=f"cuisine-{r.region_id}", tier="cuisine_region",
                lat=r.lat, lon=r.lon, name=r.name_local or r.name_en,
                source=self.name, retrieved=r.retrieved, country=r.country,
                extra={"radius_km": r.radius_km, "dishes": r.dishes,
                       "sources": r.sources, "is_modal": r.is_modal},
            )
