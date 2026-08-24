"""Stage 2 signals: kinds from real layers, dummy metadata omitted.

Landforms come from the compiled landforms.csv. Historic capitals, forests,
volcanoes and geothermal features come from Wikidata point harvests. Nothing
here invents a month, a reach band, or a kind without a source row.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

from twm.archetypes import LANDFORM_SIGNALS, MAX_ARCHETYPES, MIN_ARCHETYPE_WEIGHT
from twm.geo import GridIndex

CAPITAL_KM = 15.0
LANDFORM_KM = 60.0
FEATURE_KM = 60.0

# Kinds implied by provenance already on the published record. These are
# the same mappings as TIER_SIGNALS; they are not a fallback invention.
SOURCE_KINDS: dict[str, dict[str, float]] = {
    "unesco-whs": {"A2": 0.5},
    "wdpa": {"A9": 0.4},
    "ramsar-geopark": {"A9": 0.5, "A7": 0.3},
}


def load_landforms(path: Path) -> dict[str, list[str]]:
    """candidate numeric id -> landform tokens. Empty tokens are dropped."""
    out: dict[str, list[str]] = {}
    if not path.is_file():
        return out
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            forms = [t for t in (row.get("landforms") or "").split("|") if t]
            if not forms:
                continue
            cid = (row.get("candidate_id") or "").split("-")[-1]
            if cid:
                out[cid] = forms
    return out


def load_landform_points(path: Path) -> list[tuple[float, float, list[str]]]:
    """lat, lon, tokens — for places the id join misses."""
    out = []
    if not path.is_file():
        return out
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            forms = [t for t in (row.get("landforms") or "").split("|") if t]
            if not forms:
                continue
            try:
                out.append((float(row["lat"]), float(row["lon"]), forms))
            except (TypeError, ValueError, KeyError):
                continue
    return out


def load_kind_points(path: Path) -> list[tuple[float, float, str, float]]:
    """Harvest rows: lat, lon, kind, weight. Used for OSM/Wikidata fills."""
    out = []
    if not path.is_file():
        return out
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                kind = row.get("kind") or ""
                weight = float(row.get("weight") or 0)
                if not kind or weight < MIN_ARCHETYPE_WEIGHT:
                    continue
                out.append((float(row["lat"]), float(row["lon"]), kind, weight))
            except (TypeError, ValueError, KeyError):
                continue
    return out


def load_manual_kinds(path: Path) -> dict[str, dict[str, float]]:
    """Curated place_id -> kind vector. Only used when a place is still empty.

    Adil ruled the last 21 empties be filled from evidence, not the old
    0.5 A11/A12 dump. Each row must cite a source. Neighbour features are
    not assigned (Fes-volcanic rule).
    """
    out: dict[str, dict[str, float]] = {}
    if not path.is_file():
        return out
    rows = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(rows, dict):
        rows = rows.get("places") or []
    for row in rows:
        pid = row.get("place_id") or ""
        kind = row.get("kind") or ""
        try:
            weight = float(row.get("weight") or 0)
        except (TypeError, ValueError):
            continue
        if not pid or not kind or weight < MIN_ARCHETYPE_WEIGHT:
            continue
        out.setdefault(pid, {})
        out[pid][kind] = max(out[pid].get(kind, 0.0), weight)
    return out


def load_wdpa_points(path: Path) -> list[tuple[float, float, str]]:
    out = []
    if not path.is_file():
        return out
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                out.append((float(row["latitude"]), float(row["longitude"]),
                            row.get("WDPAID") or row.get("NAME") or ""))
            except (TypeError, ValueError, KeyError):
                continue
    return out


def load_points(path: Path) -> list[tuple[float, float, str]]:
    """qid/lat/lon harvest -> (lat, lon, qid)."""
    out = []
    if not path.is_file():
        return out
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            try:
                out.append((float(row["lat"]), float(row["lon"]), row.get("qid") or ""))
            except (TypeError, ValueError, KeyError):
                continue
    return out


def kinds_from_landforms(forms: list[str]) -> dict[str, float]:
    vec: dict[str, float] = {}
    for lf in forms:
        for code, strength in LANDFORM_SIGNALS.get(lf, {}).items():
            if strength > vec.get(code, 0.0):
                vec[code] = strength
    return vec


def qualifying_landform_kinds(forms: list[str]) -> dict[str, float]:
    """Drop tokens whose strongest kind is below the model's floor.

    River is 0.25 — that is why 157 empties stayed empty. A lake or coast
    in the same catchment still qualifies.
    """
    return {k: v for k, v in kinds_from_landforms(forms).items()
            if v >= MIN_ARCHETYPE_WEIGHT}


def geoname_tail(place_id: str) -> str:
    tail = place_id.split("-", 1)[-1]
    return tail[1:] if tail[:1].isalpha() and tail[1:].isdigit() else tail


def merge_kinds(existing: dict[str, float], extra: dict[str, float]) -> dict[str, float]:
    vec = dict(existing)
    for code, strength in extra.items():
        if strength > vec.get(code, 0.0):
            vec[code] = strength
    ranked = sorted(vec.items(), key=lambda kv: -kv[1])[:MAX_ARCHETYPES]
    return {k: round(v, 3) for k, v in ranked if v >= MIN_ARCHETYPE_WEIGHT}


def place_kind_vec(place: dict) -> dict[str, float]:
    weights = place.get("archetype_weights") or []
    vec = {}
    for i, code in enumerate(place.get("archetypes") or []):
        vec[code] = float(weights[i]) if i < len(weights) else 0.5
    return vec


def write_kinds(place: dict, vec: dict[str, float]) -> None:
    ranked = sorted(vec.items(), key=lambda kv: -kv[1])
    place["archetypes"] = [k for k, _ in ranked]
    place["archetype_weights"] = [round(v, 2) for _, v in ranked]


def omit_dummy_metadata(place: dict) -> None:
    """Doc 5 §3.8: reach and best_months are computed or omitted, never dummy."""
    place.pop("reach", None)
    place.pop("best_months", None)


def osm_livability_iso2(path: Path) -> set[str]:
    out = set()
    if not path.is_file():
        return out
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            iso = (row.get("iso") or "").strip().upper()
            if iso:
                out.add(iso)
    return out


def livability_by_country(countries_raw: dict, osm_iso2: set[str]) -> dict[str, str]:
    """country name -> scored | unscored. OSM harvest reached 41 countries."""
    out = {}
    for name, facts in countries_raw.items():
        iso = str((facts or {}).get("iso") or "").strip().upper()
        out[name] = "scored" if iso in osm_iso2 else "unscored"
    return out


def nearest_payload(index: GridIndex, lat: float, lon: float, radius_km: float):
    hits = list(index.near(lat, lon, radius_km))
    return hits[0] if hits else None


def index_points(points, cell: float = 0.5) -> GridIndex:
    index = GridIndex(cell_deg=cell)
    for lat, lon, payload in points:
        index.add(lat, lon, payload)
    return index


def _assign_points_to_nearest(
    places: list[dict],
    points: list[tuple[float, float, str]],
    radius_km: float,
) -> set[int]:
    """Each source point belongs to at most one place — the nearest in range.

    Assigning a volcano to every city in a 60 km disk made Fes volcanic.
    """
    if not points:
        return set()
    index = index_points(((p["lat"], p["lon"], i) for i, p in enumerate(places)), 0.5)
    hit: set[int] = set()
    for lat, lon, _qid in points:
        found = nearest_payload(index, lat, lon, radius_km)
        if found:
            hit.add(found[1])
    return hit


def apply_signals(
    places: list[dict],
    data_dir: Path,
) -> dict[str, int]:
    """Enrich published places in place. Scores and ids are not touched."""
    land_by_id = load_landforms(data_dir / "landforms.csv")
    land_pts = load_landform_points(data_dir / "landforms.csv")
    land_index = index_points(((lat, lon, forms) for lat, lon, forms in land_pts), 0.5)
    capitals = load_points(data_dir / "wikidata_historic_capitals.csv")
    volcanoes = load_points(data_dir / "wikidata_volcanoes.csv")
    geothermal = load_points(data_dir / "wikidata_geothermal.csv")
    forests = load_points(data_dir / "wikidata_forests.csv")

    capital_at = _assign_points_to_nearest(places, capitals, CAPITAL_KM)
    volcano_at = _assign_points_to_nearest(places, volcanoes, FEATURE_KM)
    geo_at = _assign_points_to_nearest(places, geothermal, FEATURE_KM)
    forest_at = _assign_points_to_nearest(places, forests, FEATURE_KM)
    wdpa = load_wdpa_points(data_dir / "wdpa_world.csv")
    wdpa_at = _assign_points_to_nearest(places, wdpa, FEATURE_KM)
    extra_pts = (
        load_kind_points(data_dir / "osm_empty_features.csv")
        + load_kind_points(data_dir / "wikidata_empty_features.csv")
    )
    extra_at: dict[int, dict[str, float]] = {}
    if extra_pts:
        place_index = index_points(
            ((p["lat"], p["lon"], i) for i, p in enumerate(places)), 0.5)
        for lat, lon, kind, weight in extra_pts:
            found = nearest_payload(place_index, lat, lon, FEATURE_KM)
            if not found:
                continue
            idx = found[1]
            extra_at.setdefault(idx, {})
            extra_at[idx][kind] = max(extra_at[idx].get(kind, 0.0), weight)
    manual = load_manual_kinds(data_dir / "manual_kinds.json")

    stats = {
        "landform_id": 0, "landform_near": 0, "historic_capital": 0,
        "volcano": 0, "geothermal": 0, "forest": 0, "wdpa_near": 0,
        "harvest": 0, "manual": 0, "still_empty": 0,
    }

    for i, p in enumerate(places):
        vec = place_kind_vec(p)
        forms = land_by_id.get(geoname_tail(p["place_id"]))
        if forms:
            q = qualifying_landform_kinds(forms)
            if q:
                vec = merge_kinds(vec, q)
                stats["landform_id"] += 1
        if not vec:
            # Nearest landform that actually clears the weight floor.
            hits = list(land_index.near(p["lat"], p["lon"], LANDFORM_KM))
            for _d, forms in hits:
                q = qualifying_landform_kinds(forms)
                if q:
                    vec = merge_kinds(vec, q)
                    stats["landform_near"] += 1
                    break

        if i in capital_at:
            p["historic_capital"] = True
            vec = merge_kinds(vec, {"A1": 0.9})
            stats["historic_capital"] += 1
        if i in volcano_at:
            vec = merge_kinds(vec, {"A8": 0.95})
            stats["volcano"] += 1
        if i in geo_at:
            vec = merge_kinds(vec, {"A8": 0.9})
            stats["geothermal"] += 1
        if i in forest_at:
            vec = merge_kinds(vec, {"A6": 0.8})
            stats["forest"] += 1
        if i in wdpa_at:
            vec = merge_kinds(vec, {"A9": 0.4})
            stats["wdpa_near"] += 1
        if i in extra_at and not vec:
            # Harvest points bind to the nearest published place so a
            # volcano does not paint a 60 km disk. They only *write* when
            # that place still has no qualifying kind — otherwise a nearby
            # mountain evicts a weaker real kind (Fes lost WHS A2 to A4).
            vec = merge_kinds(vec, extra_at[i])
            stats["harvest"] += 1
        if not vec:
            extra = manual.get(p.get("place_id") or "")
            if extra:
                vec = merge_kinds(vec, extra)
                stats["manual"] += 1

        for src in p.get("sources") or []:
            extra = SOURCE_KINDS.get(src)
            if extra:
                vec = merge_kinds(vec, extra)

        write_kinds(p, vec)
        omit_dummy_metadata(p)
        if not p.get("archetypes"):
            stats["still_empty"] += 1

    return stats
