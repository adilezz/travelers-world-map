"""Check the built database against the invariants the products depend on.

Stage 4: a **gate** aborts the publish (exit 1) and leaves the previous bundle
in place. A **report** informs and never satisfies a gate. Document 1 §19;
document 5 §3. The six gates are kind audit, region coverage, dissolve
resolution, polygon naming, place_id stability, and manifest agreement.

Each check states what it verified and, where a claim is quantitative, the
measured number rather than a pass/fail token.
"""
import json
import math
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

_HERE = Path(__file__).resolve()
_REPO = _HERE.parents[2]
_DB = _HERE.parents[1]
sys.path.insert(0, os.environ.get("TWM_PKG", str(_DB)))

from twm.config import PARAMS  # noqa: E402
from twm.gates import GATE_IDS, GATE_RULES  # noqa: E402
from twm.geo import haversine_km, min_spacing_km  # noqa: E402
from twm.identity import (  # noqa: E402
    build_number,
    verify_bundle_identity,
)

DIST = Path(os.environ.get("TWM_DIST", str(_DB / "dist")))
DATA = Path(os.environ.get("TWM_DATA", str(_DB / "data")))
BUNDLE = Path(os.environ.get(
    "TWM_BUNDLE", str(_REPO / "webapp" / "twm-app" / "public" / "data")))

fails, warns = [], []
gate_fails: dict[str, list[str]] = {g: [] for g in GATE_IDS}
report: list[str] = []


def _reset():
    fails.clear()
    warns.clear()
    report.clear()
    for g in GATE_IDS:
        gate_fails[g] = []


def _emit(line=""):
    print(line)
    report.append(line)


def check(ok, label, detail=""):
    mark = "ok  " if ok else "FAIL"
    _emit(f"  [{mark}] {label}" + (f"  — {detail}" if detail else ""))
    if not ok:
        fails.append(label)


def gate(ok, gate_id, label, detail=""):
    """A gate. Failure aborts the publish. A warning never satisfies this."""
    if gate_id not in GATE_IDS:
        raise ValueError(f"unknown gate {gate_id}")
    mark = "ok  " if ok else "GATE"
    _emit(f"  [{mark}] {label}" + (f"  — {detail}" if detail else ""))
    if not ok:
        fails.append(label)
        gate_fails[gate_id].append(label)


def warn(label, detail=""):
    """A report. Informs. Never a gate."""
    _emit(f"  [warn] {label}" + (f"  — {detail}" if detail else ""))
    warns.append(label)


def _is_world_bundle(man) -> bool:
    return len(man.get("countries") or []) >= 50


def _identity_section() -> str:
    """The published bundle is what the client loads. It is the source of truth."""
    snapshot = DIST / "place_ids.json"
    mapping = DIST / "place_id_map.json"
    errors, number, files = verify_bundle_identity(
        BUNDLE,
        snapshot_path=snapshot if snapshot.is_file() else None,
        mapping_path=mapping if mapping.is_file() else None,
    )
    _emit("BUNDLE IDENTITY")
    if number:
        _emit(f"  build  {number}")
    if files:
        _emit(
            f"  files  {files['places']} places, {files['printed']} printed, "
            f"{files['countries']} country files, {files['territories']} territories"
        )
    identity_errors = [e for e in errors
                       if "place_id" in e or "reused" in e or "mapping" in e]
    count_errors = [e for e in errors if e not in identity_errors]
    if errors:
        for err in count_errors:
            gate(False, "manifest_agreement", "manifest totals equal the files", err)
        for err in identity_errors:
            gate(False, "place_id_stability",
                 "place_id is unique and stable against the last snapshot", err)
        if not count_errors and not identity_errors:
            for err in errors:
                gate(False, "manifest_agreement", "bundle identity", err)
    else:
        gate(True, "manifest_agreement", "manifest totals equal the files",
             f"{files.get('places', 0)} places, {files.get('countries', 0)} countries")
        gate(True, "place_id_stability",
             "place_id is unique and stable against the last snapshot",
             f"{files.get('places', 0)} ids")

    report_path = DIST / "build_report.json"
    if number and report_path.is_file():
        rep = json.loads(report_path.read_text(encoding="utf-8"))
        reported = rep.get("build")
        gate(reported == number, "manifest_agreement",
             "build report names the same build",
             f"report {reported}, bundle {number}")
    elif number:
        warn("build_report.json missing", "cannot confirm the report's build number")
    return number


def _pipeline_section():
    app_path = DIST / "app_places.json"
    if not app_path.is_file():
        warn("app_places.json missing",
             "pipeline shape checks skipped; the published bundle was still checked")
        return

    app = json.loads(app_path.read_text(encoding="utf-8"))
    rep = json.loads((DIST / "build_report.json").read_text(encoding="utf-8"))
    countries = json.loads((DATA / "countries.json").read_text(encoding="utf-8"))
    places = app["places"]
    printed = [p for p in places if p["on_printed_map"]]
    stats = rep["stats"]

    _emit(f"\n{len(places)} places, {len(printed)} on the printed map, "
          f"{len(stats['per_country'])} countries")

    _emit("\nIDENTITY AND SHAPE")
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

    _emit("\nPRINTED MAP")
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
    _emit("      tightest pairs: " + ", ".join(
        f"{c} {d:.0f}km (min {m:.0f})" for d, c, m, _ in tightest[:4]))

    floor = min(d for d, _, _, _ in tightest) if tightest else None
    if floor is not None:
        check(floor >= 60 - 0.5, "global 60 km hole separation holds",
              f"tightest pair anywhere is {floor:.1f} km")

    _emit("\nSELECTION QUALITY")
    red = [(c, s["redundancy"]) for c, s in per.items() if s.get("redundancy") is not None]
    if red:
        vals = [r for _, r in red]
        _emit(f"      coverage redundancy measured for {len(red)} countries, "
              f"mean {sum(vals)/len(vals):.3f}, median "
              f"{sorted(vals)[len(vals)//2]:.3f}")
        check(sum(vals) / len(vals) < 0.6, "mean archetype redundancy stays below 0.6",
              "coverage selection is picking varied kinds of place")
    quota_over = [(c, s["on_printed_map"], s["quota"]) for c, s in per.items()
                  if s.get("quota") and s["on_printed_map"] > s["quota"]]
    check(not quota_over, "no country exceeds its quota",
          f"{len(quota_over)} over: {quota_over[:3]}" if quota_over else "")

    _emit("\nTERRITORIES")
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
        _emit(f"      {small} tiles below the {tdoc['min_tile_extent_km']} km "
              f"minimum extent — inset panels, not cut tiles")

    _emit("\nASSET PROVENANCE")
    srcs = Counter(s for p in places for s in p.get("sources", []))
    for s, n in srcs.most_common():
        _emit(f"      {s:<22} contributes to {n:>6} places")


def _candidate_set_section():
    """Stage 1: the published list is one place, not a crawl artefact."""
    from twm.candidates import CLOSE_PAIR_KM, harvest_spacing_km

    _emit("\nCANDIDATE SET")
    man = json.loads((BUNDLE / "manifest.json").read_text(encoding="utf-8"))
    by_iso = {c["iso3"]: c for c in man.get("countries", [])}

    geo = json.loads((BUNDLE / man["layers"]["places"]).read_text(encoding="utf-8"))
    pins = []
    for f in geo["features"]:
        props = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        mask = int(props.get("a") or 0)
        kinds = [f"A{i+1}" for i in range(12) if mask & (1 << i)]
        pins.append({
            "id": props.get("id") or props.get("place_id"),
            "name": props.get("n") or props.get("name") or "",
            "country": props.get("c") or "",
            "lat": lat, "lon": lon, "kinds": kinds,
        })

    pairs = []
    by_c: dict[str, list] = defaultdict(list)
    for p in pins:
        by_c[p["country"]].append(p)
    for iso, group in by_c.items():
        for i, a in enumerate(group):
            for b in group[i + 1:]:
                d = haversine_km(a["lat"], a["lon"], b["lat"], b["lon"])
                if d < CLOSE_PAIR_KM:
                    same = bool(set(a["kinds"]) & set(b["kinds"]))
                    pairs.append((iso, a, b, d, same))

    same_kind = [p for p in pairs if p[4]]
    check(not same_kind,
          "no same-kind pair under 2 km",
          f"{len(same_kind)} remain" if same_kind
          else f"{len(pairs)} different-kind pairs enumerated")

    allow_path = DATA / "close_pairs_allowed.json"
    allowed = set()
    if allow_path.is_file():
        raw = json.loads(allow_path.read_text(encoding="utf-8"))
        for row in raw.get("pairs", raw if isinstance(raw, list) else []):
            allowed.add(tuple(sorted((row["id_a"], row["id_b"]))))
    mystery = []
    for iso, a, b, d, same in pairs:
        if same:
            continue
        key = tuple(sorted((a["id"], b["id"])))
        if key not in allowed:
            mystery.append((iso, a["name"], b["name"], round(d, 2)))
    check(not mystery,
          "every close different-kind pair is enumerated",
          f"{len(mystery)} not on the allow-list: {mystery[:3]}" if mystery
          else f"{len(pairs)} listed in close_pairs_allowed.json")

    report = json.loads((DIST / "build_report.json").read_text(encoding="utf-8")) if (
        DIST / "build_report.json").is_file() else {}
    absorbed = (report.get("stats") or {}).get("absorbed", report.get("absorbed", 0))
    by_country = (report.get("stats") or {}).get("absorption_by_country") or {}
    if _is_world_bundle(man):
        check(int(absorbed or 0) > 0,
              "absorption is not zero on a world build",
              f"absorbed={absorbed}")
        check(bool(by_country),
              "the absorption log names a country and a count",
              f"{len(by_country)} countries" if by_country else "empty")

    deu = by_iso.get("DEU", {})
    mar = by_iso.get("MAR", {})
    if deu and mar and deu.get("places") and mar.get("places"):
        de_k = max(deu.get("kinds") or 1, 1)
        ma_k = max(mar.get("kinds") or 1, 1)
        de_per = deu["places"] / de_k
        ma_per = mar["places"] / ma_k
        ratio = de_per / ma_per
        check(ratio <= 3.0,
              "Germany's density vs Morocco is defensible against the kind audit",
              f"{deu['places']}/{de_k} kinds vs {mar['places']}/{ma_k} kinds "
              f"({ratio:.2f} places-per-kind)")
    _emit(f"      harvest spacing example DE {harvest_spacing_km(357022, 8):.0f} km, "
          f"MA {harvest_spacing_km(446550, 7):.0f} km")

    # "Aït Melloul is Agadir." The city keeps the pin. Review §4.1 / Stage 1.
    mar_names = {p["name"] for p in pins if p["country"] == "MAR"}
    if _is_world_bundle(man):
        check("Agadir" in mar_names,
              "agglomeration keeps the city (Agadir), not a suburb or a WDPA neighbour",
              "Agadir present" if "Agadir" in mar_names
              else f"Agadir missing; have {sorted(mar_names)[:8]}")
        check("Ait Melloul" not in mar_names and "Aït Melloul" not in mar_names,
              "Aït Melloul is folded into Agadir",
              "suburb absent" if "Ait Melloul" not in mar_names
              else "Aït Melloul still a separate place")


def _signals_section():
    """Stage 2: kinds from sources; dummy reach/months omitted; livability flagged."""
    _emit("\nMISSING SIGNALS")
    man = json.loads((BUNDLE / "manifest.json").read_text(encoding="utf-8"))
    counts = man.get("archetype_counts") or {}
    empty_kinds = [a for a in (man.get("archetypes") or {}) if not counts.get(a)]
    gate(not empty_kinds, "kind_audit",
          "every one of the twelve kinds is present somewhere",
          f"empty: {empty_kinds}" if empty_kinds
          else f"{sum(1 for n in counts.values() if n)} kinds with places")

    no_kind = []
    dummy_meta = 0
    fes = marr = rabat = None
    a1_named = {"Fes": False, "Meknes": False, "Kyoto": False}
    material_miss = []
    for path in (BUNDLE / "countries").glob("*.json"):
        doc = json.loads(path.read_text(encoding="utf-8"))
        country_kinds = set()
        for p in doc.get("places") or []:
            arch = p.get("archetypes") or []
            country_kinds.update(arch)
            if not arch:
                no_kind.append(f"{p.get('name')} ({doc.get('iso3')})")
            if p.get("reach") == "near" or p.get("best_months"):
                dummy_meta += 1
            if p.get("name") == "Fes" and doc.get("iso3") == "MAR":
                fes = p
            if p.get("name") == "Marrakesh" and doc.get("iso3") == "MAR":
                marr = p
            if p.get("name") == "Rabat" and doc.get("iso3") == "MAR":
                rabat = p
            if p.get("name") in a1_named and "A1" in arch:
                a1_named[p["name"]] = True
        # A country that already carries a kind on its places has that kind.
        # The missing-material check is: kinds listed in kind_counts exist
        # on at least one place — the register and the audit cannot disagree.
        listed = set((doc.get("kinds") or {}))
        if listed - country_kinds:
            material_miss.append(doc.get("iso3"))

    gate(not no_kind, "kind_audit",
          "no place without a kind",
          f"{len(no_kind)} empty e.g. {no_kind[:4]}" if no_kind else "every place has a kind")
    check(dummy_meta == 0,
          "reach and best_months are omitted, not dummy",
          "no dummy near / month list" if dummy_meta == 0
          else f"{dummy_meta} places still carry dummy metadata")
    gate(not material_miss, "kind_audit",
          "no country is missing a kind it lists",
          "kind_counts match places" if not material_miss
          else f"{len(material_miss)} countries disagree")

    if fes and marr and rabat:
        check(fes.get("score") == 100 and marr.get("score") == 88 and rabat.get("score") == 80,
              "Morocco still reads Fes 100, Marrakesh 88, Rabat 80",
              f"Fes {fes.get('score')}, Marrakesh {marr.get('score')}, Rabat {rabat.get('score')}")
    missing_a1 = [n for n, ok in a1_named.items() if not ok]
    if _is_world_bundle(man):
        check(not missing_a1,
              "A1 is former-capital, not the current-seat list",
              "Fes, Meknes, Kyoto carry A1" if not missing_a1
              else f"missing A1 on {missing_a1}")

    liv = man.get("livability") or {}
    flagged = sum(1 for c in man.get("countries", []) if c.get("livability") == "unscored")
    if _is_world_bundle(man):
        check(flagged > 0,
              "countries the OSM harvest missed are marked unscored on livability",
              f"{flagged} unscored, {liv.get('scored', 0)} scored")


def _geography_section():
    """Stage 3: tessellation, dissolve, naming. Doc 5 §3.3–§3.6."""
    from shapely.geometry import shape
    from shapely.ops import unary_union

    from twm.config import unruled_hits
    from twm.geo import namesake_in_name, union_tolerance_for
    from twm.regions import coverage_gap

    _emit("\nGEOGRAPHY")
    man = json.loads((BUNDLE / "manifest.json").read_text(encoding="utf-8"))
    layers = man.get("layers") or {}
    countries_path = BUNDLE / layers.get("countries", "countries.geojson")
    regions_path = BUNDLE / layers.get("regions", "regions.geojson")
    terr_path = BUNDLE / layers.get("territories", "territories.geojson")
    places_path = BUNDLE / layers.get("places", "places.geojson")

    gate(regions_path.is_file(), "region_coverage",
          "regions.geojson is published",
          str(regions_path.name))
    if not regions_path.is_file():
        return

    countries = json.loads(countries_path.read_text(encoding="utf-8"))
    regions = json.loads(regions_path.read_text(encoding="utf-8"))
    terr = json.loads(terr_path.read_text(encoding="utf-8")) if terr_path.is_file() else {"features": []}
    places = json.loads(places_path.read_text(encoding="utf-8"))

    def _esh(features, kind):
        hits = []
        for f in features:
            p = f.get("properties") or {}
            iso = str(p.get("iso3") or p.get("c") or "")
            country = str(p.get("country") or "")
            if iso == "ESH" or "Western Sahara" in country or country == "W. Sahara":
                hits.append(p.get("region_id") or p.get("territory_id") or iso)
        return hits

    esh = (
        _esh(countries.get("features") or [], "country")
        + _esh(regions.get("features") or [], "region")
        + _esh(terr.get("features") or [], "tile")
    )
    gate(not esh, "dissolve_resolution",
          "no ESH polygon anywhere in the bundle",
          "none" if not esh else f"still drawn: {esh[:4]}")

    esh_file = BUNDLE / "countries" / "ESH.json"
    gate(not esh_file.is_file(), "dissolve_resolution",
          "Western Sahara is not a register country",
          "ESH.json absent" if not esh_file.is_file() else "ESH.json still shipped")

    pin_r = []
    no_r = []
    for f in places.get("features") or []:
        pid = f["properties"].get("id")
        rid = f["properties"].get("r") or f["properties"].get("region_id")
        if not rid:
            no_r.append(pid)
        else:
            pin_r.append(rid)
    gate(not no_r, "region_coverage",
          "every app place has exactly one region_id",
          "all assigned" if not no_r else f"{len(no_r)} without e.g. {no_r[:4]}")

    # Country files: region_id never null; disputed ESH on dissolved places.
    tangier = None
    esh_flagged = 0
    null_region = []
    esh_wrong_country = []
    for path in (BUNDLE / "countries").glob("*.json"):
        doc = json.loads(path.read_text(encoding="utf-8"))
        for p in doc.get("places") or []:
            if not p.get("region_id"):
                null_region.append(p.get("place_id"))
            if p.get("disputed") == "ESH":
                esh_flagged += 1
                if p.get("country") != "Morocco":
                    esh_wrong_country.append(p.get("name"))
            if p.get("name") == "Tangier" and doc.get("iso3") == "MAR":
                tangier = p
    gate(not esh_wrong_country, "dissolve_resolution",
          "ESH places carry Morocco as country",
          "all Morocco" if not esh_wrong_country else str(esh_wrong_country[:4]))
    gate(not null_region, "region_coverage",
          "no place without a region_id in the registers",
          "none" if not null_region else f"{len(null_region)}")
    if _is_world_bundle(man):
        gate(esh_flagged >= 3, "dissolve_resolution",
             "dissolved Western Sahara places carry disputed: ESH",
             f"{esh_flagged} flagged")

    by_rid = {f["properties"]["region_id"]: f for f in regions.get("features") or []}
    if tangier:
        host = by_rid.get(tangier.get("region_id") or "")
        name = (host["properties"].get("name") if host else "") or ""
        gate(bool(host) and namesake_in_name(name, "Tangier"), "polygon_naming",
              "Tangier sits in a region named for Tangier or a parent that contains it",
              name or "no region")
        gate("Suss" not in name, "polygon_naming",
              "Tangier is not in Suss-Massa-Draa",
              name)

    # Union of regions vs country land, documented coastline tolerance.
    land_by_iso = {}
    for f in countries.get("features") or []:
        iso = f["properties"].get("iso3")
        if iso:
            land_by_iso.setdefault(iso, []).append(shape(f["geometry"]))
    gaps = []
    for iso, geoms in land_by_iso.items():
        land = unary_union(geoms)
        rs = [shape(f["geometry"]) for f in regions.get("features") or []
              if f["properties"].get("iso3") == iso and f.get("geometry")]
        if not rs or land.is_empty or land.area <= 0:
            continue
        gap = coverage_gap(rs, land)
        if gap > union_tolerance_for(land):
            gaps.append((iso, round(gap, 4)))
    gate(not gaps, "region_coverage",
          "region union equals country land within documented coastline tolerance (2% / 8% small islands)",
          "all within tolerance" if not gaps else f"{len(gaps)} over: {gaps[:5]}")

    labels = [c.get("country") for c in man.get("countries") or []]
    labels += [c.get("iso3") for c in man.get("countries") or []]
    unruled = unruled_hits(labels)
    if unruled:
        warn("unruled disputed cases encountered (Parked — Adil fills the table)",
             ", ".join(unruled))
    # Report only. Parked: filling DISPUTED_RULINGS is Adil's. A warning
    # never satisfies a gate, and the absence of Kosovo from a fixture is
    # not a gate failure.

    rids = {f["properties"].get("region_id") for f in regions.get("features") or []}
    tids = {f["properties"].get("territory_id") for f in terr.get("features") or []}
    check(not (rids & tids),
          "web regions are not the printed-tile layer",
          f"{len(rids)} regions, {len(tids)} printed tiles, disjoint ids")
    esh_pins = [f["properties"].get("id") for f in places.get("features") or []
                if f["properties"].get("c") == "ESH"]
    gate(not esh_pins, "dissolve_resolution",
          "no ESH iso3 on place pins",
          "none" if not esh_pins else f"{esh_pins[:4]}")


def failed_gate_ids() -> list[str]:
    return [g for g in GATE_IDS if gate_fails[g]]


def run(bundle: Path | None = None, dist: Path | None = None,
        data: Path | None = None) -> int:
    """Run gates then reports against a bundle. Exit 1 if any gate (or check) failed."""
    global BUNDLE, DIST, DATA
    _reset()
    if bundle is not None:
        BUNDLE = Path(bundle)
    if dist is not None:
        DIST = Path(dist)
    if data is not None:
        DATA = Path(data)
    DIST.mkdir(parents=True, exist_ok=True)
    number = _identity_section()
    _candidate_set_section()
    _signals_section()
    _geography_section()
    _pipeline_section()

    _emit("")
    tripped = failed_gate_ids()
    if tripped:
        _emit("GATES that abort the publish (Doc 1 §19; a warning never satisfies these):")
        for g in tripped:
            _emit(f"  {g}: {GATE_RULES[g]}")
            for label in gate_fails[g]:
                _emit(f"    - {label}")
    if fails:
        _emit(f"{len(fails)} FAILED: {fails}")
    else:
        _emit(f"All checks passed ({len(warns)} warnings).")

    header = ["Travelers World Map — verification"]
    if number:
        header.append(f"build  {number}")
    header.append("")
    (DIST / "verification.txt").write_text(
        "\n".join(header + report) + "\n", encoding="utf-8")
    # Never snapshot a failing bundle as the last-known-good identities.
    if not fails and number:
        from twm.identity import (
            places_from_geojson, snapshot_from_places, write_json,
        )
        man = json.loads((BUNDLE / "manifest.json").read_text(encoding="utf-8"))
        places_name = man.get("layers", {}).get("places", "places.geojson")
        snap_places = places_from_geojson(BUNDLE / places_name)
        write_json(DIST / "place_ids.json", snapshot_from_places(snap_places, number))

    return 1 if fails else 0


def main():
    return run()


if __name__ == "__main__":
    sys.exit(main())
