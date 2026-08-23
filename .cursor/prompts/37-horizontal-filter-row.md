# Round 37 — Layers works; the filter is still three rows

Reviewed 2026-08-23 13:43 UTC on `:4173`. AGENT-REPLY empty. I opened
Layers, tapped Street, Tiles, Geographical.

**Layers is closed.** Button **60×44**, not the accent. Menu:
Geographical, Street, Tiles — each **190×44**. Street sets CARTO
`light_all` and `aria-pressed` on Street. Tiles turns `tile-extrude`
**visible**. Geographical returns Voyager and coverage discs. Country
0/N discs stay on Street; the basemap is what changed.

**Filters are not one horizontal strip.** Bar **116px**, CSS grid two
columns. Coverage at y **69**, All/Not visited/Visited at y **85**,
Kinds of place at y **131**. A check that only asserts height ≤128 is
the old cap, not the owner’s row.

**How to talk back:** write in `.cursor/AGENT-REPLY.md`.

This round is **twelve minutes**. Do not start accounts or Express.

---

## This round — one horizontal filter row

Owner: the filter should be horizontal. Still unseen may sit above.
All, Not visited, Visited, Search, passport, Kinds of place sit on
**one line** (same top, ±8px). Every tap **≥44×44**. Bar at 390
**≤128**. Layers stays in the corner.

**Done means:**

- Viewport **390×844**. `.filters.on-map > .filter-row` and
  `.filter-more` (Kinds) share one row: `Math.abs(topA - topB) < 8`.
  Bar **≤128**. Taps ≥44×44. Accent off chrome.
- Layers menu still lists Geographical, Street, Tiles and still
  switches. Do not put Atlas|Tiles back on the corner.
- A check that fails if Kinds is a second row. Do not weaken it to
  “height ≤128”. Quote the owner and doc 3 §12.

Place-count (distributed sample of the 15,770) is **next**, not this
round.

I will measure Kinds vs All: same row or not.

---

## Parked

Accounts, sync, sign-up. Satellite / photoreal / Google panoramas.
Bevel. The 35 ids. Kyoto → Ishikawa. `punchHoles`. Wrapping nine kinds
on the 390 sentence. Do not build them.

---

## Questions

Answer in `.cursor/AGENT-REPLY.md`:

1. Quote the last line of acceptance after a preview started *after*
   this build.
2. All row top, Kinds top, bar height. Same line?
3. Layers still 44×44 after the reflow?

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both. The owner’s Layers request is done; the
horizontal row is not.
