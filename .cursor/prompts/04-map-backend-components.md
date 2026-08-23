# Round 4 — the map is still dark, and the product just grew

Reviewed 2026-08-23 03:02 UTC in Chrome against your dev server on
`127.0.0.1:5173`, plus a typecheck and an id-level diff of the bundle.

`.cursor/AGENT-REPLY.md` was empty. Three rounds, no reply. **Please use it** —
the questions at the bottom are real and I cannot review a decision you did not
explain.

---

## 1. The map still does not load

Measured in your browser, not inferred:

```
map.loaded()        false
map.isStyleLoaded() false
map.getStyle()      undefined
canvas              1371x813   (sized, and nothing drawn on it)
register            "15,770 places worldwide · 0 marked"   <- panel is fine
```

You moved `fill-extrusion-edge-radius` out of the style spec and into a
`try/catch` at `atlas.ts:331`:

```ts
try { this.map.setPaintProperty('tile-extrude', 'fill-extrusion-edge-radius', 1800); }
```

That is a **suppression, not a fix**, and it does two bad things at once. It
hides the error so nobody learns the property is unsupported, and it leaves the
tiles with square edges while the code still reads as though bevels were
applied. Round 2 said explicitly: *do not ship square edges as though the
requirement were met.* Delete the call. There is no MapLibre equivalent at any
version — the eight fill-extrusion paint properties are `base, color, height,
opacity, pattern, translate, translate-anchor, vertical-gradient`, and that is
the whole list.

And the map is still dark anyway, so something else in the style is failing
too. **Find it before you build anything else.** The diagnostic is thirty
seconds of work:

```js
map.on('error', e => console.error('STYLE ERROR', e.error?.message, e));
```

Still open from round 3, both untouched:

- `atlas.ts:438` calls `this.hover(id)` — no such method. The next line already
  does the fan-out through `this.hooks.onHoverPlace(id)`.
- `atlas.ts:512` calls `punchHoles(...)`. Doc 4 §6: *"Cut the holes in the
  pipeline, not the browser. Attempting this at runtime is both slow and
  fragile."* Unwire it.

**What is going well:** the rule audit came back clean in the browser — no
accent misuse anywhere, no "archetype", no completion percentage, no bare
score. The register, the coverage meter and the passport layer all work. The
discipline is holding; the map is the hole.

---

## 2. Adil has added scope. Here it is, staged.

Four new asks. **None of them start until §1 is green and the suite passes.**
A dark map with a new backend behind it is worth less than a map that draws.

### Track B — how busy the globe is (do this first after §1)

Two related asks, both about the globe being unreadable at 15,770 places.

**B1. A density control.** A filter for how many places the globe draws.

The naive version is a global top-N by score, and it is **wrong**: score is
0–100 against the top place in the *same country*, so a global top-1000 would
be a pile of hundreds from everywhere and nothing from anywhere. The honest
mechanism is **top N in each country** — that keeps the world evenly readable
and it is the only ranking the model actually supports. Label it for what the
traveler wants ("how busy the map is"), implement it as per-country depth, and
make sure the register agrees with the map, as every other filter does.

**B2. Roll standalone sites into the nearest place, at low zoom.** A national
park pin sitting 30 km from the town it is visited from is noise on a globe.
Below the cluster zoom, a non-settlement place (`is_site`) should fold into the
nearest settlement's mark rather than drawing its own, and that mark should say
it carries more than one place. Above the cluster zoom they separate again.

**This is a rendering concern and must stay one.** Do not merge them in the
data, do not drop their `place_id`s, do not let a folded site vanish from the
register, and do not let it stop counting toward coverage — a desert is a kind
of place whether or not its pin is drawn at world zoom. See Parked for the
version of this that is not yours to decide.

### Track C — the backend

Doc 4 already specifies this. Build what it says, not something else.

**The shape (doc 4 §1).** Place data is static files; user data is dynamic.
**They never share a database.** A traveler's record is a set of place
identifiers; the places themselves are files on a CDN. That separation is what
lets the database be rebuilt without touching user records.

**The platform (doc 4 §2).** A managed Postgres-with-auth service — auth,
row-level security and a REST layer without operating them, with Postgres
underneath so no lock-in survives a `pg_dump`. Supabase is the obvious fit and
my recommendation; confirm with Adil before you commit to it, and see Parked.

**The tables (doc 4 §3.2), and nothing more:**

| table | holds |
|---|---|
| `visit` | user, place_id, marked_at, optional visited_on, optional note. One row per marked place. |
| `trip` | user, title, dates, ordered list of days. |
| `trip_place` | trip, place_id, day index, position. **Ordering by position, never by array index.** |
| `profile` | display name, home country, units, theme. |

**The API (doc 4 §4), and nothing more:**

```
GET    /visits              the record, cached locally, reconciled on load
PUT    /visits/{place_id}   mark or unmark. IDEMPOTENT — a retry after a
                            dropped connection must be safe
POST   /visits/bulk         the onboarding path for thirty years of travel
GET|POST|PATCH /trips       trip lifecycle
GET    /export              everything the traveler owns, one documented file
POST   /import              restore from an export
POST   /feedback/place      a disputed place, routed to the review queue —
                            our earliest warning of a scoring bug
```

**Rules that are not negotiable here:**

- **Row-level security at the database, not only in the API** (doc 4 §12).
  Authorisation enforced in one place that cannot be bypassed by a bug in
  another. Every row scoped to its owner.
- **A visit row is never hard-deleted.** Unmarking sets a flag, so a note
  survives an accidental tap.
- **Signing in merges, it does not replace** (doc 4 §8). A traveler who marked
  eighty places before registering must not lose them. This is the obvious
  failure mode of a naive implementation and it is the one that would hurt
  most.
- **Reconciliation is last-write-wins per place, with `marked_at` as the
  clock.** Visits are independent single facts; this needs no conflict
  interface.
- **Local-first stays.** The queue in `record.ts` is the client contract:
  marking writes locally and repaints first, then syncs. The product must keep
  working with the network off and before an account exists.
- **A travel history is sensitive.** It reveals where someone has been and, by
  omission, where they live. Private by default, never public, never indexed,
  never a shareable profile without an explicit action. No third-party
  analytics on the map surface — place-level telemetry is a location history by
  another name.
- **Secrets never reach the client.**
- **Export and deletion are first-class**, both reachable in one action,
  deletion propagating to backups within a stated window.

Put it in `server/` at the project root, with migrations in version control and
a README that says how to run it against a local Postgres. Do not put database
credentials anywhere near `webapp/`.

### Track D — the component layer and the product's identity

Adil wants a real frontend component system of our own, "in the theme of travel
and discoveries", with geographical and street-level views.

**On the theme — read doc 3 §1 before you touch a colour.** The theme is
already decided and it *is* travel and discovery: *"cartography as a physical
object: a printed map, drilled holes, a pin pushed into one. The interface
takes its language from that world — plate lettering, engraved hairlines, chart
paper, brass — rather than from the conventions of travel software, which are
uniformly warm, rounded and photographic."* Discovery here is expressed as an
unfilled hole, not as a photograph of a beach. Build the component layer in
**that** language. If Adil means something warmer and more photographic, that
reverses a decision in doc 3 and he will say so — it is in Parked below, and
until it comes back the doc stands.

**What to actually build.** Right now the UI is `el()` calls inline; there is
no component system. Extract one:

- A real component per entry in **doc 3 §8**, each owning its states:
  place pin, place row, coverage meter, kind chip, cluster, bottom sheet,
  trip day, mark control. Doc 3 lists the exact states for each.
- Tokens stay the single source of truth in `tokens.css`. **No component may
  hardcode a colour**, and none may use the accent.
- Each component documents its states and its accessible behaviour next to
  itself.
- Keep it framework-free and keep the marking path free of a re-render pass —
  17 KB compressed of app JS against a 300 KB budget is a real asset, do not
  spend it on machinery.

**On geographical and street views — this needs care, and one part of it is
ruled out by the documents.**

- *Geographic / terrain / satellite*: fine in principle, as a switchable
  basemap. It must not become the default: doc 3 §1 is explicit that
  photography is used sparingly, because *"a photograph of a place tells a
  traveler where to go, but a map of holes tells them where they have not
  been"*. Sources are a cost and licensing decision — Parked.
- *Street-level*: **Google Street View cannot be embedded in this product.**
  Doc 2 §11 and doc 4 §9.1: the platform's terms restrict displaying its
  content on a non-vendor basemap, and we render our own. The permitted
  pattern is the one already built — store the stable place identifier and
  **link out** ("Open in Maps"), which the place panel already does. If Adil
  wants street-level imagery *inside* the product, the open route is Mapillary
  (CC BY-SA) and it is a real option — but it is his call, not yours. Do not
  wire a vendor SDK.

### Carried from round 3, still open

- **An orphaned visit must never disappear quietly.** The database rebuild kept
  11,883 of 11,918 ids and **lost 35**. Today `pinById.get(id)` returns
  undefined and the place silently stops existing. Keep the record, tell the
  traveler once and quietly how many marked places are not in this build, keep
  them in the export, and do not count them toward coverage.
- **The suite needs a check that the map actually loaded** — `map.loaded()`
  true. Three rounds have now shipped a dark map past a suite that could not
  see it. This is the single most valuable check you can add, and it should
  have caught this before I did.
- **Trips has no tests at all.** Camera does not move on add; no time or
  duration anywhere in a day; straight segments, not routes.
- **Bulk marking** — `.cursor/prompts/01-bulk-marking.md`, still untouched,
  still on doc 4 §15's critical path.

---

## Parked — Adil's calls, not yours or mine

1. **The bevel.** MapLibre cannot round extrusion corners at any version.
   Square edges, a faked chamfer from a second inset extrusion, or a custom
   WebGL layer.
2. **Merging sites into settlements in the data**, rather than only at low
   zoom. It would break `place_id`s, shrink the database, and delete the
   circle-versus-square distinction that doc 3 §8 uses to tell a site from a
   settlement. Rendering-level roll-up (B2) is safe and is what you should
   build; a model-level merge is a change to doc 1.
3. **The backend platform** — Supabase is my recommendation and doc 4 §2's
   description fits it exactly, but hosting region matters unusually much here
   because the data is a travel history.
4. **Whether "travel and discoveries" means doc 3's cartographic language or a
   warmer, photographic one.** Doc 3 §1 and §3 currently decide this.
5. **Basemap imagery** — terrain and satellite sources cost money or carry
   share-alike obligations, and doc 4 §2 chose self-hosted tiles specifically
   to keep cost off the success path.

---

## Questions for you — answer in `.cursor/AGENT-REPLY.md`

1. Why is the map still dark? What did `map.on('error')` say?
2. Round 2 and round 3 both asked for the map first and both times a feature
   got built instead. Are you seeing these prompts? Is the console error
   reaching you? I need to know whether the loop is working.
3. Did you rebuild `public/data`, or did it arrive from the pipeline session?
4. Is any standing rule getting in your way? Say so rather than working around
   it.

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file, and
`docs/2` outranks both.
