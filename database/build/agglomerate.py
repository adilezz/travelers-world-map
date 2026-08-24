"""Collapse GeoNames settlements into urban centres.

GHS-UCDB's unit is the contiguous built-up area -- the place a traveler
experiences. GeoNames' unit is the named populated place, so a city appears
several times over as its own districts and suburbs. Left alone, a suburb
centroid often sits nearer a medina than the city centroid does, and the
catchment rule hands the suburb the city's heritage: Fes lost its own medina to
'New Fes', and Meknes lost Volubilis to 'Ouislane'.

The fix belongs in the candidate layer, not in the model. A settlement is
absorbed into a larger neighbour when it is inside that neighbour's radius AND
materially smaller than it, so two comparable cities never merge. The radius
grows as the city absorbs, which is how Aït Melloul reaches Agadir.
"""
import csv
import os
import sys
from pathlib import Path

sys.path.insert(0, os.environ.get("TWM_PKG", str(Path(__file__).resolve().parents[1])))

from twm.candidates import agglomerate_settlements, population_count
from twm.types import Candidate

DATA = Path(os.environ.get("TWM_DATA", str(Path(__file__).resolve().parents[1] / "data")))


def main():
    rows = []
    with open(DATA / "settlements_ucdb.csv", encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            rows.append(Candidate(
                candidate_id=r["ID_UC_G0"], name=r["name"], country=r["country"],
                lat=float(r["latitude"]), lon=float(r["longitude"]),
                is_site=False, population=float(r["population"] or 0),
            ))

    kept, log = agglomerate_settlements(rows)
    kept.sort(key=lambda c: (c.country, -population_count(c)))
    folded = {row["kept"]: [] for row in log}
    for row in log:
        folded.setdefault(row["kept"], []).append(row["folded"])

    with open(DATA / "settlements_agglomerated.csv", "w", encoding="utf-8", newline="") as fo:
        w = csv.DictWriter(fo, fieldnames=["ID_UC_G0", "name", "country", "population",
                                           "latitude", "longitude", "absorbed"])
        w.writeheader()
        for c in kept:
            w.writerow({
                "ID_UC_G0": c.candidate_id, "name": c.name, "country": c.country,
                "population": population_count(c),
                "latitude": c.lat, "longitude": c.lon,
                "absorbed": len(c.merged_from),
            })

    print(f"settlements {len(rows)} -> {len(kept)} urban centres "
          f"({len(rows) - len(kept)} absorbed)")
    for probe in ("Fes", "Meknes", "Kyoto", "Kathmandu", "Paris", "Agadir"):
        hit = next((c for c in kept if c.name == probe), None)
        if hit:
            names = [r["folded"] for r in log if r["kept"] == probe][:4]
            print(f"  {probe:<10} pop={population_count(hit):>12,.0f} "
                  f"absorbed={len(hit.merged_from)} {names}")
        else:
            print(f"  {probe:<10} NOT KEPT")


if __name__ == "__main__":
    main()
