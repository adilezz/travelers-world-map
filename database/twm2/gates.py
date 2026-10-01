"""The gates of document 7 section 3. Each gate returns a GateResult; none only warns.

A gate that cannot yet run is `pending` and counts as a failure: a build is publishable
only when every gate passes.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from twm2 import golden as G
from twm2.bundle import Bundle, Registry
from twm2.geo import fold, haversine_km, wilson_lower
from twm2.vocab import KINDS, MAX_KINDS_PER_PLACE, MAX_NAME_LENGTH, PLACE_ID_RE, TIER_RANK


@dataclass
class GateResult:
    gate: str
    passed: bool
    detail: str
    pending: bool = False


def _fail(gate: str, detail: str) -> GateResult:
    return GateResult(gate, False, detail)


def _ok(gate: str, detail: str) -> GateResult:
    return GateResult(gate, True, detail)


def _pending(gate: str, why: str) -> GateResult:
    return GateResult(gate, False, f"pending: {why}", pending=True)


# ----------------------------------------------------------------------------- matching
def place_names(p: dict) -> set[str]:
    names = {fold(p.get("name_en", "")), fold(p.get("name_local", ""))}
    for a in p.get("aliases", []) or []:
        names.add(fold(a["alias"] if isinstance(a, dict) else a))
    names.discard("")
    return names


def match_row(row: G.Row, places: list[dict]) -> dict | None:
    """The right entity: anchor within tol_km, matching type, and the QID or a listed name."""
    best, best_d = None, 1e9
    for p in places:
        if p.get("lat") is None or p.get("lon") is None:
            continue
        d = haversine_km(row.lat, row.lon, p["lat"], p["lon"])
        if d > row.tol_km or p.get("type") != row.type:
            continue
        if row.qid:
            if p.get("qid") != row.qid:
                continue
        elif not (row.names & place_names(p)):
            continue
        if d < best_d:
            best, best_d = p, d
    return best


def find_by_name(row: G.Row, places: list[dict]) -> list[dict]:
    return [p for p in places if p.get("country") == row.country and row.names & place_names(p)]


def _positives(golden: list[G.Row]) -> list[G.Row]:
    return [r for r in golden if r.row_kind == "positive"]


# ------------------------------------------------------------------------------- gates
def g_golden_file(golden: list[G.Row], known_whs: set[str] | None = None) -> GateResult:
    problems = G.validate(golden, known_whs)
    if problems:
        return _fail("G-GOLDEN", f"{len(problems)} problems; first: {problems[:3]}")
    return _ok("G-GOLDEN", f"{len(golden)} rows well formed")


def g_landmark(bundle: Bundle, golden: list[G.Row]) -> GateResult:
    places = bundle.active()
    pos = _positives(golden)
    if not pos:
        return _fail("G-LANDMARK", "golden set has no positive rows")
    missed = [r for r in pos if match_row(r, places) is None]
    rate = 1 - len(missed) / len(pos)
    reg = [r.golden_id for r in missed if r.regression]
    relational = _relational_failures(places, golden)
    detail = f"{len(pos) - len(missed)}/{len(pos)} resolved ({rate:.1%})"
    if missed:
        detail += "; missed " + ", ".join(f"{r.golden_id} {r.name}" for r in missed[:6])
    if relational:
        detail += "; relational: " + "; ".join(relational[:4])
    ok = rate >= 0.95 and not reg and not relational
    if reg:
        detail += f"; REGRESSION rows missed: {reg}"
    return GateResult("G-LANDMARK", ok, detail)


def _relational_failures(places: list[dict], golden: list[G.Row]) -> list[str]:
    by_id = {r.golden_id: r for r in golden}
    out: list[str] = []
    for r in golden:
        if r.row_kind != "negative":
            continue
        found = find_by_name(r, places)
        if r.relation == "component_of" and found:
            out.append(f"{r.golden_id} {r.name} exists as a separate place")
        elif r.relation == "not_credited":
            tgt = by_id[r.targets[0]]
            for p in found:
                keys = {e.get("source_key") for e in p.get("evidence", [])}
                if tgt.whs_id and (str(p.get("whs_id", "")) == tgt.whs_id or f"whs:{tgt.whs_id}" in keys):
                    out.append(f"{r.golden_id} {r.name} carries {tgt.name}'s World Heritage evidence")
    return out


def g_tier(bundle: Bundle, golden: list[G.Row]) -> GateResult:
    places = bundle.active()
    by_id = {r.golden_id: r for r in golden}
    bad: list[str] = []
    checked = 0
    resolved: dict[str, dict] = {}
    for r in _positives(golden):
        p = match_row(r, places)
        if p is None:
            continue
        resolved[r.golden_id] = p
        rank = TIER_RANK.get(p.get("tier"), -1)
        checked += 1
        if rank < TIER_RANK[r.min_tier]:
            bad.append(f"{r.golden_id} {r.name} is {p.get('tier')}, needs {r.min_tier}+")
        if r.max_tier and rank > TIER_RANK[r.max_tier]:
            bad.append(f"{r.golden_id} {r.name} is {p.get('tier')}, max {r.max_tier}")
    for r in golden:
        if r.row_kind == "negative" and r.relation == "not_above":
            for p in find_by_name(r, places):
                for t in r.targets:
                    tp = resolved.get(t)
                    if tp and TIER_RANK[p["tier"]] >= TIER_RANK[tp["tier"]]:
                        bad.append(f"{r.golden_id} {r.name} ({p['tier']}) is not below {by_id[t].name} ({tp['tier']})")
    if checked == 0:
        return _fail("G-TIER", "no golden row resolved, so no tier could be checked")
    return GateResult("G-TIER", not bad, f"{checked} tiers checked; " + (f"{len(bad)} violations: {bad[:3]}" if bad else "all hold"))


def g_id(bundle: Bundle, registry: Registry | None, previous: Bundle | None = None) -> GateResult:
    ids = [p.get("place_id", "") for p in bundle.places]
    bad_fmt = [i for i in ids if not PLACE_ID_RE.match(i)]
    dup = [i for i, n in Counter(ids).items() if n > 1]
    if bad_fmt or dup:
        return _fail("G-ID", f"{len(bad_fmt)} malformed ids {bad_fmt[:2]}, {len(dup)} duplicates {dup[:2]}")
    if registry is None:
        return _fail("G-ID", "no registry supplied")
    unknown = [i for i in ids if i not in registry.rows]
    if unknown:
        return _fail("G-ID", f"{len(unknown)} ids missing from the registry, e.g. {unknown[:2]}")
    resurrected = [p["place_id"] for p in bundle.active()
                   if (registry.rows[p["place_id"]].get("status") or "active") not in ("active",)]
    if resurrected:
        return _fail("G-ID", f"{len(resurrected)} active places are retired or merged in the registry")
    if previous is not None:
        lost = {p["place_id"] for p in previous.places} - set(ids)
        unexplained = [i for i in lost if i not in registry.rows
                       or (registry.rows[i].get("status") or "active") == "active"]
        if unexplained:
            return _fail("G-ID", f"{len(unexplained)} ids lost without a registry status, e.g. {unexplained[:2]}")
    return _ok("G-ID", f"{len(ids)} ids unique, well formed and registered")


def g_ident(bundle: Bundle, registry: Registry | None) -> GateResult:
    qids = Counter(p.get("qid") for p in bundle.active() if p.get("qid"))
    dup = [q for q, n in qids.items() if n > 1]
    if dup:
        return _fail("G-IDENT", f"{len(dup)} QIDs on more than one active place, e.g. {dup[:3]}")
    if registry is not None:
        broken = [i for i, row in registry.rows.items()
                  if (row.get("status") or "").startswith("merged_into:") and registry.resolve(i) is None]
        if broken:
            return _fail("G-IDENT", f"{len(broken)} merged_into chains do not resolve, e.g. {broken[:2]}")
    return _ok("G-IDENT", "no shared QIDs; merge chains resolve")


_BAD_NAME = re.compile(r"(^[QPL]\d+$)|<|>|&#?\w+;|[\x00-\x1f\x7f-\x9f�]|Ã.|Â.")


def g_names(bundle: Bundle) -> GateResult:
    bad: list[str] = []
    for p in bundle.places:
        n = p.get("name_en") or ""
        if not n or len(n) > MAX_NAME_LENGTH or _BAD_NAME.search(n):
            bad.append(f"{p.get('place_id')}:{n[:30]!r}")
    detail = f"{len(bad)} bad names, e.g. {bad[:3]}" if bad else f"{len(bundle.places)} names clean"
    return GateResult("G-NAMES", not bad, detail + " (name_local presence is checked once the country script table exists, M2)")


def g_count(bundle: Bundle) -> GateResult:
    m = bundle.manifest
    n_files = len(bundle.places)
    claimed = m.get("counts", {}).get("places")
    per_country = sum((m.get("counts", {}).get("per_country") or {}).values())
    if claimed is None:
        return _fail("G-COUNT", "manifest has no counts.places")
    if claimed != n_files or (per_country and per_country != n_files):
        return _fail("G-COUNT", f"manifest {claimed}, per-country {per_country}, files {n_files}")
    return _ok("G-COUNT", f"{n_files} places agree")


def g_kind(bundle: Bundle, min_places_for_share: int = 100) -> GateResult:
    places = bundle.active()
    problems: list[str] = []
    counts: Counter[str] = Counter()
    for p in places:
        ks = p.get("kinds") or []
        if not 1 <= len(ks) <= MAX_KINDS_PER_PLACE:
            problems.append(f"{p.get('place_id')} has {len(ks)} kinds")
        for k in ks:
            if k.get("kind") not in KINDS:
                problems.append(f"{p.get('place_id')} unknown kind {k.get('kind')!r}")
            if not k.get("rule") or not k.get("evidence"):
                problems.append(f"{p.get('place_id')} kind {k.get('kind')} lacks rule or evidence")
            counts[k.get("kind")] += 1
    missing = [k for k in KINDS if counts[k] == 0]
    if places and len(places) >= min_places_for_share:
        for k in KINDS:
            share = counts[k] / len(places)
            if counts[k] and (share > 0.25 or share < 0.01):
                problems.append(f"kind {k} on {share:.1%} of places")
    if missing:
        problems.append(f"kinds absent from the world: {missing}")
    if not places:
        problems.append("no places")
    return GateResult("G-KIND", not problems, "; ".join(problems[:4]) if problems else f"{len(places)} places, all kinds present")


def g_kind_precision(bundle: Bundle, labels: list[dict] | None, floor: float = 0.85) -> GateResult:
    if not labels:
        return _fail("G-KIND-PRECISION", "no hand-labelled sample supplied (golden/kind_labels.csv)")
    by_id = {p["place_id"]: p for p in bundle.active() if "place_id" in p}
    tp: Counter[str] = Counter()
    fp: Counter[str] = Counter()
    for lab in labels:
        p = by_id.get(lab["place_id"])
        if p is None:
            continue
        truth = {k for k in lab["kinds"].split("|") if k}
        for k in (x["kind"] for x in p.get("kinds", [])):
            (tp if k in truth else fp)[k] += 1
    weak = []
    for k in KINDS:
        n = tp[k] + fp[k]
        if n and wilson_lower(tp[k], n) < floor:
            weak.append(f"{k} {tp[k]}/{n}")
    if not (tp or fp):
        return _fail("G-KIND-PRECISION", "no labelled place appears in the bundle")
    return GateResult("G-KIND-PRECISION", not weak, f"lower bound below {floor}: {weak}" if weak else "all kinds above the floor")


def g_cover(bundle: Bundle) -> GateResult:
    scope = bundle.manifest.get("scope") or {}
    states, deps = scope.get("sovereign", []), scope.get("dependencies", [])
    if not states and not deps:
        return _fail("G-COVER", "manifest names no countries in scope")
    count = Counter(p.get("iso3") for p in bundle.active())
    short = [f"{c} {count[c]}<5" for c in states if count[c] < 5] + [f"{c} {count[c]}<2" for c in deps if count[c] < 2]
    exempt = set(scope.get("exemptions", []))
    short = [s for s in short if s.split()[0] not in exempt]
    return GateResult("G-COVER", not short, f"{len(short)} under floor: {short[:5]}" if short else "all countries meet the floor")


def g_evidence(bundle: Bundle) -> GateResult:
    bad = []
    for p in bundle.active():
        ev = p.get("evidence") or []
        ids = {e.get("asset_id") for e in ev}
        if not ev or any(not (e.get("source") and e.get("url") and e.get("retrieved")) for e in ev):
            bad.append(p.get("place_id"))
            continue
        if any(set(k.get("evidence", [])) - ids for k in p.get("kinds", [])):
            bad.append(p.get("place_id"))
    return GateResult("G-EVIDENCE", not bad, f"{len(bad)} places with missing or dangling evidence, e.g. {bad[:3]}" if bad else "every place and kind has provenance")


def g_determinism(bundle: Bundle) -> GateResult:
    recorded = bundle.manifest.get("hashes")
    if not recorded:
        return _fail("G-DETERMINISM", "manifest records no file hashes")
    actual = bundle.file_hashes()
    diff = [f for f in sorted(set(recorded) | set(actual)) if recorded.get(f) != actual.get(f)]
    return GateResult("G-DETERMINISM", not diff, f"{len(diff)} files differ from the manifest, e.g. {diff[:3]}" if diff else f"{len(actual)} file hashes match")


def g_churn(bundle: Bundle, previous: Bundle | None, limit: float = 0.02) -> GateResult:
    if previous is None:
        return _ok("G-CHURN", "no previous build to compare")
    if bundle.manifest.get("recorded_cause"):
        return _ok("G-CHURN", f"recorded cause: {bundle.manifest['recorded_cause']}")
    prev = {p["place_id"]: p for p in previous.places}
    cur = {p["place_id"]: p for p in bundle.places}
    changed = sum(1 for i in prev if i not in cur or prev[i].get("tier") != cur[i].get("tier"))
    share = changed / max(1, len(prev))
    return GateResult("G-CHURN", share <= limit, f"{share:.1%} of places changed id or tier (limit {limit:.0%})")


def g_holdout(bundle: Bundle, holdout: list[G.Row] | None, floor: float = 0.85) -> GateResult:
    if not holdout:
        return _fail("G-HOLDOUT", "no holdout rows (holdout/H1.csv); the owner writes it before release")
    places = bundle.active()
    pos = _positives(holdout)
    hit = sum(1 for r in pos if match_row(r, places) is not None)
    lb = wilson_lower(hit, len(pos))
    return GateResult("G-HOLDOUT", lb >= floor, f"recall {hit}/{len(pos)}, Wilson lower bound {lb:.2f} (floor {floor})")


def g_precision(review: list[dict] | None, floor: float = 0.95) -> GateResult:
    if not review:
        return _fail("G-PRECISION", "no precision review (holdout/precision_review.csv)")
    right = sum(1 for r in review if r.get("verdict") == "right")
    rate = right / len(review)
    return GateResult("G-PRECISION", rate >= floor and len(review) >= 100, f"{right}/{len(review)} right ({rate:.1%}); needs >= {floor:.0%} on at least 100")


def pending_gates() -> list[GateResult]:
    why = "needs geometry; built in M4"
    return [_pending("G-REGION", why), _pending("G-DISPUTE", why), _pending("G-PRINT", why)]


def run_all(bundle: Bundle, golden: list[G.Row], *, registry: Registry | None = None,
            previous: Bundle | None = None, holdout: list[G.Row] | None = None,
            labels: list[dict] | None = None, review: list[dict] | None = None,
            known_whs: set[str] | None = None, release: bool = False) -> list[GateResult]:
    out = [
        g_golden_file(golden, known_whs),
        g_landmark(bundle, golden), g_tier(bundle, golden),
        g_id(bundle, registry, previous), g_ident(bundle, registry),
        g_names(bundle), g_count(bundle), g_kind(bundle), g_kind_precision(bundle, labels),
        g_cover(bundle), g_evidence(bundle), g_determinism(bundle), g_churn(bundle, previous),
    ]
    if release:
        out += [g_holdout(bundle, holdout), g_precision(review)]
    out += pending_gates()
    return out
