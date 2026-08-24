"""Core record types flowing through the pipeline.

The pipeline is a sequence of pure-ish transforms over these:

    Asset      -- one heritage/natural/cultural thing, from one source
    Candidate  -- somewhere that could become a place, before scoring
    Scored     -- a candidate with its pillar and composite scores
    Place      -- what the app and the printed map consume
    Territory  -- a cluster of places forming one physical tile

Every Asset keeps its `source` so a later licence audit can filter the database
rather than rebuild it. This is cheap now and expensive later.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Pillar = Literal["H", "N", "L"]
ReachBand = Literal["near", "mid", "far", "remote"]
AccessStatus = Literal["open", "restricted", "closed"]


@dataclass(slots=True)
class Asset:
    """One thing worth travelling for, as reported by one source."""

    asset_id: str
    tier: str
    """Key into config.ALL_TIERS -- determines both weight and pillar."""
    lat: float
    lon: float
    name: str = ""
    source: str = ""
    """Provenance for licence audit: 'unesco-whs', 'osm', 'wikidata', ..."""
    source_url: str = ""
    retrieved: str = ""
    """ISO date. Scraped records must carry this."""
    country: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def pillar(self) -> Pillar:
        from twm.config import PILLAR_OF

        return PILLAR_OF[self.tier]  # type: ignore[return-value]

    @property
    def weight(self) -> float:
        from twm.config import ALL_TIERS

        return ALL_TIERS[self.tier]


@dataclass(slots=True)
class Candidate:
    """Somewhere that could become a place."""

    candidate_id: str
    name: str
    country: str
    lat: float
    lon: float
    is_site: bool = False
    """True for a natural or archaeological feature with no settlement attached.
    Site places are pinned at their own coordinates, never at a proxy town."""
    population: float = 0.0
    """Millions. Never a scoring term -- an input to the distinctiveness
    saturation weight and the final tie-break only."""

    # assets, after catchment assignment
    tier_counts: dict[str, int] = field(default_factory=dict)
    landforms: tuple[str, ...] = ()
    relief_m: float = 0.0
    coherence: float = 0.0
    """Share of heritage assets inside the densest 1 km2 cell, 0..1."""

    historic_capital: bool = False
    """Seat of a historic state. Comes from Wikidata 'capital of' -- it cannot be
    inferred from heritage inscriptions, and inferring it made every inscribed
    town look like an imperial capital."""

    # distinctiveness profile
    profile: dict[str, str] = field(default_factory=dict)

    # feasibility
    reach: ReachBand = "near"
    has_lodging: bool = True
    access: AccessStatus = "open"
    overtourism: bool = False
    best_months: tuple[int, ...] = ()
    """Metadata for trip planning. Never a score penalty: a place reachable four
    months a year is a place with a window."""

    archetypes: dict[str, float] = field(default_factory=dict)
    merged_from: list[str] = field(default_factory=list)
    sources: set[str] = field(default_factory=set)

    def tier_counts_for(self, pillar: Pillar) -> dict[float, int]:
        """Weight -> count, restricted to one pillar. Input to the tiered sum."""
        from twm.config import ALL_TIERS, PILLAR_OF

        out: dict[float, int] = {}
        for tier, n in self.tier_counts.items():
            if PILLAR_OF.get(tier) != pillar or n <= 0:
                continue
            w = ALL_TIERS[tier]
            out[w] = out.get(w, 0) + n
        return out


@dataclass(slots=True)
class Scored:
    """A candidate with its scores. Pillar values are country-relative."""

    candidate: Candidate
    h_raw: float = 0.0
    n_raw: float = 0.0
    l_raw: float = 0.0
    h: float = 0.0
    n: float = 0.0
    liv: float = 0.0
    distinctiveness: float = 1.0
    feasibility: float = 1.0
    base: float = 0.0
    score: float = 0.0

    @property
    def name(self) -> str:
        return self.candidate.name

    @property
    def country(self) -> str:
        return self.candidate.country


@dataclass(slots=True)
class Place:
    """A row in the shipped database."""

    place_id: str
    name: str
    country: str
    lat: float
    lon: float
    is_site: bool
    score: int
    """0-100, relative to the highest-scoring place in the same country."""
    archetypes: list[str]
    archetype_weights: list[float]
    whs: int
    reach: str
    best_months: list[int]
    on_printed_map: bool
    """True for the subset that survives the hole budget and spacing rule."""
    printed_rank: int | None = None
    territory_id: str | None = None
    region_id: str | None = None
    disputed: str | None = None
    sources: list[str] = field(default_factory=list)
    merged_from: list[str] = field(default_factory=list)


@dataclass(slots=True)
class Territory:
    """A cluster of places forming one physical tile."""

    territory_id: str
    name: str
    country: str
    place_ids: list[str]
    admin_units: list[str]
    """The official units merged to form it -- territories are built by merging
    real administrative boundaries, never drawn freehand."""
    geometry_wkt: str = ""
    dominant_archetypes: list[str] = field(default_factory=list)
    printable: bool = True
    """False when the tile falls below the minimum handleable size at map scale."""


@dataclass(slots=True)
class Region:
    """One cell of the web tessellation. Empty cells are kept."""

    region_id: str
    name: str
    country: str
    place_ids: list[str]
    admin_units: list[str]
    geometry_wkt: str = ""
