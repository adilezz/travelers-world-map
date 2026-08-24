"""Bundle identity: one build number, counts that match the files, stable place_ids.

The repository once told three stories about the same product — the manifest,
the build report, and the client each named a different bundle. This module is
the single story. It is also the gate for document 5 P10: place_id is a
migration. A rebuild that reuses an id for a different place, or that changes
an id without a mapping table, fails.

The build number is a content hash of the sorted place_id list. Same identities,
same number. A changed id changes the number. One value, written to the
manifest, the build report, verification.txt, and the client's about line.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Iterable

from twm.config import same_identity_country

# Keys in a mapping file that are notes, not moves.
_META = {"_comment", "comment", "description", "moved"}


def build_number(place_ids: Iterable[str]) -> str:
    """One value, derived from the identities the traveler holds."""
    payload = "\n".join(sorted(place_ids)).encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()[:12]
    return f"twm-{digest}"


def fingerprint(name: str, country: str, lat: float, lon: float) -> str:
    """Enough to tell 'this is still that place' from 'this id was reused'."""
    return f"{country}|{name.strip().casefold()}|{round(float(lat), 3)}|{round(float(lon), 3)}"


def load_mapping(path: Path | None) -> dict[str, str]:
    """old_id -> new_id. Absent file means no moves are authorised."""
    if path is None or not path.is_file():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"place_id mapping must be an object: {path}")
    moved = raw.get("moved", raw)
    if not isinstance(moved, dict):
        raise ValueError(f"place_id mapping 'moved' must be an object: {path}")
    return {str(k): str(v) for k, v in moved.items() if k not in _META}


def places_from_geojson(path: Path) -> list[dict]:
    geo = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for feat in geo["features"]:
        props = feat["properties"]
        lon, lat = feat["geometry"]["coordinates"][:2]
        pid = props.get("id") or props.get("place_id")
        out.append({
            "id": pid,
            "name": props.get("n") or props.get("name") or "",
            "country": props.get("c") or props.get("country") or "",
            "lat": lat,
            "lon": lon,
            "printed": props.get("hole") == 1 or props.get("on_printed_map") is True,
        })
    return out


def places_from_app(path: Path) -> list[dict]:
    app = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for p in app["places"]:
        out.append({
            "id": p["place_id"],
            "name": p["name"],
            "country": p["country"],
            "lat": p["lat"],
            "lon": p["lon"],
            "printed": bool(p.get("on_printed_map")),
        })
    return out


def snapshot_from_places(places: list[dict], build: str) -> dict:
    return {
        "build": build,
        "places": {
            p["id"]: {
                "name": p["name"],
                "country": p["country"],
                "lat": p["lat"],
                "lon": p["lon"],
            }
            for p in places
        },
    }


def load_snapshot(path: Path) -> dict[str, dict]:
    if not path.is_file():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    places = raw.get("places", raw)
    return {str(k): v for k, v in places.items()}


def count_bundle_files(bundle_dir: Path, manifest: dict) -> dict[str, int]:
    """What is actually on disk, not what the manifest claims."""
    places_name = manifest.get("layers", {}).get("places", "places.geojson")
    terr_name = manifest.get("layers", {}).get("territories", "territories.geojson")
    places_path = bundle_dir / places_name
    terr_path = bundle_dir / terr_name
    n_places = n_printed = 0
    if places_path.is_file():
        places = places_from_geojson(places_path)
        n_places = len(places)
        n_printed = sum(1 for p in places if p["printed"])
    n_countries = len(list((bundle_dir / "countries").glob("*.json"))) if (bundle_dir / "countries").is_dir() else 0
    n_territories = 0
    if terr_path.is_file():
        terr = json.loads(terr_path.read_text(encoding="utf-8"))
        n_territories = len(terr.get("features", terr.get("territories", [])))
    return {
        "places": n_places,
        "printed": n_printed,
        "countries": n_countries,
        "territories": n_territories,
    }


def check_manifest_counts(manifest: dict, files: dict[str, int]) -> list[str]:
    """Every mismatch names both numbers. Silence here is how three stories grew."""
    totals = manifest.get("totals") or {}
    errors = []
    pairs = (
        ("places", "places"),
        ("printed", "printed"),
        ("countries", "countries"),
        ("territories", "territories"),
    )
    for key, file_key in pairs:
        claimed = totals.get(key)
        actual = files.get(file_key)
        if claimed is None or actual is None:
            errors.append(f"manifest totals.{key} or file count for {file_key} is missing")
            continue
        if int(claimed) != int(actual):
            errors.append(
                f"manifest totals.{key} is {claimed}, files contain {actual}"
            )
    index = manifest.get("countries") or []
    claimed_countries = totals.get("countries")
    if claimed_countries is not None and len(index) != int(claimed_countries):
        errors.append(
            f"manifest totals.countries is {claimed_countries}, "
            f"the country index lists {len(index)}"
        )
    return errors


def check_place_id_stability(
    previous: dict[str, dict],
    current: list[dict],
    mapping: dict[str, str],
) -> list[str]:
    """A rebuild that changes an existing place_id fails unless the mapping
    accounts for every moved id. Reusing an id for a different place always fails.
    """
    if not previous:
        return []

    current_by_id = {p["id"]: p for p in current}
    current_ids = set(current_by_id)
    previous_ids = set(previous)
    errors = []

    # Only mappings that apply to the last snapshot are a live migration.
    # Entries whose source id is already gone are history, not an error.
    active = {k: v for k, v in mapping.items() if k in previous_ids}
    mapped_from = set(active)
    mapped_to = set(active.values())

    missing_to = mapped_to - current_ids
    if missing_to:
        sample = ", ".join(sorted(missing_to)[:5])
        errors.append(
            f"mapping table points at {len(missing_to)} id(s) that are not in the "
            f"new bundle (e.g. {sample})"
        )

    disappeared = previous_ids - current_ids
    unmapped = disappeared - mapped_from
    if unmapped:
        sample = ", ".join(sorted(unmapped)[:8])
        errors.append(
            f"{len(unmapped)} place_id(s) vanished with no mapping table entry "
            f"(e.g. {sample})"
        )

    # An id that is still present must still name the same place.
    for pid in sorted(previous_ids & current_ids):
        old = previous[pid]
        new = current_by_id[pid]
        old_fp = fingerprint(old["name"], old["country"], old["lat"], old["lon"])
        new_fp = fingerprint(new["name"], new["country"], new["lat"], new["lon"])
        if old_fp == new_fp:
            continue
        same_place = (
            (old["name"] or "").strip().casefold()
            == (new["name"] or "").strip().casefold()
            and round(float(old["lat"]), 3) == round(float(new["lat"]), 3)
            and round(float(old["lon"]), 3) == round(float(new["lon"]), 3)
            and same_identity_country(str(old["country"]), str(new["country"]))
        )
        if not same_place:
            errors.append(
                f"place_id {pid} was reused for a different place "
                f"({old['name']} / {old['country']} → {new['name']} / {new['country']})"
            )
    return errors


def write_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")


def verify_bundle_identity(
    bundle_dir: Path,
    snapshot_path: Path | None = None,
    mapping_path: Path | None = None,
) -> tuple[list[str], str, dict[str, int]]:
    """Check the published bundle against its manifest and the last snapshot.

    Returns (errors, build_number, file_counts). errors is empty on success.
    """
    manifest_path = bundle_dir / "manifest.json"
    if not manifest_path.is_file():
        return [f"no manifest.json in {bundle_dir}"], "", {}

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    places_name = manifest.get("layers", {}).get("places", "places.geojson")
    places_path = bundle_dir / places_name
    if not places_path.is_file():
        return [f"places layer missing: {places_path}"], "", {}

    places = places_from_geojson(places_path)
    ids = [p["id"] for p in places]
    if len(ids) != len(set(ids)):
        dup = sorted({i for i in ids if ids.count(i) > 1})[:8]
        return [f"place_id is not unique (e.g. {', '.join(dup)})"], "", {}

    number = build_number(ids)
    files = count_bundle_files(bundle_dir, manifest)
    errors = check_manifest_counts(manifest, files)

    claimed_build = manifest.get("build") or ""
    if not claimed_build:
        errors.append("manifest has no build number")
    elif claimed_build != number:
        errors.append(
            f"manifest build is {claimed_build}, identity of the files is {number}"
        )

    previous = load_snapshot(snapshot_path) if snapshot_path else {}
    mapping = load_mapping(mapping_path)
    errors.extend(check_place_id_stability(previous, places, mapping))
    return errors, number, files


def stamp_bundle(
    bundle_dir: Path,
    dist_dir: Path,
    snapshot_path: Path | None = None,
) -> str:
    """Write the one build number into the published bundle and the dist report.

    Does not invent place_ids. It names the set that is already on disk.
    """
    manifest_path = bundle_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    places_name = manifest.get("layers", {}).get("places", "places.geojson")
    places = places_from_geojson(bundle_dir / places_name)
    number = build_number(p["id"] for p in places)
    manifest["build"] = number
    write_json(manifest_path, manifest)

    dist_dir.mkdir(parents=True, exist_ok=True)
    report_path = dist_dir / "build_report.json"
    if report_path.is_file():
        report = json.loads(report_path.read_text(encoding="utf-8"))
    else:
        report = {}
    report["build"] = number
    # Keep the existing stats blob; only the identity field is ours to set.
    report_path.write_text(
        json.dumps(report, indent=1, default=str) + "\n", encoding="utf-8"
    )

    snap = snapshot_path or (dist_dir / "place_ids.json")
    write_json(snap, snapshot_from_places(places, number))
    return number
