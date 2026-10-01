"""Every gate passes on the oracle bundle and fails on the defect it exists to catch."""
import copy

from conftest import pid, write_bundle

from twm2 import gates
from twm2.bundle import Bundle, Registry


def load(oracle):
    d, reg, places = oracle
    return Bundle.load(d), Registry.load(reg), places


def rebuild(tmp_path, places, name="b2"):
    return Bundle.load(write_bundle(tmp_path / name, places))


# -------- landmark
def test_landmark_passes_on_oracle(oracle, golden_rows):
    b, _, _ = load(oracle)
    r = gates.g_landmark(b, golden_rows)
    assert r.passed, r.detail


def test_landmark_fails_when_a_regression_landmark_is_missing(oracle, golden_rows, tmp_path):
    _, _, places = load(oracle)
    kept = [p for p in places if p["name_en"] != "Machu Picchu"]
    r = gates.g_landmark(rebuild(tmp_path, kept), golden_rows)
    assert not r.passed and "REGRESSION" in r.detail


def test_landmark_fails_when_the_landmark_is_a_town_nearby(oracle, golden_rows, tmp_path):
    """v1's failure: Machu Picchu shipped as 'Quillabamba', 37 km away."""
    _, _, places = load(oracle)
    bad = copy.deepcopy(places)
    mp = next(p for p in bad if p["name_en"] == "Machu Picchu")
    mp["name_en"], mp["aliases"], mp["lat"], mp["lon"] = "Quillabamba", [], -12.86, -72.69
    r = gates.g_landmark(rebuild(tmp_path, bad), golden_rows)
    assert not r.passed


def test_landmark_requires_the_right_type(oracle, golden_rows, tmp_path):
    _, _, places = load(oracle)
    bad = copy.deepcopy(places)
    next(p for p in bad if p["name_en"] == "Petra")["type"] = "settlement"
    assert not gates.g_landmark(rebuild(tmp_path, bad), golden_rows).passed


def test_a_serial_component_as_separate_place_fails(oracle, golden_rows, tmp_path):
    _, _, places = load(oracle)
    bad = copy.deepcopy(places)
    bad.append({**places[0], "place_id": pid("khufu"), "name_en": "Great Pyramid of Khufu",
                "aliases": [], "qid": "Q1"})
    r = gates.g_landmark(rebuild(tmp_path, bad), golden_rows)
    assert not r.passed and "Khufu" in r.detail


def test_nested_destinations_may_exist_or_not(oracle, golden_rows, tmp_path):
    """Colosseum and Uffizi are 'optional' rows: both outcomes pass."""
    _, _, places = load(oracle)
    with_nested = copy.deepcopy(places)
    rome = next(p for p in places if p["name_en"] == "Rome")
    with_nested.append({**rome, "place_id": pid("colosseum"), "name_en": "Colosseum", "aliases": [],
                        "type": "site", "qid": "Q2"})
    assert gates.g_landmark(rebuild(tmp_path, with_nested, "n1"), golden_rows).passed
    assert gates.g_landmark(rebuild(tmp_path, places, "n2"), golden_rows).passed


def test_a_town_carrying_a_landmarks_world_heritage_evidence_fails(oracle, golden_rows, tmp_path):
    _, _, places = load(oracle)
    bad = copy.deepcopy(places)
    mp = next(p for p in places if p["name_en"] == "Machu Picchu")
    bad.append({**mp, "place_id": pid("quilla"), "name_en": "Quillabamba", "aliases": [],
                "type": "settlement", "lat": -12.86, "lon": -72.69, "qid": "Q3"})
    r = gates.g_landmark(rebuild(tmp_path, bad), golden_rows)
    assert not r.passed and "World Heritage" in r.detail


# -------- tier
def test_tier_passes_on_oracle(oracle, golden_rows):
    b, _, _ = load(oracle)
    assert gates.g_tier(b, golden_rows).passed


def test_tier_fails_when_florence_is_below_floor(oracle, golden_rows, tmp_path):
    _, _, places = load(oracle)
    bad = copy.deepcopy(places)
    next(p for p in bad if p["name_en"] == "Florence")["tier"] = "Notable"
    assert not gates.g_tier(rebuild(tmp_path, bad), golden_rows).passed


def test_tier_fails_when_belluno_outranks_florence(oracle, golden_rows, tmp_path):
    _, _, places = load(oracle)
    bad = copy.deepcopy(places)
    fl = next(p for p in places if p["name_en"] == "Florence")
    bad.append({**fl, "place_id": pid("belluno"), "name_en": "Belluno", "aliases": [], "qid": "Q4",
                "lat": 46.14, "lon": 12.22, "tier": "Icon"})
    r = gates.g_tier(rebuild(tmp_path, bad), golden_rows)
    assert not r.passed and "Belluno" in r.detail


def test_tier_respects_max_tier(oracle, golden_rows, tmp_path):
    _, _, places = load(oracle)
    bad = copy.deepcopy(places)
    next(p for p in bad if p["name_en"] == "Wadi Al-Hitan")["tier"] = "Icon"
    assert not gates.g_tier(rebuild(tmp_path, bad), golden_rows).passed


# -------- identity
def test_id_and_ident_pass_on_oracle(oracle):
    b, reg, _ = load(oracle)
    assert gates.g_id(b, reg).passed
    assert gates.g_ident(b, reg).passed


def test_id_rejects_a_v1_style_id(oracle, tmp_path):
    _, reg, places = load(oracle)
    bad = copy.deepcopy(places)
    bad[0]["place_id"] = "MOR-c2555567"
    assert not gates.g_id(rebuild(tmp_path, bad), reg).passed


def test_id_rejects_duplicates_and_unregistered_ids(oracle, tmp_path):
    _, reg, places = load(oracle)
    dup = copy.deepcopy(places) + [copy.deepcopy(places[0])]
    assert not gates.g_id(rebuild(tmp_path, dup, "d"), reg).passed
    fresh = copy.deepcopy(places)
    fresh[0]["place_id"] = pid("never registered")
    assert not gates.g_id(rebuild(tmp_path, fresh, "f"), reg).passed


def test_id_rejects_a_retired_place_published_as_active(oracle, tmp_path):
    _, _, places = load(oracle)
    reg = Registry({p["place_id"]: {"status": "active"} for p in places})
    reg.rows[places[0]["place_id"]]["status"] = "retired"
    assert not gates.g_id(rebuild(tmp_path, places), reg).passed


def test_id_flags_ids_lost_without_a_registry_status(oracle, tmp_path):
    b, reg, places = load(oracle)
    smaller = rebuild(tmp_path, places[:-1])
    assert not gates.g_id(smaller, reg, previous=b).passed
    reg.rows[places[-1]["place_id"]]["status"] = "retired"
    assert gates.g_id(smaller, reg, previous=b).passed


def test_ident_rejects_a_shared_qid_and_a_broken_merge_chain(oracle, tmp_path):
    _, reg, places = load(oracle)
    bad = copy.deepcopy(places)
    bad[1]["qid"] = bad[0]["qid"]
    assert not gates.g_ident(rebuild(tmp_path, bad), reg).passed
    reg.rows["pl_aaaaaaaaaa"] = {"status": "merged_into:pl_bbbbbbbbbb"}
    assert not gates.g_ident(rebuild(tmp_path, places, "ok"), reg).passed


def test_registry_follows_merge_chains():
    reg = Registry({"a": {"status": "merged_into:b"}, "b": {"status": "merged_into:c"}, "c": {"status": "active"}})
    assert reg.resolve("a") == "c"
    cyc = Registry({"a": {"status": "merged_into:b"}, "b": {"status": "merged_into:a"}})
    assert cyc.resolve("a") is None


# -------- names
def test_names_pass_on_oracle(oracle):
    assert gates.g_names(load(oracle)[0]).passed


def test_names_reject_v1_defects(oracle, tmp_path):
    _, _, places = load(oracle)
    for bad_name in ["Q130654972", "Fujian <em>Tulou</em>", "Rede de A\x81reas Marinhas",
                     "Zones A2, A3, A4, A5 kai A7 periochis A Ethnikou Thalassiou Parkou Voreion Sporadon",
                     "Ã\xa0 mojibake", ""]:
        bad = copy.deepcopy(places)
        bad[0]["name_en"] = bad_name
        assert not gates.g_names(rebuild(tmp_path, bad, "n")).passed, bad_name


# -------- counts, evidence, determinism, churn
def test_count_gate(oracle, tmp_path):
    b, _, places = load(oracle)
    assert gates.g_count(b).passed
    b.manifest["counts"]["places"] += 1
    assert not gates.g_count(b).passed


def test_evidence_gate(oracle, tmp_path):
    b, _, places = load(oracle)
    assert gates.g_evidence(b).passed
    bad = copy.deepcopy(places)
    bad[0]["evidence"][0]["url"] = ""
    assert not gates.g_evidence(rebuild(tmp_path, bad)).passed
    dangling = copy.deepcopy(places)
    dangling[0]["kinds"][0]["evidence"] = ["missing"]
    assert not gates.g_evidence(rebuild(tmp_path, dangling, "d")).passed


def test_determinism_gate_detects_tampering(oracle):
    d, _, _ = oracle
    b = Bundle.load(d)
    assert gates.g_determinism(b).passed
    f = next((d / "places").glob("*.json"))
    f.write_text(f.read_text(encoding="utf-8") + " ", encoding="utf-8")
    assert not gates.g_determinism(Bundle.load(d)).passed


def test_churn_gate(oracle, tmp_path):
    b, _, places = load(oracle)
    assert gates.g_churn(b, b).passed
    changed = copy.deepcopy(places)
    for p in changed[:10]:
        p["tier"] = "Local"
    assert not gates.g_churn(rebuild(tmp_path, changed), b).passed


# -------- kinds
def test_kind_gate_flags_missing_kinds_and_over_use(oracle):
    b, _, _ = load(oracle)
    assert gates.g_kind(b).passed                       # under 100 places the share check is skipped
    r = gates.g_kind(b, min_places_for_share=50)        # the golden set is not a world: ruins is on 26 % of rows
    assert not r.passed and "ruins" in r.detail


def test_kind_gate_passes_on_a_balanced_world(tmp_path):
    from twm2.vocab import KINDS
    places = []
    for i in range(130):
        k = KINDS[i % len(KINDS)]
        places.append({"place_id": pid(str(i)), "iso3": "EGY", "status": "active",
                       "kinds": [{"kind": k, "rule": "r", "evidence": ["a"]}]})
    assert gates.g_kind(Bundle(tmp_path, {}, places)).passed
    places[0]["kinds"] = []
    assert not gates.g_kind(Bundle(tmp_path, {}, places)).passed


def test_kind_precision_gate(oracle):
    b, _, places = load(oracle)
    assert not gates.g_kind_precision(b, None).passed
    labels = [{"place_id": p["place_id"], "kinds": "|".join(k["kind"] for k in p["kinds"])} for p in places]
    # a tiny sample cannot clear a Wilson lower bound of 0.85 for rare kinds; large kinds can
    r = gates.g_kind_precision(b, labels)
    assert "ruins" not in r.detail


# -------- coverage and release-only gates
def test_cover_gate(oracle):
    b, _, _ = load(oracle)
    assert gates.g_cover(b).passed
    b.manifest["scope"]["dependencies"] = ["BVT"]
    assert not gates.g_cover(b).passed


def test_holdout_and_precision_gates_fail_without_ground_truth(oracle):
    b, _, _ = load(oracle)
    assert not gates.g_holdout(b, None).passed
    assert not gates.g_precision(None).passed
    assert not gates.g_precision([{"verdict": "right"}] * 50).passed        # too small
    assert gates.g_precision([{"verdict": "right"}] * 100).passed
    assert not gates.g_precision([{"verdict": "right"}] * 90 + [{"verdict": "wrong_name"}] * 10).passed


def test_pending_gates_count_as_failures():
    pend = gates.pending_gates()
    assert {g.gate for g in pend} == {"G-REGION", "G-DISPUTE", "G-PRINT"}
    assert all(g.pending and not g.passed for g in pend)


def test_run_all_is_never_green_before_m4(oracle, golden_rows):
    b, reg, _ = load(oracle)
    results = gates.run_all(b, golden_rows, registry=reg)
    assert any(not r.passed for r in results)
    landmark = next(r for r in results if r.gate == "G-LANDMARK")
    assert landmark.passed
