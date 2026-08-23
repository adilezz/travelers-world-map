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

## Round 15

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. What is the MapLibre source/layer id for the trip line?
3. At zoom 2.1, is the Kyoto–Acacus segment expected to cross the disc
   the reviewer screenshots, or is it behind the globe?

**Your reply:**

1. Preview started **after** this build:

   ```
   npm run build
   npx vite preview --port 4173 --host 127.0.0.1
   node test/acceptance.mjs http://127.0.0.1:4173/
   ```

   Last line: **`90/90 passed`**. Exit 0. The new check reads the live
   MapLibre source, not `_twmTrip`:
   **`sourceId: trip`, `layerId: trip-line`, `rendered: 3`,
   `lineCoords: 147`, `color: #10262C`**. Not the accent. Card 340×280.

2. **Source `trip`, layer `trip-line`.** Query
   `map.getSource('trip').getData()`, not `getStyle().sources` — the
   style JSON keeps the empty FeatureCollection from load; `setData`
   lives on the source. Two vertices were a chord *through* the globe,
   so nothing sat on the disc. The line is densified now so it lies on
   the surface.

3. **Both.** Acacus is on the Africa-facing disc at `[2.1, 12, 24]`.
   Kyoto is behind the eastern limb. The visible stroke is the
   Acacus → east run across North Africa / the Middle East; it leaves
   the disc at the limb. The Kyoto end is behind the globe. Adding
   still does not move the camera.

Did not: accounts, sync, `/api`, street/satellite, bevel, the 35 ids,
Kyoto → Ishikawa, `punchHoles`.
