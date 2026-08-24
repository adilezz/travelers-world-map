"""The candidate set: one place, not two spellings or a suburb and its city.

Scores computed over a list that still contains Dzuunmod and Zuunmod, or Aït
Melloul and Agadir, are arithmetic on a bad list. These transforms run before
scoring. None of them is a world ranking: a weaker place of a kind the country
does not otherwise have is kept.
"""
from __future__ import annotations

import math
import unicodedata
from collections import defaultdict

from twm.config import PARAMS, ModelParams
from twm.geo import GridIndex, haversine_km
from twm.types import Candidate

# Sources that measure how deep a crawl went, not what the country has.
HARVEST_SOURCES = frozenset({"ghsl-ucdb", "osm"})
# Only globally adjudicated lists keep a harvest neighbour from folding.
# Wikidata sitelinks measure how completely Europe was documented, not
# what a country has — that is the Germany/Morocco gap.
PROTECTED_TIERS = frozenset({
    "whs_cultural", "whs_natural", "whs_tentative",
    "wdpa_iucn_i_ii", "wdpa_iucn_iii_iv", "ramsar_geopark",
    "ich_unesco",
})
PROTECTED_SOURCES = frozenset({
    "unesco-whs", "wdpa", "ramsar-geopark",
})

# Same-kind pairs closer than this are one place unless they are enumerated
# as genuinely different kinds. Stage 1 exit test.
CLOSE_PAIR_KM = 2.0


def fold_name(name: str) -> str:
    """Strip marks and case so Dzuunmod and Zuunmod can be compared."""
    nfkd = unicodedata.normalize("NFKD", name or "")
    stripped = "".join(ch for ch in nfkd if not unicodedata.combining(ch))
    return "".join(ch for ch in stripped.casefold() if ch.isalnum())


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def names_are_transliterations(a: str, b: str) -> bool:
    """Same place, two spellings. Equality after folding, or one edit, or a prefix."""
    fa, fb = fold_name(a), fold_name(b)
    if not fa or not fb:
        return False
    if fa == fb:
        return True
    longer, shorter = (fa, fb) if len(fa) >= len(fb) else (fb, fa)
    if shorter and longer.startswith(shorter) and len(longer) - len(shorter) <= 2:
        return True
    limit = 1 if min(len(fa), len(fb)) < 8 else 2
    return levenshtein(fa, fb) <= limit


def population_count(c: Candidate) -> float:
    """Candidate.population is stored in millions by GHSL. CSV rows use headcount."""
    p = float(c.population or 0.0)
    return p * 1_000_000.0 if 0 < p < 10_000 else p


def radius_km_for_population(pop: float) -> float:
    if pop >= 1_000_000:
        return 18.0
    if pop >= 500_000:
        # Agadir is 698k and Aït Melloul sits at 12.6 km. The 250k step
        # of 12 km left them as two places; a half-million city is a metro.
        return 14.0
    if pop >= 250_000:
        return 12.0
    if pop >= 50_000:
        return 8.0
    return 5.0


def primary_kind(c: Candidate) -> str:
    if not c.archetypes:
        return ""
    return max(c.archetypes, key=c.archetypes.get)


def kinds_of(c: Candidate) -> frozenset[str]:
    return frozenset(a for a, w in c.archetypes.items() if w > 0)


def is_harvest_only(c: Candidate) -> bool:
    """True when the record exists because a crawl found it, not a global list."""
    if any(c.tier_counts.get(t) for t in PROTECTED_TIERS):
        return False
    if c.sources & PROTECTED_SOURCES:
        return False
    return True


def is_density_extra(c: Candidate, params: ModelParams = PARAMS) -> bool:
    """Harvest-only and not a city. A WDPA village must not absorb Agadir.

    Wikidata sitelinks do not protect: they measure how completely Europe was
    documented, which is the Germany/Morocco gap the cap exists to close.
    """
    if not is_harvest_only(c):
        return False
    return population_count(c) < params.harvest_city_pop


def _strength(c: Candidate) -> tuple:
    """Who keeps the pin when two records are the same place. Not a world rank."""
    city = 1 if population_count(c) >= PARAMS.harvest_city_pop else 0
    global_n = 0 if is_harvest_only(c) else 1
    return (city, global_n, population_count(c), len(c.sources),
            sum(c.tier_counts.values()), -len(c.name))


def _fold_into(host: Candidate, guest: Candidate) -> None:
    host.merged_from.append(guest.candidate_id)
    host.merged_from.extend(guest.merged_from)
    host.sources |= guest.sources
    host.landforms = tuple(sorted(set(host.landforms) | set(guest.landforms)))
    host.relief_m = max(host.relief_m, guest.relief_m)
    host.coherence = max(host.coherence, guest.coherence)
    host.population = max(host.population, guest.population)
    for tier, n in guest.tier_counts.items():
        host.tier_counts[tier] = host.tier_counts.get(tier, 0) + n
    for a, v in guest.archetypes.items():
        host.archetypes[a] = max(host.archetypes.get(a, 0.0), v)
    if guest.historic_capital:
        host.historic_capital = True


def merge_transliterations(candidates: list[Candidate]) -> tuple[list[Candidate], list[dict]]:
    """Exact-coordinate pairs with matching names are one place.

    Dzuunmod and Zuunmod sit on the same point. Keeping both is a harvest
    artefact, not two kinds of place.
    """
    by_key: dict[tuple, list[Candidate]] = defaultdict(list)
    for c in candidates:
        key = (c.country, round(c.lat, 3), round(c.lon, 3))
        by_key[key].append(c)

    kept: list[Candidate] = []
    log: list[dict] = []
    consumed: set[str] = set()

    for group in by_key.values():
        unused = [c for c in group if c.candidate_id not in consumed]
        unused.sort(key=_strength, reverse=True)
        while unused:
            host = unused.pop(0)
            rest = []
            for guest in unused:
                if names_are_transliterations(host.name, guest.name):
                    _fold_into(host, guest)
                    consumed.add(guest.candidate_id)
                    log.append({
                        "country": host.country, "kept": host.name,
                        "folded": guest.name, "decision": "transliteration",
                        "km": 0.0,
                    })
                else:
                    rest.append(guest)
            unused = rest
            kept.append(host)

    return kept, log


def agglomerate_settlements(
    candidates: list[Candidate],
    smaller_than: float = 0.40,
) -> tuple[list[Candidate], list[dict]]:
    """Fold a suburb into its city when it sits inside the city's radius.

    Radius grows as the city absorbs neighbours — that is how Aït Melloul
    reaches Agadir at 12.6 km after Agadir has already taken closer suburbs.
    Two comparable cities never merge: the neighbour must be under
    `smaller_than` of the head's population.
    """
    settlements = [c for c in candidates if not c.is_site]
    sites = [c for c in candidates if c.is_site]
    settlements.sort(key=lambda c: -population_count(c))

    absorbed = [False] * len(settlements)
    log: list[dict] = []

    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    cell = 0.25
    for i, c in enumerate(settlements):
        grid[(int(c.lat / cell), int(c.lon / cell))].append(i)

    for i, head in enumerate(settlements):
        if absorbed[i]:
            continue
        pop = population_count(head)
        if pop <= 0:
            continue
        grew = True
        while grew:
            grew = False
            R = radius_km_for_population(pop)
            span = int(R / (cell * 111.32)) + 2
            gy, gx = int(head.lat / cell), int(head.lon / cell)
            for dy in range(-span, span + 1):
                for dx in range(-span, span + 1):
                    for j in grid.get((gy + dy, gx + dx), ()):
                        if j == i or absorbed[j]:
                            continue
                        nb = settlements[j]
                        if nb.country != head.country:
                            continue
                        if not is_harvest_only(nb):
                            continue
                        nb_pop = population_count(nb)
                        if nb_pop > pop * smaller_than:
                            continue
                        d = haversine_km(head.lat, head.lon, nb.lat, nb.lon)
                        if d > R:
                            continue
                        absorbed[j] = True
                        raw = pop + nb_pop
                        _fold_into(head, nb)
                        if 0 < (head.population or 0) < 10_000:
                            head.population = raw / 1_000_000.0
                        else:
                            head.population = raw
                        pop = raw
                        grew = True
                        log.append({
                            "country": head.country, "kept": head.name,
                            "folded": nb.name, "decision": "agglomerated",
                            "km": round(d, 1),
                        })

    kept = [c for i, c in enumerate(settlements) if not absorbed[i]]
    return kept + sites, log


def absorb_near_duplicates(
    candidates: list[Candidate],
    max_km: float = CLOSE_PAIR_KM,
) -> tuple[list[Candidate], list[dict]]:
    """Same country, same kinds, closer than `max_km` — one place.

    Different kinds at that distance are left for the enumerated allow-list.
    They are not inferred.
    """
    by_country: dict[str, list[Candidate]] = defaultdict(list)
    for c in candidates:
        by_country[c.country].append(c)

    kept: list[Candidate] = []
    log: list[dict] = []
    consumed: set[str] = set()

    for country, group in by_country.items():
        group = sorted(group, key=_strength, reverse=True)
        index = GridIndex(cell_deg=0.05)
        for c in group:
            if c.candidate_id in consumed:
                continue
            kinds = kinds_of(c)
            hit = None
            for d, other in index.near(c.lat, c.lon, max_km):
                if other.candidate_id == c.candidate_id:
                    continue
                if other.candidate_id in consumed:
                    continue
                if kinds and kinds_of(other) and kinds.isdisjoint(kinds_of(other)):
                    continue
                hit = (d, other)
                break
            if hit is None:
                index.add(c.lat, c.lon, c)
                kept.append(c)
                continue
            dist, host = hit
            _fold_into(host, c)
            consumed.add(c.candidate_id)
            log.append({
                "country": country, "kept": host.name, "folded": c.name,
                "decision": "absorbed", "km": round(dist, 2),
                "similarity": 1.0,
            })

    return kept, log


def harvest_spacing_km(area_km2: float, n_kinds: int,
                       params: ModelParams = PARAMS) -> float:
    """How far apart two harvest-only places of the same kind must sit.

    Derived from area and the kind inventory, not from a score ranking. A
    country that was crawled more thoroughly does not earn a denser list.
    """
    kinds = max(n_kinds, 1)
    target = kinds * (8.0 + 4.0 * math.log(1.0 + max(area_km2, 1.0) / 50_000.0))
    spacing = params.harvest_spacing_coef * math.sqrt(max(area_km2, 1.0) / max(target, 1.0))
    return max(params.harvest_min_spacing_km, spacing)


def cap_harvest_density(
    candidates: list[Candidate],
    areas_km2: dict[str, float],
    params: ModelParams = PARAMS,
) -> tuple[list[Candidate], list[dict]]:
    """Fold OSM/GHSL extras of the same kind that sit inside the harvest spacing.

    A place on a global list (UNESCO, WDPA) is never removed by this cap.
    A city is never removed by this cap — population, not score, is the
    signal. A harvest-only village of a kind the country does not otherwise
    keep is kept, even if its score is low. That is the opposite of a top-N.
    """
    by_country: dict[str, list[Candidate]] = defaultdict(list)
    for c in candidates:
        by_country[c.country].append(c)

    kept: list[Candidate] = []
    log: list[dict] = []

    for country, group in by_country.items():
        n_kinds = len({k for c in group for k in kinds_of(c)})
        area = areas_km2.get(country, 100_000.0)
        spacing = harvest_spacing_km(area, n_kinds, params)
        kinds = max(n_kinds, 1)
        target = kinds * (8.0 + 4.0 * math.log(1.0 + max(area, 1.0) / 50_000.0))
        group = sorted(group, key=_strength, reverse=True)

        def apply(spacing_km: float, pool: list[Candidate]) -> tuple[list[Candidate], list[dict]]:
            kept_here: list[Candidate] = []
            rows: list[dict] = []
            index = GridIndex(cell_deg=0.25)
            for c in pool:
                kind = primary_kind(c)
                if is_density_extra(c, params) and kind:
                    hit = None
                    for d, other in index.near(c.lat, c.lon, spacing_km):
                        if primary_kind(other) == kind:
                            hit = (d, other)
                            break
                    if hit is not None:
                        dist, host = hit
                        _fold_into(host, c)
                        rows.append({
                            "country": country, "kept": host.name, "folded": c.name,
                            "decision": "density", "km": round(dist, 1),
                        })
                        continue
                index.add(c.lat, c.lon, c)
                kept_here.append(c)
            return kept_here, rows

        kept_here, rows = apply(spacing, group)
        # If the country is still a crawl outlier against its own kind
        # inventory, widen same-kind harvest spacing — still not a top-N.
        while len(kept_here) > target * 1.5 and spacing < 80.0:
            spacing = min(80.0, spacing * 1.25)
            kept_here, extra = apply(spacing, kept_here)
            rows.extend(extra)
        kept.extend(kept_here)
        log.extend(rows)

    return kept, log


def close_pairs(candidates: list[Candidate], max_km: float = CLOSE_PAIR_KM) -> list[dict]:
    """Same-country pairs closer than `max_km`, for the allow-list and the gate."""
    by_country: dict[str, list[Candidate]] = defaultdict(list)
    for c in candidates:
        by_country[c.country].append(c)
    out: list[dict] = []
    for country, group in by_country.items():
        index = GridIndex(cell_deg=0.05)
        seen: set[tuple[str, str]] = set()
        for c in group:
            for d, other in index.near(c.lat, c.lon, max_km):
                if other.candidate_id == c.candidate_id:
                    continue
                pair = tuple(sorted((c.candidate_id, other.candidate_id)))
                if pair in seen:
                    continue
                seen.add(pair)
                ka, kb = sorted(kinds_of(c)), sorted(kinds_of(other))
                out.append({
                    "country": country,
                    "a": c.name, "b": other.name,
                    "id_a": c.candidate_id, "id_b": other.candidate_id,
                    "kinds_a": ka, "kinds_b": kb,
                    "same_kind": bool(set(ka) & set(kb)),
                    "km": round(d, 3),
                })
            index.add(c.lat, c.lon, c)
    return sorted(out, key=lambda r: (r["km"], r["country"], r["a"]))


def absorption_by_country(log: list[dict]) -> dict[str, int]:
    """Country → how many records that country absorbed. Empty means it had none."""
    counts: dict[str, int] = defaultdict(int)
    for row in log:
        if row.get("decision") in {"absorbed", "agglomerated", "transliteration", "density"}:
            counts[row["country"]] += 1
    return dict(counts)


def summarise_candidate_set(log: list[dict]) -> dict[str, int]:
    out = defaultdict(int)
    for row in log:
        out[row.get("decision", "")] += 1
    return dict(out)
