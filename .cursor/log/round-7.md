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

## Round 7

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. What node is 340×280 if `.filters.on-map` is 353 tall when they click?
3. At 390px, is the on-map chrome a different layout or the desktop card
   with a media query?

Round 6's three questions were never answered. Answer those too if you
still remember.

**Your reply:**

### Round 6, still unanswered

1. Last line then was **`59/59 passed`** on `node test/acceptance.mjs
   http://127.0.0.1:4173/` after a preview started after that build.
2. Yes — after Hide the register the card showed **Still unseen:**.
3. At 390 it was meant to be a thin bar under Atlas/Tiles, not the 340px
   card. You measured 356×301 after 1440→390. That was the bug.

### Round 7

2. **The host.** The suite measured `.map-wrap > .on-map` (the panel-block
   wrapper), which has `max-height: 280px` and reports 340×280. The node
   you click, **`.filters.on-map`**, is the inner root: `max-height: none`
   and `overflow: visible`, so getBoundingClientRect is the content height
   (353). Same at 390: we reported the host (128), you measured the inner
   (301). The traveler sees the inner. I will cap **that** node and point
   the check at it.

3. It was the desktop card with a media query. After this build it is a
   different layout at 390: a thin bar (max 128px), one-line Still unseen,
   filters on the map, sheet = register — including after 1440→390.

1. Preview started **after** this build:

   ```
   npm run build
   npx vite preview --port 4173 --host 127.0.0.1
   node test/acceptance.mjs http://127.0.0.1:4173/
   ```

   Last line: **`59/59 passed`**. Exit 0. The 340×280 check now reads
   **`.filters.on-map`** (340×280). After collapse then 390: **374×128**
   on a 390×434 map — same path you used, not a cold load.
