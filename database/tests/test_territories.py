"""Territory derivation -- the physical tiles."""
import pytest

shapely = pytest.importorskip("shapely")
from shapely.geometry import Polygon  # noqa: E402

from twm.territories import (  # noqa: E402
    AdminUnit,
    assign_places,
    build_territories,
    dissolve_disputed,
)
from twm.types import Place  # noqa: E402


def _place(pid, lat, lon, country="Testland", arch=("A2",)):
    return Place(place_id=pid, name=pid, country=country, lat=lat, lon=lon,
                 is_site=False, score=50, archetypes=list(arch),
                 archetype_weights=[0.9] * len(arch), whs=0, reach="near",
                 best_months=[], on_printed_map=True)


def _grid_units(n=4, country="Testland"):
    return [AdminUnit(unit_id=f"u{i}", name=f"Unit {i}", country=country,
                      geometry=Polygon([(i, 0), (i + 1, 0), (i + 1, 1), (i, 1)]))
            for i in range(n)]


def test_undersized_units_merge_until_they_carry_enough_places():
    units = _grid_units(4)
    places = [_place(f"p{i}", 0.5, i + 0.5) for i in range(4)]
    assign_places(units, places)
    territories = build_territories(units, places)
    assert territories
    for t in territories:
        assert len(t.place_ids) >= 3 or len(places) < 3


def test_a_tile_never_crosses_an_international_border():
    """Non-negotiable: a magnetic object spanning two countries is both a
    political liability and a physical nuisance."""
    units = _grid_units(2, "Alpha") + [
        AdminUnit(unit_id="b0", name="Beta 0", country="Beta",
                  geometry=Polygon([(2, 0), (3, 0), (3, 1), (2, 1)]))]
    places = [_place("a0", 0.5, 0.5, "Alpha"), _place("a1", 0.5, 1.5, "Alpha"),
              _place("b0", 0.5, 2.5, "Beta")]
    assign_places(units, places)
    territories = build_territories(units, places)
    for t in territories:
        countries = {p.country for p in places if p.place_id in t.place_ids}
        assert len(countries) <= 1, f"tile {t.territory_id} spans {countries}"


def test_disputed_territory_dissolves_into_its_administering_state():
    """No contested boundary is drawn; the places inside are never deleted."""
    units = [AdminUnit(unit_id="ws", name="Region", country="W. Sahara",
                       geometry=Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]))]
    dissolve_disputed(units)
    assert units[0].country == "Morocco"


def test_a_tile_too_small_to_hold_is_flagged_not_dropped():
    tiny = [AdminUnit(unit_id="t", name="Tiny", country="Testland",
                      geometry=Polygon([(0, 0), (0.2, 0), (0.2, 0.2), (0, 0.2)]))]
    places = [_place(f"p{i}", 0.1, 0.1 + i * 0.01) for i in range(3)]
    assign_places(tiny, places)
    territories = build_territories(tiny, places)
    assert territories, "an unprintable tile must still exist in the data"
    assert territories[0].printable is False
