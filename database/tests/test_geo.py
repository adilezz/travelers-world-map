"""The arithmetic tying the database to the physical object."""
import pytest

from twm.geo import GridIndex, PrintedMap, haversine_km, min_spacing_km


def test_haversine_against_known_pairs():
    assert haversine_km(48.8566, 2.3522, 48.8049, 2.1204) == pytest.approx(17, abs=2)
    assert haversine_km(27.7172, 85.3240, 27.6710, 85.4298) == pytest.approx(12, abs=2)
    assert haversine_km(0, 0, 0, 0) == 0.0


def test_printed_map_scale():
    pm = PrintedMap(3.0)
    assert pm.km_per_mm == pytest.approx(13.4, abs=0.1)
    assert pm.min_place_separation_km == pytest.approx(60, abs=1)
    assert pm.scale_denominator == pytest.approx(13.4e6, rel=0.01)


def test_a_dense_valley_needs_a_large_inset():
    """Three cities 12 km apart cannot be three holes on a 3 m map."""
    pm = PrintedMap(3.0)
    assert pm.width_m_for_separation(15.0) == pytest.approx(12.0, abs=0.2)
    assert pm.inset_factor_for(15.0) == pytest.approx(4.0, abs=0.1)
    assert pm.inset_factor_for(200.0) == 1.0


def test_spacing_follows_density_not_raw_area():
    """Scaling by raw area gave ~470 km across a continental country, which would
    forbid two famous canyons 250 km apart from both existing."""
    assert min_spacing_km(446_550, 8) == pytest.approx(83, abs=2)
    assert min_spacing_km(9_834_000, 30) < 250
    assert min_spacing_km(1_000, 1) == 60.0, "never below the physical floor"


def test_grid_index_finds_neighbours_across_cell_edges():
    idx = GridIndex(cell_deg=1.0)
    idx.add(0.999, 0.999, "a")
    idx.add(1.001, 1.001, "b")
    hits = idx.near(0.999, 0.999, 60.0)
    assert {p for _, p in hits} == {"a", "b"}


def test_grid_index_handles_high_latitude_convergence():
    idx = GridIndex(cell_deg=1.0)
    idx.add(78.0, 10.0, "a")
    idx.add(78.0, 12.0, "b")   # ~46 km apart at this latitude
    assert len(idx.near(78.0, 10.0, 60.0)) == 2
