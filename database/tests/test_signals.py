"""Stage 2: signals are computed from a source or omitted. Never invented."""
import json
from pathlib import Path

from twm.signals import (
    apply_signals,
    kinds_from_landforms,
    livability_by_country,
    merge_kinds,
    omit_dummy_metadata,
)


def test_desert_landform_is_a5():
    """Landform tokens drive kinds. Review §3.2 / Stage 2."""
    assert kinds_from_landforms(["desert"])["A5"] >= 0.9
    assert kinds_from_landforms(["forest"])["A6"] >= 0.8
    assert kinds_from_landforms(["volcano"])["A8"] >= 0.9
    assert kinds_from_landforms([]) == {}


def test_merge_does_not_drop_a_stronger_existing_kind():
    merged = merge_kinds({"A11": 0.6}, {"A5": 0.95})
    assert merged["A5"] >= 0.9
    assert merged["A11"] == 0.6


def test_dummy_reach_and_months_are_omitted():
    """Doc 5 §3.8: never a dummy 'near' / [] presented as knowledge."""
    p = {"reach": "near", "best_months": [4, 5, 6], "name": "Fes"}
    omit_dummy_metadata(p)
    assert "reach" not in p
    assert "best_months" not in p


def test_historic_capital_is_a1(tmp_path: Path):
    """A1 comes from Wikidata 'capital of', including former capitals. Stage 2."""
    (tmp_path / "wikidata_historic_capitals.csv").write_text(
        "qid,lat,lon\nQ80985,34.0331,-5.0003\n", encoding="utf-8")
    places = [{
        "place_id": "MOR-c2548885", "name": "Fes", "country": "Morocco",
        "lat": 34.0331, "lon": -5.0003, "score": 100,
        "archetypes": ["A11", "A12"], "archetype_weights": [0.6, 0.54],
        "reach": "near", "best_months": [4, 5, 6],
    }]
    stats = apply_signals(places, tmp_path)
    assert places[0]["historic_capital"] is True
    assert "A1" in places[0]["archetypes"]
    assert places[0]["score"] == 100
    assert "reach" not in places[0]
    assert stats["historic_capital"] == 1


def test_forest_and_volcano_layers_create_a6_and_a8(tmp_path: Path):
    """A6 and A8 exist only when a real point layer is present. Stage 2."""
    (tmp_path / "wikidata_forests.csv").write_text(
        "qid,lat,lon\nQ1,-0.5,37.0\n", encoding="utf-8")
    (tmp_path / "wikidata_volcanoes.csv").write_text(
        "qid,lat,lon\nQ2,-1.4,29.5\n", encoding="utf-8")
    places = [
        {"place_id": "KEN-x", "name": "Forest town", "country": "Kenya",
         "lat": -0.5, "lon": 37.0, "archetypes": [], "archetype_weights": []},
        {"place_id": "COD-x", "name": "Volcano town", "country": "DRC",
         "lat": -1.4, "lon": 29.5, "archetypes": ["A9"], "archetype_weights": [0.8]},
        {"place_id": "MAR-fes", "name": "Fes", "country": "Morocco",
         "lat": 34.0331, "lon": -5.0003, "archetypes": ["A11"],
         "archetype_weights": [0.6]},
    ]
    apply_signals(places, tmp_path)
    assert "A6" in places[0]["archetypes"]
    assert "A8" in places[1]["archetypes"]
    assert "A8" not in places[2]["archetypes"]


def test_wdpa_source_implies_wildlife_not_an_invented_kind():
    """A place that already carries wdpa is A9. That is provenance, not a guess."""
    from twm.signals import SOURCE_KINDS
    assert "A9" in SOURCE_KINDS["wdpa"]


def test_river_landform_does_not_invent_a7():
    """River is 0.25, below the floor. Stage 2 must not promote it to a kind."""
    from twm.signals import qualifying_landform_kinds
    assert qualifying_landform_kinds(["river"]) == {}
    assert qualifying_landform_kinds(["lake"])["A7"] >= 0.8


def test_harvested_osm_point_goes_to_nearest_place_only(tmp_path: Path):
    """A castle fills the nearest empty pin, not every city in 60 km."""
    (tmp_path / "osm_empty_features.csv").write_text(
        "id,lat,lon,kind,weight,tag\n"
        "osm-node-1,10.0,10.0,A2,0.5,historic=castle\n",
        encoding="utf-8")
    places = [
        {"place_id": "A", "name": "Near", "country": "X",
         "lat": 10.0, "lon": 10.0, "archetypes": [], "archetype_weights": []},
        {"place_id": "B", "name": "Far", "country": "X",
         "lat": 10.4, "lon": 10.0, "archetypes": [], "archetype_weights": []},
    ]
    apply_signals(places, tmp_path)
    assert "A2" in places[0]["archetypes"]
    assert places[1]["archetypes"] == []


def test_harvest_does_not_evict_existing_kinds(tmp_path: Path):
    """A nearby mountain must not kick WHS A2 off Fes. Stage 2 / Fes rule."""
    (tmp_path / "osm_empty_features.csv").write_text(
        "id,lat,lon,kind,weight,tag\n"
        "osm-peak,34.04,-5.00,A4,0.9,natural=peak\n",
        encoding="utf-8")
    places = [{
        "place_id": "MAR-fes", "name": "Fes", "country": "Morocco",
        "lat": 34.0331, "lon": -5.0003,
        "archetypes": ["A1", "A11", "A12", "A2"],
        "archetype_weights": [0.9, 0.6, 0.54, 0.5],
    }]
    apply_signals(places, tmp_path)
    assert "A2" in places[0]["archetypes"]
    assert "A4" not in places[0]["archetypes"]


def test_empty_kind_is_not_invented(tmp_path: Path):
    """A place with no source signal keeps no kind. Never invent A11/A12."""
    places = [{
        "place_id": "XXX-1", "name": "Nowhere", "country": "X",
        "lat": 0.1, "lon": 0.1, "archetypes": [], "archetype_weights": [],
    }]
    stats = apply_signals(places, tmp_path)
    assert places[0]["archetypes"] == []
    assert stats["still_empty"] == 1


def test_manual_kind_fills_only_empty_places(tmp_path: Path):
    """Adil: fill leftovers from evidence. Do not evict kinds already present."""
    (tmp_path / "manual_kinds.json").write_text(
        json.dumps({"places": [
            {"place_id": "EMPTY-1", "kind": "A12", "weight": 0.6,
             "source": "https://example.test/mine"},
            {"place_id": "FULL-1", "kind": "A5", "weight": 0.95,
             "source": "https://example.test/desert"},
        ]}),
        encoding="utf-8")
    places = [
        {"place_id": "EMPTY-1", "name": "Mine", "country": "X",
         "lat": 1.0, "lon": 1.0, "archetypes": [], "archetype_weights": []},
        {"place_id": "FULL-1", "name": "Old town", "country": "X",
         "lat": 2.0, "lon": 2.0, "archetypes": ["A2"], "archetype_weights": [0.5]},
    ]
    stats = apply_signals(places, tmp_path)
    assert places[0]["archetypes"] == ["A12"]
    assert places[1]["archetypes"] == ["A2"]
    assert "A5" not in places[1]["archetypes"]
    assert stats["manual"] == 1
    assert stats["still_empty"] == 0


def test_livability_unscored_where_osm_did_not_run():
    """An empty pillar must not look like a low one. Stage 2."""
    flags = livability_by_country(
        {"Morocco": {"iso": "MA"}, "Mongolia": {"iso": "MN"}},
        {"MA"},
    )
    assert flags["Morocco"] == "scored"
    assert flags["Mongolia"] == "unscored"
