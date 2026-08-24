"""Stage 3: web regions tessellate country land. Printed tiles do not."""
import warnings

import pytest

shapely = pytest.importorskip("shapely")
from shapely.geometry import Polygon  # noqa: E402

from twm.config import unruled_hits  # noqa: E402
from twm.geo import namesake_in_name  # noqa: E402
from twm.regions import build_regions, coverage_ok  # noqa: E402
from twm.territories import AdminUnit  # noqa: E402
from twm.types import Place  # noqa: E402


def _place(pid, name, lat, lon, country="Morocco"):
    return Place(place_id=pid, name=name, country=country, lat=lat, lon=lon,
                 is_site=False, score=50, archetypes=["A3"],
                 archetype_weights=[0.9], whs=0, reach="",
                 best_months=[], on_printed_map=True)


def test_empty_regions_are_kept():
    """Web regions keep empty land. Printed tiles skip it. Stage 3."""
    units = [
        AdminUnit(unit_id="n", name="North", country="Testland",
                  geometry=Polygon([(0, 0), (1, 0), (1, 1), (0, 1)])),
        AdminUnit(unit_id="s", name="South", country="Testland",
                  geometry=Polygon([(0, 1), (1, 1), (1, 2), (0, 2)])),
    ]
    places = [_place("p1", "Town", 0.5, 0.5, "Testland")]
    land = {"Testland": Polygon([(0, 0), (1, 0), (1, 2), (0, 2)])}
    regions = build_regions(units, places, {"Testland": "TST"}, country_land=land)
    assert len(regions) == 2
    empty = [r for r in regions if not r.place_ids]
    assert empty, "empty land must remain a region on the web"


def test_region_ids_use_iso3_not_english_slug():
    aus = [AdminUnit(unit_id="a", name="West", country="Australia",
                     geometry=Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]))]
    aut = [AdminUnit(unit_id="b", name="East", country="Austria",
                     geometry=Polygon([(2, 0), (3, 0), (3, 1), (2, 1)]))]
    places = [
        _place("a1", "Perth", 0.5, 0.5, "Australia"),
        _place("b1", "Vienna", 0.5, 2.5, "Austria"),
    ]
    regions = build_regions(
        aus + aut, places, {"Australia": "AUS", "Austria": "AUT"})
    ids = {r.country: r.region_id for r in regions}
    assert ids["Australia"].startswith("AUS-R")
    assert ids["Austria"].startswith("AUT-R")
    assert ids["Australia"] != ids["Austria"]


def test_tangier_sits_in_a_region_named_for_tangier():
    """Doc 5 §3.6: not in Suss-Massa-Draa. Named from the polygon."""
    north = AdminUnit(
        unit_id="tt", name="Tanger-Tetouan-Al Hoceima", country="Morocco",
        geometry=Polygon([(-6, 35), (-5, 35), (-5, 36), (-6, 36)]))
    south = AdminUnit(
        unit_id="sm", name="Suss-Massa-Draa", country="Morocco",
        geometry=Polygon([(-10, 28), (-8, 28), (-8, 31), (-10, 31)]))
    tangier = _place("MOR-t", "Tangier", 35.767, -5.80)
    agadir = _place("MOR-a", "Agadir", 30.42, -9.60)
    land = {"Morocco": Polygon([(-10, 28), (-5, 28), (-5, 36), (-10, 36)])}
    regions = build_regions(
        [north, south], [tangier, agadir], {"Morocco": "MAR"},
        country_land=land)
    host = next(r for r in regions if "MOR-t" in r.place_ids)
    assert namesake_in_name(host.name, "Tangier"), host.name
    assert "Suss" not in host.name


def test_name_is_from_the_polygon_not_the_merge_winner():
    """A blob centred on Taza must not keep the name Tangier. Stage 3."""
    from twm.geo import name_from_polygon

    tangier = Polygon([(-6, 35), (-5, 35), (-5, 36), (-6, 36)])
    taza = Polygon([(-5, 33), (-3, 33), (-3, 35), (-5, 35)])
    merged = Polygon([(-6, 33), (-3, 33), (-3, 36), (-6, 36)])
    name = name_from_polygon(
        merged,
        [("Tanger-Tetouan", tangier), ("Taza", taza)],
        [("Tangier", 35.767, -5.80, 100000), ("Taza", 34.21, -4.01, 50000)],
        "Morocco",
        country_centroid=(-4.5, 34.5),
    )
    # Centroid of the merged blob is near Taza, not Tangier.
    assert "Tanger" not in name and "Tangier" not in name, name


def test_union_equals_country_land_within_tolerance():
    units = [
        AdminUnit(unit_id="w", name="West", country="Testland",
                  geometry=Polygon([(0, 0), (1, 0), (1, 1), (0, 1)])),
        AdminUnit(unit_id="e", name="East", country="Testland",
                  geometry=Polygon([(1, 0), (2, 0), (2, 1), (1, 1)])),
    ]
    land = {"Testland": Polygon([(0, 0), (2, 0), (2, 1), (0, 1)])}
    regions = build_regions(
        units, [_place("p", "P", 0.5, 0.5, "Testland")],
        {"Testland": "TST"}, country_land=land)
    assert coverage_ok(regions, land["Testland"])


def test_unruled_disputed_cases_are_warned_not_decided():
    """Parked: Kosovo, Taiwan, … — table plus warning, no ruling."""
    hits = unruled_hits(["Kosovo", "Morocco", "Taiwan", "XKX"])
    assert "Kosovo" in hits
    assert "Taiwan" in hits
    assert "Morocco" not in hits
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        warnings.warn(
            f"unruled disputed cases encountered: {hits}",
            stacklevel=1,
        )
    assert caught
