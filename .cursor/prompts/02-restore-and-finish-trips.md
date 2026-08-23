# Prompt 02 — the app is down. Restore it, then finish Trips.

**Stop adding features. Read this whole file before editing anything.**

As of the last review the client does not boot. Not the tile view — the whole
product. The globe, the register, the coverage meter, marking: none of it
loads. The acceptance suite cannot get past its first assertion, so all 32
checks are unrun rather than failing.

Verify it yourself before you start, so you can see the state you are fixing:

```bash
cd webapp/twm-app
npm run check     # 10 type errors
npm run build     # fails at tsc
npx vite build && npx vite preview --port 4173 &
node test/acceptance.mjs http://127.0.0.1:4173/   # times out on .register-count
```

## What went wrong, in order of severity

**1. `fill-extrusion-edge-radius` does not exist in MapLibre.** `atlas.ts:276`
uses it. It is a **Mapbox GL JS** property. MapLibre 5.24 ships exactly eight
fill-extrusion paint properties and rounded extrusion is not among them:

```
fill-extrusion-base, -color, -height, -opacity, -pattern,
-translate, -translate-anchor, -vertical-gradient
```

An unknown property fails style validation, so `map.on('load')` never fires,
so the `await` in `Atlas.init` never resolves, so `boot()` hangs forever and
the page sits on `is-booting` with no error shown to anyone. **One wrong paint
property took down the entire product silently.** That is the failure mode to
learn from here: validate a style property against the renderer you actually
ship before building a feature on it.

**2. The build does not typecheck.** `detail.ts` now requires `annotate` and
`addToTrip` on `DetailHooks`, and `filter-bar.ts` requires `sort` on
`FilterHooks`, but `main.ts` supplies none of them. Trips, notes and the sort
control are written and **not wired to anything**. 463 lines of new module are
unreachable from the entry point.

**3. `atlas.ts:416` calls `this.hover(id)`. There is no such method.** It would
throw on every mousemove over a pin, if the map ever loaded.

**4. `punchHoles` is imported and never called.** Beyond being dead code, doc 4
§6 is a closed decision: *"Cut the holes in the pipeline, not the browser.
Attempting this at runtime is both slow and fragile."* `holes.ts` says so in
its own header and does it anyway. Do not wire it up.

**5. No tests were added.** `test/acceptance.mjs` is byte-identical to before.
Trips arrived with zero coverage.

**6. The order was skipped.** Prompt 01 was bulk marking — doc 4 §15 calls it
the critical path. It is untouched, and steps 8 and 9 were both started at
once, leaving both unfinished.

Credit where it is due: the Trips code correctly excludes routing, travel times
and collaboration, and says so in its own comments. The new modules put nothing
in the accent and use none of the forbidden words. The problem is wiring and
verification, not taste.

## Do this, in this order

### A. Get it booting again. Nothing else matters until this is true.

1. Delete `'fill-extrusion-edge-radius'` from the tile layer. Do not substitute
   a lookalike; there isn't one. See the parked question below.
2. Fix `this.hover(id)` in `atlas.ts` — the hover fan-out already happens
   through `this.hooks.onHoverPlace(id)` on the next line.
3. Make `main.ts` satisfy every hook interface it constructs.
4. Keep the tile view **out of the boot path**. Its code may stay in the tree;
   nothing in `boot()` may depend on it loading.

**Done means:** `npm run check` clean, `npm run build` clean, and
`node test/acceptance.mjs` reporting **32/32**. Not 31. If a check fails, your
change is wrong — never edit a check to make it pass.

### B. Then finish Trips properly (doc 2 §9).

Only after A is green. Wire what you already wrote:

- Collect: add to a trip from the map, the register and the place panel.
- Order: assign to days by dragging, unassigned held in a tray. **A day is a
  list, not a schedule — no times, no durations.**
- See it: the trip draws on the map as a sequence with the day each place
  belongs to. **Straight lines, not routes.** An honest connection beats a
  fake route we cannot verify.
- Surface only what the database already knows: whether two places are
  impractically far apart in straight-line distance. Seasonality stays hidden
  while `best_months` is empty — **do not invent values**.
- No collaboration, no bookings, no routing.

**Add acceptance checks**, in the existing style, each quoting the rule it
defends. At minimum: adding a place to a trip does not move the camera; a trip
day shows no time or duration anywhere; the trip line is drawn as straight
segments; the accent is still not decorating anything.

### C. Then, and only then, prompt 01's bulk marking.

`.cursor/prompts/01-bulk-marking.md` still stands and is still on the critical
path.

## Parked — do not decide this yourself

Doc 3 §7.1 requires **bevelled corners**: *"A moulded piece has no razor edges.
Rounding the corners of the extrusion is what separates a physical object from
a data visualisation."* MapLibre cannot do it. The options are to accept square
edges, to fake a chamfer with a second inset extrusion at a lower height, or to
write a custom WebGL layer — and that is the owner's call, not yours. It has
been raised with him. **Do not build any of the three until the answer comes
back**, and do not quietly ship square edges as though the requirement were met.

## Standing rules

`.cursor/rules/travelers-world-map.mdc` applies to everything and outranks this
file. `docs/2` outranks both. When you finish, say plainly what you did, what
you skipped, and what you were unsure about — all three get reviewed.
