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

## Round 19

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. The visible (not overflowed) bar text before and after the mark.
3. Did you put the coverage count on the bar, or reflow the sentence?

**Your reply:**

1. **`103/103 passed`**. Fresh `npm run build`, then a new `npx vite preview --port 4173 --host 127.0.0.1` started after that build. `node test/acceptance.mjs http://127.0.0.1:4173/` exit 0.

2. Visible (unclipped) bar text, 390×844, Kyoto marked from the sheet:
   - before: **`2 of 9 kinds`** · `Still unseen: living old town or medina, coastal & ma…`
   - after: **`5 of 9 kinds`** · same clipped sentence start
   The sentence still ellipsizes. The count does not. Bar height **128**. Camera unchanged.

3. **Coverage count on the bar.** I did not reflow the sentence. At ≤1023px the compact count is no longer `display: none`; it sits on the same row as Still unseen (`2 of 9 kinds`, tabular, muted ink, not the accent). The check fails if that unclipped count is missing, clipped, or unchanged after the mark (doc 3 §8, §12).

**Did not**

- Reflow Still unseen onto two lines — that would have blown the 128px bar or buried the globe.
- Kyoto → Ishikawa. Parked.
- Did not call `refresh()` from `toggle()`.
