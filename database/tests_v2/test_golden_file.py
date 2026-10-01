"""The golden set itself must be well formed before it is used to judge anything."""
from collections import Counter

from twm2 import golden as G
from twm2.vocab import KINDS


def test_file_validates(golden_rows):
    known = G.whs_ids(G.__file__.replace("twm2/golden.py", "data/whs_expanded.xml"))
    assert G.validate(golden_rows, known) == []


def test_every_prototype_country_is_covered(golden_rows):
    countries = Counter(r.country for r in golden_rows if r.row_kind == "positive")
    assert set(countries) == {"Egypt", "Peru", "Italy", "Jordan", "Tanzania"}
    assert all(n >= 15 for n in countries.values())


def test_every_kind_is_represented(golden_rows):
    seen = {k for r in golden_rows for k in r.kinds}
    assert seen == set(KINDS)


def test_regression_rows_are_present(golden_rows):
    reg = {r.name for r in golden_rows if r.regression}
    assert {"Machu Picchu", "Petra", "Cairo", "Wadi Rum", "Mount Kilimanjaro", "Florence"} <= reg


def test_relational_rows_have_the_intended_targets(golden_rows):
    by = {r.golden_id: r for r in golden_rows}
    nine = next(r for r in golden_rows if r.name == "Yusuf as-Siddiq")
    assert {by[t].name for t in nine.targets} == {"Giza Pyramids", "Cairo", "Luxor (Thebes)", "Abu Simbel"}


def test_validator_catches_a_broken_row(golden_rows):
    import copy
    rows = copy.deepcopy(golden_rows)
    rows[0].kinds = ()
    rows[1].tol_km = 500
    rows[2].min_tier = "Legendary"
    problems = G.validate(rows)
    assert len(problems) >= 3
