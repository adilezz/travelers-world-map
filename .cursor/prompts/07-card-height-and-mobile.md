# Round 7 — Still unseen is back; the card grew; write the reply

Reviewed 2026-08-23 05:13 UTC on `:4173` (preview titled "detail-bottom
CSS", started 04:08). Clicked 1440 and 390, screenshotted, ran

```
node test/acceptance.mjs http://127.0.0.1:4173/
```

Last line: **`59/59 passed`**. Exit 0.

**How to talk back:** write in `.cursor/AGENT-REPLY.md`. You left it empty
this round. That is the feedback loop failing. Fill it before you code.

This round is **twelve minutes**. Do not start a backend.

---

## What I clicked

- After Hide the register, the card **does** contain **Still unseen:**
  living old town or medina, coastal & maritime, high mountain… That was
  Round 6 item 1. The new check for it PASSed.
- **59/59**, including map.loaded, close, empty-map, passport, orphans,
  the 390px battery you added, and "on-map card stays within 340×280".
- Show the register is still the chevron label.

You shipped the coverage sentence. The suite agrees. I can see the words.

---

## What is still wrong

### 1. The painted card is not 280px tall

Your check reports `340×280`. I measured `.filters.on-map` at **322×353**
on 1440×844. The Still unseen paragraph is what grew it. Round 6 said: if
the sentence would push past ~280px, wrap or clip — do not grow a form
over the globe again.

Those two numbers cannot both be the box a traveler sees. Make the
**visible** overlay stay in the 340×280 band with the sentence still
readable (two lines plus a way to read the rest is enough). I will
measure the same node next tick.

### 2. 390px is not a shrunk desktop

I resized from a collapsed 1440 down to 390. The on-map card became
**356×301 on a 390×434 map** — most of the globe gone, register sheet
underneath. Your 390 checks report `374×128 on 390×434` and PASS. That
is a cold phone load, not a traveler who hid the register and then
rotated.

**Done means:** at 390px, however they got there, the globe is not under
a 300px card. Peek sheet is the register. Filters on the map are a thin
bar, not the desktop card scaled down. 44×44. Still unseen still present
(one line is enough). I will open 390 cold *and* 1440→390 next tick.

### 3. Write the reply

Questions 1–3 from Round 6 are still unanswered in `.cursor/AGENT-REPLY.md`.
Answer Round 7's questions there. A round with no reply costs more than
a round that asks.

---

## Parked

Accounts, sync, `/api`, street/satellite/photoreal. Bevel. The 35 ids.
Kyoto → Ishikawa (pipeline). Do not build them.

---

## Questions

Answer in `.cursor/AGENT-REPLY.md`:

1. Quote the last line of acceptance after a preview started *after*
   this build.
2. What node is 340×280 if `.filters.on-map` is 353 tall when I click?
3. At 390px, is the on-map chrome a different layout or the desktop card
   with a media query?

Standing rules: `.cursor/rules/travelers-world-map.mdc` outranks this file,
and `docs/2` outranks both.
