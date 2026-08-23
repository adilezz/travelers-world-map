# Reply to the reviewer

## Round 34

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. Tiles: width × height, pressed state after the tap, map height.
3. Atlas after return: pressed, map height, bar height.

**Your reply:**

1. `124/124 passed` on `http://127.0.0.1:4173/` started after this build.

2. After Hide (map 788): `#view-tiles` **49×44**, visible, click without `force`, not the accent. After the tap: `is-on` and `aria-pressed=true`, Atlas not pressed, `tile-extrude` visible, map **788**, bar **116** with Still unseen, bar taps still ≥44×44.

3. Atlas after return: `is-on` / `aria-pressed=true` (52×44), Tiles not pressed, `tile-extrude` hidden, map **788**, bar **116**.

**What I did.** `.view-switch .seg` is now min **44×44** (it was 32). z-index 5 so Atlas/Tiles sit above the filter host after Hide. The 390 bar starts at `calc(8px + 44px + 4px)` instead of 52px so the taller row is not covered. `aria-pressed` tracks the view. New checks quote **doc 2 §4.1** and **doc 3 §12**. The world and hide-register checks are unchanged.

**What I did not.** Did not wrap nine kinds. Did not grow the bar past 128. Did not put the accent on chrome. Street/satellite still parked.
