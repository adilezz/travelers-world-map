"""
The build pipeline.

    sources -> candidates -> assets -> catchments -> absorption -> archetypes
            -> scoring -> the app database
            -> quotas -> coverage selection -> territories -> the printed map

One database, two renderings. The web application takes every place that clears
the feasibility gate and a score floor. The printed map takes a filtered
projection of the same table, bounded by a hole budget and a physical minimum
distance between two holes. Nothing is ever lost to the printed map's limits --
that is the whole point of building it this way.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from twm.archetypes import derive_archetypes, dominant
from twm.assets import (
    absorb_sites,
    assign_area_assets,
    assign_assets,
    orphans_to_sites,
    split_point_and_area,
)
from twm.config import CROSS_COUNTRY_SOURCES, PARAMS, ModelParams
from twm.geo import PrintedMap, min_spacing_km
from twm.scoring import covered_archetypes, score_country
from twm.select import (
    allocate_quotas,
    closest_pair_km,
    country_quality,
    redundancy,
    select_for_printed_map,
    spacing_conflicts,
)
from twm.types import Asset, Candidate, Place, Scored

log = logging.getLogger("twm.pipeline")


@dataclass
class CountryFacts:
    """What the quota formula needs, per country."""

    name: str
    area_km2: float
    iso: str = ""


@dataclass
class BuildResult:
    places: list[Place] = field(default_factory=list)
    scored: dict[str, list[Scored]] = field(default_factory=dict)
    quotas: dict[str, int] = field(default_factory=dict)
    absorption_log: list[dict] = field(default_factory=list)
    conflicts: dict[str, list[tuple[str, str, float]]] = field(default_factory=dict)
    stats: dict = field(default_factory=dict)

    def for_country(self, country: str) -> list[Place]:
        return [p for p in self.places if p.country == country]

    @property
    def printed(self) -> list[Place]:
        return [p for p in self.places if p.on_printed_map]


def build(candidates: list[Candidate], assets: list[Asset],
          countries: dict[str, CountryFacts], params: ModelParams = PARAMS,
          printed_map: PrintedMap | None = None) -> BuildResult:
    """Run the whole pipeline over already-loaded records."""
    pm = printed_map or PrintedMap()
    result = BuildResult()

    # -- assets to candidates ------------------------------------------------
    point_assets, area_assets = split_point_and_area(assets)
    candidates, orphans = assign_assets(candidates, point_assets, params)

    promoted = orphans_to_sites(orphans)
    if promoted:
        log.info("promoted %d orphan assets into site candidates", len(promoted))
        candidates.extend(promoted)
        # re-run so the newly promoted sites can claim nearby orphans of their own
        candidates, _ = assign_assets(candidates, [
            a for a in orphans if a.weight < 4.0
        ], params)

    assign_area_assets(candidates, area_assets)

    # -- archetypes before absorption: absorption compares archetype profiles --
    for c in candidates:
        if not c.archetypes:
            c.archetypes = derive_archetypes(c)

    candidates, result.absorption_log = absorb_sites(candidates, params)
    for c in candidates:
        c.archetypes = derive_archetypes(c)

    # -- score, per country ---------------------------------------------------
    by_country: dict[str, list[Candidate]] = {}
    for c in candidates:
        by_country.setdefault(c.country, []).append(c)

    qualities: dict[str, float] = {}
    archetype_counts: dict[str, int] = {}
    for country, group in by_country.items():
        scored = score_country(group, params)
        result.scored[country] = scored
        archetype_counts[country] = len(covered_archetypes(group))
        facts = countries.get(country)
        qualities[country] = country_quality(
            area_km2=facts.area_km2 if facts else 100_000.0,
            archetype_count=archetype_counts[country],
            global_assets=_global_assets(group, params),
            params=params,
        )

    result.quotas = allocate_quotas(qualities, archetype_counts, params)

    # -- assemble places ------------------------------------------------------
    for country, scored in result.scored.items():
        keep = [s for s in scored
                if s.feasibility > 0 and s.score >= params.score_floor * _top(scored)]
        keep.sort(key=lambda s: -s.score)

        facts = countries.get(country)
        area = facts.area_km2 if facts else 100_000.0
        n = result.quotas.get(country, params.quota_min)
        selection = select_for_printed_map(keep, n, area, params)
        rank_of = {id(s): i + 1 for i, s in enumerate(selection)}

        d_min = min_spacing_km(area, n, params)
        result.conflicts[country] = spacing_conflicts(keep[: 3 * max(n, 1)], d_min)

        top = _top(keep)
        for s in keep:
            c = s.candidate
            arch = dominant(c.archetypes)
            result.places.append(Place(
                place_id=_place_id(country, c),
                name=c.name, country=country, lat=c.lat, lon=c.lon,
                is_site=c.is_site,
                score=int(round(100 * s.score / top)) if top else 0,
                archetypes=arch,
                archetype_weights=[c.archetypes.get(a, 0.0) for a in arch],
                whs=c.tier_counts.get("whs_cultural", 0) + c.tier_counts.get("whs_natural", 0),
                reach=c.reach, best_months=list(c.best_months),
                on_printed_map=id(s) in rank_of,
                printed_rank=rank_of.get(id(s)),
                sources=sorted(c.sources), merged_from=list(c.merged_from),
            ))

    result.stats = _stats(result, params, pm)
    return result


# ------------------------------------------------------------------------ helpers
def _top(scored: list[Scored]) -> float:
    return max((s.score for s in scored), default=0.0) or 1.0


def _global_assets(group: list[Candidate], params: ModelParams) -> int:
    """Count only globally-adjudicated assets.

    This is the rule that stops a country's quota reflecting how thoroughly it
    catalogued itself. National registers are excluded here by construction.
    """
    total = 0
    for c in group:
        for tier, n in c.tier_counts.items():
            if tier in CROSS_COUNTRY_SOURCES:
                total += n
    return total


def _place_id(country: str, c: Candidate) -> str:
    slug = "".join(ch for ch in country.upper() if ch.isalnum())[:3] or "XXX"
    tail = "".join(ch for ch in c.candidate_id if ch.isalnum())[-8:]
    return f"{slug}-{tail}"


def _stats(result: BuildResult, params: ModelParams, pm: PrintedMap) -> dict:
    printed = result.printed
    per_country = {}
    for country, scored in result.scored.items():
        sel = [s for s in scored if any(
            p.on_printed_map and p.name == s.name for p in result.for_country(country))]
        per_country[country] = {
            "candidates": len(scored),
            "in_app": len(result.for_country(country)),
            "on_printed_map": len([p for p in result.for_country(country)
                                   if p.on_printed_map]),
            "quota": result.quotas.get(country),
            "redundancy": round(redundancy(sel), 3) if sel else None,
            "closest_pair_km": (round(closest_pair_km(sel), 1)
                                if len(sel) > 1 else None),
            "spacing_conflicts": len(result.conflicts.get(country, [])),
        }
    return {
        "places_in_app": len(result.places),
        "places_on_printed_map": len(printed),
        "hole_budget": params.hole_budget,
        "countries": len(result.scored),
        "min_place_separation_km": round(pm.min_place_separation_km, 1),
        "absorbed": sum(1 for r in result.absorption_log if r["decision"] == "absorbed"),
        "retained_sites": sum(1 for r in result.absorption_log
                              if r["decision"] == "retained"),
        "per_country": per_country,
    }
