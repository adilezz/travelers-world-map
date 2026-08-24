"""Stage 4: six gates, six broken fixtures, six rejections.

A gate you have not watched fail is a gate you have not written.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_DB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_DB))
sys.path.insert(0, str(_DB / "build"))

from twm.gate_fixtures import GATES, write_valid_bundle  # noqa: E402
from twm.gates import GATE_IDS, GATE_RULES  # noqa: E402
from publish import begin_repair, finish_repair, publish  # noqa: E402
from verify import failed_gate_ids, run  # noqa: E402

FIXTURES = _DB / "fixtures" / "gates"


def test_the_six_gates_are_the_brief():
    assert tuple(GATE_IDS) == GATES
    assert set(GATE_RULES) == set(GATE_IDS)


@pytest.mark.parametrize("gate_id", GATES)
def test_broken_fixture_trips_its_gate(tmp_path, gate_id):
    """Doc 1 §19: each gate is proved by a bundle that it rejects."""
    bundle = FIXTURES / gate_id / "bundle"
    assert bundle.is_dir(), bundle
    dist = FIXTURES / gate_id / "dist"
    if not dist.is_dir():
        dist = tmp_path / f"dist-{gate_id}"
        dist.mkdir()
    code = run(bundle=bundle, dist=dist, data=_DB / "data")
    assert code == 1, f"{gate_id} should abort"
    tripped = failed_gate_ids()
    assert gate_id in tripped, f"wanted {gate_id} in {tripped}"


def test_a_valid_mini_bundle_clears_the_six_gates(tmp_path):
    bundle = tmp_path / "ok"
    write_valid_bundle(bundle)
    dist = tmp_path / "dist"
    dist.mkdir()
    code = run(bundle=bundle, dist=dist, data=_DB / "data")
    assert code == 0, failed_gate_ids()
    assert failed_gate_ids() == []


def test_failed_publish_leaves_the_previous_bundle(tmp_path):
    """A gate aborts the publish and leaves the previous bundle in place."""
    live = tmp_path / "live"
    live.mkdir()
    (live / "PREVIOUS.txt").write_text("keep-me", encoding="utf-8")
    src = FIXTURES / "kind_audit" / "bundle"
    dist = tmp_path / "dist"
    dist.mkdir()
    code = publish(src, live, dist)
    assert code == 1
    assert (live / "PREVIOUS.txt").read_text(encoding="utf-8") == "keep-me"
    assert not (live / "manifest.json").is_file()


def test_passing_publish_replaces_the_live_bundle(tmp_path):
    src = tmp_path / "src"
    write_valid_bundle(src)
    live = tmp_path / "live"
    live.mkdir()
    (live / "PREVIOUS.txt").write_text("old", encoding="utf-8")
    dist = tmp_path / "dist"
    dist.mkdir()
    code = publish(src, live, dist)
    assert code == 0
    assert (live / "manifest.json").is_file()
    assert (live / "PREVIOUS.txt").is_file()  # extra files stay; bundle files land
    man = (live / "manifest.json").read_text(encoding="utf-8")
    assert "TST" in man


def test_begin_repair_mutates_staging_not_live(tmp_path, monkeypatch):
    """Repair scripts must not write the live bundle until gates pass."""
    import publish as pub
    live = tmp_path / "live"
    staging = tmp_path / "staging"
    live.mkdir()
    (live / "keep.txt").write_text("live", encoding="utf-8")
    monkeypatch.setattr(pub, "LIVE", live)
    monkeypatch.setattr(pub, "STAGING", staging)
    out = pub.begin_repair()
    assert out == staging
    (staging / "keep.txt").write_text("dirty", encoding="utf-8")
    assert (live / "keep.txt").read_text(encoding="utf-8") == "live"


def test_finish_repair_failed_gate_leaves_live(tmp_path, monkeypatch):
    import shutil
    import publish as pub
    live = tmp_path / "live"
    staging = tmp_path / "staging"
    live.mkdir()
    (live / "keep.txt").write_text("live", encoding="utf-8")
    shutil.copytree(FIXTURES / "kind_audit" / "bundle", staging)
    monkeypatch.setattr(pub, "LIVE", live)
    monkeypatch.setattr(pub, "STAGING", staging)
    code = pub.finish_repair(tmp_path / "dist")
    assert code != 0
    assert (live / "keep.txt").read_text(encoding="utf-8") == "live"
    assert not (live / "manifest.json").is_file()
