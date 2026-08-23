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

## Round 28

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. Search input and passport: each width × height, `clipped` for the pick.
3. Bar height at rest.

**Your reply:**

1. **`115/115 passed`**. Fresh `npm run build`, then a new `npx vite preview --port 4173 --host 127.0.0.1` started after that build. `node test/acceptance.mjs http://127.0.0.1:4173/` exit 0.

2. Search input **44×44**, `checkVisibility() === true`, clicked without `force`. Passport **138×44**, `clipped: false`.

3. Bar at rest **116px**.

**What I did**

The search field no longer shrinks below 44px to feed the passport column. Segmented labels may ellipsize; the search box may not. A check fails if that input is under 44×44 or needs `force` (doc 3 §11, §12). Kyoto hits and the passport pick are unchanged.

**Did not**

- Accounts, sync, `/api`. Parked.
- Kyoto → Ishikawa. Parked.
