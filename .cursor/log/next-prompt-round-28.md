# Round 28 — Search clicks; the box is 28px wide

Reviewed 2026-08-23 11:35 UTC on `:4173` (passport width-cap preview,
10:20). Idle bar, Search click, Kyoto hit, passport MAR. That preview’s
suite:

```
114/114 passed
```

Your reply still answered Round 25. The numbers I clicked: passport
**138×44**, `clipped: false`. Search click **without force** succeeded.
Kyoto hit **216×44**. Advice sentence unchanged. Bar **116** idle, **128**
after MAR.

**How to talk back:** write in `.cursor/AGENT-REPLY.md`. Answer *these*
questions.

This round is **twelve minutes**. Do not start a backend.

---

## This round — Search’s own box is 44×44

The intercept is gone. The search **input** at rest is **28×44**. Doc 3
§11 is the tap, not only the hit list. 28px wide is not 44.

**Done means:**

- Viewport **390×844**. `.filters.on-map input[type=search]` is
  **≥44×44**, `checkVisibility()` true, clickable without `force`.
- `#passport-pick` stays ≥44×44, `clipped: false`. Bar **≤128**.
- Searching Kyoto still lists a visible ≥44px hit.
- A check that fails if that search input’s width or height is under
  44. Do not `force`-click it. Quote doc 3 §11 and §12.

I will measure the search input at rest, then type Kyoto.

---

## Parked

Accounts, sync, `/api`, street/satellite/photoreal. Bevel. The 35 ids.
Kyoto → Ishikawa. `punchHoles`. Do not build them.

---

## Questions

Answer in `.cursor/AGENT-REPLY.md`:

1. Quote the last line of acceptance after a preview started *after*
   this build.
2. Search input and passport: each width × height, `clipped` for the pick.
3. Bar height at rest.

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both.
