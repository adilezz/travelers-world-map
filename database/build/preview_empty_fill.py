"""Dry-run apply_signals and report how the 417 empties fare."""
from __future__ import annotations

import copy
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from twm.signals import apply_signals

_DB = Path(__file__).resolve().parents[1]
_REPO = _DB.parent
DATA = _DB / "data"
BUNDLE = _REPO / "webapp" / "twm-app" / "public" / "data"
OUT = DATA / "empty_kinds_remaining.json"


def main() -> None:
    empties = json.loads((DATA / "empty_kinds.json").read_text(encoding="utf-8"))
    places = []
    for path in sorted((BUNDLE / "countries").glob("*.json")):
        places.extend(json.loads(path.read_text(encoding="utf-8")).get("places") or [])
    work = copy.deepcopy(places)
    stats = apply_signals(work, DATA)
    print("stats", stats)
    by = {p["place_id"]: p for p in work}
    filled, still = [], []
    src_kinds = Counter()
    for e in empties:
        p = by[e["place_id"]]
        kinds = p.get("archetypes") or []
        if kinds:
            filled.append({
                "place_id": e["place_id"], "name": e["name"],
                "country": e["country"], "kinds": kinds,
            })
            src_kinds.update(kinds)
        else:
            still.append({
                "place_id": e["place_id"], "name": e["name"],
                "country": e["country"], "lat": e.get("lat"), "lon": e.get("lon"),
                "forms": e.get("forms"),
                "sources": e.get("sources"),
            })
    print("of 417 filled", len(filled), "still", len(still))
    print("fill kinds", dict(src_kinds))
    print("global empty", stats["still_empty"])
    print("--- Morocco ---")
    for name in ("Fes", "Marrakesh", "Rabat", "Agadir", "Meknes"):
        for p in work:
            if p["country"] == "Morocco" and p["name"] == name:
                print(p["name"], p["score"], p.get("archetypes"))
    for p in work:
        if p["name"] == "Kyoto":
            print(p["name"], p["country"], p.get("score"), p.get("archetypes"))
            break
    by_c = Counter(r["country"] for r in still)
    print("remaining countries", dict(by_c.most_common()))
    OUT.write_text(json.dumps(still, indent=1, ensure_ascii=False), encoding="utf-8")
    print("wrote", OUT, "n=", len(still))


if __name__ == "__main__":
    main()
