"""Copy a candidate bundle to the live path only when every Stage 4 gate passes.

A failed gate leaves the previous bundle in place. Reports (warnings) never
satisfy a gate and never block a publish by themselves — but a failed check
on a world build still aborts, because silence is how the last bundle shipped
broken.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

_HERE = Path(__file__).resolve()
_DB = _HERE.parents[1]
_REPO = _HERE.parents[2]
sys.path.insert(0, os.environ.get("TWM_PKG", str(_DB)))
sys.path.insert(0, str(_HERE.parent))

from verify import failed_gate_ids, run  # noqa: E402


LIVE = _REPO / "webapp" / "twm-app" / "public" / "data"
STAGING = _DB / "dist" / "repair_staging"


def begin_repair() -> Path:
    """Copy the live bundle to a staging dir. Repair scripts mutate the copy."""
    if STAGING.exists():
        shutil.rmtree(STAGING)
    shutil.copytree(LIVE, STAGING)
    return STAGING


def finish_repair(dist: Path | None = None) -> int:
    """Copy staging to live only when Stage 4 gates pass."""
    return publish(STAGING, LIVE, dist or (_DB / "dist"))


def publish(src: Path, dst: Path, dist: Path) -> int:
    src, dst, dist = Path(src), Path(dst), Path(dist)
    code = run(bundle=src, dist=dist)
    if code != 0:
        tripped = failed_gate_ids()
        print(
            f"publish aborted: gates {tripped or 'checks'} failed; "
            f"{dst} left in place",
            file=sys.stderr,
        )
        return code
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        target = dst / item.name
        if item.is_dir():
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)
    print(f"published {src} -> {dst}")
    return 0


def main() -> int:
    default_src = _DB / "dist" / "app"
    default_dst = _REPO / "webapp" / "twm-app" / "public" / "data"
    default_dist = _DB / "dist"
    p = argparse.ArgumentParser(description="Publish a bundle if Stage 4 gates pass.")
    p.add_argument("--src", type=Path, default=default_src)
    p.add_argument("--dst", type=Path, default=default_dst)
    p.add_argument("--dist", type=Path, default=default_dist)
    args = p.parse_args()
    return publish(args.src, args.dst, args.dist)


if __name__ == "__main__":
    sys.exit(main())
