# Round 36 — owner: horizontal filters, Layers, place cap

Reviewed 2026-08-23 13:29 UTC. The owner spoke. That outranks Round 35.

**How to talk back:** write in `.cursor/AGENT-REPLY.md`.

This round is **twelve minutes**. Do not start accounts, sync, or a
sign-up wall.

---

## Owner list (all three are in; this round is 1 and 2)

1. **Filters are a horizontal strip** on the map — one row, not a
   stacked 128px card of wrap and grid. Still unseen can sit above that
   row. Every tap stays **≥44×44**. Accent still means visited only.
2. **Atlas | Tiles comes off the corner.** One **Layers** button
   (≥44×44, not the accent) whose menu is:
   - **Geographical** — today’s Atlas (coverage discs on the CARTO
     geography).
   - **Street** — OSM/CARTO **streets** raster, not Google Street View
     panoramas, not satellite, not photoreal.
   - **Tiles** — today’s admin tiles.
   Choosing one switches the view. I will open Layers, tap Street,
   tap Tiles, tap Geographical.
3. **Place-count** (next round unless 1–2 are already done): a control
   to cap how many places are drawn worldwide. Sample from the existing
   **15,770** place files with **geographic distribution** (not the
   first N in Afghanistan). No accounts. No new `/api` unless the
   owner’s “backend” cannot be that sample — if so, write that in the
   reply and do not scaffold Express.

Show-the-register after 1440→390 still timed out. Keep that restore
clickable without `force`. Do not delete it to make Layers.

---

## This round — Done means

- Viewport **1440** and **390×844**. Filter chrome on the map is a
  **horizontal** row (`flex-direction: row` / one line of taps), not
  a two-column wrap. Bar at 390 still **≤128**.
- A **Layers** control ≥44×44. Menu lists Geographical, Street, Tiles
  (those words, not “atlas” as the traveler-facing label if the owner
  said Geographical). Each item ≥44×44. Street actually changes the
  basemap. Tiles still sets `tile-extrude` visible. Geographical
  returns coverage discs. Quote doc 2 §4.1 and doc 3 §12.
- Checks for the Layers menu and for Street ≠ Geographical. Do not
  weaken hide-register or 44×44 tap checks. Do not `force`-click.

I will measure the filter row, then open Layers.

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
2. Filter row: one horizontal line? Height of the bar at 390.
3. Layers: width × height. After Street, after Tiles, after
   Geographical — what I should see on the globe.

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both. **The owner’s message in this thread
outranks the old “street parked” line.**
