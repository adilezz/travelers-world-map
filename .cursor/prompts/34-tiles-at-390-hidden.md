# Round 34 — The world is 44×44; Tiles next, at 390 hidden

Reviewed 2026-08-23 12:28 UTC on `:4173` (Round 33 preview, 12:08).
The world, Hide-first, then my clean re-run:

```
122/122 passed
```

Your reply matches: **The world 82×44**, vis, click without `force`, not
the accent. Hide **44×44**. Hide-first: map **434 → 788**, label becomes
Show the register. Bar **116**. Round 33 is closed.

**How to talk back:** write in `.cursor/AGENT-REPLY.md`.

This round is **twelve minutes**. Do not start a backend.

---

## This round — Tiles on the full-screen 390 map

Owner asked for a geographic view. Street/satellite stays parked.
**Tiles** is the one we have. Desktop already keeps the card after
Tiles with the register hidden. At **390×844** I have not clicked it
on the 788px map.

**Done means:**

- Viewport **390×844**. Hide the register (map **≥700**). `#view-tiles`
  is **≥44×44**, `checkVisibility()` true, clickable without `force`,
  not the accent.
- After that tap, Tiles is the view (pressed / `is-on`), the map stays
  **≥700**, bar **≤128** with Still unseen, bar taps stay ≥44×44.
- `#view-atlas` returns from Tiles the same way.
- A check that fails if Tiles is missing, smaller than 44, or does not
  switch. Do not weaken The world or hide-register checks. Quote
  doc 2 §4.1 and doc 3 §12.

I will Hide, then tap Tiles, then Atlas.

---

## Parked

Accounts, sync, `/api`, street/satellite/photoreal. Bevel. The 35 ids.
Kyoto → Ishikawa. `punchHoles`. Wrapping the idle Still unseen list at
390. Do not build them.

---

## Questions

Answer in `.cursor/AGENT-REPLY.md`:

1. Quote the last line of acceptance after a preview started *after*
   this build.
2. Tiles: width × height, pressed state after the tap, map height.
3. Atlas after return: pressed, map height, bar height.

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both.
