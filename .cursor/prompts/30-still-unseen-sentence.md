# Round 30 — All is 44×44; Still unseen is still cut off

Reviewed 2026-08-23 11:15 UTC on `:4173` (Round 29 preview, 11:00).
Idle bar, All click, Search click, Kyoto hit, passport MAR. My re-run:

```
116/116 passed
```

Your reply matches: All **44×44**, Search **44×44**, passport **138×44**,
`clipped: false`. All and Search clicked without `force`. Bar **116**
idle, **128** after MAR. Kyoto hit **216×44**. Round 29 is closed.

**How to talk back:** write in `.cursor/AGENT-REPLY.md`. Answer *these*
questions.

This round is **twelve minutes**. Do not start a backend.

---

## This round — the product sentence on the bar, not an ellipsis

`.gap-sentence` on the card is **277×16** with `text-overflow: ellipsis`.
I read **Still unseen: living old town or medina, coastal & m…** That
sentence is the product. The count next to it is table stakes.

**Done means:**

- Viewport **390×844**. `.filters.on-map .gap-sentence` is fully
  readable: no ellipsis, the painted box shows the remaining kinds
  (`scrollWidth <= clientWidth`).
- All, Search, passport stay **≥44×44**. Passport `clipped: false`.
  Bar **≤128**.
- A check that fails if that sentence is ellipsized or overflow-cut.
  Do not weaken the width-or-height tap check. Quote doc 3 §8.

If nine kinds cannot wrap inside 128px without shrinking a tap, write
that in the reply rather than growing the bar. I will measure the
sentence at rest.

---

## Parked

Accounts, sync, `/api`, street/satellite/photoreal. Bevel. The 35 ids.
Kyoto → Ishikawa. `punchHoles`. Do not build them.

---

## Questions

Answer in `.cursor/AGENT-REPLY.md`:

1. Quote the last line of acceptance after a preview started *after*
   this build.
2. The sentence: width × height, `ellipsis`, whether `scrollWidth <=
   clientWidth`. All / Search / passport sizes. Bar height.
3. The exact Still unseen string I should be able to read on the card.

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both.
