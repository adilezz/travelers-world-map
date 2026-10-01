"""An 'oracle bundle': one perfect place per golden row, built from the golden file itself.

It proves the matcher and the golden set agree. The real pipeline must reproduce this
quality from evidence, with real ids, names and tiers.
"""
from __future__ import annotations

import csv
import hashlib
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from twm2 import golden as G  # noqa: E402

ISO = {"Egypt": "EGY", "Peru": "PER", "Italy": "ITA", "Jordan": "JOR", "Tanzania": "TZA"}
ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"


def pid(seed: str) -> str:
    h = hashlib.sha256(seed.encode()).digest()
    return "pl_" + "".join(ALPHABET[b % 32] for b in h[:10])


@pytest.fixture(scope="session")
def golden_rows():
    return G.load(ROOT / "golden" / "golden_starter.csv")


def write_bundle(root: Path, places: list[dict]) -> Path:
    (root / "places").mkdir(parents=True, exist_ok=True)
    by_iso: dict[str, list[dict]] = {}
    for p in places:
        by_iso.setdefault(p["iso3"], []).append(p)
    for iso, ps in by_iso.items():
        (root / "places" / f"{iso}.json").write_text(
            json.dumps({"iso3": iso, "places": ps}, sort_keys=True), encoding="utf-8")
    hashes = {f.relative_to(root).as_posix(): hashlib.sha256(f.read_bytes()).hexdigest()
              for f in sorted(root.rglob("*")) if f.is_file() and f.name != "manifest.json"}
    manifest = {
        "build_id": "oracle", "counts": {"places": len(places),
                                         "per_country": {k: len(v) for k, v in by_iso.items()}},
        "scope": {"sovereign": sorted(by_iso), "dependencies": []}, "hashes": hashes,
    }
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return root


def oracle_places(rows) -> list[dict]:
    out = []
    for r in rows:
        if r.row_kind != "positive":
            continue
        out.append({
            "place_id": pid(r.golden_id), "type": r.type, "name_en": r.name,
            "aliases": sorted(r.raw["aliases"].split("|")) if r.raw["aliases"] else [],
            "country": r.country, "iso3": ISO[r.country], "lat": r.lat, "lon": r.lon,
            "tier": r.min_tier, "qid": f"Q{900000 + int(r.golden_id[1:])}", "status": "active",
            "whs_id": r.whs_id,
            "kinds": [{"kind": k, "rule": "oracle", "evidence": ["a1"]} for k in r.kinds],
            "evidence": [{"asset_id": "a1", "source": "oracle", "url": "https://example.org/oracle",
                          "retrieved": "2026-10-01",
                          "source_key": f"whs:{r.whs_id}" if r.whs_id else "oracle"}],
        })
    return out


def write_registry(path: Path, places: list[dict], extra: list[dict] | None = None) -> Path:
    with open(path, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["place_id", "status"])
        w.writeheader()
        for p in places:
            w.writerow({"place_id": p["place_id"], "status": "active"})
        for e in extra or []:
            w.writerow(e)
    return path


@pytest.fixture()
def oracle(tmp_path, golden_rows):
    places = oracle_places(golden_rows)
    bundle_dir = write_bundle(tmp_path / "bundle", places)
    registry = write_registry(tmp_path / "registry.csv", places)
    return bundle_dir, registry, places
