"""Assigning assets to candidates, and absorbing sites that are not really places.

Two rules, both learned the hard way:

* Every asset belongs to exactly ONE candidate -- the nearest within the catchment
  radius. Without this, two neighbouring cities both claim the same cathedral and
  both look twice as endowed as they are.

* A site inside another candidate's catchment is absorbed only if its archetype
  profile is similar. A naive radius rule folds a 4,000 m mountain into a city on
  a plain 55 km away, and hands that city a landform it does not have.
"""
from __future__ import annotations

from twm.config import PARAMS, ModelParams
from twm.geo import GridIndex, haversine_km
from twm.scoring import archetype_similarity, tiered_sum
from twm.types import Asset, Candidate


def assign_assets(candidates: list[Candidate], assets: list[Asset],
                  params: ModelParams = PARAMS) -> tuple[list[Candidate], list[Asset]]:
    """Attach each asset to its nearest candidate within the catchment.

    Returns the candidates (mutated in place) and the assets that fell outside
    every catchment -- those are orphans, and the caller decides whether each
    becomes a site candidate of its own.
    """
    index = GridIndex(cell_deg=1.0)
    for c in candidates:
        index.add(c.lat, c.lon, c)

    orphans: list[Asset] = []
    for a in assets:
        hit = index.nearest(a.lat, a.lon, params.catchment_km)
        if hit is None:
            orphans.append(a)
            continue
        _, cand = hit
        cand.tier_counts[a.tier] = cand.tier_counts.get(a.tier, 0) + 1
        if a.source:
            cand.sources.add(a.source)
    return candidates, orphans


def compute_coherence(candidate: Candidate, assets: list[Asset],
                      cell_km: float = 1.0) -> float:
    """Share of a candidate's heritage assets inside its densest ~1 km cell.

    An intact historic quarter is worth more to a traveler than the same number
    of monuments scattered across a metropolitan area, and this is measurable
    straight from coordinates.
    """
    pts = [(a.lat, a.lon) for a in assets if a.pillar == "H"]
    if len(pts) < 2:
        return 1.0 if pts else 0.0
    deg = cell_km / 111.32
    buckets: dict[tuple[int, int], int] = {}
    for lat, lon in pts:
        key = (int(lat / deg), int(lon / deg))
        buckets[key] = buckets.get(key, 0) + 1
    return max(buckets.values()) / len(pts)


def absorb_sites(candidates: list[Candidate],
                 params: ModelParams = PARAMS) -> tuple[list[Candidate], list[dict]]:
    """Fold sites into a nearby settlement when they are the same experience.

    On absorption the merged place takes the name and pin of whichever component
    is stronger, which is why output reads like "Ait Benhaddou / Ouarzazate"
    rather than burying the famous half inside the administrative half.

    Returns the surviving candidates and a log of every decision, kept because
    absorption silently changes what a country looks like and needs auditing.
    """
    settlements = [c for c in candidates if not c.is_site]
    index = GridIndex(cell_deg=1.0)
    for s in settlements:
        index.add(s.lat, s.lon, s)

    kept: list[Candidate] = []
    log: list[dict] = []

    def bulk(c: Candidate) -> float:
        return sum(
            tiered_sum(c.tier_counts_for(p), params.delta) for p in ("H", "N", "L")
        )

    for c in candidates:
        if not c.is_site:
            kept.append(c)
            continue
        hit = index.nearest(c.lat, c.lon, params.catchment_km)
        if hit is None:
            kept.append(c)
            continue
        dist, host = hit
        sim = archetype_similarity(c, host)
        if sim < params.absorb_similarity:
            kept.append(c)
            log.append({"site": c.name, "host": host.name, "country": c.country,
                        "km": round(dist), "similarity": round(sim, 2),
                        "decision": "retained"})
            continue

        for tier, n in c.tier_counts.items():
            host.tier_counts[tier] = host.tier_counts.get(tier, 0) + n
        host.landforms = tuple(sorted(set(host.landforms) | set(c.landforms)))
        host.relief_m = max(host.relief_m, c.relief_m)
        host.coherence = max(host.coherence, c.coherence)
        host.sources |= c.sources
        for a, v in c.archetypes.items():
            # the absorbed site's character survives at a discount -- it is part
            # of the host place now, not the whole of it
            host.archetypes[a] = max(host.archetypes.get(a, 0.0), v * 0.8)

        if bulk(c) > bulk(host):
            host.name = f"{c.name} / {host.name}"
            host.lat, host.lon = c.lat, c.lon
        else:
            host.name = f"{host.name} (+{c.name})"
        host.merged_from.append(c.candidate_id)
        log.append({"site": c.name, "host": host.name, "country": c.country,
                    "km": round(dist), "similarity": round(sim, 2),
                    "decision": "absorbed"})

    return kept, log


def orphans_to_sites(orphans: list[Asset], min_weight: float = 4.0) -> list[Candidate]:
    """Promote significant assets with no candidate nearby into site candidates.

    Clusters orphans that sit within a catchment of each other so a national park
    reported by three sources becomes one place rather than three.
    """
    significant = [a for a in orphans if a.weight >= min_weight]
    significant.sort(key=lambda a: -a.weight)
    used: set[int] = set()
    out: list[Candidate] = []
    for i, a in enumerate(significant):
        if i in used:
            continue
        group = [a]
        used.add(i)
        for j in range(i + 1, len(significant)):
            if j in used:
                continue
            b = significant[j]
            if haversine_km(a.lat, a.lon, b.lat, b.lon) <= PARAMS.catchment_km:
                group.append(b)
                used.add(j)
        counts: dict[str, int] = {}
        for g in group:
            counts[g.tier] = counts.get(g.tier, 0) + 1
        out.append(Candidate(
            candidate_id=f"site:{a.asset_id}", name=a.name or a.asset_id,
            country=a.country, lat=a.lat, lon=a.lon, is_site=True,
            tier_counts=counts, sources={g.source for g in group if g.source},
        ))
    return out


def assign_area_assets(candidates: list[Candidate], assets: list[Asset],
                       max_per_asset: int = 40) -> int:
    """Attach assets that cover a REGION rather than a point.

    A cuisine region or an intangible-heritage practice is not located at a
    coordinate -- it is practised across an area, and every candidate inside that
    area genuinely has it. Assigning such an asset to its nearest candidate alone
    would give one town the whole of its region's cooking and its neighbours none.

    Capped per asset so a carelessly large radius cannot flood a country.
    """
    index = GridIndex(cell_deg=1.0)
    for c in candidates:
        index.add(c.lat, c.lon, c)

    attached = 0
    for a in assets:
        radius = float(a.extra.get("radius_km") or 0.0)
        if radius <= 0:
            continue
        for _, cand in index.near(a.lat, a.lon, radius)[:max_per_asset]:
            cand.tier_counts[a.tier] = cand.tier_counts.get(a.tier, 0) + 1
            if a.source:
                cand.sources.add(a.source)
            attached += 1
    return attached


def split_point_and_area(assets: list[Asset]) -> tuple[list[Asset], list[Asset]]:
    area = [a for a in assets if float(a.extra.get("radius_km") or 0) > 0]
    point = [a for a in assets if float(a.extra.get("radius_km") or 0) <= 0]
    return point, area
