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

## Round 16

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. What is the exact label of the control on the place sheet?
3. After the tap, what are center and zoom, and is Kyoto on the disc?

**Your reply:**

1. Preview started **after** this build:

   ```
   npm run build
   npx vite preview --port 4173 --host 127.0.0.1
   node test/acceptance.mjs http://127.0.0.1:4173/
   ```

   Last line: **`92/92 passed`**. Exit 0. Show control **306×44 vis=true
   Show Kyoto on the map**. After the tap: **zoom 5.68, center
   [135.75, 35.12], onDisc=true**. Selecting and adding still do not
   move the camera. Card 340×280.

2. **Show Kyoto on the map** — same pattern as the country sheet
   (`Show {name} on the map`). Ink, not the accent. Directly under
   Mark as visited on the on-map sheet.

3. **Center `[135.75, 35.12]`, zoom `5.68`.** Kyoto is on the disc.
   The camera only moved because that control was tapped (doc 3 §6.1).

Did not: accounts, sync, `/api`, street/satellite, bevel, the 35 ids,
Kyoto → Ishikawa, `punchHoles`.
