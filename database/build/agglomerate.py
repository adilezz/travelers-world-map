"""Collapse GeoNames settlements into urban centres.

GHS-UCDB's unit is the contiguous built-up area -- the place a traveler
experiences. GeoNames' unit is the named populated place, so a city appears
several times over as its own districts and suburbs. Left alone, a suburb
centroid often sits nearer a medina than the city centroid does, and the
catchment rule hands the suburb the city's heritage: Fes lost its own medina to
'New Fes', and Meknes lost Volubilis to 'Ouislane'.

The fix belongs in the candidate layer, not in the model. A settlement is
absorbed into a larger neighbour when it is inside that neighbour's radius AND
materially smaller than it, so two comparable cities never merge.
"""
import csv
import math
import os
from pathlib import Path

DATA = Path(os.environ.get("TWM_DATA", "/home/claude/twm/data"))

SMALLER_THAN = 0.40   # absorb only if the neighbour is under 40% of the head's population
CELL = 0.25           # ~28 km grid cells, wider than the largest radius used


def radius_km(pop: float) -> float:
    if pop >= 1_000_000:
        return 18.0
    if pop >= 250_000:
        return 12.0
    if pop >= 50_000:
        return 8.0
    return 5.0


def hav(a, b):
    p = math.pi / 180
    dla, dlo = (b["lat"] - a["lat"]) * p, (b["lon"] - a["lon"]) * p
    la1, la2 = a["lat"] * p, b["lat"] * p
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def main():
    rows = []
    with open(DATA / "settlements_ucdb.csv", encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            rows.append({"id": r["ID_UC_G0"], "name": r["name"], "country": r["country"],
                         "pop": float(r["population"] or 0),
                         "lat": float(r["latitude"]), "lon": float(r["longitude"])})
    rows.sort(key=lambda r: -r["pop"])

    grid = {}
    for i, r in enumerate(rows):
        grid.setdefault((int(r["lat"] / CELL), int(r["lon"] / CELL)), []).append(i)

    absorbed = [False] * len(rows)
    merged_into = {}
    for i, head in enumerate(rows):
        if absorbed[i]:
            continue
        R = radius_km(head["pop"])
        span = int(R / (CELL * 111.32)) + 1
        gy, gx = int(head["lat"] / CELL), int(head["lon"] / CELL)
        for dy in range(-span, span + 1):
            for dx in range(-span, span + 1):
                for j in grid.get((gy + dy, gx + dx), ()):
                    if j <= i or absorbed[j]:
                        continue
                    nb = rows[j]
                    if nb["country"] != head["country"]:
                        continue
                    if nb["pop"] > head["pop"] * SMALLER_THAN:
                        continue
                    if hav(head, nb) <= R:
                        absorbed[j] = True
                        merged_into.setdefault(head["id"], []).append(nb["name"])
                        head["pop"] += nb["pop"]

    kept = [r for i, r in enumerate(rows) if not absorbed[i]]
    kept.sort(key=lambda r: (r["country"], -r["pop"]))
    with open(DATA / "settlements_agglomerated.csv", "w", encoding="utf-8", newline="") as fo:
        w = csv.DictWriter(fo, fieldnames=["ID_UC_G0", "name", "country", "population",
                                           "latitude", "longitude", "absorbed"])
        w.writeheader()
        for r in kept:
            w.writerow({"ID_UC_G0": r["id"], "name": r["name"], "country": r["country"],
                        "population": r["pop"], "latitude": r["lat"], "longitude": r["lon"],
                        "absorbed": len(merged_into.get(r["id"], []))})

    print(f"settlements {len(rows)} -> {len(kept)} urban centres "
          f"({len(rows) - len(kept)} absorbed)")
    for probe in ("Fes", "Meknes", "Kyoto", "Kathmandu", "Paris"):
        hit = next((r for r in kept if r["name"] == probe), None)
        if hit:
            print(f"  {probe:<10} pop={hit['pop']:>12,.0f} "
                  f"absorbed={len(merged_into.get(hit['id'], []))} "
                  f"{merged_into.get(hit['id'], [])[:4]}")
        else:
            print(f"  {probe:<10} NOT KEPT")


if __name__ == "__main__":
    main()
