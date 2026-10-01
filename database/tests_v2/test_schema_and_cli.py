import json
import subprocess
import sys
from pathlib import Path

import duckdb
import pytest

from twm2.vocab import KINDS, PLACE_TYPES, TIERS

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = (ROOT / "twm2" / "schema.sql").read_text(encoding="utf-8")


def test_schema_loads_and_matches_the_vocabulary():
    con = duckdb.connect()
    con.execute(SCHEMA)
    tables = {r[0] for r in con.execute("show tables").fetchall()}
    assert {"asset", "place", "place_asset", "place_kind", "place_alias", "territory", "piece",
            "print_selection", "merge_log", "split_log", "review_queue", "build"} <= tables
    for kind in KINDS:
        assert f"'{kind}'" in SCHEMA
    for t in (*PLACE_TYPES, *TIERS):
        assert f"'{t}'" in SCHEMA


def test_schema_rejects_bad_rows():
    con = duckdb.connect()
    con.execute(SCHEMA)
    con.execute("insert into place values ('pl_0000000001','site','Petra',null,'JOR',null,30.3,35.4,null,'Icon',null,null,'rich',null,null,null,null,null,null,null,null,'active','b1')")
    with pytest.raises(duckdb.Error):
        con.execute("insert into place values ('pl_0000000002','castle','X',null,'JOR',null,0,0,null,'Icon',null,null,'rich',null,null,null,null,null,null,null,null,'active','b1')")
    with pytest.raises(duckdb.Error):
        con.execute("insert into place_kind values ('pl_0000000001','archaeological','r',1.0,['a'])")
    with pytest.raises(duckdb.Error):
        con.execute("insert into place_kind values ('pl_0000000001','ruins','r',1.0,[])")


def run(*args):
    return subprocess.run([sys.executable, "-m", "twm2.verify", *args], cwd=ROOT, capture_output=True, text=True)


def test_verify_fails_without_a_bundle():
    r = run()
    assert r.returncode == 1 and "no published bundle" in r.stdout


def test_verify_never_goes_green_on_the_oracle_bundle(oracle):
    d, reg, _ = oracle
    r = run("--bundle", str(d), "--registry", str(reg))
    assert r.returncode == 1
    assert "G-LANDMARK" in r.stdout and "G-REGION" in r.stdout and "PEND" in r.stdout


def test_registry_parquet_is_readable_and_empty():
    from twm2.bundle import Registry
    assert Registry.load(ROOT / "registry" / "place_registry.parquet").rows == {}


def test_tiers_json_is_valid_and_has_every_rule():
    cfg = json.loads((ROOT / "rules" / "tiers.json").read_text(encoding="utf-8"))
    assert {"admission", "notability", "tiers", "dedup", "churn_limit"} <= set(cfg)
    assert cfg["admission"]["r5_country_floor"] == {"sovereign": 5, "dependency": 2}


def test_manifest_lists_every_documented_source():
    m = json.loads((ROOT / "inputs" / "MANIFEST.json").read_text(encoding="utf-8"))
    ids = {s["source_id"] for s in m["sources"]}
    assert {"wikidata", "wikipedia_pageviews", "wikivoyage", "unesco_whs", "wdpa", "ramsar", "geonames", "osm", "natural_earth"} <= ids
    assert all(s["licence"] and "restricted" in s for s in m["sources"])
