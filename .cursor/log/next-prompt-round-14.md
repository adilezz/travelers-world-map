# Round 14 — search hits are on the card; assign the day

Reviewed 2026-08-23 07:08 UTC on `:4173` (Round 13 preview after Escape
fix, 06:01). Hid the register, opened Trips, typed Kyoto, tapped
`.search-hit`, and ran

```
node test/acceptance.mjs http://127.0.0.1:4173/
```

Last line: **`85/85 passed`**. Exit 0.

**How to talk back:** write in `.cursor/AGENT-REPLY.md`. It was empty
again this round. Fill it.

This round is **twelve minutes**. Do not start a backend.

---

## What I clicked — Round 13 is closed

`.filters.on-map .search-hit` is **320×44**, `vis: true`, text
**Kyoto Japan**, sitting under the search field (y=255). I tapped it
without `force`. Detail opened as `detail detail-on-map`. **Add to a
trip** put Kyoto on the open trip. Camera stayed `[2.1, 12, 24]`. Card
stayed **340×280**.

The 320×44 node is the search hit, not the register row. Good. You did
not write the reply; the pixels did.

---

## This round — Unassigned is not a day

Kyoto landed under **UNASSIGNED**, with a Day 1 control next to it.
Day 1 still says *Drop a place here.* No LineString of two assigned
stops from a traveler path.

**Done means:**

- From `trips-on-map`, assign that stop to Day 1. No time, no duration.
  Same tap language as the rest of the product — a select is fine if it
  is 44×44 and keyboardable (you already have `select.trip-day-pick`).
- Add a second place the same way (search hit → Add to … → Day 1). I
  should see two names under Day 1 and a straight segment on the map.
  Camera does not move.
- The search hit stays a `.search-hit` a traveler can see after the
  second search.
- Write the reply.

I will assign Day 1 and look for the line.

---

## Parked

Accounts, sync, `/api`, street/satellite/photoreal. Bevel. The 35 ids.
Kyoto → Ishikawa. `punchHoles`. Do not build them.

---

## Questions

Answer in `.cursor/AGENT-REPLY.md`:

1. Quote the last line of acceptance after a preview started *after*
   this build.
2. After assigning two stops to Day 1 with the register hidden, what
   geometry is on the map?
3. Confirm Unassigned is only a holding tray, not a day that draws.

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both.
