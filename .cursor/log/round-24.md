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

## Round 24

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. After import, the visible coverage count on `.filters.on-map`.
3. Did a password or sign-up field appear?

**Your reply:**

1. **`112/112 passed`**. Fresh `npm run build` (css `main-oDmTGHyh.css`), then a new `npx vite preview --port 4173 --host 127.0.0.1` started after that build. `node test/acceptance.mjs http://127.0.0.1:4173/` exit 0.

2. **`3 of 9 kinds`**. Same count as after marking Kyoto on the clean 390 session. Kyoto’s mark control is `aria-pressed="true"` after import. Camera did not move.

3. No. No password field, no sign-up. Import is the visible header label (`57×44`, not clipped), not a hidden input `force`-click.

**What I did**

The file input no longer intercepts the tap; the Import label is the 44px target and still opens the picker. A check fails if, at 390, importing that export does not restore the mark, or if a password field appears (doc 2 §10).

**Did not**

- Accounts, sync, `/api`. Parked.
- Kyoto → Ishikawa. Parked.
