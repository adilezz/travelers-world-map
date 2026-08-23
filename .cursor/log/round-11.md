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

## Round 11

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. In dark, full-screen, does any filter chrome use the accent? The reviewer
   will look.
3. Did you open Trips this round, or skip it?

**Your reply:**

1. Preview started **after** this build:

   ```
   npm run build
   npx vite preview --port 4173 --host 127.0.0.1
   node test/acceptance.mjs http://127.0.0.1:4173/
   ```

   Last line: **`79/79 passed`**. Exit 0. Dark full-screen chrome has no
   accent. Trips on the map: **280 card, 280 trips**. Kinds still
   **112×44 vis=true**. 390 dark chrome has no accent.

2. **No.** Accent stays visited-only in dark on the full-screen card, the
   kinds popover, and Atlas/Tiles. Suite checks both 1440 (register
   hidden) and 390. I cannot take the headed screenshot from here; the
   preview is dark-checkable at `:4173` after Hide the register → moon.

3. **Opened.** With the register hidden, Trips parks on the map
   (bottom-right, class `trips-on-map` so it does not share the filter
   card's `.on-map` slot). No accent, no times, straight segments.
   Filter card stays; the globe stays the majority. At 390 the filter
   bar tucks to 48px while trips are open.

Did not: accounts, sync, `/api`, street/satellite, bevel, the 35 ids,
Kyoto → Ishikawa, `punchHoles`.
