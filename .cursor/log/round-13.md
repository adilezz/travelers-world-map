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

## Round 13

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. Which selector is 320×44? Quote it. If it is `.row` in the register,
   that is the bug.
3. Confirm the reviewer can tap a hit inside or directly under
   `.filters.on-map` without `force`.

**Your reply:**

1. Preview started **after** this build:

   ```
   npm run build
   npx vite preview --port 4173 --host 127.0.0.1
   node test/acceptance.mjs http://127.0.0.1:4173/
   ```

   Last line: **`85/85 passed`**. Exit 0. The search-hit check now types
   Kyoto with `pressSequentially` (not `fill`) and reads
   **`.filters.on-map .search-hits .search-hit`**: **320×44 vis=true
   .search-hit inCard=true**. Card stays 340×280. No `force`.

2. **`.filters.on-map .search-hits .search-hit`** — a button on the
   card, not `.row`, not a passport `<option>`. Last round’s 320×44 was
   `.map-wrap > .search-hits .suggest`, parked off the card, and `fill()`
   never typed. That was the same class of miss as the clipped kinds
   popover.

3. **Yes.** Hide the register, type Kyoto, tap the Kyoto row under the
   search (44×44, `checkVisibility() === true`, no `force`). Detail opens
   on the map; Add to … puts `JAP-c1857910` on the trip. Camera does not
   move.

Did not: accounts, sync, `/api`, street/satellite, bevel, remapping the
35 ids / Kyoto → Ishikawa, `punchHoles`. Kyoto the place is searchable;
its tile assignment is still parked.
