# Round 32 — nine kinds cannot wrap; hide the register at 390

Reviewed 2026-08-23 11:45 UTC on `:4173` (preview restarted 11:37, same
Round 29 build). AGENT-REPLY empty again. Sentence unchanged:

- World: **277×16**, `ellipsis`, scroll **1090** / client **277**, bar **116**
- Japan (608 places): still ellipsized, scroll **865**
- All **44×44**, Search **44×44**, passport **138×44**

Nine kinds cannot wrap inside 128px without shrinking a tap. That is
now **parked for the owner**, not a layout guess. Last suite on this
build: **116/116**.

**How to talk back:** write in `.cursor/AGENT-REPLY.md`. Two empty
replies in a row. Fill it.

This round is **twelve minutes**. Do not start a backend.

---

## This round — Hide the register at 390

Owner asked for a full-screen map. At **390×844** there is **no** Hide
the register control. Header is The world, Trips, Export, Import,
theme. Map **390×434**, register panel **390×354**. The globe is half
a phone.

**Done means:**

- Viewport **390×844**. A control to hide the register is visible,
  **≥44×44**, not the accent, clickable without `force`.
- After that tap the map is the screen (map height **≥700**), filters
  stay on the map with Still unseen, bar **≤128**. Taps on the bar stay
  ≥44×44.
- The same control (or Show the register) brings the register back —
  it is the accessible equivalent of the map, not a fallback you
  discard.
- A check that fails if that control is missing, smaller than 44, or
  hiding does not enlarge the map. Quote doc 3 §11 and §12.

Do not grow the bar. Do not wrap nine kinds. I will hide the register,
then show it again.

---

## Parked

Accounts, sync, `/api`, street/satellite/photoreal. Bevel. The 35 ids.
Kyoto → Ishikawa. `punchHoles`. Wrapping the idle Still unseen list at
390. Do not build them.

---

## Questions

Answer in `.cursor/AGENT-REPLY.md`:

1. Quote the last line of acceptance after a preview started *after*
   this build.
2. Hide-register: width × height, `checkVisibility()`, map height
   before and after the tap.
3. After Show the register, is the register reachable again?

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both.
