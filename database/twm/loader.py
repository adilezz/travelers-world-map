"""
Turning a build configuration into candidates, assets and country facts.

A build configuration names which adapters to run and where the operator-supplied
files live. Keeping this out of the pipeline means the pipeline can be tested
against fixtures with no network and no credentials at all.

    {
      "countries": {"Morocco": {"area_km2": 446550, "iso": "MA"}},
      "sources": {
        "unesco-whs":  {},
        "ghsl-ucdb":   {"path": "data/ucdb.csv"},
        "wdpa":        {"path": "data/wdpa.csv"},
        "unesco-ich":  {"path": "data/ich.csv"},
        "cuisine":     {"path": "data/cuisine.csv", "strict": true},
        "osm":         {"iso_codes": ["MA"]},
        "wikidata":    {}
      }
    }
"""
from __future__ import annotations

import logging

from twm.pipeline import CountryFacts
from twm.sources.base import Source, SourceError
from twm.types import Asset, Candidate

log = logging.getLogger("twm.loader")


def load_from_config(cfg: dict) -> tuple[list[Candidate], list[Asset],
                                         dict[str, CountryFacts], list[dict]]:
    from twm.sources import cuisine, foursquare, ghsl, osm, protected, unesco, wikidata

    builders = {
        "unesco-whs": lambda kw: unesco.WorldHeritage(**kw),
        "unesco-whs-tentative": lambda kw: unesco.WorldHeritageTentative(**kw),
        "unesco-ich": lambda kw: unesco.IntangibleHeritage(**kw),
        "ghsl-ucdb": lambda kw: ghsl.UrbanCentres(**kw),
        "wdpa": lambda kw: protected.ProtectedAreas(**kw),
        "ramsar-geopark": lambda kw: protected.RamsarAndGeoparks(**kw),
        "wikidata": lambda kw: wikidata.Wikidata(**kw),
        "osm": lambda kw: osm.OpenStreetMap(**kw),
        "foursquare-os": lambda kw: foursquare.FoursquarePlaces(**kw),
        "cuisine": lambda kw: cuisine.CuisineRegions(**kw),
    }

    countries = {
        name: CountryFacts(name=name, area_km2=float(f["area_km2"]),
                           iso=f.get("iso", ""))
        for name, f in cfg.get("countries", {}).items()
    }

    candidates: list[Candidate] = []
    assets: list[Asset] = []
    manifest: list[dict] = []

    for name, kwargs in cfg.get("sources", {}).items():
        make = builders.get(name)
        if make is None:
            raise SourceError(f"unknown source {name!r}; see `twm sources`")
        adapter: Source = make(dict(kwargs))
        manifest.append(adapter.manifest())
        log.info("loading %s", name)
        try:
            for record in adapter.load():
                (candidates if isinstance(record, Candidate) else assets).append(record)
        except SourceError:
            raise
        except Exception as exc:  # a broken adapter must not look like empty data
            raise SourceError(f"{name}: load failed: {exc}") from exc

    if not candidates:
        raise SourceError(
            "no candidates loaded -- at least one settlement source (ghsl-ucdb) "
            "is required, otherwise every asset becomes its own site place."
        )
    return candidates, assets, countries, manifest
