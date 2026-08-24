"""Harvest Wikidata point layers Stage 2 needs and the compiled landform file lacks.

Queries are real SPARQL against WDQS. Nothing is invented. The public endpoint
currently allows one request per minute; this script waits between pages.

A1 comes from P1376 (capital of) when the state is a historical country, or
when the capital claim has an end date — former capitals, not the current
seat-of-government list.

A6 / A8 come from instance-of forest / rainforest / volcano / geothermal
features with coordinates. landforms.csv has none of those classes.
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
ENDPOINT = "https://query.wikidata.org/sparql"
UA = os.environ.get(
    "TWM_USER_AGENT",
    "TravelersWorldMap/1.0 (stage-2 signal harvest; local build)",
)
PAUSE_S = 70

# Direct classes only — P279* trees time out on the public endpoint.
QUERIES = {
    "wikidata_historic_capitals.csv": """
SELECT ?item ?coord WHERE {
  ?item p:P1376 ?stmt .
  ?stmt ps:P1376 ?state .
  ?stmt pq:P582 ?end .
  ?item wdt:P625 ?coord .
}
LIMIT 5000
""",
    "wikidata_volcanoes.csv": """
SELECT ?item ?coord WHERE {
  ?item wdt:P31 wd:Q8072 .
  ?item wdt:P625 ?coord .
}
LIMIT 5000
""",
    "wikidata_geothermal.csv": """
SELECT ?item ?coord WHERE {
  VALUES ?class { wd:Q83407 wd:Q1773807 }
  ?item wdt:P31 ?class .
  ?item wdt:P625 ?coord .
}
LIMIT 3000
""",
    "wikidata_forests.csv": """
SELECT ?item ?coord WHERE {
  VALUES ?class { wd:Q4421 wd:Q132453 }
  ?item wdt:P31 ?class .
  ?item wdt:P625 ?coord .
  ?item wikibase:sitelinks ?links .
  FILTER(?links >= 5)
}
LIMIT 5000
""",
}


def parse_point(wkt: str) -> tuple[float, float] | None:
    if "Point(" not in wkt:
        return None
    body = wkt[wkt.index("Point(") + 6:].rstrip(")")
    try:
        lon_s, lat_s = body.split()[:2]
        return float(lat_s), float(lon_s)
    except (ValueError, IndexError):
        return None


def query(sparql: str) -> list[dict]:
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": sparql, "format": "json"})
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept": "application/sparql-results+json"},
    )
    last_err = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = json.loads(resp.read().decode())
            return data["results"]["bindings"]
        except urllib.error.HTTPError as exc:
            last_err = exc
            wait = PAUSE_S * (attempt + 1)
            print(f"  HTTP {exc.code}; waiting {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"wikidata query failed: {last_err}")


def write_csv(path: Path, rows: list[dict]) -> int:
    n = 0
    with path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["qid", "lat", "lon"])
        w.writeheader()
        seen = set()
        for r in rows:
            qid = r.get("item", {}).get("value", "").rsplit("/", 1)[-1]
            pt = parse_point(r.get("coord", {}).get("value", ""))
            if not qid or pt is None or qid in seen:
                continue
            seen.add(qid)
            w.writerow({"qid": qid, "lat": f"{pt[0]:.5f}", "lon": f"{pt[1]:.5f}"})
            n += 1
    return n


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    first = True
    for filename, sparql in QUERIES.items():
        path = DATA / filename
        if path.is_file() and path.stat().st_size > 40:
            print(f"[skip] {filename} already present", flush=True)
            continue
        if not first:
            print(f"waiting {PAUSE_S}s for WDQS…", flush=True)
            time.sleep(PAUSE_S)
        first = False
        print(f"query {filename}", flush=True)
        rows = query(sparql)
        n = write_csv(path, rows)
        print(f"  wrote {n} points -> {path.name}", flush=True)


if __name__ == "__main__":
    main()
