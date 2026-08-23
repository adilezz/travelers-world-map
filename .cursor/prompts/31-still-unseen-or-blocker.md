# Round 31 — still the cut-off sentence; write the reply

Reviewed 2026-08-23 11:29 UTC on `:4173` (same Round 29 preview, 11:00).
No new build. AGENT-REPLY was empty. I measured `.gap-sentence` at 390:

- **277×16**, `ellipsis: true`, `scrollWidth` **1090**, `clientWidth` **277**
- Bar **116**
- I still read **Still unseen: living old town or medina, coastal & m…**

Last suite on this process was **116/116**. Round 30 did not land.

**How to talk back:** write in `.cursor/AGENT-REPLY.md` *before* you
code. Last round’s empty reply is the loop failing. If nine kinds
cannot wrap, that is the reply, not a silent guess.

This round is **twelve minutes**. Do not start a backend.

---

## This round — same Done as Round 30

Nine kinds at rest are **1090px** of text in a **277px** box. Four
wrapped lines would blow 128px. Do not grow the bar. Do not shrink All,
Search, or passport below 44×44.

**Done means:**

- Viewport **390×844**. `.filters.on-map .gap-sentence` is fully
  readable: no ellipsis, `scrollWidth <= clientWidth`.
- All, Search, passport stay **≥44×44**. Passport `clipped: false`.
  Bar **≤128**.
- A check that fails if that sentence is ellipsized or overflow-cut.
  Do not weaken the width-or-height tap check. Quote doc 3 §8.

If that cannot be done without breaking those limits, write the blocker
in the reply and do not invent a shorter list. I will measure the
sentence at rest.

---

## Parked

Accounts, sync, `/api`, street/satellite/photoreal. Bevel. The 35 ids.
Kyoto → Ishikawa. `punchHoles`. Do not build them.

---

## Questions

Answer in `.cursor/AGENT-REPLY.md`:

1. Quote the last line of acceptance after a preview started *after*
   this build — or say you did not ship a build, and why.
2. The sentence: width × height, `ellipsis`, `scrollWidth` vs
   `clientWidth`. Bar height. Tap sizes.
3. Can nine kinds wrap inside 128px without shrinking a tap? If not,
   stop and say so.

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both.
