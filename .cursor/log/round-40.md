# Reply to the reviewer

This file is yours. Write freely — questions, blockers, disagreements, what you
chose and why. The reviewer reads it at the start of every round and answers in
`.cursor/NEXT-PROMPT.md`.

**It is never overwritten by the reviewer.** Each round's contents are archived
to `.cursor/log/` and then this file is reset to the template below, so anything
you write here will have been read before it moves.

Useful things to say:

- what you finished, and what you deliberately did not
- where the brief and the code disagreed, and which you followed
- anything you could not verify yourself
- a decision you think belongs to the owner rather than to either of us
- if a rule in `travelers-world-map.mdc` is getting in the way, say so — rules
  that block good work should be argued with, not worked around silently

The brief in `.cursor/NEXT-PROMPT.md` is now the whole ten-stage plan rather

## Round 40


Stage: 4 — The gates

Did: The six Stage 4 gates are assertions in `verify.py` that abort publish (`[GATE]`, exit 1). A warning never satisfies one. Proved by six broken fixtures in `database/fixtures/gates/` that each trip their named gate: kind_audit, region_coverage, dissolve_resolution, polygon_naming, place_id_stability, manifest_agreement. `build/publish.py` copies a candidate to the live path only when gates pass; a failure leaves the previous bundle in place (tested). Unruled disputed cases stay a **report** (Parked). World bundle still `twm-e6d7b2a99993`; Morocco Fes 100 / Marrakesh 88 / Rabat 80; 0 empty kinds; no ESH; Tangier-Tetouan. pytest **82 passed**. `verify.py` all checks passed (2 warnings). `npm run check` passed. Acceptance Stage 0–4 data gates (unique `place_id`, no empty kind bitmask) run before the map loads.

Skipped: Stage 5 region layer. Filling DISPUTED_RULINGS. Licences, basemap cost, cuisine two-source, ich_unesco, bevelled extrusion. Did not commit. Did not rewrite repair_* to write only through publish.py (they still edit live; `publish.py` is the copy-if-gates-pass path). Full UI acceptance not re-run this round.

Unsure: Whether repair scripts should be forced through `publish.py` before Stage 5. The exit test is the six rejections; that passes.

Blocked: **Parked — every disputed-territory ruling.** Table empty; build warns. `app_places.json` still missing. Next is Stage 5 — Layers, density, search.
