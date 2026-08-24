# The reviewer's brief

This file is for whoever reviews the building agent's rounds — a scheduled
Claude session, or Adil, or a fresh agent asked to "review the round". It is
versioned here rather than living inside a scheduled task so it can be
corrected in a commit like anything else.

The building agent does not read this file. Its brief is `NEXT-PROMPT.md`.

---

## What a review round is

Judge what the agent actually did, then tell it what to do next. One pass.

Read first: `NEXT-PROMPT.md` (the ten-stage plan; its "Where you are" section
holds the last verdict), `AGENT-REPLY.md` (what the agent claims),
`rules/travelers-world-map.mdc` (the non-negotiables — they outrank the
brief), and `git log --oneline -12` plus `git status --short`. For a stage's
reasoning see `docs/REVIEW-POC-TO-MVP.md` §12; for a requirement see
`docs/5 - MVP Specification.md`, which wins over documents 2, 3 and 4.

**Stop early if nothing happened.** Untouched reply template, no new commits,
clean tree — say so in one sentence and stop. Do not write a brief, do not
commit.

---

## What runs on the Linux VM, and what must never be attempted there

**The pipeline runs.** Dependencies are not preinstalled and the VM is reset
periodically, so install them when imports fail:

```
python3 -m pip install --quiet --user pytest shapely pyshp typer rich duckdb pyarrow
```

Then from `database/`: `python3 -m pytest -q`, and `python3 build/verify.py`,
which gates the real published bundle in `webapp/twm-app/public/data`. That
second command is the most informative thing available — read its GATES and
its warnings, not just its exit code.

**`npm run check` runs** from `webapp/twm-app`. It is `tsc --noEmit` and needs
no native binary.

**`npm run build` and the acceptance suite cannot run there, and this must not
be "fixed".** `node_modules` is OneDrive-synced from Adil's Windows machine
and holds win32 rollup binaries; there is no Playwright browser either.

> Never run `npm install`, `npm ci`, or `npx playwright install` in that
> folder. It would overwrite the Windows install inside a synced folder and
> break Adil's own machine.

When client code has changed, say plainly that the suite was not run and the
change is unverified. Never report a check you did not run.

---

## The pass

1. **Read the diff, not the reply.** Where they disagree, the diff is true and
   the disagreement is itself a finding.
2. **Run everything runnable** and judge against the current stage's exit test
   as written in `NEXT-PROMPT.md`. A stage is finished when its exit test
   passes on the published bundle. Partial is partial — say which part.
3. **Check the suite was not weakened.** Compare `check(` counts in
   `webapp/twm-app/test/acceptance.mjs` against the last commit, list any
   check name that disappeared, and diff the `environmental` error-filter
   regex. A widened filter or a dropped check is serious even when everything
   passes.
4. **Look for this project's known failure modes:** a dummy presented as
   knowledge (`reach: "near"`, empty `best_months`); a completion percentage
   anywhere; the accent on anything but a visited mark; a silent `place_id`
   renumber; a stage begun before its predecessor's exit test passed; a
   disputed-territory question settled by adopting the upstream dataset's
   opinion; a repair script writing into the live bundle instead of going
   through `build/publish.py`.
5. **Commit anything the agent left uncommitted**, pipeline and client in
   separate commits, saying in the client one that it is unverified. A night's
   work living only in a synced folder is one sync conflict away from gone.

---

## Writing the verdict

Replace **only** the `## Where you are` section of `NEXT-PROMPT.md`: the date,
the stage in progress, what you verified yourself versus what you could not
run, what the agent finished and did not, findings, and the two or three
concrete next things. Leave the ten stage bodies alone — they are the plan,
and the plan changes only if a review shows a stage is wrong. If you do change
one, say why in that same section.

Then archive `AGENT-REPLY.md` to `log/round-N.md` (N one past the highest
already there) and reset it to its header, the `## write below this line`
marker, and empty `Stage:` / `Did:` / `Skipped:` / `Unsure:` / `Blocked:` lines.

---

## Not the reviewer's to decide

The Parked list in `NEXT-PROMPT.md` is Adil's: data licences (WDPA
non-commercial, OSM ODbL), commercial basemap cost, the cuisine two-source
rule, the `ich_unesco` sample, and every disputed-territory ruling — the build
warns on Kosovo, Palestine and Taiwan and should keep warning. Write those up
for him; do not settle them.

How the pipeline enforces its own gates **is** the reviewer's to decide.

---

## Committing

`git add` the paths you mean; the review commit's message begins `Review:`. If
git reports a `.git/*.lock`, move it into `.git/_stale/` — `rm` is not
permitted on that mount, so `mv` is the only way to clear a lock.

**Do not push.** That machine has no GitHub credentials; Adil pushes himself.

Finish with a short report for Adil: what the agent did, whether the stage
advanced, what could not be verified, and anything he needs to rule on.
