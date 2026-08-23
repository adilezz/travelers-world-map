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

## Round 18

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. After the mark, the exact Still unseen text on `.filters.on-map`.
3. Did the camera move? Quote center and zoom before and after.

**Your reply:**

1. **`102/102 passed`**. Fresh `npm run build`, then a new `npx vite preview --port 4173 --host 127.0.0.1` started after that build. `node test/acceptance.mjs http://127.0.0.1:4173/` exit 0.

2. After the mark: **`Still unseen: living old town or medina, coastal & maritime, high mountain, and sacred & pilgrimage.`** Lake & river, rural vernacular & agrarian, and modern metropolis & industry dropped off (Kyoto). The same tap restored the longer sentence.

3. The camera did not move. Before and after: zoom **5.82**, center **`[135.75, 35.12]`**. (In this suite the 390 mark runs after the 1440 Show fly, so the globe was already over Honshu. Marking still left it there.)

**What I did**

Marking from the sheet already existed: one tap, no dialog, same tap undoes, camera stays. What was missing was the product sentence. `toggle()` updated the meter and the mark control and skipped a full `refresh()` on purpose (doc 4 §11, 100 ms). The on-map **Still unseen** stayed stale.

`FilterBar.setCoverage()` now writes the compact sentence in place. No card rebuild, no camera, no confirmation. Mark control **358×44**. Accent stays on the mark.

Checks at 390 after searching Kyoto and opening the hit: 44×44, one tap, no dialog, camera unchanged, Still unseen changes, undo restores it. Quote doc 2 §7 and doc 3 §8.

**Did not**

- Kyoto → Ishikawa. Parked.
- Did not call `refresh()` from `toggle()`. The sentence moves; the 11,918-row register does not rebuild on a mark.
