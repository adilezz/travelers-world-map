"""Stage 0: one build number, counts that match the files, stable place_ids.

These are the checks that would have caught three stories about the same
product, and the check that treats a renamed place_id as a migration.
"""
from __future__ import annotations

import json
from pathlib import Path

from twm.identity import (
    build_number,
    check_manifest_counts,
    check_place_id_stability,
    count_bundle_files,
    stamp_bundle,
    verify_bundle_identity,
)


def _feature(pid, name, country, lon, lat, hole=0):
    return {
        "type": "Feature",
        "properties": {
            "id": pid, "n": name, "s": 80, "k": "A2", "a": 2,
            "c": country, "site": 0, "hole": hole, "whs": 0, "t": "",
        },
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


def _bundle(tmp: Path, features, totals=None, n_countries=None):
    """A published bundle small enough to hold in a test."""
    bundle = tmp / "bundle"
    countries = bundle / "countries"
    countries.mkdir(parents=True)
    geo = {"type": "FeatureCollection", "features": features}
    (bundle / "places.geojson").write_text(json.dumps(geo), encoding="utf-8")
    terr = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id": "t1"}, "geometry": None},
    ]}
    (bundle / "territories.geojson").write_text(json.dumps(terr), encoding="utf-8")
    iso = sorted({f["properties"]["c"] for f in features})
    for code in iso:
        (countries / f"{code}.json").write_text(
            json.dumps({"country": code, "iso3": code, "places": []}),
            encoding="utf-8",
        )
    n_c = n_countries if n_countries is not None else len(iso)
    n_printed = sum(1 for f in features if f["properties"]["hole"] == 1)
    tot = totals or {
        "places": len(features), "printed": n_printed,
        "countries": n_c, "territories": 1,
        "printable_territories": 1, "hole_budget": 3000,
    }
    ids = [f["properties"]["id"] for f in features]
    manifest = {
        "build": build_number(ids),
        "totals": tot,
        "layers": {"places": "places.geojson", "territories": "territories.geojson"},
        "countries": [{"iso3": c, "country": c, "file": f"countries/{c}.json",
                       "places": 1, "holes": 0, "tiles": 0, "kinds": 1,
                       "kind_counts": {}, "bytes": 1} for c in iso],
    }
    (bundle / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return bundle


def _places(features):
    return [{
        "id": f["properties"]["id"],
        "name": f["properties"]["n"],
        "country": f["properties"]["c"],
        "lat": f["geometry"]["coordinates"][1],
        "lon": f["geometry"]["coordinates"][0],
    } for f in features]


A = _feature("AAA-1", "Alpha", "AAA", 0.0, 0.0, hole=1)
B = _feature("BBB-1", "Beta", "BBB", 1.0, 1.0)
C = _feature("CCC-1", "Gamma", "CCC", 2.0, 2.0)


def test_matching_bundle_passes(tmp_path):
    bundle = _bundle(tmp_path, [A, B, C])
    errors, number, files = verify_bundle_identity(bundle)
    assert errors == []
    assert number.startswith("twm-")
    assert files["places"] == 3
    assert files["countries"] == 3
    assert files["printed"] == 1


def test_build_number_is_one_value_for_the_same_ids():
    assert build_number(["AAA-1", "BBB-1"]) == build_number(["BBB-1", "AAA-1"])
    assert build_number(["AAA-1"]) != build_number(["AAA-2"])


def test_corrupted_manifest_count_fails(tmp_path):
    """Change one count by one. The two numbers must both be in the error."""
    bundle = _bundle(tmp_path, [A, B, C], totals={
        "places": 4, "printed": 1, "countries": 3, "territories": 1,
        "printable_territories": 1, "hole_budget": 3000,
    })
    errors, _, files = verify_bundle_identity(bundle)
    assert errors
    msg = " ".join(errors)
    assert "4" in msg and "3" in msg
    assert files["places"] == 3


def test_renamed_place_id_without_mapping_fails():
    previous = {
        "AAA-1": {"name": "Alpha", "country": "AAA", "lat": 0.0, "lon": 0.0},
        "BBB-1": {"name": "Beta", "country": "BBB", "lat": 1.0, "lon": 1.0},
    }
    current = _places([_feature("AAA-9", "Alpha", "AAA", 0.0, 0.0), B])
    errors = check_place_id_stability(previous, current, mapping={})
    assert errors
    assert any("AAA-1" in e and "mapping" in e.lower() for e in errors)


def test_renamed_place_id_with_mapping_passes():
    previous = {
        "AAA-1": {"name": "Alpha", "country": "AAA", "lat": 0.0, "lon": 0.0},
        "BBB-1": {"name": "Beta", "country": "BBB", "lat": 1.0, "lon": 1.0},
    }
    current = _places([_feature("AAA-9", "Alpha", "AAA", 0.0, 0.0), B])
    errors = check_place_id_stability(previous, current, mapping={"AAA-1": "AAA-9"})
    assert errors == []


def test_dissolve_of_country_label_is_the_same_place():
    """Stage 3: ESH → MAR is a dissolve, not a reused place_id. Doc 5 §3.3."""
    previous = {
        "WES-1": {"name": "Laayoune", "country": "ESH", "lat": 27.142, "lon": -13.188},
    }
    current = [{
        "id": "WES-1", "name": "Laayoune", "country": "MAR",
        "lat": 27.142, "lon": -13.188,
    }]
    errors = check_place_id_stability(previous, current, mapping={})
    assert errors == []


def test_reused_place_id_for_a_different_place_fails():
    previous = {
        "AAA-1": {"name": "Alpha", "country": "AAA", "lat": 0.0, "lon": 0.0},
    }
    current = _places([_feature("AAA-1", "Somewhere else", "ZZZ", 40.0, 40.0)])
    errors = check_place_id_stability(previous, current, mapping={})
    assert errors
    assert any("reused" in e for e in errors)


def test_stamp_writes_the_same_build_everywhere(tmp_path):
    bundle = _bundle(tmp_path, [A, B])
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "build_report.json").write_text(json.dumps({"stats": {}}), encoding="utf-8")
    number = stamp_bundle(bundle, dist)
    man = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    rep = json.loads((dist / "build_report.json").read_text(encoding="utf-8"))
    snap = json.loads((dist / "place_ids.json").read_text(encoding="utf-8"))
    assert man["build"] == number
    assert rep["build"] == number
    assert snap["build"] == number
    assert set(snap["places"]) == {"AAA-1", "BBB-1"}
    errors, verified, _ = verify_bundle_identity(
        bundle, snapshot_path=dist / "place_ids.json")
    assert errors == []
    assert verified == number


def test_count_bundle_files_reads_the_disk(tmp_path):
    bundle = _bundle(tmp_path, [A, B, C])
    man = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    files = count_bundle_files(bundle, man)
    assert files == {"places": 3, "printed": 1, "countries": 3, "territories": 1}
    mismatches = check_manifest_counts(man, files)
    assert mismatches == []
