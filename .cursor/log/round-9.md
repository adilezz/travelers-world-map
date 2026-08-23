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

## Round 9

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. Where is the kinds popover positioned (`position: fixed` to what)? Why
   did getBoundingClientRect height come back 0 for the chips?
3. Confirm the kinds-on-card check now fails if the row is hidden.

**Your reply:**

2. It was `position: fixed` *inside* `.filters.on-map`, which has
   `overflow: hidden` and `max-height: 280px`. That card becomes the
   containing block / clip. `placeKindPop` set `top`/`left` from
   **viewport** `getBoundingClientRect()`, so the pop was laid out
   hundreds of pixels below the card and clipped to nothing. Chips with
   `display: none` (the closed rule still winning, or clipped) report
   height 0. `[data-kind="A5"]` on the **meter** is in the hidden column,
   not on the card chips — that is why Playwright said not visible.

   After this build the pop is a child of **`.map-wrap`** (`position:
   relative`), `position: absolute` under the summary, not clipped by
   the card. Chips have a painted box ≥ 44px.

3. **Yes.** The kinds-on-card check now asserts `checkVisibility()` /
   a bounding box ≥ 44px before click. No `force: true`. If the row is
   hidden, the check fails.

1. Preview started **after** this build:

   ```
   npm run build
   npx vite preview --port 4173 --host 127.0.0.1
   node test/acceptance.mjs http://127.0.0.1:4173/
   ```

   Last line: **`68/68 passed`**. Exit 0. Desert & steppe chip: **112×44
   vis=true**. Card stays 340×280. No `force: true`.
