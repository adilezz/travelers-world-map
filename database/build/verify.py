"""Check the built database against the invariants the products depend on.

Exit codes are not the point -- read the report. Each check states what it
verified and, where a claim is quantitative, the measured number rather than a
pass/fail token, because "PASS" hides a value that drifted 40% in the right
direction.
"""
import json
import math
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, os.environ.get("TWM_PKG", "/home/claude/twm/db"))

from twm.config import PARAMS  # noqa: E402
from twm.geo import haversine_km, min_spacing_km  # noqa: E402

DIST = Path(os.environ.get("TWM_DIST", "/home/claude/twm/dist"))
DATA = Path(os.environ.get("TWM_DATA", "/home/claude/twm/data"))

fails, warns = [], []


def check(ok, label, detail=""):
    mark = "ok  " if ok else "FAIL"
    print(f"  [{mark}] {label}" + (f"  — {detail}" if detail else ""))
    if not ok:
        fails.append(label)


def warn(label, detail=""):
    print(f"  [warn] {label}" + (f"  — {detail}" if detail else ""))
    warns.append(label)


def main():
    app = json.loads((DIST / "app_places.json").read_text(encoding="utf-8"))
    rep = json.loads((DIST / "build_report.json").read_text(encoding="utf-8"))
    countries = json.loads((DATA / "countries.json").read_text(encoding="utf-8"))
    places = app["places"]
    printed = [p for p in places if p["on_printed_map"]]
    stats = rep["stats"]

    print(f"\n{len(places)} places, {len(printed)} on the printed map, "
          f"{len(stats['per_country'])} countries\n")

    print("IDENTITY AND SHAPE")
    ids = [p["place_id"] for p in places]
    dup = [k for k, v in Counter(ids).items() if v > 1]
    check(not dup, "place_id is unique",
          f"{len(dup)} duplicates" if dup else f"{len(ids)} ids")

    bad_coord = [p for p in places
                 if not (-90 <= p["lat"] <= 90) or not (-180 <= p["lon"] <= 180)
                 or (p["lat"] == 0 and p["lon"] == 0)]
    check(not bad_coord, "coordinates are in range and never null island",
          f"{len(bad_coord)} bad" if bad_coord else f"{len(places)} checked")

    unnamed = [p for p in places if not p["name"].strip()]
    check(not unnamed, "every place has a name",
          f"{len(unnamed)} blank" if unnamed else "")

    no_src = [p for p in places if not p.get("sources")]
    check(not no_src, "every place carries provenance",
          f"{len(no_src)} without a source" if no_src else "licence audit possible")

    scores = [p["score"] for p in places]
    check(all(0 <= s <= 100 for s in scores), "scores are 0-100",
          f"min {min(scores)} max {max(scores)}")

    per = stats["per_country"]

    print("\nPRINTED MAP")
    check(len(printed) <= stats["hole_budget"], "hole budget respected",
          f"{len(printed)} of {stats['hole_budget']} holes")

    ranks = [p["printed_rank"] for p in printed if p.get("printed_rank")]
    check(len(ranks) == len(printed), "every printed place has a rank",
          f"{len(ranks)}/{len(printed)}")

    # the spacing rule is the physical constraint the whole two-rendering split exists for
    by_country = defaultdict(list)
    for p in printed:
        by_country[p["country"]].append(p)
    violations, tightest = [], []
    for c, ps in by_country.items():
        if len(ps) < 2:
            continue
        facts = countries.get(c)
        area = facts["area_km2"] if facts else 100_000.0
        # the pipeline sizes spacing from the QUOTA, not from how many were
        # actually selected -- density is coef*sqrt(area/n), so using the smaller
        # selected count would invent a stricter threshold than the model applied
        n = per.get(c, {}).get("quota") or len(ps)
        d_min = min_spacing_km(area, n, PARAMS)
        closest = math.inf
        for i in range(len(ps)):
            for j in range(i + 1, len(ps)):
                d = haversine_km(ps[i]["lat"], ps[i]["lon"], ps[j]["lat"], ps[j]["lon"])
                closest = min(closest, d)
        tightest.append((closest, c, d_min, len(ps)))
        if closest < d_min - 0.5:
            violations.append((c, round(closest, 1), round(d_min, 1)))
    check(not violations, "no two drilled holes closer than the country's minimum spacing",
          f"{len(violations)} countries violate it: {violations[:4]}" if violations
          else f"{len(tightest)} multi-place countries checked")
    tightest.sort()
    print("      tightest pairs: " + ", ".join(
        f"{c} {d:.0f}km (min {m:.0f})" for d, c, m, _ in tightest[:4]))

    floor = min(d for d, _, _, _ in tightest) if tightest else None
    if floor is not None:
        check(floor >= 60 - 0.5, "global 60 km hole separation holds",
              f"tightest pair anywhere is {floor:.1f} km")

    print("\nSELECTION QUALITY")
    red = [(c, s["redundancy"]) for c, s in per.items() if s.get("redundancy") is not None]
    if red:
        vals = [r for _, r in red]
        print(f"      coverage redundancy measured for {len(red)} countries, "
              f"mean {sum(vals)/len(vals):.3f}, median "
              f"{sorted(vals)[len(vals)//2]:.3f}")
        check(sum(vals) / len(vals) < 0.6, "mean archetype redundancy stays below 0.6",
              "coverage selection is picking varied kinds of place")
    quota_over = [(c, s["on_printed_map"], s["quota"]) for c, s in per.items()
                  if s.get("quota") and s["on_printed_map"] > s["quota"]]
    check(not quota_over, "no country exceeds its quota",
          f"{len(quota_over)} over: {quota_over[:3]}" if quota_over else "")

    print("\nTERRITORIES")
    tpath = DIST / "territories.json"
    if not tpath.exists():
        warn("territories.json missing", "printed map has no tiles")
    else:
        tdoc = json.loads(tpath.read_text(encoding="utf-8"))
        terr = tdoc["territories"]
        tids = [t["territory_id"] for t in terr]
        tdup = [k for k, v in Counter(tids).items() if v > 1]
        check(not tdup, "territory_id is unique",
              f"{len(tdup)} duplicates" if tdup else f"{len(tids)} tiles")

        assigned = [pid for t in terr for pid in t["place_ids"]]
        multi = [k for k, v in Counter(assigned).items() if v > 1]
        check(not multi, "no place sits in two tiles",
              f"{len(multi)} placed twice" if multi else f"{len(assigned)} assignments")

        printed_ids = {p["place_id"] for p in printed}
        orphan = printed_ids - set(assigned)
        pct = 100 * len(orphan) / max(len(printed_ids), 1)
        if orphan:
            warn("printed places with no tile", f"{len(orphan)} ({pct:.1f}%)")
        else:
            check(True, "every printed place belongs to a tile")

        empty = [t for t in terr if not t["place_ids"]]
        check(not empty, "no empty tiles", f"{len(empty)} empty" if empty else "")
        small = sum(1 for t in terr if not t["printable"])
        print(f"      {small} tiles below the {tdoc['min_tile_extent_km']} km "
              f"minimum extent — inset panels, not cut tiles")

    print("\nASSET PROVENANCE")
    srcs = Counter(s for p in places for s in p.get("sources", []))
    for s, n in srcs.most_common():
        print(f"      {s:<22} contributes to {n:>6} places")

    print()
    if fails:
        print(f"{len(fails)} FAILED: {fails}")
    else:
        print(f"All checks passed ({len(warns)} warnings).")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
