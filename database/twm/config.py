"""
Model parameters and controlled vocabularies for the Travelers World Map database.

Every number here is fixed by the approved place-model specification. They were
tuned together against pre-registered ground truth and interact strongly -- in
particular LINEAR normalisation only pays off once the discount is applied
WITHIN each tier. Do not adjust one in isolation.
"""
from __future__ import annotations

from dataclasses import dataclass


# --------------------------------------------------------------------------- model
@dataclass(frozen=True)
class ModelParams:
    """Scoring parameters. Frozen: build a new instance to experiment."""

    delta: float = 0.95
    """Geometric discount applied within each asset tier. Each tier saturates at
    w/(1-delta) = 20x its own weight, so the 40th church stops counting while a
    World Heritage inscription is always worth its full weight."""

    power: float = 2.0
    """Exponent of the power mean combining the three pillars. p>1 leans toward
    the maximum, so a place outstanding at one thing is not beaten by one that is
    merely adequate at three."""

    beta: float = 0.0
    """Distinctiveness amplitude. Ships at zero: the mechanism and all four
    profile components are retained, but every positive value scored worse than
    zero on validation, including on the places it was designed to rescue."""

    coherence: float = 0.25
    """Bonus amplitude for spatially concentrated heritage -- an intact quarter
    beats the same monuments scattered across a metropolitan area."""

    w_h: float = 0.30
    w_n: float = 0.35
    w_l: float = 0.35
    """Pillar weights: built heritage, natural setting, living culture."""

    lam_red: float = 1.0
    """Redundancy penalty coefficient in selection."""

    quality_relief: float = 0.4
    """Fraction of the redundancy penalty waived for a candidate at the top of its
    country, so a world-class second-of-a-kind is still selectable."""

    coverage_decay: float = 0.5
    """How fast an archetype's marginal value falls as the selection already
    covers it. The second coastal place is worth half the first, the third a
    quarter. Uses the same diminishing-returns idea as the asset tiers, for the
    same reason: a set of six coastal towns is not six times a coastal town."""

    catchment_km: float = 60.0
    """Assets within this radius belong to their nearest candidate."""

    absorb_similarity: float = 0.5
    """A site inside another candidate's catchment is absorbed only if its
    archetype profile is at least this similar. Below it the site is retained --
    otherwise a mountain 55 km from a city hands that city a landform it lacks."""

    pin_spacing_km: float = 60.0
    """Physical floor on distance between two printed-map holes, from pin head
    diameter plus drilling tolerance at 1:13.4M."""

    spacing_density_coef: float = 0.35
    """Spacing follows pin density: d_min = max(pin_spacing_km, coef*sqrt(area/n))."""

    hole_budget: int = 3000
    """Total holes on the printed map. Does not bound the web application."""

    quota_area: float = 2.5
    quota_archetypes: float = 0.6
    quota_global: float = 1.2
    quota_area_ref_km2: float = 50_000.0
    quota_min: int = 1
    quota_max: int = 40
    quota_small_country_floor: int = 6
    """Floor for countries clearing a diversity bar despite small area -- without
    it Iceland receives five places for three World Heritage sites."""

    small_country_archetypes: int = 6
    """Archetype count a small country must reach to earn the floor above."""

    score_floor: float = 0.10
    """Minimum composite score, relative to the country maximum, for a candidate to
    enter the web application's database."""

    harvest_spacing_coef: float = 0.35
    """Same-kind harvest spacing: coef * sqrt(area / target). Target grows with
    the kind inventory, not with how completely OSM was crawled."""

    harvest_min_spacing_km: float = 8.0
    """Floor on harvest-only same-kind spacing. Below this, two OSM towns of
    the same kind are a crawl artefact, not two places."""

    harvest_city_pop: float = 50_000.0
    """A settlement this large is a city, not a harvest extra. Density may
    fold villages of the same kind; it must not fold Agadir into a WDPA
    neighbour that happened to be processed first."""

    rarity_country_cap: float = 3.0
    """Ceiling on a landform's rarity weight when the country contains only one
    instance of it. Without this a single volcanic field outranks a capital."""


PARAMS = ModelParams()


# ---------------------------------------------------------------------- vocabularies
ARCHETYPES: dict[str, str] = {
    "A1": "Imperial & historic capital",
    "A2": "Living old town / medina",
    "A3": "Coastal & maritime",
    "A4": "High mountain",
    "A5": "Desert & steppe",
    "A6": "Forest & jungle",
    "A7": "Lake & river",
    "A8": "Volcanic & geothermal",
    "A9": "Wildlife & wilderness",
    "A10": "Sacred & pilgrimage",
    "A11": "Rural vernacular & agrarian",
    "A12": "Modern metropolis & industry",
}

PROFILE_KEYS = ("language", "religion", "vernacular", "cuisine")
"""Components of the distinctiveness profile. Landform class was removed: it
duplicated the natural-setting pillar and was the dominant source of noise."""


# ------------------------------------------------------------------------ asset tiers
H_TIERS: dict[str, float] = {
    "whs_cultural": 10.0,
    "whs_tentative": 4.0,
    "national_top": 3.0,
    "wikidata_multilingual": 2.0,
    "national_other": 1.0,
    "osm_heritage": 0.3,
}

N_TIERS: dict[str, float] = {
    "whs_natural": 10.0,
    "wdpa_iucn_i_ii": 5.0,
    "ramsar_geopark": 3.0,
    "wdpa_iucn_iii_iv": 2.5,
}

L_TIERS: dict[str, float] = {
    "ich_unesco": 8.0,
    "pilgrimage_major": 6.0,
    "cuisine_region": 5.0,
    "festival": 3.0,
    "craft_cluster": 3.0,
    "ich_national": 2.0,
    "institution": 2.0,
    "market": 1.0,
}

ALL_TIERS: dict[str, float] = {**H_TIERS, **N_TIERS, **L_TIERS}

PILLAR_OF: dict[str, str] = (
    {k: "H" for k in H_TIERS} | {k: "N" for k in N_TIERS} | {k: "L" for k in L_TIERS}
)

CROSS_COUNTRY_SOURCES = frozenset(
    {"whs_cultural", "whs_natural", "whs_tentative", "ich_unesco", "wdpa_iucn_i_ii",
     "wdpa_iucn_iii_iv", "ramsar_geopark", "wikidata_multilingual"}
)
"""Only these may inform a comparison BETWEEN countries. National registers have
nationally-set inclusion criteria -- France lists tens of thousands of monuments
where other countries list hundreds -- so letting them cross a border measures
how well a country documented itself, not how much it has."""

NATIONAL_ONLY_SOURCES = frozenset(ALL_TIERS) - CROSS_COUNTRY_SOURCES


# ------------------------------------------------------ landform rarity (global share)
LANDFORM_FREQUENCY: dict[str, float] = {
    "coast": 0.35, "river": 0.45, "lake": 0.20, "forest": 0.30, "mountain": 0.18,
    "desert": 0.06, "volcano": 0.03, "geothermal": 0.015, "glacier": 0.025,
    "fjord": 0.012, "canyon": 0.05, "cave": 0.03, "wetland": 0.07, "steppe": 0.08,
    "island": 0.10, "waterfall": 0.04, "saltflat": 0.008, "rainforest": 0.05,
    "tundra": 0.02, "reef": 0.02, "dunes": 0.025, "gorge": 0.04,
}

REACH_FACTOR: dict[str, float] = {"near": 1.0, "mid": 0.9, "far": 0.7, "remote": 0.5}
REACH_BANDS = ((3.0, "near"), (8.0, "mid"), (24.0, "far"))
"""Hours of travel to the nearest international gateway, and the band it maps to."""


# ----------------------------------------------------------------- disputed territories
# Matching one spelling is how Western Sahara shipped as a country last time.
# Lookups go through canonical_country / canonical_iso3, which fold every alias.
_DISSOLVE_ROWS: tuple[tuple[str, str], ...] = (
    ("W. Sahara", "Morocco"),
    ("Western Sahara", "Morocco"),
    ("Sahrawi", "Morocco"),
    ("Sahrawi Arab Democratic Republic", "Morocco"),
    ("ESH", "Morocco"),
    ("EH", "Morocco"),
)

DISSOLVE_INTO: dict[str, str] = {src: dst for src, dst in _DISSOLVE_ROWS}
"""No contested boundary is drawn: a disputed territory's outline dissolves into
the state administering it and its places keep their own coordinates. Nothing is
deleted. Cases where 'the state administering it' is itself contested -- Kosovo,
Taiwan, Palestine, Northern Cyprus, Somaliland, Crimea, Kashmir -- are deliberately
absent here and require an explicit entry before any global print run."""

DISSOLVE_ISO3: dict[str, str] = {
    "ESH": "MAR",
    "EH": "MAR",
    "SAH": "MAR",
}

NEEDS_EXPLICIT_RULING = (
    "Kosovo", "Taiwan", "Palestine", "N. Cyprus", "Somaliland", "Crimea", "Kashmir",
)

# Parked: Adil fills the table. None means unruled — the build warns, it does
# not adopt Natural Earth's (or anyone else's) opinion.
DISPUTED_RULINGS: dict[str, str | None] = {name: None for name in NEEDS_EXPLICIT_RULING}

_UNRULED_ALIASES: dict[str, str] = {
    "kosovo": "Kosovo", "xkx": "Kosovo",
    "taiwan": "Taiwan", "twn": "Taiwan",
    "palestine": "Palestine", "palestinian territory": "Palestine", "pse": "Palestine",
    "n. cyprus": "N. Cyprus", "northern cyprus": "N. Cyprus",
    "somaliland": "Somaliland",
    "crimea": "Crimea",
    "kashmir": "Kashmir",
}


def canonical_country(label: str) -> str:
    """Fold every dissolve alias onto the host country. Unknown labels pass through."""
    if not label:
        return label
    key = label.strip()
    folded = key.casefold()
    for src, dst in _DISSOLVE_ROWS:
        if src == key or src.casefold() == folded:
            return dst
    return key


def canonical_iso3(iso3: str) -> str:
    """ESH/EH become MAR. Unruled codes are left alone."""
    code = (iso3 or "").strip().upper()
    return DISSOLVE_ISO3.get(code, code)


def same_identity_country(old: str, new: str) -> bool:
    """A dissolve of the country label is the same place, not a reused place_id.

    Stage 0 compares fingerprints including country. Western Sahara places keep
    their ids when the label becomes Morocco; that must not look like reuse.
    """
    if old == new:
        return True
    if canonical_country(old) == canonical_country(new):
        return True
    if canonical_iso3(old) == canonical_iso3(new) and canonical_iso3(old):
        return True
    if canonical_country(old) == new or canonical_iso3(old) == (new or "").upper():
        return True
    return False


def disputed_case(label: str) -> str | None:
    """Canonical unruled-case name, or None if this is not one of those cases."""
    if not label:
        return None
    return _UNRULED_ALIASES.get(label.strip().casefold())


def unruled_hits(labels) -> list[str]:
    """Names from NEEDS_EXPLICIT_RULING that appear and still have no ruling.

    The Parked list owns the ruling. This returns what the build must warn on.
    """
    seen: set[str] = set()
    for label in labels:
        case = disputed_case(str(label))
        if case and DISPUTED_RULINGS.get(case) is None:
            seen.add(case)
    return sorted(seen)
