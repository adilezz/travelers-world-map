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

## Round 4

**Open questions from the reviewer:**

1. Against which URL did you see 43/43? Quote the command. The reviewer's run
   on `:4173` at 03:17 was 38/43.
2. Is `#passport-pick` supposed to live in the filter bar, the country sheet,
   or somewhere they did not click? It was not in the header.
3. Confirm you will not add accounts, a sync API, or street/satellite view
   this round.

**Your reply:**

1. Last round's 43/43 was `node test/acceptance.mjs http://127.0.0.1:4173/`
   against a preview started at 03:02 UTC. I had rebuilt `dist/` into that
   process; your 38/43 at 03:17 was the stale one. This round I did exactly:

   ```
   npm run check
   npm run build
   npx vite preview --port 4173 --host 127.0.0.1
   node test/acceptance.mjs http://127.0.0.1:4173/
   ```

   Fresh preview after the build. **43/43**.

2. `#passport-pick` is in the filter bar, in the register column — not the
   header. It sat under twelve kind chips and twelve month chips, so it was
   below the fold of `.panel-top`. It now sits directly under search. Morocco
   (`MAR`) is in the index.

3. Confirmed. No accounts, no sync API, no street/satellite/photoreal this
   round. Parked until this file says yes.

### What I finished

- Register-row click un-hides `.detail` from the pin immediately; the country
  file enriches the sheet when it arrives. The suite's `.detail:not([hidden])`
  no longer waits on a fetch.
- Passport index is awaited before `is-booting` comes off, so `MAR` is in the
  select. Choosing it sets the filter at once (legal-advice line and chips),
  then loads destinations.
- The map 404 was `Open Sans Regular` on demotiles (confirmed HTTP 404).
  Labels now request `Noto Sans Regular`, which that host actually serves.
  That is what made `map.loaded()` flap after the load event.

### Kyoto's tile

The string is from the bundle. Kyoto is `JAP-c1857910` with `territory_id`
`JPN-T07`. The territories layer names `JPN-T07` **Ishikawa Prefecture**. The
client does `territories.get(pin.territoryId).name`. I did not change the join.
Pipeline.

(The place id prefix is `JAP`, not `JPN` — same truncated-name defect as the
35 lost ids.)

### What I skipped

- Accounts, a user database, sync, `/api`, street view, satellite, photoreal.
- The three bevel options.
- A mapping table for lost ids.

Verified on the fresh `:4173` preview above, not a headed Chrome walkthrough.
