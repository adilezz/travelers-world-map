# Reply to the reviewer

This file is yours. Write freely — questions, blockers, disagreements, what you
chose and why. The reviewer reads it at the start of every round (roughly every
twelve minutes) and answers in `.cursor/NEXT-PROMPT.md`.

**It is never overwritten by the reviewer.** Each round's contents are archived
to `.cursor/log/` and then this file is reset to the template below, so anything
you write here will have been read before it moves.

Useful things to say:

- what you finished, and what you deliberately did not
- where the brief and the code disagreed, and which you followed
- anything you could not verify yourself
- a decision you think belongs to the owner rather than to either of us
- if a rule in `travelers-world-map.mdc` is getting in the way, say so — rules
  that block good work should be argued with, not worked around silently

---

## Round 17

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. At 390, the control's width × height and `checkVisibility()`.
3. After the tap, center, zoom, and whether Kyoto is on the disc.

**Your reply:**

1. **`96/96 passed`**. Fresh `npm run build`, then a new `npx vite preview --port 4173 --host 127.0.0.1` started after that build. `node test/acceptance.mjs http://127.0.0.1:4173/` exit 0.

2. **358×44**, `checkVisibility() === true`. Selector is `.detail:not([hidden]) button.show-on-map` — at 390 the sheet is not `.detail-on-map`. Ink, not the accent. Search hit on the bar was **354×44**, `vis=true`, bar **122px**.

3. After the tap: **center `[135.75, 34.92]`, zoom `4.71`, `onDisc: true`**. Kyoto's projection is on the canvas and not under the bar or the sheet. Selecting the hit left the camera where it was.

**What I did**

- `.detail .show-on-map` is 44×44 on every sheet, not only `.detail-on-map`.
- At 390, while `.search-hits` is present, the compact sentence and the All/Not visited/Visited row hide so search + the first hit fit in the 128px bar.
- `showOnMap` now pads `fitBounds` from the real overlap of the filter bar and the detail sheet, so the place sits on the visible disc instead of under chrome. A full-width phone sheet pads the bottom; a corner card pads the side.
- Checks at 390: search Kyoto on the bar, hit visible without `force`, Show ≥44×44, select does not move the camera, tap does. Quotes doc 3 §6.1 and §12.

**Did not**

- Kyoto's tile still reads Ishikawa Prefecture. Parked.
- Did not change 340×280 or the kinds-popover-must-not-bury-the-globe rule.

At 1440 the same padding moved the fly slightly (`zoom` 5.82, still `onDisc: true`). Selecting still does not zoom.
