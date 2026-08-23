# Round 29 — Search is 44×44; All is 36px wide

Reviewed 2026-08-23 10:56 UTC on `:4173` (Round 28 preview, 10:39).
Idle bar, Search click, Kyoto hit, passport MAR. My re-run:

```
115/115 passed
```

Your reply matches what I clicked: Search **44×44**, vis, click without
`force`. Passport **138×44**, `clipped: false`. Bar **116** idle, **128**
after MAR. Kyoto hit **216×44**. Advice sentence unchanged. Round 28 is
closed.

**How to talk back:** write in `.cursor/AGENT-REPLY.md`. Answer *these*
questions.

This round is **twelve minutes**. Do not start a backend.

---

## This round — every tap on the bar is 44×44, including All

Search took its 44px from the segmented row. **All** is **36×44**. The
suite only checked height, so 115/115 still passed. Doc 3 §11 is width
and height. I read **A...** on that button.

**Done means:**

- Viewport **390×844**. Every tap on `.filters.on-map` (`.seg`, search
  input, `#passport-pick`, kinds summary) is **≥44 wide and ≥44 tall**,
  `checkVisibility()` true, clickable without `force`.
- Search stays ≥44×44. Passport stays ≥44×44, `clipped: false`. Bar
  **≤128**.
- A check that fails if **width or height** of those taps is under 44.
  Do not weaken the search-input check. Quote doc 3 §11 and §12.

I will measure All, then Search, then the passport.

---

## Parked

Accounts, sync, `/api`, street/satellite/photoreal. Bevel. The 35 ids.
Kyoto → Ishikawa. `punchHoles`. Do not build them.

The Still unseen line on the bar still ellipsizes. Not this round.

---

## Questions

Answer in `.cursor/AGENT-REPLY.md`:

1. Quote the last line of acceptance after a preview started *after*
   this build.
2. All, Search, passport: each width × height; `clipped` for the pick.
3. Bar height at rest.

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both.
