"""Why did a place score what it scored?

Re-runs the asset assignment and prints the tier counts, pillar values and
composite for named candidates, side by side. Nothing here changes the model --
it reads the same numbers the pipeline used.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.environ.get("TWM_PKG", "/home/claude/twm/db"))

from twm.archetypes import derive_archetypes
from twm.assets import assign_area_assets, assign_assets, split_point_and_area
from twm.config import ALL_TIERS, PARAMS, PILLAR_OF
from twm.scoring import score_country
from twm.sources import ghsl, protected

DATA = Path(os.environ.get("TWM_DATA", "/home/claude/twm/data"))
sys.path.insert(0, str(Path(__file__).parent))
from build_world import LocalWikidata, LocalWorldHeritage  # noqa: E402


def main(country, names):
    countries_raw = json.loads((DATA / "countries.json").read_text(encoding="utf-8"))
    candidates = list(ghsl.UrbanCentres(path=DATA / "settlements_agglomerated.csv").load())
    assets = list(LocalWorldHeritage(DATA / "whs_expanded.xml").load())
    if (DATA / "wdpa_normalised.csv").exists():
        assets += list(protected.ProtectedAreas(path=DATA / "wdpa_normalised.csv").load())
    iso2 = {v.get("iso", "").lower(): k for k, v in countries_raw.items() if v.get("iso")}
    if (DATA / "wikidata_heritage.csv").exists():
        assets += list(LocalWikidata(DATA / "wikidata_heritage.csv", iso2).load())
    if (DATA / "wikidata_livability.csv").exists():
        assets += list(LocalWikidata(DATA / "wikidata_livability.csv", iso2,
                                     prefix="wd-l").load())
    if (DATA / "wikidata_institutions.csv").exists():
        assets += list(LocalWikidata(DATA / "wikidata_institutions.csv", iso2,
                                     prefix="wd-i").load())
    if (DATA / "cuisine_regions.csv").exists():
        from twm.sources import cuisine
        assets += list(cuisine.CuisineRegions(path=DATA / "cuisine_regions.csv",
                                              strict=False).load())

    point, area = split_point_and_area(assets)
    candidates, _orphans = assign_assets(candidates, point, PARAMS)
    assign_area_assets(candidates, area)
    for c in candidates:
        c.archetypes = derive_archetypes(c)

    group = [c for c in candidates if c.country == country]
    scored = score_country(group, PARAMS)
    by_name = {s.candidate.name: s for s in scored}
    top = max((s.score for s in scored), default=1.0) or 1.0

    print(f"\n{country}: {len(group)} candidates, top raw score {top:.4f}\n")
    hdr = f"{'place':<24}{'score':>7}{'H':>8}{'N':>8}{'L':>8}{'feas':>7}  tiers"
    print(hdr)
    print("-" * len(hdr))
    for n in names:
        s = by_name.get(n)
        if not s:
            print(f"{n:<24}  -- not a candidate --")
            continue
        c = s.candidate
        tiers = ", ".join(
            f"{t}×{k}" for t, k in sorted(c.tier_counts.items(), key=lambda kv: -kv[1]) if k
        ) or "(none)"
        print(f"{n[:23]:<24}{100*s.score/top:>7.0f}{s.h:>8.3f}{s.n:>8.3f}"
              f"{s.liv:>8.3f}{s.feasibility:>7.2f}  {tiers}")

    print("\ntier weights in play:")
    seen = set()
    for n in names:
        s = by_name.get(n)
        if s:
            seen |= {t for t, k in s.candidate.tier_counts.items() if k}
    for t in sorted(seen):
        print(f"   {t:<26} weight {ALL_TIERS[t]:>5}  pillar {PILLAR_OF[t]}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
