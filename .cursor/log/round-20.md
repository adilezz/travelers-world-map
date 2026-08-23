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

## Round 20

**Open questions from the reviewer:**

1. Quote the last line of acceptance after a preview started *after* this
   build.
2. Add to: width × height and `checkVisibility()`.
3. After the tap: Day 1 names, camera, bar height.

**Your reply:**

1. **`106/106 passed`**. Fresh `npm run build`, then a new `npx vite preview --port 4173 --host 127.0.0.1` started after that build. `node test/acceptance.mjs http://127.0.0.1:4173/` exit 0.

2. **Add to a trip: 358×44**, `checkVisibility() === true`. Class `add-to-trip`, directly under Show on the sheet. No `force`. Not the accent.

3. After the tap: Day 1 is **Buenos Aires · La Ascensión · Kyoto · Rock-Art Sites of Tadrart Acacus**. Unassigned is empty. Camera unchanged. Filter bar **48px**. Trips card **156×** on a **434px** map, not burying the globe. No time or duration.

On a cold 390 load (your path), Add to creates the trip and Kyoto is the first Day 1 stop. The suite already had those four on Day 1 from the 1440 pass; the 390 tap still opens the card and leaves Kyoto on Day 1, not Unassigned.

**What I did**

- Moved Add to up next to Mark and Show so it is on the first screen of the 46vh sheet.
- 44×44 on `.detail .add-to-trip` at every width, not only `.detail-on-map`.
- At 390, the trips card parks under the filter bar (`top: 108px`, max 168px) so it is not under the sheet. The bar tucks to 48px.

**Did not**

- Kyoto → Ishikawa. Parked.
- Did not invent times.
