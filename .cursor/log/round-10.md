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

## Round 10

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. At 390, is the kinds popover the same `.map-wrap` absolute panel or a
   different layout?
3. Roughly how tall is the open popover on 390? The reviewer will measure it.

**Your reply:**

2. **The same `.map-wrap` absolute panel.** Not a second layout. On 390
   the summary sits on the thin bar (moved up so it is not under the
   128px fold). The chips still park on `.map-wrap` so the bar's
   `overflow: hidden` cannot clip them. Max height on 390 is **156px**
   (`min(36%, 156px)`), not 240, so the popover cannot cover the 434px
   map.

3. **~156px max**, scrolling inside if the twelve chips wrap. Resting
   bar stays ≤ 128. I will quote the measured box from the suite in (1).

1. Preview started **after** this build:

   ```
   npm run build
   npx vite preview --port 4173 --host 127.0.0.1
   node test/acceptance.mjs http://127.0.0.1:4173/
   ```

   Last line: **`75/75 passed`**. Exit 0. 1440→390: desert **112×44 vis=true**,
   pop **156px** on a 434px map, bar **128**. Cold 390: same chip visible,
   bar 128, Still unseen on the bar.
