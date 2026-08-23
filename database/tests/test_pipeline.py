"""End-to-end behaviour, on the pilot fixture. No network, no credentials."""

from twm.assets import absorb_sites, assign_area_assets, split_point_and_area
from twm.config import PARAMS
from twm.geo import haversine_km, min_spacing_km
from twm.pipeline import build
from twm.select import redundancy
from twm.types import Asset, Candidate


def test_build_runs_and_produces_both_renderings(candidates, countries):
    result = build(candidates, [], countries)
    assert result.places, "pipeline produced nothing"
    printed = result.printed
    assert printed, "no place reached the printed map"
    assert len(printed) < len(result.places), (
        "the printed map must be a strict subset -- if it is not, the hole "
        "budget is not binding and the two-rendering split has collapsed"
    )
    for country in countries:
        assert result.for_country(country), f"{country} produced no places"


def test_every_country_gets_at_least_one_hole(candidates, countries):
    result = build(candidates, [], countries)
    for country in countries:
        printed = [p for p in result.for_country(country) if p.on_printed_map]
        assert printed, f"{country} has no hole -- a buyer's own country must appear"


def test_printed_selection_respects_physical_spacing(candidates, countries):
    """Two holes closer than the pin-spacing floor cannot both be drilled."""
    result = build(candidates, [], countries)
    for country, facts in countries.items():
        chosen = [p for p in result.for_country(country) if p.on_printed_map]
        if len(chosen) < 2:
            continue
        floor = min_spacing_km(facts.area_km2, len(chosen))
        closest = min(
            haversine_km(a.lat, a.lon, b.lat, b.lon)
            for i, a in enumerate(chosen) for b in chosen[i + 1:]
        )
        assert closest >= floor * 0.999, (
            f"{country}: two holes {closest:.0f} km apart, floor is {floor:.0f} km"
        )


def test_coverage_selection_beats_ranking_at_a_realistic_quota(candidates, countries):
    """The whole reason selection is not a ranking.

    Measured at a realistic printed-map quota. The fixture holds five countries,
    so a pro-rated world budget hands each of them a third to a half of its own
    candidate pool -- at that ratio almost everything is selected and the two
    strategies necessarily converge. The printed map is never in that regime: it
    picks a handful from hundreds.

    Compared against a ranking baseline under the SAME spacing constraint.
    Comparing against an unconstrained ranking would flatter the baseline, which
    could take three neighbouring places of three kinds and look diverse while
    being unbuildable.
    """
    from twm.scoring import covered_archetypes
    from twm.select import select_by_rank, select_for_printed_map

    result = build(candidates, [], countries)
    for n in (5, 8):
        wins, kinds_cov, kinds_rank = 0, 0, 0
        for country, facts in countries.items():
            scored = result.scored[country]
            cov = select_for_printed_map(scored, n, facts.area_km2)
            rank = select_by_rank(scored, n, facts.area_km2)
            r_cov, r_rank = redundancy(cov), redundancy(rank)
            assert r_cov <= r_rank + 0.02, (
                f"{country} at n={n}: coverage {r_cov:.3f} is more redundant "
                f"than ranking {r_rank:.3f}"
            )
            wins += r_cov < r_rank - 1e-6
            kinds_cov += len(covered_archetypes([s.candidate for s in cov]))
            kinds_rank += len(covered_archetypes([s.candidate for s in rank]))

        assert wins >= 3, f"at n={n} coverage improved only {wins} of 5 countries"
        assert kinds_cov > kinds_rank, (
            f"at n={n} coverage reached {kinds_cov} archetypes, ranking {kinds_rank}"
        )


def test_coverage_selection_halves_redundancy_where_it_matters(candidates, countries):
    """A country with real variety is where the mechanism has to earn its keep."""
    from twm.select import select_by_rank, select_for_printed_map

    result = build(candidates, [], countries)
    scored = result.scored["Morocco"]
    area = countries["Morocco"].area_km2
    cov = redundancy(select_for_printed_map(scored, 5, area))
    rank = redundancy(select_by_rank(scored, 5, area))
    assert cov < rank * 0.75, (
        f"expected a large diversity gain in a varied country: {cov:.3f} vs {rank:.3f}"
    )


def test_absorption_retains_a_divergent_site(candidates):
    """A mountain 55 km from a city on a plain must stay its own place."""
    from twm.archetypes import derive_archetypes

    for c in candidates:
        c.archetypes = derive_archetypes(c)
    kept, log = absorb_sites(list(candidates))
    retained = [r for r in log if r["decision"] == "retained"]
    absorbed = [r for r in log if r["decision"] == "absorbed"]
    assert retained, "no site was retained -- the similarity gate is not firing"
    assert absorbed, "no site was absorbed -- the catchment rule is not firing"
    for r in retained:
        assert r["similarity"] < PARAMS.absorb_similarity


def test_area_assets_reach_every_candidate_in_range():
    """A cuisine region belongs to a region, not to its nearest town."""
    cands = [Candidate(candidate_id=f"c{i}", name=f"c{i}", country="X",
                       lat=10.0 + i * 0.2, lon=10.0) for i in range(4)]
    region = Asset(asset_id="cui-1", tier="cuisine_region", lat=10.3, lon=10.0,
                   extra={"radius_km": 80})
    point, area = split_point_and_area([region])
    assert not point and len(area) == 1
    assign_area_assets(cands, area)
    hit = [c for c in cands if c.tier_counts.get("cuisine_region")]
    assert len(hit) == 4, "every candidate inside the radius must receive it"


def test_score_floor_keeps_the_app_wider_than_the_map(candidates, countries):
    result = build(candidates, [], countries)
    for country in countries:
        in_app = result.for_country(country)
        printed = [p for p in in_app if p.on_printed_map]
        assert len(in_app) > len(printed), (
            f"{country}: the app must hold places the printed map cannot"
        )


def test_place_ids_are_unique(candidates, countries):
    result = build(candidates, [], countries)
    ids = [p.place_id for p in result.places]
    assert len(ids) == len(set(ids))
