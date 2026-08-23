"""
The place scoring model.

Four properties matter and each exists because the alternative was measured and
found worse:

1. Discounting happens WITHIN a tier, not across the whole sorted asset list.
   Discounting across the list saturates the entire pillar at 6.7x the top asset,
   which made Paris and a mid-sized walled town score within 7% of each other.
2. Normalisation is LINEAR against the country maximum. Percentile ranks are
   ordinal and throw magnitude away; log normalisation over-compresses the top.
3. The pillars combine through a POWER MEAN, not an arithmetic one. An arithmetic
   mean rewards balance, but the most essential places are extreme specialists --
   a great national park has no monuments and should not be punished for it.
4. Feasibility is capped at 1.0 so it can only penalise. If good connectivity
   earned points, the capital-city bias would return through the back door.
"""
from __future__ import annotations

import math

from twm.config import (
    ALL_TIERS,
    ARCHETYPES,
    CROSS_COUNTRY_SOURCES,
    LANDFORM_FREQUENCY,
    PARAMS,
    PILLAR_OF,
    PROFILE_KEYS,
    REACH_FACTOR,
    ModelParams,
)
from twm.types import Candidate, Scored


# ------------------------------------------------------------------ tiered asset sums
def tiered_sum(weight_counts: dict[float, int], delta: float | None = None) -> float:
    """Sum asset tiers with a geometric discount applied inside each tier.

    Each tier contributes ``w * (1 - delta**n) / (1 - delta)``, saturating at
    ``w / (1 - delta)``. So the fortieth church stops mattering while a World
    Heritage inscription always contributes its full weight.

    A capital with 40 top-rank monuments and a 400-entry tail scores well clear
    of a walled town with 8 and 60 -- but not 10x clear, because the tail cannot
    accumulate:

    >>> round(tiered_sum({10.0: 1, 3.0: 40, 1.0: 400}), 1)
    82.3
    >>> round(tiered_sum({10.0: 1, 3.0: 8, 1.0: 60}), 1)
    49.3
    >>> round(tiered_sum({1.0: 25}), 1) == round(tiered_sum({1.0: 400}), 1)
    False
    >>> round(tiered_sum({1.0: 400}), 2)   # saturates at w/(1-delta)
    20.0
    """
    d = PARAMS.delta if delta is None else delta
    total = 0.0
    for w, n in weight_counts.items():
        if n and n > 0:
            total += w * (1.0 - d ** int(n)) / (1.0 - d)
    return total


def landform_weight(landform: str, country_instances: int = 2,
                    params: ModelParams = PARAMS) -> float:
    """Rarity weight for a landform, as its self-information rescaled to 1..6.

    A beach is common and earns little; a fjord or geothermal field is globally
    rare and earns a great deal. Capped when the country holds exactly one
    instance -- otherwise a country's single volcanic field outranks its capital.
    """
    f = LANDFORM_FREQUENCY.get(landform)
    if f is None:
        return 1.0
    w = max(1.0, min(6.0, 1.0 + 1.6 * (-math.log2(f) - 2.0)))
    if country_instances <= 1:
        w = min(w, params.rarity_country_cap)
    return w


# ----------------------------------------------------------------------- pillar scores
def pillar_h(c: Candidate, params: ModelParams = PARAMS,
             cross_country_only: bool = False) -> float:
    counts = _counts(c, "H", cross_country_only)
    return tiered_sum(counts, params.delta) * (1.0 + params.coherence * c.coherence)


def pillar_n(c: Candidate, params: ModelParams = PARAMS,
             landform_instances: dict[str, int] | None = None,
             cross_country_only: bool = False) -> float:
    base = tiered_sum(_counts(c, "N", cross_country_only), params.delta)
    if not cross_country_only:
        lf: dict[float, int] = {}
        for t in c.landforms:
            n_inst = (landform_instances or {}).get(t, 2)
            w = round(landform_weight(t, n_inst, params), 3)
            lf[w] = lf.get(w, 0) + 1
        base += tiered_sum(lf, params.delta)
        base += 1.5 * min(c.relief_m, 3000.0) / 1000.0
    return base


def pillar_l(c: Candidate, params: ModelParams = PARAMS,
             cross_country_only: bool = False) -> float:
    return tiered_sum(_counts(c, "L", cross_country_only), params.delta)


def _counts(c: Candidate, pillar: str, cross_country_only: bool) -> dict[float, int]:
    out: dict[float, int] = {}
    for tier, n in c.tier_counts.items():
        if n <= 0 or PILLAR_OF.get(tier) != pillar:
            continue
        if cross_country_only and tier not in CROSS_COUNTRY_SOURCES:
            continue
        w = ALL_TIERS[tier]
        out[w] = out.get(w, 0) + n
    return out


# ---------------------------------------------------------------------- normalisation
def linear_norm(values: list[float]) -> list[float]:
    """Country-relative and magnitude-preserving. See module docstring, point 2."""
    top = max(values) if values else 0.0
    if top <= 0:
        return [0.0] * len(values)
    return [max(v, 0.0) / top for v in values]


# --------------------------------------------------------------------- distinctiveness
def modal_profile(cands: list[Candidate]) -> dict[str, str]:
    """The country's typical profile, weighted by population so an uninhabited
    outlier cannot define the norm."""
    modes: dict[str, str] = {}
    for key in PROFILE_KEYS:
        tally: dict[str, float] = {}
        for c in cands:
            v = c.profile.get(key)
            if v:
                tally[v] = tally.get(v, 0.0) + max(c.population, 0.01)
        if tally:
            modes[key] = max(tally.items(), key=lambda kv: kv[1])[0]
    return modes


def distinctiveness(c: Candidate, modes: dict[str, str], p75_population: float,
                    params: ModelParams = PARAMS) -> float:
    """How far a place sits from its country's own norm, as a multiplier.

    Ships at beta = 0, so this returns 1.0 unless deliberately enabled. The
    mechanism and all four components are retained for a future redesign.

    This is an internal quantity. It measures the variety of a country's cultural
    LANDSCAPE -- vernacular building, cuisine, dialect. It is never surfaced to a
    user as a number or a label, never a sort order, never in an export.
    """
    if params.beta == 0.0:
        return 1.0
    distances: list[float] = []
    for key in PROFILE_KEYS:
        v, mode = c.profile.get(key), modes.get(key)
        if not v or not mode:
            continue
        if key == "language":
            # same family, different language counts as half a step
            same_family = v.split(":")[0] == mode.split(":")[0]
            distances.append(0.0 if v == mode else (0.5 if same_family else 1.0))
        else:
            distances.append(0.0 if v == mode else 1.0)
    if not distances:
        return 1.0
    raw = sum(distances) / len(distances)
    ref = math.sqrt(max(p75_population, 1e-4))
    saturation = min(math.sqrt(max(c.population, 1e-4)), ref) / ref
    if c.is_site:
        saturation = max(saturation, 0.35)  # a site has no residents but is still real
    return 1.0 + params.beta * raw * saturation


# ------------------------------------------------------------------------- feasibility
def feasibility(c: Candidate) -> float:
    """Can a traveler actually go and sleep there? Capped at 1.0 -- see docstring
    point 4. Seasonality is metadata, never a penalty."""
    if c.access == "closed":
        return 0.0
    f = REACH_FACTOR[c.reach]
    if not c.has_lodging:
        f *= 0.6
    if c.overtourism:
        f *= 0.85
    if c.access == "restricted":
        f *= 0.8
    return min(1.0, f)


# ------------------------------------------------------------------------- composition
def score_country(cands: list[Candidate], params: ModelParams = PARAMS) -> list[Scored]:
    """Score every candidate in one country. Normalisation is per-country by
    construction, which is what keeps national registers from crossing borders."""
    if not cands:
        return []

    instances: dict[str, int] = {}
    for c in cands:
        for t in set(c.landforms):
            instances[t] = instances.get(t, 0) + 1

    h_raw = [pillar_h(c, params) for c in cands]
    n_raw = [pillar_n(c, params, instances) for c in cands]
    l_raw = [pillar_l(c, params) for c in cands]
    h, n, liv = linear_norm(h_raw), linear_norm(n_raw), linear_norm(l_raw)

    modes = modal_profile(cands)
    pops = sorted(c.population for c in cands)
    p75 = pops[int(0.75 * (len(pops) - 1))] if pops else 1.0

    out: list[Scored] = []
    p = params.power
    for i, c in enumerate(cands):
        if p == 1.0:
            base = params.w_h * h[i] + params.w_n * n[i] + params.w_l * liv[i]
        else:
            base = (params.w_h * h[i] ** p
                    + params.w_n * n[i] ** p
                    + params.w_l * liv[i] ** p) ** (1.0 / p)
        d = distinctiveness(c, modes, p75, params)
        f = feasibility(c)
        out.append(Scored(candidate=c, h_raw=h_raw[i], n_raw=n_raw[i], l_raw=l_raw[i],
                          h=h[i], n=n[i], liv=liv[i], distinctiveness=d, feasibility=f,
                          base=base, score=base * d * f))
    return out


# ------------------------------------------------------------------ archetype geometry
def archetype_vector(c: Candidate) -> dict[str, float]:
    """L2-normalised, so similarity is a plain dot product."""
    norm = math.sqrt(sum(v * v for v in c.archetypes.values())) or 1.0
    return {a: c.archetypes.get(a, 0.0) / norm for a in ARCHETYPES}


def archetype_similarity(a: Candidate, b: Candidate) -> float:
    va, vb = archetype_vector(a), archetype_vector(b)
    num = sum(va[k] * vb[k] for k in ARCHETYPES)
    da = math.sqrt(sum(v * v for v in va.values())) or 1.0
    db = math.sqrt(sum(v * v for v in vb.values())) or 1.0
    return num / (da * db)


def covered_archetypes(cands: list[Candidate], threshold: float = 0.45) -> set[str]:
    out: set[str] = set()
    for c in cands:
        v = archetype_vector(c)
        out |= {a for a in ARCHETYPES if v[a] >= threshold}
    return out
