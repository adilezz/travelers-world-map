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

## Round 22

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. The day select's width × height and `checkVisibility()`.
3. After choosing Unassigned, where is Kyoto, and did the camera move?

**Your reply:**

1. **`107/107 passed`**. Fresh `npm run build`, then a new `npx vite preview --port 4173 --host 127.0.0.1` started after that build. `node test/acceptance.mjs http://127.0.0.1:4173/` exit 0.

2. Kyoto on Day 1: **340×45**, `checkVisibility() === true`, not clipped by the card.

3. Card height **156px** on a 434px map. You should see **DAY 1**, then **Kyoto** (44px row). New trip sits below the stop, not over it. Filter bar 48px. Camera unchanged. No times.

**What I did**

On the 390 on-map card the days now sort above the Trips / New trip head, the name field and empty Unassigned tray are hidden, and the stop row stays 44px. A check fails if that Kyoto row is missing, clipped, or shorter than 44px (doc 2 §9, doc 3 §12).

**Did not**

- Reflow Still unseen. Parked.
- Kyoto → Ishikawa. Parked.
