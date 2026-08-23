"""
Quotas and selection for the printed map.

The web application takes every place clearing the feasibility gate and a score
floor. The printed map cannot: it has 3,000 holes and a physical minimum distance
between two of them. So selection is a COVERAGE problem, not a ranking one.

Five scores summed into a ranking has no memory -- it does not know it already
picked three walled cities. The greedy objective below is monotone and
submodular, so it reaches at least (1 - 1/e) ~ 63% of the optimum.
"""
from __future__ import annotations

import math

from twm.config import ARCHETYPES, PARAMS, ModelParams
from twm.geo import haversine_km, min_spacing_km
from twm.scoring import archetype_similarity, archetype_vector
from twm.types import Scored


# ------------------------------------------------------------------------- the quota
def country_quality(area_km2: float, archetype_count: int, global_assets: int,
                    params: ModelParams = PARAMS) -> float:
    """A country's claim on the hole budget.

    Weighted 2.5 / 0.6 / 1.2 because the archetype term saturates at twelve. With
    equal weights a country 22x larger than another earned only 27% more places.
    """
    return (params.quota_area * math.log(1.0 + area_km2 / params.quota_area_ref_km2)
            + params.quota_archetypes * archetype_count
            + params.quota_global * math.log(1.0 + global_assets))


WORLD_COUNTRIES = 195
"""Sovereign states the hole budget is shared between."""


def allocate_quotas(qualities: dict[str, float], archetypes: dict[str, int],
                    params: ModelParams = PARAMS,
                    budget: int | None = None) -> dict[str, int]:
    """Distribute the hole budget across countries.

    The budget is a WORLD budget. Building a subset of countries and dividing the
    whole budget between them would hand each of them a share of the world's
    holes, so a partial build pro-rates: `budget` defaults to the full budget
    scaled by how much of the world is present. Pass it explicitly to override.

    Two floors. Every sovereign country gets at least one hole -- a world map on
    which a buyer's own country has none is a map that buyer does not want. And a
    small country rich in archetypes gets a higher floor, because area alone would
    otherwise give a volcanic, glacial, coastal island nation five holes.
    """
    if budget is None:
        share = min(1.0, len(qualities) / WORLD_COUNTRIES)
        budget = max(1, int(round(params.hole_budget * share)))
    total_q = sum(qualities.values()) or 1.0
    out: dict[str, int] = {}
    for country, q in qualities.items():
        n = int(round(budget * q / total_q))
        if archetypes.get(country, 0) >= params.small_country_archetypes:
            n = max(n, params.quota_small_country_floor)
        out[country] = max(params.quota_min, min(params.quota_max, n))
    return out


# ---------------------------------------------------------------------- the selection
def select_for_printed_map(scored: list[Scored], n: int, area_km2: float,
                           params: ModelParams = PARAMS) -> list[Scored]:
    """Greedy coverage selection under the physical spacing constraint."""
    pool = [s for s in scored if s.feasibility > 0]
    if not pool or n <= 0:
        return []

    d_min = min_spacing_km(area_km2, n, params)
    v_max = max(s.score for s in pool) or 1.0

    chosen: list[Scored] = []
    counts: dict[str, int] = {a: 0 for a in ARCHETYPES}

    while len(chosen) < n and pool:
        best, best_gain = None, -1.0
        for s in pool:
            gain = _marginal_gain(s, chosen, counts, d_min, v_max, params)
            if gain > best_gain:
                best, best_gain = s, gain
        if best is None or best_gain <= 0:
            break
        chosen.append(best)
        pool.remove(best)
        vec = archetype_vector(best.candidate)
        for a in ARCHETYPES:
            if vec[a] >= COVERAGE_THRESHOLD:
                counts[a] += 1
    return chosen


COVERAGE_THRESHOLD = 0.45
"""Weight above which a place counts as genuinely being that kind of place."""


def coverage_value(candidate, counts: dict[str, int], params: ModelParams) -> float:
    """How much NEW kind-of-place this candidate adds, in 0..1.

    1.0 when nothing it offers is represented yet, decaying geometrically as the
    selection already covers each archetype. This replaced a maximum-similarity
    penalty, which saturated: once one coastal town was chosen, every further
    coastal town was penalised identically, so a country could quietly fill up
    with six of them.
    """
    vec = archetype_vector(candidate)
    strong = {a: w for a, w in vec.items() if w >= COVERAGE_THRESHOLD}
    if not strong:
        strong = {a: w for a, w in vec.items() if w > 0} or {"": 1.0}
    total = sum(strong.values()) or 1.0
    earned = sum(w * (params.coverage_decay ** counts.get(a, 0))
                 for a, w in strong.items())
    return earned / total


def _marginal_gain(s: Scored, chosen: list[Scored], counts: dict[str, int],
                   d_min: float, v_max: float, params: ModelParams) -> float:
    if chosen:
        nearest = min(haversine_km(s.candidate.lat, s.candidate.lon,
                                   t.candidate.lat, t.candidate.lon) for t in chosen)
        # zero inside the physical floor, ramping to full at twice the floor
        spatial = 0.0 if nearest < d_min else min(1.0, (nearest - d_min) / d_min)
    else:
        spatial = 1.0

    novelty = coverage_value(s.candidate, counts, params)

    # A candidate at the very top of its country pays less of the novelty penalty:
    # a country may deserve a second of a kind if both are world-class. Fes does
    # not lock Marrakech out.
    relief = params.quality_relief * (s.score / v_max)
    adjusted = relief + (1.0 - relief) * novelty

    return s.score * (params.lam_red * adjusted + (1 - params.lam_red)) * spatial


def select_by_rank(scored: list[Scored], n: int, area_km2: float,
                   params: ModelParams = PARAMS) -> list[Scored]:
    """Baseline: take the highest scorers that fit the spacing rule.

    This is the model the coverage selection has to beat, and it must be measured
    under the SAME physical constraint -- an unconstrained ranking can take three
    neighbouring places of three different kinds and look artificially diverse,
    which is not an option the printed map ever has.
    """
    pool = sorted((s for s in scored if s.feasibility > 0), key=lambda s: -s.score)
    d_min = min_spacing_km(area_km2, n, params)
    chosen: list[Scored] = []
    for s in pool:
        if len(chosen) >= n:
            break
        if all(haversine_km(s.candidate.lat, s.candidate.lon,
                            t.candidate.lat, t.candidate.lon) >= d_min for t in chosen):
            chosen.append(s)
    return chosen


# ------------------------------------------------------------------------- diagnostics
def redundancy(selection: list[Scored]) -> float:
    """Mean pairwise archetype similarity. Must fall against a ranking baseline."""
    if len(selection) < 2:
        return 0.0
    total, pairs = 0.0, 0
    for i in range(len(selection)):
        for j in range(i + 1, len(selection)):
            total += archetype_similarity(selection[i].candidate, selection[j].candidate)
            pairs += 1
    return total / pairs


def closest_pair_km(selection: list[Scored]) -> float:
    if len(selection) < 2:
        return float("inf")
    return min(
        haversine_km(a.candidate.lat, a.candidate.lon, b.candidate.lat, b.candidate.lon)
        for i, a in enumerate(selection) for b in selection[i + 1:]
    )


def spacing_conflicts(scored: list[Scored], d_min: float) -> list[tuple[str, str, float]]:
    """Pairs that cannot both be holes on the printed map.

    Reported rather than silently resolved: these are the places that need an
    inset panel, and knowing which regions need one is a manufacturing decision.
    """
    out = []
    for i, a in enumerate(scored):
        for b in scored[i + 1:]:
            d = haversine_km(a.candidate.lat, a.candidate.lon,
                             b.candidate.lat, b.candidate.lon)
            if d < d_min:
                out.append((a.name, b.name, round(d, 1)))
    return sorted(out, key=lambda t: t[2])
