"""Loading and validating the golden set (document 7 section 2)."""
from __future__ import annotations

import csv
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from twm2.geo import fold
from twm2.vocab import (
    KINDS,
    MAX_KINDS_PER_PLACE,
    PLACE_TYPES,
    RELATIONS,
    ROW_KINDS,
    TIERS,
)

COLUMNS = (
    "golden_id", "country", "expected_name", "aliases", "row_kind", "type", "lat", "lon",
    "tol_km", "min_tier", "max_tier", "kinds_expected", "whs_id", "qid", "qid_status",
    "relation", "target_id", "regression", "evidence", "note",
)
MAX_TOL_SITE_KM = 8.0         # sites
MAX_TOL_SETTLEMENT_KM = 12.0  # settlements: the anchor of a large city is its centre
MAX_TOL_AREA_KM = 60.0        # areas and routes


@dataclass
class Row:
    raw: dict
    golden_id: str = ""
    country: str = ""
    name: str = ""
    names: set[str] = field(default_factory=set)  # folded name plus aliases
    row_kind: str = "positive"
    type: str = ""
    lat: float | None = None
    lon: float | None = None
    tol_km: float | None = None
    min_tier: str = ""
    max_tier: str = ""
    kinds: tuple[str, ...] = ()
    whs_id: str = ""
    qid: str = ""
    relation: str = ""
    targets: tuple[str, ...] = ()
    regression: bool = False


def _split(value: str) -> list[str]:
    return [p for p in (value or "").split("|") if p]


def load(path: str | Path) -> list[Row]:
    rows: list[Row] = []
    with open(path, encoding="utf-8", newline="") as fh:
        for raw in csv.DictReader(fh):
            r = Row(raw=raw)
            r.golden_id = raw["golden_id"]
            r.country = raw["country"]
            r.name = raw["expected_name"]
            r.names = {fold(raw["expected_name"]), *(fold(a) for a in _split(raw["aliases"]))}
            r.row_kind = raw["row_kind"]
            r.type = raw["type"]
            r.lat = float(raw["lat"]) if raw["lat"] else None
            r.lon = float(raw["lon"]) if raw["lon"] else None
            r.tol_km = float(raw["tol_km"]) if raw["tol_km"] else None
            r.min_tier, r.max_tier = raw["min_tier"], raw["max_tier"]
            r.kinds = tuple(_split(raw["kinds_expected"]))
            r.whs_id, r.qid = raw["whs_id"], raw["qid"]
            r.relation = raw["relation"]
            r.targets = tuple(_split(raw["target_id"]))
            r.regression = raw["regression"] == "y"
            rows.append(r)
    return rows


def whs_ids(xml_path: str | Path) -> set[str]:
    root = ET.parse(xml_path).getroot()
    return {(row.findtext("id_number") or "").strip() for row in root.findall("row")}


def validate(rows: list[Row], known_whs: set[str] | None = None) -> list[str]:
    """Return a list of problems; an empty list means the file is well formed."""
    problems: list[str] = []
    ids = [r.golden_id for r in rows]
    if len(ids) != len(set(ids)):
        problems.append("duplicate golden_id")
    by_id = {r.golden_id: r for r in rows}
    for r in rows:
        g = r.golden_id
        if r.row_kind not in ROW_KINDS:
            problems.append(f"{g}: bad row_kind {r.row_kind!r}")
        if not r.name or not r.country:
            problems.append(f"{g}: missing name or country")
        if r.row_kind == "positive":
            if r.type not in PLACE_TYPES:
                problems.append(f"{g}: bad type {r.type!r}")
            if r.lat is None or r.lon is None or not (-90 <= r.lat <= 90 and -180 <= r.lon <= 180):
                problems.append(f"{g}: bad coordinates")
            if r.tol_km is None or r.tol_km <= 0:
                problems.append(f"{g}: missing tol_km")
            elif r.type == "site" and r.tol_km > MAX_TOL_SITE_KM:
                problems.append(f"{g}: tol_km {r.tol_km} too wide for a site")
            elif r.type == "settlement" and r.tol_km > MAX_TOL_SETTLEMENT_KM:
                problems.append(f"{g}: tol_km {r.tol_km} too wide for a settlement")
            elif r.tol_km > MAX_TOL_AREA_KM:
                problems.append(f"{g}: tol_km {r.tol_km} too wide")
            if r.min_tier not in TIERS:
                problems.append(f"{g}: bad min_tier {r.min_tier!r}")
            if r.max_tier and r.max_tier not in TIERS:
                problems.append(f"{g}: bad max_tier {r.max_tier!r}")
            if r.min_tier in TIERS and r.max_tier in TIERS and TIERS.index(r.max_tier) < TIERS.index(r.min_tier):
                problems.append(f"{g}: max_tier below min_tier")
            if not r.kinds:
                problems.append(f"{g}: no kinds_expected (every place carries 1-3 kinds)")
            if len(r.kinds) > MAX_KINDS_PER_PLACE:
                problems.append(f"{g}: more than {MAX_KINDS_PER_PLACE} kinds")
            for k in r.kinds:
                if k not in KINDS:
                    problems.append(f"{g}: unknown kind {k!r}")
            if len(set(r.kinds)) != len(r.kinds):
                problems.append(f"{g}: repeated kind")
            if r.whs_id and known_whs is not None and r.whs_id not in known_whs:
                problems.append(f"{g}: whs_id {r.whs_id} not in the UNESCO file")
        else:
            if r.relation not in RELATIONS:
                problems.append(f"{g}: bad relation {r.relation!r}")
            if not r.targets:
                problems.append(f"{g}: relational row without target_id")
            for t in r.targets:
                tgt = by_id.get(t)
                if tgt is None:
                    problems.append(f"{g}: target {t} does not exist")
                elif tgt.row_kind != "positive":
                    problems.append(f"{g}: target {t} is not a positive row")
                elif tgt.country != r.country:
                    problems.append(f"{g}: target {t} is in another country")
    return problems
