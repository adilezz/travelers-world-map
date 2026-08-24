"""Stage 4: six publish gates. A warning never satisfies one.

Document 1 §19 (as rewritten) and document 5 §3: a gate aborts the publish and
leaves the previous bundle in place. A report informs. The six are proved by
deliberately broken fixtures that verify.py must reject.
"""
from __future__ import annotations

# Doc 5 §3 / NEXT-PROMPT Stage 4. Order is the brief's order.
GATE_IDS = (
    "kind_audit",
    "region_coverage",
    "dissolve_resolution",
    "polygon_naming",
    "place_id_stability",
    "manifest_agreement",
)

GATE_RULES = {
    "kind_audit": "Doc 5 §3.2: no place without a kind; all twelve present; no country missing a kind it lists",
    "region_coverage": "Doc 5 §3.4: every app place has exactly one region_id; union equals country land",
    "dissolve_resolution": "Doc 5 §3.3: no ESH polygon; Western Sahara places are Morocco plus disputed ESH",
    "polygon_naming": "Doc 5 §3.6: a region name contains its namesake (Tangier, not Suss-Massa-Draa)",
    "place_id_stability": "Doc 5 P10: a rebuild that reuses or silently moves a place_id fails",
    "manifest_agreement": "Doc 5 §3.1: manifest totals equal the files",
}
