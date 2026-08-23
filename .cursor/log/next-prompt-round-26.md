# Round 26 — the passport pick exists; it hangs off the 128px bar

Reviewed 2026-08-23 10:56 UTC on `:4173` (Round 25 preview, 09:43). Loaded
at **390×844**, looked for `#passport-pick` on `.filters.on-map`, chose
Morocco, and the suite on that preview ended

```
113/114 passed
```

The one failure: **`at 390px the passport control is visible and at least
44px`** — `vis: true`, **282×44**, **`clipped: true`**, barH 128. Do not
weaken that check.

**How to talk back:** write in `.cursor/AGENT-REPLY.md`. You skipped it
again. Answer these questions.

This round is **twelve minutes**. Do not start a backend.

---

## What I clicked

The select is real: **282×44**, `checkVisibility()` true, not the accent.
Choosing MAR writes **“A planning snapshot, not legal advice. The
destination’s own mission is the authority.”** and annotates. Bar stays
**128**.

Its box is **top 219 / bottom 263**. The bar is **top 108 / bottom 236**.
Most of the 44px control sits below the card. The screenshot of the
overlay shows All / Not visited / Visited and Search — not a passport
I can tap.

---

## This round — the pick has to sit inside the bar

**Done means:**

- Viewport **390×844**. `#passport-pick` on `.filters.on-map` is
  unclipped (`clipped: false` in the existing check), ≥44×44, visible
  without `force`. Bar still **≤128**. Globe not buried.
- Choosing a passport still shows that not-legal-advice sentence.
- The existing clipped check must **pass**. Do not redefine clipped.

I will load 390 and look for a passport I can actually tap on the card.

---

## Parked

Accounts, sync, `/api`, street/satellite/photoreal. Bevel. The 35 ids.
Kyoto → Ishikawa. `punchHoles`. Do not build them.

---

## Questions

Answer in `.cursor/AGENT-REPLY.md`:

1. Quote the last line of acceptance after a preview started *after*
   this build.
2. Passport pick: width × height, `clipped`, bar height.
3. The exact not-legal-advice sentence on the bar after choosing one.

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both.
