"""Stage 1: the candidate set is one place, not a crawl artefact.

Each test quotes the rule it defends. Density is never a top-N.
"""
from twm.candidates import (
    absorb_near_duplicates,
    agglomerate_settlements,
    absorption_by_country,
    cap_harvest_density,
    close_pairs,
    harvest_spacing_km,
    merge_transliterations,
    names_are_transliterations,
)
from twm.types import Candidate


def C(**kw):
    defaults = dict(candidate_id="x", name="x", country="X", lat=0.0, lon=0.0)
    defaults.update(kw)
    return Candidate(**defaults)


def test_dzuunmod_and_zuunmod_are_one_place():
    """Exact-coordinate transliteration pairs merge. Doc 5 §3.7."""
    a = C(candidate_id="mn-d", name="Dzuunmod", country="Mongolia",
          lat=47.7069, lon=106.9528, sources={"ghsl-ucdb"})
    b = C(candidate_id="mn-z", name="Zuunmod", country="Mongolia",
          lat=47.7069, lon=106.9528, sources={"ghsl-ucdb", "osm"})
    kept, log = merge_transliterations([a, b])
    assert len(kept) == 1
    assert {a.candidate_id, b.candidate_id} <= set(kept[0].merged_from) | {kept[0].candidate_id}
    assert any(r["decision"] == "transliteration" and r["country"] == "Mongolia" for r in log)


def test_transliteration_names_match():
    assert names_are_transliterations("Dzuunmod", "Zuunmod")
    assert not names_are_transliterations("Fes", "Meknes")


def test_ait_melloul_folds_into_agadir():
    """Agglomeration folds a suburb into its city. Review §4.1."""
    agadir = C(candidate_id="agadir", name="Agadir", country="Morocco",
               lat=30.4202, lon=-9.5982, population=1_044_429,
               archetypes={"A3": 0.9})
    melloul = C(candidate_id="melloul", name="Aït Melloul", country="Morocco",
                lat=30.3416, lon=-9.5036, population=187_652,
                archetypes={"A3": 0.9})
    kept, log = agglomerate_settlements([agadir, melloul])
    names = {c.name for c in kept}
    assert "Agadir" in names
    assert "Aït Melloul" not in names
    by_country = absorption_by_country(log)
    assert by_country["Morocco"] >= 1
    assert any(r["folded"] == "Aït Melloul" for r in log)


def test_ait_melloul_folds_at_agadir_published_population():
    """The published Agadir is 698k, not 1M. 12.6 km must still fold. Review §4.1."""
    agadir = C(candidate_id="agadir", name="Agadir", country="Morocco",
               lat=30.4202, lon=-9.5982, population=698_310)
    melloul = C(candidate_id="melloul", name="Aït Melloul", country="Morocco",
                lat=30.3416, lon=-9.5036, population=187_652)
    kept, log = agglomerate_settlements([agadir, melloul])
    assert "Agadir" in {c.name for c in kept}
    assert "Aït Melloul" not in {c.name for c in kept}
    assert any(r["folded"] == "Aït Melloul" for r in log)


def test_agglomeration_radius_grows_with_the_city():
    """A suburb just outside the first radius folds after closer suburbs join."""
    agadir = C(candidate_id="agadir", name="Agadir", country="Morocco",
               lat=30.4202, lon=-9.5982, population=698_310)
    melloul = C(candidate_id="melloul", name="Aït Melloul", country="Morocco",
                lat=30.3416, lon=-9.5036, population=187_652)
    inners = [
        C(candidate_id=f"in{i}", name=f"Inner {i}", country="Morocco",
          lat=30.4202 + 0.01 * (i + 1) * 0.2, lon=-9.5982,
          population=90_000)
        for i in range(4)
    ]
    kept, log = agglomerate_settlements([agadir, melloul, *inners])
    assert "Aït Melloul" not in {c.name for c in kept}
    assert any(r["folded"] == "Aït Melloul" for r in log)


def test_two_comparable_cities_do_not_merge():
    """Agglomeration must not glue two cities of similar size."""
    a = C(candidate_id="a", name="Rabat", country="Morocco",
          lat=34.0132, lon=-6.8326, population=500_000)
    b = C(candidate_id="b", name="Salé", country="Morocco",
          lat=34.0531, lon=-6.7985, population=400_000)
    kept, _ = agglomerate_settlements([a, b])
    assert {c.name for c in kept} == {"Rabat", "Salé"}


def test_same_kind_under_2km_merges():
    """Zero same-kind pairs under 2 km. Stage 1 exit test."""
    a = C(candidate_id="a", name="Old spelling", country="X",
          lat=10.0, lon=10.0, archetypes={"A5": 0.9}, sources={"osm"})
    b = C(candidate_id="b", name="New spelling", country="X",
          lat=10.001, lon=10.001, archetypes={"A5": 0.9}, sources={"osm"})
    kept, log = absorb_near_duplicates([a, b])
    assert len(kept) == 1
    assert any(r["decision"] == "absorbed" for r in log)


def test_different_kinds_under_2km_are_not_inferred():
    """A city and a mountain at 1 km stay two places until someone enumerates them."""
    city = C(candidate_id="city", name="Town", country="X",
             lat=10.0, lon=10.0, archetypes={"A12": 0.9}, sources={"unesco-whs"})
    peak = C(candidate_id="peak", name="Peak", country="X",
             lat=10.005, lon=10.0, archetypes={"A4": 0.9}, is_site=True,
             sources={"wdpa"})
    kept, _ = absorb_near_duplicates([city, peak])
    assert {c.name for c in kept} == {"Town", "Peak"}
    pairs = close_pairs(kept)
    assert pairs
    assert all(not p["same_kind"] for p in pairs)


def test_density_cap_is_not_a_top_n():
    """A low-score unique kind survives; a high-score harvest duplicate folds.

    'Do not solve density by truncating to a top-N.' Stage 1.
    """
    # High-score harvest A11 pair, 10 km apart — density should fold one.
    a = C(candidate_id="h1", name="Village A", country="Germania",
          lat=50.0, lon=10.0, archetypes={"A11": 0.9}, sources={"osm"},
          tier_counts={"osm_heritage": 20})
    b = C(candidate_id="h2", name="Village B", country="Germania",
          lat=50.08, lon=10.0, archetypes={"A11": 0.9}, sources={"osm"},
          tier_counts={"osm_heritage": 18})
    # Low-score unique mountain, harvest-only — must survive.
    peak = C(candidate_id="pk", name="Lone peak", country="Germania",
             lat=51.5, lon=11.0, archetypes={"A4": 0.9}, sources={"osm"},
             tier_counts={"osm_heritage": 1})
    kept, log = cap_harvest_density(
        [a, b, peak], {"Germania": 357_000.0},
    )
    names = {c.name for c in kept}
    assert "Lone peak" in names
    assert any(r["decision"] == "density" for r in log)
    assert len([c for c in kept if primary_is(c, "A11")]) == 1


def primary_is(c, kind):
    from twm.candidates import primary_kind
    return primary_kind(c) == kind


def test_density_does_not_fold_a_city_into_a_protected_village():
    """Aït Melloul is Agadir — Agadir is not Ben Jerrar. Stage 1.

    Ben Jerrar carries WDPA so it sorts as 'protected'. Agadir is harvest-only
    and a million people. The cap must not invert that.
    """
    agadir = C(candidate_id="agadir", name="Agadir", country="Morocco",
               lat=30.4202, lon=-9.5982, population=698_310,
               archetypes={"A3": 0.9, "A5": 0.6},
               sources={"ghsl-ucdb", "osm", "wikidata"})
    jerrar = C(candidate_id="jerrar", name="Ben Jerrar", country="Morocco",
               lat=30.2622, lon=-9.5038, population=12_000,
               archetypes={"A3": 0.9, "A9": 0.68},
               sources={"ghsl-ucdb", "osm", "wdpa", "wikidata"})
    kept, log = cap_harvest_density(
        [agadir, jerrar], {"Morocco": 446_550.0},
    )
    names = {c.name for c in kept}
    assert "Agadir" in names
    assert "Ben Jerrar" in names
    assert not any(r["folded"] == "Agadir" for r in log)


def test_density_does_not_fold_sale_into_rabat():
    """Comparable cities stay after agglomeration; density must not undo that."""
    rabat = C(candidate_id="rabat", name="Rabat", country="Morocco",
              lat=34.0132, lon=-6.8326, population=500_000,
              archetypes={"A3": 0.9},
              sources={"ghsl-ucdb", "osm", "unesco-whs", "wikidata"})
    sale = C(candidate_id="sale", name="Salé", country="Morocco",
             lat=34.0531, lon=-6.7985, population=400_000,
             archetypes={"A3": 0.9},
             sources={"ghsl-ucdb", "osm", "wikidata"})
    kept, _ = cap_harvest_density([rabat, sale], {"Morocco": 446_550.0})
    assert {c.name for c in kept} == {"Rabat", "Salé"}


def test_harvest_spacing_grows_with_kinds_not_crawl_depth():
    """Germany and Morocco with the same kind count get similar spacing."""
    de = harvest_spacing_km(357_022, 8)
    ma = harvest_spacing_km(446_550, 7)
    assert de > 8 and ma > 8
    assert abs(de - ma) / max(de, ma) < 0.35


def test_absorption_log_names_a_country():
    """The absorption log names a country and a count. Stage 1 exit test."""
    a = C(candidate_id="d", name="Dzuunmod", country="Mongolia",
          lat=47.7069, lon=106.9528)
    b = C(candidate_id="z", name="Zuunmod", country="Mongolia",
          lat=47.7069, lon=106.9528)
    _, log = merge_transliterations([a, b])
    counts = absorption_by_country(log)
    assert counts["Mongolia"] == 1
