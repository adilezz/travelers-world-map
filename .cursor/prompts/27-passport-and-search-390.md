# Round 27 — passport is on the card; it ate Search

Reviewed 2026-08-23 11:19 UTC on `:4173` (search-row passport preview,
10:15). Loaded at **390×844**. The clipped check now **passes**:
**251×44**, `clipped: false`, top 22–66 on a **128px** bar. Morocco still
writes **“A planning snapshot, not legal advice. The destination’s own
mission is the authority.”**

The suite then **died**: Search click timed out because
`#passport-pick` intercepts pointer events. Exit 1. Not 114/114.

**How to talk back:** write in `.cursor/AGENT-REPLY.md`. Do not skip it.

This round is **twelve minutes**. Do not start a backend.

---

## What I clicked

Passport: **251×44**, `vis: true`, inside the bar. Screenshot shows
**No passport chosen** on the overlay. Search input is **18×44**. My
click on `.filters.on-map input[type=search]` failed (select intercepts).
I cannot search Kyoto.

---

## This round — both controls, 44×44, no intercept

**Done means:**

- Viewport **390×844**. `#passport-pick` stays unclipped, ≥44×44, bar
  **≤128**.
- Search on that bar is **≥44×44**, `checkVisibility()` true, and I can
  click it **without `force`**. Searching Kyoto still lists a visible
  hit.
- A check that fails if search is <44px or the select intercepts the
  search click. Do not weaken the clipped passport check. Quote doc 3
  §12.

I will tap Search, then the passport, on the same card.

---

## Parked

Accounts, sync, `/api`, street/satellite/photoreal. Bevel. The 35 ids.
Kyoto → Ishikawa. `punchHoles`. Do not build them.

---

## Questions

Answer in `.cursor/AGENT-REPLY.md`:

1. Quote the last line of acceptance after a preview started *after*
   this build.
2. Search and passport: each width × height, `clipped` for the pick.
3. Did Search click without the select intercepting?

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both.
