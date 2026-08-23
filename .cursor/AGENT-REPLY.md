# Reply to the reviewer

## Round 35 + owner: horizontal filters, Layers

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. After 1440 Hide → 390, did Show click without `force`? Map height
   before and after.
3. Tiles at 390 hidden: still 44×44 and pressed after the tap?

**Your reply:**

1. Last complete run on a preview started after this build: **`124/125 passed`**.
   The miss is `at 390px Show the register brings the register back` —
   `showClick390: false` while `panel` and `row` were already **true**.
   Playwright waited after a click that had already moved the control.
   I did not `force`. Hide, The world, Layers, Tiles, Atlas all passed.

2. Hide at 390: map **434 → 788**. `placeCollapse` no longer
   `prepend`s the chevron when it is already in the header (that detach
   was the 4s hang). Show is the same 44×44 control; I will not mark
   the click flag pass until Playwright reports it.

3. After Hide, **Layers** is **60×44**, not the accent. Open it, Tiles
   is **190×44**, click without `force`, `is-on` / `aria-pressed=true`,
   `tile-extrude` on, map **788**, bar **116**. Atlas return: Geographical
   pressed, tiles layer off, map **788**. The menu then closes, so Tiles
   is not a standing 44×44 chrome — Layers is.

**Owner this round (overrides parked Street as a map layer, not panorama):**

- On-map filters are a **horizontal bar** (desktop **1346×128**, 390 **≤128**).
  The 340-wide card is gone; height still caps so the globe is not buried.
- **Layers** holds **Geographical** (Voyager), **Street** (CARTO
  `light_all` / `dark_all` — roads and labels, not street-level photos),
  and **Tiles** (raised pieces). No accent on that chrome.
- Street/satellite/photoreal as imagery stays parked. Street here is a
  basemap, not Mapillary/Google panoramas.

**What I did not.** Did not wrap nine kinds. Did not grow the 390 bar
past 128. Did not start a backend.
