"""
Deriving a candidate's experience archetypes from the assets it holds.

Archetypes are the vocabulary the whole product depends on: the printed map's
coverage selection uses them, and the web application turns them into the one
question that matters to a traveler -- not "how many places have I seen" but
"which *kinds* of country have I not seen".

They are derived, never hand-assigned, so the vocabulary stays consistent across
20,000 places that no human will ever review individually.
"""
from __future__ import annotations

from twm.config import ARCHETYPES
from twm.types import Candidate

# Landform -> archetypes it evidences, with strength.
LANDFORM_SIGNALS: dict[str, dict[str, float]] = {
    "coast": {"A3": 0.9}, "island": {"A3": 0.7}, "fjord": {"A3": 0.6, "A4": 0.6},
    "reef": {"A3": 0.5, "A9": 0.6},
    "mountain": {"A4": 0.9}, "glacier": {"A4": 0.7, "A9": 0.4},
    "canyon": {"A4": 0.5, "A5": 0.5}, "gorge": {"A4": 0.5},
    "desert": {"A5": 0.95}, "dunes": {"A5": 0.8}, "saltflat": {"A5": 0.7},
    "steppe": {"A5": 0.6, "A9": 0.3},
    "forest": {"A6": 0.8}, "rainforest": {"A6": 0.95, "A9": 0.6},
    "lake": {"A7": 0.85}, "river": {"A7": 0.25}, "waterfall": {"A7": 0.7},
    "wetland": {"A7": 0.6, "A9": 0.6},
    "volcano": {"A8": 0.95}, "geothermal": {"A8": 0.9},
    "tundra": {"A9": 0.8}, "cave": {"A9": 0.3, "A6": 0.2},
}

# Asset tier -> archetypes it evidences.
#
# Signals are deliberately narrow. A signal that fires on most candidates carries
# no information: when museums implied "metropolis" and any river implied "lake &
# river", six great French cities ended up with identical vectors and the coverage
# selection had nothing left to tell them apart.
TIER_SIGNALS: dict[str, dict[str, float]] = {
    # No tier implies A1: being inscribed does not make a town a former capital.
    "whs_cultural": {"A2": 0.5},
    "whs_tentative": {"A2": 0.25},
    "national_top": {"A2": 0.35},
    "whs_natural": {"A9": 0.6},
    "wdpa_iucn_i_ii": {"A9": 0.8},
    "wdpa_iucn_iii_iv": {"A9": 0.4},
    "ramsar_geopark": {"A9": 0.5, "A7": 0.3},
    "pilgrimage_major": {"A10": 0.95},
    "ich_unesco": {"A11": 0.4},
    "ich_national": {"A11": 0.3},
    "craft_cluster": {"A11": 0.6},
    "market": {"A2": 0.25},
    "festival": {"A11": 0.2},
}

URBAN_POP_MILLIONS = 1.0
"""Above this, a settlement reads as a modern metropolis whatever else it is.
Set high on purpose: a city of half a million is not a metropolis, and letting
it claim that archetype made every vector dense enough to blunt coverage."""

MEDINA_COHERENCE = 0.6
"""Heritage this concentrated is an intact quarter, not scattered monuments."""

MIN_ARCHETYPE_WEIGHT = 0.30
MAX_ARCHETYPES = 4
"""A place is a few things, not nine. See the note in derive_archetypes."""


def derive_archetypes(c: Candidate) -> dict[str, float]:
    """Build a candidate's archetype vector from its assets and setting.

    Weights accumulate by maximum rather than by sum: three national parks make a
    place no more 'wildlife' than one does, they just make it certain.
    """
    vec: dict[str, float] = {}

    def bump(code: str, value: float) -> None:
        if value > vec.get(code, 0.0):
            vec[code] = value

    for lf in c.landforms:
        for code, strength in LANDFORM_SIGNALS.get(lf, {}).items():
            bump(code, strength)

    for tier, count in c.tier_counts.items():
        if count <= 0:
            continue
        # a second instance adds confidence, a tenth adds nothing
        confidence = min(1.0, 0.7 + 0.15 * min(count, 3))
        for code, strength in TIER_SIGNALS.get(tier, {}).items():
            bump(code, strength * confidence)

    if c.relief_m >= 1500:
        bump("A4", min(0.95, 0.5 + c.relief_m / 6000))

    if c.historic_capital:
        bump("A1", 0.9)

    if not c.is_site:
        if c.population >= URBAN_POP_MILLIONS:
            bump("A12", min(0.95, 0.45 + 0.5 * min(c.population / 8.0, 1.0)))
        if c.coherence >= MEDINA_COHERENCE and c.tier_counts.get("whs_cultural", 0):
            bump("A2", 0.95)
        elif c.coherence >= MEDINA_COHERENCE:
            bump("A2", 0.7)
        if c.population < 0.05 and c.tier_counts.get("craft_cluster", 0):
            bump("A11", 0.9)

    if not vec:
        # every place is at least somewhere people are, or somewhere they are not
        vec["A11" if c.is_site else "A12"] = 0.5

    # Keep only what a place actually IS. Weak signals accumulate into dense
    # vectors, and dense vectors make every place look similar to every other,
    # which quietly disables the coverage selection downstream.
    ranked = sorted(vec.items(), key=lambda kv: -kv[1])[:MAX_ARCHETYPES]
    return {k: round(v, 3) for k, v in ranked if v >= MIN_ARCHETYPE_WEIGHT}


def label(code: str) -> str:
    return ARCHETYPES.get(code, code)


def dominant(vec: dict[str, float], threshold: float = 0.45, limit: int = 3) -> list[str]:
    ranked = sorted(vec.items(), key=lambda kv: -kv[1])
    return [c for c, v in ranked if v >= threshold][:limit]
