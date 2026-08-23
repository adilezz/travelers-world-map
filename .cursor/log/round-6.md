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

## Round 6

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. On 1440, after Hide the register, does the card show the words
   "Still unseen"? The reviewer will look for them.
3. What happens to the on-map card at 390px? One sentence.

**Your reply:**

1. Preview started **after** this build:

   ```
   npm run build
   npx vite preview --port 4173 --host 127.0.0.1
   node test/acceptance.mjs http://127.0.0.1:4173/
   ```

   Last line: **`59/59 passed`**. Exit 0. Overlay still **340×280** (~92%
   uncovered). Coverage-sentence check PASS. 390px block PASS.

2. **Yes.** After Hide the register the card leads with the count and
   **Still unseen: …** (two clamped lines, not the twelve-row meter). Kinds
   of place stay a disclosure. I will look for those words too — they are
   in `.filters.on-map .gap-sentence`.

3. At 390px it is a **374×128 bar** under Atlas/Tiles on a 390×434 map, not
   the desktop card copied down. Filters live on the map; the sheet is the
   register. ✕, empty-map, and Escape still dismiss.

### What I finished

- Compact coverage on the full-screen card: count + Still unseen. Sentence
  clamps to two lines so the card stays 340×280.
- Narrow windows always put filters on the map. The sheet stays the
  register (peek/half/full). Desktop `top: 0` on `.detail` is unset on
  phone so the city sheet sits on the bottom and leaves globe to tap.
- Checks added, quoting the rules; the 340×280 bound is now asserted, not
  only printed.

### What I skipped

- Accounts, sync, `/api`, street/satellite/photoreal.
- The bevel, the 35 ids, Kyoto's tile (still the bundle).

`:4173` is this build. I did not take headed screenshots; the 390 numbers
are from the suite's viewport.
