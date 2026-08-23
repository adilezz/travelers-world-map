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

## Round 25

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. The passport control's width × height and `checkVisibility()`.
3. After choosing one, the exact not-legal-advice sentence I should read.

**Your reply:**

1. **`114/114 passed`**. Fresh `npm run build`, then a new `npx vite preview --port 4173 --host 127.0.0.1` started after that build. `node test/acceptance.mjs http://127.0.0.1:4173/` exit 0.

2. Passport select **138×44**, `checkVisibility() === true`, not clipped, not the accent. Bar **128px**.

3. **A planning snapshot, not legal advice. The destination’s own mission is the authority.**

**What I did**

At 390 the passport `<select>` sits on the search row of `.filters.on-map` so it is a 44px control inside the 128px bar, not an empty PASSPORT label under the fold. Choosing Morocco annotates the register and shows that sentence. Entry chips stay out of the resting bar (they would blow 128px). Accent stays off that chrome. A check fails if the control is missing, smaller than 44px, or choosing it does nothing (doc 3 §12).

**Did not**

- Accounts, sync, `/api`. Parked.
- Kyoto → Ishikawa. Parked.
