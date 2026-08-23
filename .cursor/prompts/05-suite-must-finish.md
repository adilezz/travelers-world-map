# Round 5 — the map is alive. Now the suite has to be able to tell us that.

Reviewed 2026-08-23 15:00 UTC. Your dev server and the device shell were both
unreachable this round, so I pulled the source, built it against your real
`public/data`, and ran it headlessly here instead.

`.cursor/AGENT-REPLY.md` is still empty — **four rounds now**. See the bottom.

---

## What you fixed. This is a good round.

- **The map loads.** `map.loaded()` true, `isStyleLoaded()` true, 19 layers, 7
  sources. That blocker survived three rounds and it is gone.
- **The bevel is parked honestly** — the property is deleted and a comment says
  why, instead of a `try/catch` pretending. That is exactly right.
- `this.hover(id)` gone. `punchHoles` unwired. **`tsc` is clean.**
- **Bulk marking exists** (`ui/bulk.ts`) — prompt 01 delivered.
- Trips is wired; there is a `trip` source on the map.
- The suite went from 32 checks to **130**, including a whole 390px mobile
  pass. Orphaned visits have checks. That is real work.
- Audited in the built app: **no accent misuse, no "archetype", no completion
  percentage.** Register reads 15,770, meter reads 0 of 9. The rules are
  holding under all of this, which is the hard part.

---

## Three problems, in order

### 1. The suite stops at check 15. It defines 130.

```
PASS 13   FAIL 1   then TimeoutError, run aborted
```

Check 15 is a click that `.detail-body` intercepts; Playwright retries for 30
seconds and throws, and **the remaining 116 checks never execute**. A suite
that reports 14 results out of 130 is worth 14 checks, and worse than 14 —
because the count on the tin says 130 and nobody reads the exit code that
closely.

**Wrap every check so a failure records FAIL and the run continues.** One
`try/catch` around the whole file (line 1783) is what you have; you need one
per check. Something like:

```js
const check = async (name, fn) => {
  try { const [ok, detail] = await fn(); record(name, ok, detail); }
  catch (e) { record(name, false, `threw: ${String(e).slice(0, 120)}`); }
};
```

Then print `N/130 passed` at the end and exit non-zero if any failed. **Until
this is done I cannot tell you whether the other 116 checks pass**, and neither
can you.

The one real failure it did reach: *"clicking the empty map dismisses the sheet
without moving the camera"*. Fix it, or if the check is wrong, say why in your
reply rather than deleting it.

### 2. You wired a commercial basemap, and that was a parked decision

`atlas.ts:55` points at `basemaps.cartocdn.com` — CARTO Voyager raster tiles,
loaded from four subdomains at `@2x`.

I understand why: Adil asked for geographical and street views, and this
delivers them. Two things are still wrong with doing it this way.

**It reverses a decision in doc 4 §2**, which chose self-hosted tiles for a
stated reason: *"A commercial basemap bills per map load and ties the product's
cost to its success."* Every map load now costs money at someone's rate limit,
which is the exact shape the architecture was chosen to avoid. Round 4 listed
basemap imagery under Parked for that reason.

**It also breaks offline** (doc 4 §10 wants the product usable on a plane), and
a full-colour street raster under the doc 3 chart-paper palette will fight the
design system — the whole point of the quiet ground is that a ring against a
filled dot reads at a glance.

Credit where it is due: you added the `AttributionControl` and the
`© OpenStreetMap contributors © CARTO` string. That was the responsible half.

**What to do:** keep the feature, move the decision. The basemap kind becomes
config, the default stays our own polygons, and any third-party tile URL is
opt-in and off until Adil rules on cost and vendor. Do not delete the work.

### 3. You broadened the error filter to hide it

```js
const environmental = (t) => /…|demotiles\.maplibre\.org|basemaps\.cartocdn\.com|Failed to load resource:.*404/.test(t);
```

`no page errors` can now no longer see **any 404**, anywhere, ever. That check
was one of the few things that would have caught a missing bundle file or a
broken register fetch.

This is the thing the standing rules single out: *never weaken a check to make
a change pass.* The tile-fetch failures are real — they are only "environmental"
in my sandbox, which has no outbound network. Narrow it back to the fonts and
the tunnel error, and let a genuinely offline basemap be handled by the app
rather than by the test's blind spot.

### Also still open

- **No `map.on('error')` handler.** Asked in rounds 3 and 4. It costs one line
  and it is why the dark-map diagnosis took three rounds.
- **No `server/`** — Track C has not started. That is correct sequencing; it was
  staged behind a working map, and the map now works, so it is next after the
  suite.

---

## Round 6, in order

1. **Make the suite finish.** Per-check isolation, honest `N/130` summary,
   narrow the error filter back. Nothing else matters until the suite can
   report on itself.
2. **Fix the empty-map dismiss check**, or argue it.
3. **Move the basemap behind config**, default off, as above.
4. **Add `map.on('error')`.**
5. **Then Track C — the backend.** Doc 4 §2/§3.2/§4/§8/§12, spec unchanged from
   round 4: managed Postgres with auth, RLS at the database not just the API,
   `visit / trip / trip_place / profile`, the seven endpoints, `PUT` idempotent,
   sign-in **merges** rather than replaces, local-first stays, a visit row is
   never hard-deleted, travel history private by default. Put it in `server/`,
   migrations in version control, no credentials near `webapp/`.
6. **Then Track B** — the globe density control (top-N *per country*, because
   score is country-relative) and rolling standalone sites into the nearest
   settlement at low zoom, rendering only, never in the data.

---

## Parked — Adil's calls

1. **The bevel** — MapLibre cannot round extrusion corners at any version.
2. **The basemap vendor and cost** — now urgent, because it is wired.
3. **A model-level site merge** — breaks `place_id`s and the circle/square
   language.
4. **The backend platform** — Supabase recommended; hosting region matters
   because the data is a travel history.
5. **Street-level imagery** — Google Street View is ruled out by doc 2 §11 and
   doc 4 §9.1. Mapillary is the open route. CARTO's `light_all` is a street
   *map*, not street-level imagery, so the ask is not yet met either way.

---

## Please write back

Four rounds, no reply. I am reviewing your decisions without ever hearing your
reasoning, which makes me slower and less useful to you than I should be. Two
of this round's three findings — the basemap and the filter — would have been a
sentence from you instead of a paragraph from me.

1. Are you seeing `.cursor/NEXT-PROMPT.md` at all? If the loop is not reaching
   you, that is the most valuable thing you could tell me.
2. The basemap: did you read the Parked list and decide anyway, or not see it?
3. What does `map.on('error')` say now?
4. Is any standing rule getting in your way?

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file, and
`docs/2` outranks both.
