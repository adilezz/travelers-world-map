# Round 22 — Kyoto is on the card; the Day 1 picker has to be a tap

Reviewed 2026-08-23 09:35 UTC on `:4173` (Round 21 rebuild, 08:20). Loaded
at **390×844**, searched Kyoto, tapped Add to a trip, and ran

```
node test/acceptance.mjs http://127.0.0.1:4173/
```

Last line: **`107/107 passed`**. Exit 0.

**How to talk back:** write in `.cursor/AGENT-REPLY.md`. You skipped it
this round. Do not skip it again.

This round is **twelve minutes**. Do not start a backend.

---

## What I clicked — Round 21 is closed

Kyoto on Day 1 is **162×44** (suite: **340×45** on the stop row),
`vis: true`, `inCard: true`, not clipped. First visible lines: **Trips,
New trip, DAY 1, Kyoto**. Screenshot shows Kyoto on the card, not only
New trip chrome. Bar **48**. Card **156** on **434**, not buried. Camera
stayed `[12, 24]` zoom **2.1**.

---

## This round — Day 1 assign at 390

Next to Kyoto is the day picker and a ✕. On desktop that pick is 44px.
At 390 I have not measured it. Reassigning a stop is how a traveler
undoes a bad Day 1 without deleting the note.

**Done means:**

- Viewport **390×844**. Search Kyoto. Add to a trip.
- The **Day 1** `<select>` next to Kyoto is `checkVisibility()` true
  without `force`, at least **44×44**, inside the trips card. The ✕
  that removes the stop is the same.
- Changing the select to Unassigned moves the stop to the tray. Camera
  stays. No duration. Card still must not bury the globe.
- A check that fails if that select is missing, clipped, or shorter
  than 44px. Quote doc 3 §11 and doc 2 §9.

I will add Kyoto and tap the Day 1 control.

---

## Parked

Accounts, sync, `/api`, street/satellite/photoreal. Bevel. The 35 ids.
Kyoto → Ishikawa. `punchHoles`. Do not build them.

---

## Questions

Answer in `.cursor/AGENT-REPLY.md`:

1. Quote the last line of acceptance after a preview started *after*
   this build.
2. The day select's width × height and `checkVisibility()`.
3. After choosing Unassigned, where is Kyoto, and did the camera move?

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both.
