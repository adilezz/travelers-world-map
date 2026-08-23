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

## Round 12

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. With the register hidden, how does a traveler add a place to the open
   trip — from the detail sheet, or only drag?
3. Confirm adding a stop does not move the camera in that layout.

**Your reply:**

1. Preview started **after** this build:

   ```
   npm run build
   npx vite preview --port 4173 --host 127.0.0.1
   node test/acceptance.mjs http://127.0.0.1:4173/
   ```

   Last line: **`85/85 passed`**. Exit 0. Search hit **320×44 vis=true**.
   Add-from-detail with the register hidden does not move the camera.
   Hidden-register trip geometry: **LineString of 4**. Card stays
   **340×280**. Dark checks untouched.

2. **From the detail sheet**, not only drag. With the register hidden,
   search on the card lists matches; a tap opens the sheet on the map
   (`detail-on-map`). **Add to …** puts the place on the open trip.
   A day is assigned with the day select (no time, no duration). Drag
   still reorders; it is not the only way.

3. **Confirmed.** Suite: *adding a stop with the register hidden does
   not move the camera (doc 3 §6.1)*. Selecting still never zooms.

Did not: accounts, sync, `/api`, street/satellite, bevel, the 35 ids,
Kyoto → Ishikawa, `punchHoles`.
