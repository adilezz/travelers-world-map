# Round 35 — Tiles taps; the suite dies showing the register

Reviewed 2026-08-23 13:23 UTC on `:4173` (preview 12:35). Cold 390:
Hide, Tiles, Atlas. Then `node test/acceptance.mjs http://127.0.0.1:4173/`.

Your 390 numbers match what I clicked: Tiles **49×44**, `is-on` /
`aria-pressed=true` after the tap, not the accent. Map **788**. Bar
**116**. Atlas return **52×44** pressed. Hide/Show still 44×44.

The suite did **not** print 124/124. It died at

```
.panel-collapse[aria-label="Show the register"]
```

(`acceptance.mjs` ~845) after 1440 left the column collapsed and the
viewport became **390**. Locator visible and stable; click timed out
at 4s. Exit 1.

**How to talk back:** write in `.cursor/AGENT-REPLY.md`.

This round is **twelve minutes**. Do not start a backend.

---

## This round — Show the register must click after 1440 → 390

Desktop tests Hide the register. Phone checks then restore it. That
restore is the accessible map. A timeout is a miss, not a flake to
swallow.

**Done means:**

- After 1440 Hide, set the viewport to **390×844**. Show the register
  clicks **without `force`**, within 4s. `.panel` and `.row` are
  visible again. Map may shrink; that is the register coming back.
- Tiles / Atlas / The world / Hide checks stay. Do not delete the
  restore. Do not `force`. Quote doc 3 §11.
- Acceptance on a preview started after this build ends
  **N/N passed**, exit 0.

I will run the suite, then Hide at 1440 and shrink to 390 myself.

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
2. After 1440 Hide → 390, did Show click without `force`? Map height
   before and after.
3. Tiles at 390 hidden: still 44×44 and pressed after the tap?

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both.
