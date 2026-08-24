"""Harvest distinctive OSM/Wikidata features around places that still have no kind.

Each feature is later assigned to the nearest published place — not to every
city in a disk. Parish churches, farmland and rivers are excluded: those fire
on almost every settlement and would invent a kind.
"""
from __future__ import annotations

import csv
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DATA = Path(os.environ.get("TWM_DATA", str(Path(__file__).resolve().parents[1] / "data")))
CACHE = DATA / "cache" / "empty_kinds"
OVERPASS_ENDPOINTS = [
    os.environ.get("TWM_OVERPASS", "https://overpass-api.de/api/interpreter"),
    "https://overpass.kumi.systems/api/interpreter",
]
WDQS = "https://query.wikidata.org/sparql"
UA = os.environ.get(
    "TWM_USER_AGENT",
    "TravelersWorldMap/1.0 (empty-kind harvest; local build)",
)
OVERPASS_PAUSE = 6.0
WDQS_PAUSE = 70.0
AROUND_M = 15_000
BATCH = 4

# Distinctive tags only. historic=church / landuse=forest / waterway=river
# are omitted on purpose — they are the European default, not a kind of place.
HISTORIC = "castle|palace|fort|fortress|city_walls|archaeological_site|monastery"
BUILDING = "castle|palace|cathedral"
NATURAL = (
    "beach|bay|cape|peak|ridge|cliff|glacier|desert|dune|"
    "volcano|geyser|hot_spring|wetland"
)

OSM_KIND = {
    ("historic", "castle"): ("A2", 0.5),
    ("historic", "palace"): ("A2", 0.5),
    ("historic", "fort"): ("A2", 0.5),
    ("historic", "fortress"): ("A2", 0.5),
    ("historic", "city_walls"): ("A2", 0.5),
    ("historic", "archaeological_site"): ("A2", 0.5),
    ("historic", "monastery"): ("A2", 0.5),
    ("building", "castle"): ("A2", 0.5),
    ("building", "palace"): ("A2", 0.5),
    ("building", "cathedral"): ("A2", 0.5),
    ("natural", "beach"): ("A3", 0.9),
    ("natural", "bay"): ("A3", 0.9),
    ("natural", "cape"): ("A3", 0.7),
    ("natural", "peak"): ("A4", 0.9),
    ("natural", "ridge"): ("A4", 0.7),
    ("natural", "cliff"): ("A4", 0.5),
    ("natural", "glacier"): ("A4", 0.7),
    ("natural", "desert"): ("A5", 0.95),
    ("natural", "dune"): ("A5", 0.8),
    ("natural", "wetland"): ("A7", 0.6),
    ("water", "lake"): ("A7", 0.85),
    ("waterway", "waterfall"): ("A7", 0.7),
    ("natural", "volcano"): ("A8", 0.95),
    ("natural", "geyser"): ("A8", 0.9),
    ("natural", "hot_spring"): ("A8", 0.9),
    ("boundary", "protected_area"): ("A9", 0.4),
    ("boundary", "national_park"): ("A9", 0.8),
    ("leisure", "nature_reserve"): ("A9", 0.8),
    ("pilgrimage", "yes"): ("A10", 0.95),
}

WD_CLASS_KIND = {
    "Q23413": ("A2", 0.5),    # castle
    "Q751876": ("A2", 0.5),   # château
    "Q839954": ("A2", 0.5),   # archaeological site
    "Q16560": ("A2", 0.5),    # palace
    "Q57821": ("A2", 0.5),    # fortress
    "Q44539": ("A10", 0.6),   # temple
    "Q2977": ("A10", 0.6),    # cathedral
    "Q8502": ("A4", 0.9),     # mountain
    "Q8072": ("A8", 0.95),    # volcano
    "Q23397": ("A7", 0.85),   # lake
    "Q34038": ("A7", 0.7),    # waterfall
    "Q170321": ("A7", 0.6),   # wetland
    "Q4421": ("A6", 0.8),     # forest
    "Q132453": ("A6", 0.95),  # rainforest
    "Q8514": ("A5", 0.95),    # desert
    "Q25391": ("A5", 0.8),    # dune
    "Q35148": ("A5", 0.7),    # oasis
    "Q39816": ("A3", 0.9),    # bay
    "Q40080": ("A3", 0.9),    # beach
    "Q185113": ("A3", 0.7),   # cape
    "Q46169": ("A9", 0.8),    # national park
    "Q23442": ("A3", 0.7),    # island
    "Q45776": ("A3", 0.6),    # fjord
    "Q150784": ("A4", 0.5),   # canyon
    "Q180874": ("A5", 0.7),   # salt pan
    "Q23552": ("A5", 0.6),    # steppe
    "Q43262": ("A9", 0.8),    # tundra
    "Q35558": ("A9", 0.3),    # cave — at the floor, not below it
}


def _centre(el: dict) -> tuple[float | None, float | None]:
    if "lat" in el and "lon" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    return (c["lat"], c["lon"]) if c else (None, None)


def kind_from_tags(tags: dict) -> tuple[str, float] | None:
    if tags.get("pilgrimage") == "yes":
        return "A10", 0.95
    if tags.get("craft"):
        return "A11", 0.6
    for key in ("historic", "building", "natural", "water", "waterway",
                "boundary", "leisure"):
        mapped = OSM_KIND.get((key, tags.get(key, "")))
        if mapped:
            return mapped
    return None


def overpass_query(batch: list[dict]) -> str:
    # Nodes + way centres only. Relations (national parks, huge woods)
    # blow the public endpoint; WDPA already covers A9 parks.
    parts = []
    for p in batch:
        lat, lon = p["lat"], p["lon"]
        around = f"around:{AROUND_M},{lat},{lon}"
        parts.append(f'node({around})["historic"~"^({HISTORIC})$"];')
        parts.append(f'way({around})["historic"~"^({HISTORIC})$"];')
        parts.append(f'node({around})["building"~"^({BUILDING})$"];')
        parts.append(f'node({around})["natural"~"^({NATURAL})$"];')
        parts.append(f'way({around})["natural"~"^({NATURAL})$"];')
        parts.append(f'node({around})["water"="lake"];')
        parts.append(f'node({around})["waterway"="waterfall"];')
        parts.append(f'node({around})["leisure"="nature_reserve"];')
        parts.append(f'node({around})["pilgrimage"="yes"];')
    return (
        f"[out:json][timeout:90][maxsize:32000000];(\n  "
        + "\n  ".join(parts)
        + "\n);\nout center tags qt;"
    )


def post_overpass(query: str) -> list[dict]:
    data = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for attempt in range(6):
        endpoint = OVERPASS_ENDPOINTS[attempt % len(OVERPASS_ENDPOINTS)]
        req = urllib.request.Request(
            endpoint, data=data,
            headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read().decode())
            return payload.get("elements") or []
        except urllib.error.HTTPError as exc:
            last = exc
            wait = OVERPASS_PAUSE * (attempt + 2)
            print(f"  overpass {endpoint} HTTP {exc.code}; waiting {wait}s", flush=True)
            time.sleep(wait)
        except OSError as exc:
            last = exc
            wait = OVERPASS_PAUSE * (attempt + 2)
            print(f"  overpass {endpoint} {exc}; waiting {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"overpass failed: {last}")


def harvest_osm(empties: list[dict]) -> list[dict]:
    CACHE.mkdir(parents=True, exist_ok=True)
    rows = []
    seen = set()
    batches = [empties[i:i + BATCH] for i in range(0, len(empties), BATCH)]
    for n, batch in enumerate(batches):
        cache_path = CACHE / f"osm_{n:03d}.json"
        if cache_path.is_file() and cache_path.stat().st_size >= 2:
            elements = json.loads(cache_path.read_text(encoding="utf-8"))
            print(f"[osm] batch {n+1}/{len(batches)} cache {len(elements)}", flush=True)
        else:
            print(f"[osm] batch {n+1}/{len(batches)} query {len(batch)} points", flush=True)
            elements = post_overpass(overpass_query(batch))
            cache_path.write_text(json.dumps(elements), encoding="utf-8")
            time.sleep(OVERPASS_PAUSE)
        for el in elements:
            lat, lon = _centre(el)
            tags = el.get("tags") or {}
            mapped = kind_from_tags(tags)
            if lat is None or mapped is None:
                continue
            key = (el.get("type"), el.get("id"))
            if key in seen:
                continue
            seen.add(key)
            kind, weight = mapped
            rows.append({
                "id": f"osm-{el.get('type')}-{el.get('id')}",
                "lat": f"{lat:.5f}", "lon": f"{lon:.5f}",
                "kind": kind, "weight": weight,
                "tag": next((f"{k}={tags[k]}" for k, _ in OSM_KIND if tags.get(k)), ""),
            })
    return rows


def wdqs(sparql: str) -> list[dict]:
    url = WDQS + "?" + urllib.parse.urlencode({"query": sparql, "format": "json"})
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept": "application/sparql-results+json"})
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())["results"]["bindings"]
        except urllib.error.HTTPError as exc:
            last = exc
            wait = WDQS_PAUSE * (attempt + 1)
            print(f"  wdqs HTTP {exc.code}; waiting {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"wdqs failed: {last}")


def parse_point(wkt: str) -> tuple[float, float] | None:
    if "Point(" not in wkt:
        return None
    body = wkt[wkt.index("Point(") + 6:].rstrip(")")
    try:
        lon_s, lat_s = body.split()[:2]
        return float(lat_s), float(lon_s)
    except (ValueError, IndexError):
        return None


# Worldwide class harvest — same pattern as harvest_wikidata_signals.py.
# Each point later binds to the nearest published place, not a 60 km disk.
WD_BULK = {
    "heritage": (
        """
SELECT ?item ?coord ?class WHERE {
  VALUES ?class { wd:Q23413 wd:Q751876 wd:Q839954 wd:Q16560 wd:Q57821 }
  ?item wdt:P31 ?class .
  ?item wdt:P625 ?coord .
}
LIMIT 8000
""",
    ),
    "land": (
        """
SELECT ?item ?coord ?class WHERE {
  {
    VALUES ?class { wd:Q8514 wd:Q25391 wd:Q40080 wd:Q39816 wd:Q185113 wd:Q35148 }
    ?item wdt:P31 ?class .
    ?item wdt:P625 ?coord .
  } UNION {
    VALUES ?class { wd:Q8502 }
    ?item wdt:P31 ?class .
    ?item wdt:P625 ?coord .
    ?item wikibase:sitelinks ?links .
    FILTER(?links >= 8)
  }
}
LIMIT 8000
""",
    ),
    "water_sacred": (
        """
SELECT ?item ?coord ?class WHERE {
  {
    VALUES ?class { wd:Q34038 wd:Q170321 wd:Q46169 wd:Q44539 wd:Q2977 }
    ?item wdt:P31 ?class .
    ?item wdt:P625 ?coord .
  } UNION {
    VALUES ?class { wd:Q23397 }
    ?item wdt:P31 ?class .
    ?item wdt:P625 ?coord .
    ?item wikibase:sitelinks ?links .
    FILTER(?links >= 10)
  }
}
LIMIT 8000
""",
    ),
    "land2": (
        """
SELECT ?item ?coord ?class WHERE {
  {
    VALUES ?class { wd:Q45776 wd:Q150784 wd:Q180874 wd:Q23552 wd:Q43262 wd:Q35558 }
    ?item wdt:P31 ?class .
    ?item wdt:P625 ?coord .
  } UNION {
    VALUES ?class { wd:Q23442 }
    ?item wdt:P31 ?class .
    ?item wdt:P625 ?coord .
    ?item wikibase:sitelinks ?links .
    FILTER(?links >= 8)
  }
}
LIMIT 8000
""",
    ),
}


def harvest_wikidata_bulk() -> list[dict]:
    """Few SPARQL pages, cached. Faster and cleaner than 417 around-searches."""
    CACHE.mkdir(parents=True, exist_ok=True)
    rows = []
    seen = set()
    first = True
    for name, (sparql,) in WD_BULK.items():
        cache_path = CACHE / f"wd_bulk_{name}.json"
        if cache_path.is_file() and cache_path.stat().st_size >= 2:
            bindings = json.loads(cache_path.read_text(encoding="utf-8"))
            print(f"[wd-bulk] {name} cache {len(bindings)}", flush=True)
        else:
            if not first:
                print(f"  waiting {WDQS_PAUSE}s for WDQS", flush=True)
                time.sleep(WDQS_PAUSE)
            first = False
            print(f"[wd-bulk] {name} query", flush=True)
            bindings = wdqs(sparql)
            cache_path.write_text(json.dumps(bindings), encoding="utf-8")
        for b in bindings:
            qid = b.get("item", {}).get("value", "").rsplit("/", 1)[-1]
            cls = b.get("class", {}).get("value", "").rsplit("/", 1)[-1]
            pt = parse_point(b.get("coord", {}).get("value", ""))
            mapped = WD_CLASS_KIND.get(cls)
            if not qid or not pt or not mapped or qid in seen:
                continue
            seen.add(qid)
            rows.append({
                "id": qid, "lat": f"{pt[0]:.5f}", "lon": f"{pt[1]:.5f}",
                "kind": mapped[0], "weight": mapped[1], "tag": cls,
            })
    return rows


AROUND_BATCH = 5
AROUND_KM = 15


def harvest_wikidata(empties: list[dict]) -> list[dict]:
    """UNION of around-searches, five empties per WDQS request, cached."""
    CACHE.mkdir(parents=True, exist_ok=True)
    classes = " ".join(f"wd:{c}" for c in WD_CLASS_KIND)
    rows = []
    seen = set()
    batches = [empties[i:i + AROUND_BATCH] for i in range(0, len(empties), AROUND_BATCH)]
    for n, batch in enumerate(batches):
        cache_path = CACHE / f"wd_around_{n:03d}.json"
        if cache_path.is_file() and cache_path.stat().st_size >= 2:
            bindings = json.loads(cache_path.read_text(encoding="utf-8"))
            print(f"[wd-around] batch {n+1}/{len(batches)} cache {len(bindings)}", flush=True)
        else:
            unions = []
            for p in batch:
                unions.append(f"""
  {{
    SERVICE wikibase:around {{
      ?item wdt:P625 ?coord .
      bd:serviceParam wikibase:center "Point({p['lon']} {p['lat']})"^^geo:wktLiteral .
      bd:serviceParam wikibase:radius "{AROUND_KM}" .
    }}
    ?item wdt:P31 ?class .
    VALUES ?class {{ {classes} }}
  }}""")
            sparql = (
                "SELECT ?item ?coord ?class WHERE {\n"
                + " UNION ".join(unions)
                + "\n} LIMIT 200"
            )
            ids = ",".join(p["place_id"] for p in batch)
            print(f"[wd-around] batch {n+1}/{len(batches)} {ids}", flush=True)
            bindings = wdqs(sparql)
            cache_path.write_text(json.dumps(bindings), encoding="utf-8")
            time.sleep(WDQS_PAUSE)
        for b in bindings:
            qid = b.get("item", {}).get("value", "").rsplit("/", 1)[-1]
            cls = b.get("class", {}).get("value", "").rsplit("/", 1)[-1]
            pt = parse_point(b.get("coord", {}).get("value", ""))
            mapped = WD_CLASS_KIND.get(cls)
            if not qid or not pt or not mapped or qid in seen:
                continue
            seen.add(qid)
            rows.append({
                "id": qid, "lat": f"{pt[0]:.5f}", "lon": f"{pt[1]:.5f}",
                "kind": mapped[0], "weight": mapped[1], "tag": cls,
            })
    return rows


def merge_feature_files(path: Path, extra: list[dict]) -> list[dict]:
    """Keep existing bulk points and add around/OSM rows by id."""
    seen = {}
    if path.is_file():
        with path.open(encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                if row.get("id"):
                    seen[row["id"]] = row
    for row in extra:
        seen[row["id"]] = row
    return list(seen.values())


def write_features(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["id", "lat", "lon", "kind", "weight", "tag"])
        w.writeheader()
        w.writerows(rows)


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm-only", action="store_true")
    ap.add_argument("--wd-only", action="store_true")
    ap.add_argument("--wd-around", action="store_true",
                    help="UNION around-search over remaining empties")
    args = ap.parse_args()
    empty_path = DATA / "empty_kinds_remaining.json"
    if not empty_path.is_file():
        empty_path = DATA / "empty_kinds.json"
    empties = json.loads(empty_path.read_text(encoding="utf-8"))
    print(f"empties {len(empties)}", flush=True)
    if not args.osm_only:
        if args.wd_around:
            around = harvest_wikidata(empties)
            wd_rows = merge_feature_files(DATA / "wikidata_empty_features.csv", around)
        else:
            wd_rows = harvest_wikidata_bulk()
        write_features(DATA / "wikidata_empty_features.csv", wd_rows)
        print(f"wikidata features {len(wd_rows)}", flush=True)
    if not args.wd_only:
        osm_rows = harvest_osm(empties)
        write_features(DATA / "osm_empty_features.csv", osm_rows)
        print(f"osm features {len(osm_rows)}", flush=True)


if __name__ == "__main__":
    main()
