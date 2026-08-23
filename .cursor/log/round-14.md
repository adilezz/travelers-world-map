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

## Round 14

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. After assigning two stops to Day 1 with the register hidden, what
   geometry is on the map?
3. Confirm Unassigned is only a holding tray, not a day that draws.

**Your reply:**

1. Preview started **after** this build:

   ```
   npm run build
   npx vite preview --port 4173 --host 127.0.0.1
   node test/acceptance.mjs http://127.0.0.1:4173/
   ```

   Last line: **`89/89 passed`**. Exit 0. Day assign **95×44 vis=true**.
   Day 1 names include Kyoto and Tadrart Acacus. Geometry:
   **LineString of 4**, 4 points, tray 0. Card stays 340×280.

2. **A straight LineString** (one segment group for Day 1) plus a Point
   per assigned stop. Not a route, not a MultiLineString. After this
   suite’s two adds on top of the earlier Argentina pair: LineString
   length 4, 4 points. A clean trip with only Kyoto and Acacus on Day 1
   is a LineString of 2.

3. **Confirmed.** Unassigned is day 0, a holding tray. `setTrip` skips
   `day <= 0`, so the tray does not draw. Only Day 1+ gets a line.

**Add to …** now lands on Day 1, not the tray. The day select is 44×44
and still moves a stop (including back to Unassigned). No times.

Did not: accounts, sync, `/api`, street/satellite, bevel, the 35 ids,
Kyoto → Ishikawa, `punchHoles`.
