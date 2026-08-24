"""Tiny bundles that fail exactly one Stage 4 gate. Written to database/fixtures/gates/."""
from __future__ import annotations

import json
from pathlib import Path

from twm.identity import build_number, snapshot_from_places, write_json

ARCHETYPES = {
    "A1": "Imperial & historic capital",
    "A2": "Living old town / medina",
    "A3": "Coastal & maritime",
    "A4": "High mountain",
    "A5": "Desert & steppe",
    "A6": "Forest & jungle",
    "A7": "Lake & river",
    "A8": "Volcanic & geothermal",
    "A9": "Wildlife & wilderness",
    "A10": "Sacred & pilgrimage",
    "A11": "Rural vernacular & agrarian",
    "A12": "Modern metropolis & industry",
}
ALL_KINDS = list(ARCHETYPES)
KIND_MASK = (1 << 12) - 1
SQUARE = [[[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0], [0.0, 0.0]]]
# Tangier's real coordinates sit inside this box.
TANGIER_BOX = [[[-6.5, 35.0], [-5.0, 35.0], [-5.0, 36.2], [-6.5, 36.2], [-6.5, 35.0]]]

GATES = (
    "kind_audit",
    "region_coverage",
    "dissolve_resolution",
    "polygon_naming",
    "place_id_stability",
    "manifest_agreement",
)


def _poly(props, ring):
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Polygon", "coordinates": ring},
    }


def _point(pid, name, iso3, lon, lat, *, kinds=None, region_id="TST-R01", hole=1):
    kinds = kinds if kinds is not None else ALL_KINDS
    mask = 0
    for code in kinds:
        mask |= 1 << (int(code[1:]) - 1)
    return {
        "type": "Feature",
        "properties": {
            "id": pid, "n": name, "s": 80, "k": kinds[0] if kinds else "",
            "a": mask, "c": iso3, "site": 0, "hole": hole, "whs": 0,
            "t": "TST-T01", "r": region_id,
        },
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


def _register_place(pid, name, country, iso3, lon, lat, *, kinds=None,
                    region_id="TST-R01"):
    kinds = kinds if kinds is not None else ALL_KINDS
    return {
        "place_id": pid, "name": name, "country": country,
        "lat": lat, "lon": lon, "is_site": False, "score": 80,
        "archetypes": kinds, "archetype_weights": [0.9] * len(kinds),
        "whs": 0, "on_printed_map": True, "printed_rank": 1,
        "territory_id": "TST-T01", "region_id": region_id, "sources": ["fixture"],
    }


def _dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")


def write_valid_bundle(root: Path, *, pid="TST-1", name="Town", iso3="TST",
                       country="Testland", lon=1.0, lat=1.0,
                       region_id="TST-R01", region_name="North",
                       kinds=None, ring=None) -> dict:
    """A one-place bundle that clears the six Stage 4 gates."""
    kinds = kinds if kinds is not None else ALL_KINDS
    ring = ring if ring is not None else SQUARE
    root.mkdir(parents=True, exist_ok=True)
    countries_dir = root / "countries"
    countries_dir.mkdir(exist_ok=True)

    pin = _point(pid, name, iso3, lon, lat, kinds=kinds, region_id=region_id)
    place = _register_place(pid, name, country, iso3, lon, lat,
                            kinds=kinds, region_id=region_id)
    counts = {k: 1 for k in kinds}
    for k in ALL_KINDS:
        counts.setdefault(k, 0 if k not in kinds else 1)
    # A valid gate fixture must carry every kind somewhere.
    if set(kinds) != set(ALL_KINDS):
        counts = {k: 1 for k in ALL_KINDS}
        pin["properties"]["a"] = KIND_MASK
        place["archetypes"] = ALL_KINDS
        place["archetype_weights"] = [0.9] * 12
        kinds = ALL_KINDS

    places_geo = {"type": "FeatureCollection", "features": [pin]}
    countries_geo = {"type": "FeatureCollection", "features": [
        _poly({"iso3": iso3, "country": country}, ring),
    ]}
    regions_geo = {"type": "FeatureCollection", "features": [
        _poly({"region_id": region_id, "name": region_name,
               "iso3": iso3, "country": country}, ring),
    ]}
    tiles_geo = {"type": "FeatureCollection", "features": [
        _poly({"territory_id": "TST-T01", "name": region_name,
               "iso3": iso3, "country": country},
              [[[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]]]),
    ]}
    register = {
        "country": country, "iso3": iso3, "area_km2": None,
        "places": [place],
        "kinds": counts,
        "territories": [],
        "livability": "unscored",
    }
    number = build_number([pid])
    manifest = {
        "build": number,
        "archetypes": ARCHETYPES,
        "archetype_counts": counts,
        "totals": {
            "places": 1, "printed": 1, "countries": 1, "territories": 1,
            "printable_territories": 1, "hole_budget": 3000,
        },
        "layers": {
            "places": "places.geojson",
            "territories": "territories.geojson",
            "countries": "countries.geojson",
            "regions": "regions.geojson",
            "register": "countries/{iso3}.json",
        },
        "countries": [{
            "country": country, "iso3": iso3,
            "file": f"countries/{iso3}.json",
            "places": 1, "holes": 1, "tiles": 1, "kinds": 12,
            "kind_counts": counts, "bytes": 1, "livability": "unscored",
        }],
    }
    _dump(root / "places.geojson", places_geo)
    _dump(root / "countries.geojson", countries_geo)
    _dump(root / "regions.geojson", regions_geo)
    _dump(root / "territories.geojson", tiles_geo)
    _dump(countries_dir / f"{iso3}.json", register)
    write_json(root / "manifest.json", manifest)
    return {
        "pid": pid, "number": number, "place": place, "pin": pin,
        "manifest": manifest,
    }


def _break_kind_audit(root: Path) -> None:
    info = write_valid_bundle(root)
    pin = json.loads((root / "places.geojson").read_text(encoding="utf-8"))
    pin["features"][0]["properties"]["a"] = 0
    pin["features"][0]["properties"]["k"] = ""
    _dump(root / "places.geojson", pin)
    doc = json.loads((root / "countries" / "TST.json").read_text(encoding="utf-8"))
    doc["places"][0]["archetypes"] = []
    doc["places"][0]["archetype_weights"] = []
    doc["kinds"] = {}
    _dump(root / "countries" / "TST.json", doc)
    man = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    man["archetype_counts"] = {k: 0 for k in ALL_KINDS}
    man["countries"][0]["kind_counts"] = {}
    man["countries"][0]["kinds"] = 0
    write_json(root / "manifest.json", man)


def _break_region_coverage(root: Path) -> None:
    write_valid_bundle(root)
    pin = json.loads((root / "places.geojson").read_text(encoding="utf-8"))
    pin["features"][0]["properties"]["r"] = ""
    _dump(root / "places.geojson", pin)
    doc = json.loads((root / "countries" / "TST.json").read_text(encoding="utf-8"))
    doc["places"][0]["region_id"] = None
    _dump(root / "countries" / "TST.json", doc)


def _break_dissolve(root: Path) -> None:
    write_valid_bundle(root)
    geo = json.loads((root / "countries.geojson").read_text(encoding="utf-8"))
    geo["features"].append(_poly(
        {"iso3": "ESH", "country": "Western Sahara"},
        [[[-16.0, 22.0], [-12.0, 22.0], [-12.0, 27.0], [-16.0, 27.0], [-16.0, 22.0]]],
    ))
    _dump(root / "countries.geojson", geo)


def _break_naming(root: Path) -> None:
    write_valid_bundle(
        root, pid="MAR-t", name="Tangier", iso3="MAR", country="Morocco",
        lon=-5.80, lat=35.767, region_id="MAR-R99",
        region_name="Suss-Massa-Draa", ring=TANGIER_BOX,
    )


def _break_place_id(root: Path, dist: Path) -> None:
    info = write_valid_bundle(root, pid="TST-NEW")
    previous = snapshot_from_places(
        [{"id": "TST-OLD", "name": "Town", "country": "TST",
          "lat": 1.0, "lon": 1.0}],
        "twm-previous",
    )
    dist.mkdir(parents=True, exist_ok=True)
    write_json(dist / "place_ids.json", previous)


def _break_manifest(root: Path) -> None:
    write_valid_bundle(root)
    man = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    man["totals"]["places"] = int(man["totals"]["places"]) + 1
    write_json(root / "manifest.json", man)


def write_all(fixtures_root: Path) -> dict[str, Path]:
    """Write the six broken bundles under fixtures_root / <gate_id>/bundle."""
    out = {}
    mapping = {
        "kind_audit": _break_kind_audit,
        "region_coverage": _break_region_coverage,
        "dissolve_resolution": _break_dissolve,
        "polygon_naming": _break_naming,
        "manifest_agreement": _break_manifest,
    }
    for gate_id, fn in mapping.items():
        bundle = fixtures_root / gate_id / "bundle"
        if bundle.exists():
            import shutil
            shutil.rmtree(bundle)
        fn(bundle)
        out[gate_id] = bundle
    pid_root = fixtures_root / "place_id_stability"
    bundle = pid_root / "bundle"
    dist = pid_root / "dist"
    if bundle.exists():
        import shutil
        shutil.rmtree(bundle)
    _break_place_id(bundle, dist)
    out["place_id_stability"] = bundle
    return out


if __name__ == "__main__":
    here = Path(__file__).resolve().parents[1] / "fixtures" / "gates"
    written = write_all(here)
    for k, p in written.items():
        print(f"{k:24} {p}")
