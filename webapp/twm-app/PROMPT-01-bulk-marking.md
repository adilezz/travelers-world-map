# Prompt 01 — bulk marking as a first-class action

You are continuing the Travelers World Map web client. The flat Atlas view is
built and passing 32 acceptance checks. Your job is one feature, described
below. Read this whole file before touching anything.

## Orient yourself first

Read these, in this order, and do not skip them:

1. `webapp/twm-app/README.md` — what exists, what is deliberately not built,
   and three renderer constraints that were measured rather than assumed.
2. `docs/2 - Web Application - Product Specification.docx` §7 and §10 — this is
   the requirements document. Where it and I disagree, **doc 2 wins**.
3. `docs/3 - Web Application - Ergonomics and Design System.docx` §8, §11, §13.
4. `webapp/twm-app/src/core/record.ts` and `src/ui/onboarding.ts` — the
   existing marking path and the only bulk path that exists today.

Then get it running: `cd webapp/twm-app && npm install && npm run dev`.
`public/data/` is already unpacked. Before you change a line, run the suite and
see it green:

```bash
npm run build && npm run preview &
node test/acceptance.mjs http://127.0.0.1:4173/
```

## The problem

Doc 4 §15 names bulk marking as **on the critical path, not a nice-to-have**:
"someone with thirty years of travel behind them will not tap two hundred pins
one at a time", and if we cannot capture that history they leave before the
point of the product lands.

Today bulk marking exists in exactly one place: step 2 of first-run onboarding,
in `src/ui/onboarding.ts`, for one country, once. A traveler who skipped
onboarding, or who has since remembered a second country, has **no bulk path at
all**. That is the gap you are closing.

## What to build

A bulk marking surface reachable at any time, from the country scope.

- **Where.** The country detail panel (`src/ui/detail.ts`, the `country`
  method). A control that opens bulk marking for that country. The tile panel
  gets it too, scoped to the tile — same component, different set.
- **What it shows.** The country's places, most obviously-worth-marking first,
  each with a checkbox reflecting its current visited state. Everything already
  marked starts ticked, because this surface edits a record rather than adding
  to one. Show enough per row to decide: name, kinds, score in its country
  frame, World Heritage where it applies.
- **What it does.** One confirm applies the whole diff — marks what was ticked
  and unmarks what was unticked — through `Record.markMany`, which already
  coalesces to a single storage write. Announce the result: how many marked,
  how many unmarked, and the coverage change.
- **Scale.** Germany has 269 places. The list must not be an unbounded wall.
  Offer a sensible starting subset (the ones that reach the printed map is a
  good default and is already how onboarding does it) with a way to see all of
  them. Virtualise if you need to — `src/ui/register.ts` shows the pattern.
- **Undo.** Applying a bulk change must be reversible in one action, because a
  mis-tick across two hundred places is not something a traveler can unpick by
  hand. `Record` never hard-deletes, so the previous state is recoverable —
  build the undo on that.

## Non-negotiable

These are not style preferences. Each one is a line in doc 2 or doc 3 and each
is enforced by `test/acceptance.mjs`.

- **The accent (`#A87B22` / `#DBA83E`) means visited and nothing else.** No
  button, heading, link, chart or checkbox chrome may use it.
- **Never show a completion percentage for a country.** A country is not a
  task. "Still unseen" is the register's voice.
- **Never use the word "archetype"** or a bare code like `A10` in the
  interface. They are "kinds of place".
- **Score is country-relative.** Never render it bare; use `scoreText()`.
- **Marking never moves the camera.** Bulk marking especially — the map must
  not fly anywhere when a hundred places change.
- **44×44px minimum** on every tap target, checkboxes included.
- **Full keyboard path and an announcement.** This surface must be operable
  and comprehensible without sight; the register is the model to copy.
- **No confirmation dialog on the individual tick.** One tap, no ceremony. The
  single "apply" at the end is the one deliberate action.

## Done means

1. `npm run check` clean, `npm run build` clean.
2. `node test/acceptance.mjs` — **all existing checks still green.** If a check
   fails, your change is wrong, not the check. Do not weaken a check to pass.
   Four real bugs were caught by this suite that review missed; it earns its
   keep.
3. **You have added checks** for the new behaviour, in the same style — each
   one quoting the rule it defends. At minimum: bulk marking is reachable
   outside onboarding; applying it does not move the camera; the result is
   announced; the accent is still not decorating anything.
4. The README's "What is not built" section is updated if you changed what is
   true.

## Do not

- Do not add a component framework, a state library, or a CSS framework.
- Do not touch `src/core/coverage.ts` — the coverage arithmetic is the product
  and it is correct.
- Do not change `place_id` handling anywhere. Identifier stability is a
  migration contract; a rebuild that renumbers places destroys travel
  histories.
- Do not invent data. `best_months` is empty for all 11,918 places and `reach`
  is `"near"` for all of them. Build surfaces, hide them, leave them empty.
- Do not start Trips or the tile view. They are the next two prompts.

## If you are unsure

Ask before deciding. Specifically: anything where doc 2 and this file disagree
(doc 2 wins), and anything that would put a second meaning-bearing colour on
the map.
