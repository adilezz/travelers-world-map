"""`make verify`: run every gate against the PUBLISHED bundle. Exit 1 on any failure."""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from twm2 import golden as G
from twm2.bundle import Bundle, Registry
from twm2.gates import GateResult, run_all

ROOT = Path(__file__).resolve().parent.parent


def _csv(path: Path) -> list[dict] | None:
    if not path.is_file():
        return None
    with open(path, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh)) or None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--bundle", type=Path, required=False, help="bundle directory (bundle/<build_id>)")
    ap.add_argument("--previous", type=Path)
    ap.add_argument("--golden", type=Path, default=ROOT / "golden" / "golden_starter.csv")
    ap.add_argument("--registry", type=Path, default=ROOT / "registry" / "place_registry.parquet")
    ap.add_argument("--whs", type=Path, default=ROOT / "data" / "whs_expanded.xml")
    ap.add_argument("--release", action="store_true", help="also run the holdout and precision gates")
    a = ap.parse_args(argv)

    golden = G.load(a.golden)
    known = G.whs_ids(a.whs) if a.whs.is_file() else None
    if a.bundle is None or not (a.bundle / "manifest.json").is_file():
        print("G-BUNDLE FAIL  no published bundle to verify (expected: the pipeline has not produced one yet)")
        print(f"       golden file: {len(G.validate(golden, known))} problems in {len(golden)} rows")
        return 1
    bundle = Bundle.load(a.bundle)
    previous = Bundle.load(a.previous) if a.previous else None
    registry = Registry.load(a.registry) if a.registry.is_file() else None
    holdout = G.load(ROOT / "holdout" / "H1.csv") if (ROOT / "holdout" / "H1.csv").is_file() else None
    results: list[GateResult] = run_all(
        bundle, golden, registry=registry, previous=previous, holdout=holdout,
        labels=_csv(ROOT / "golden" / "kind_labels.csv"),
        review=_csv(ROOT / "holdout" / "precision_review.csv"), known_whs=known, release=a.release)
    for r in results:
        tag = "PEND" if r.pending else ("ok  " if r.passed else "FAIL")
        print(f"{r.gate:18s} {tag}  {r.detail}")
    failed = [r.gate for r in results if not r.passed]
    print(f"\n{len(failed)} of {len(results)} gates not passing" if failed else "\nall gates pass")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
