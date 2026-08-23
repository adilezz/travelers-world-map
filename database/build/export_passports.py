"""Fold the passport index into the app bundle as a separate, per-passport layer.

Entry requirements are not place data. They are a property of a pair — the
traveler's passport and the destination state — and they change on a political
clock rather than the pipeline's. So they ship as their own files, are fetched
only when a traveler picks a passport, and are versioned independently of the
place bundle. Nothing here touches a place, a score or an id.

Source: ilyankou/passport-index-dataset, MIT. 199 passports x 199 destinations.
The dataset's own note applies here too: it is a snapshot for planning, not
legal advice, and the authority is always the destination's own mission.

Coverage is deliberately partial. 37 of our 233 register countries are
dependencies and overseas territories that the index does not carry (Greenland,
Reunion, Gibraltar, Puerto Rico...). Several of them do follow their sovereign
state's policy exactly and several plainly do not, and guessing which is which
would be inventing a legal claim. They are listed as uncovered and the interface
says so.
"""
import csv
import json
import os
from pathlib import Path

DATA = Path(os.environ.get("TWM_DATA", "/home/claude/twm/data"))
DIST = Path(os.environ.get("TWM_DIST", "/home/claude/twm/dist"))
OUT = DIST / "app"

TIDY = DATA / "passport-tidy-iso3.csv"

# The five states a traveler actually plans around. The dataset's numeric values
# are visa-free day allowances, which is the same state as "visa free" plus a
# number worth showing.
FREE, ARRIVAL, ONLINE, ADVANCE, CLOSED, HOME = "vf", "voa", "ev", "vr", "na", "home"

RAW_TO_STATE = {
    "visa free": FREE,
    "visa on arrival": ARRIVAL,
    "e-visa": ONLINE,
    "eta": ONLINE,
    "visa required": ADVANCE,
    "no admission": CLOSED,
    "-1": HOME,
}

# eTA and e-visa are both "apply online before you fly", but they are not the
# same paperwork and the interface should not pretend they are.
SUBTYPE = {"eta": "eta", "e-visa": "e-visa"}


def classify(raw: str):
    """-> (state, days, subtype). Unknown values raise rather than guess."""
    raw = (raw or "").strip().lower()
    if raw in RAW_TO_STATE:
        return RAW_TO_STATE[raw], None, SUBTYPE.get(raw)
    try:
        days = int(raw)
    except ValueError:
        raise ValueError(f"unhandled requirement value from the source: {raw!r}")
    if days < 0:
        return HOME, None, None
    return FREE, days, None


def main():
    manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    name_by_iso3 = {c["iso3"]: c["country"] for c in manifest["countries"]}
    ours = set(name_by_iso3)

    rows = list(csv.DictReader(TIDY.open(encoding="utf-8")))
    by_passport: dict[str, dict] = {}
    for r in rows:
        state, days, sub = classify(r["Requirement"])
        entry = {"r": state}
        if days is not None:
            entry["d"] = days
        if sub:
            entry["v"] = sub
        by_passport.setdefault(r["Passport"], {})[r["Destination"]] = entry

    covered = {d for row in by_passport.values() for d in row}
    uncovered = sorted(ours - covered)

    pdir = OUT / "passports"
    pdir.mkdir(exist_ok=True)

    index = []
    for iso3, dests in sorted(by_passport.items()):
        # Destinations the passport index knows but our database has no places
        # for are kept: a traveler still wants to know they can go, and a place
        # arriving in a later build should not need a passport republish.
        counts: dict[str, int] = {}
        for e in dests.values():
            counts[e["r"]] = counts.get(e["r"], 0) + 1
        payload = {
            "passport": iso3,
            "name": name_by_iso3.get(iso3, iso3),
            "counts": counts,
            "in_database": sum(1 for d in dests if d in ours),
            "destinations": dests,
        }
        path = pdir / f"{iso3}.json"
        path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        index.append({
            "iso3": iso3,
            "name": name_by_iso3.get(iso3, iso3),
            "file": f"passports/{iso3}.json",
            "free": counts.get(FREE, 0),
            "bytes": path.stat().st_size,
        })

    index.sort(key=lambda p: p["name"])
    (pdir / "index.json").write_text(json.dumps({
        "passports": index,
        "uncovered": uncovered,
        "uncovered_note": "Dependencies and overseas territories the passport "
                          "index does not carry. Their entry rules are not "
                          "stated rather than inferred from a sovereign state.",
    }, separators=(",", ":")), encoding="utf-8")

    manifest["passports"] = {
        "source": "ilyankou/passport-index-dataset",
        "licence": "MIT",
        "count": len(index),
        "destinations": len(covered),
        "uncovered_in_register": len(uncovered),
        "states": {FREE: "no visa needed", ARRIVAL: "visa on arrival",
                   ONLINE: "apply online first", ADVANCE: "apply in advance",
                   CLOSED: "no admission", HOME: "your own country"},
        "index": "passports/index.json",
        "note": "A planning snapshot, not legal advice. The destination's own "
                "mission is the authority.",
    }
    manifest["layers"]["passports"] = "passports/{iso3}.json"
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, separators=(",", ":")), encoding="utf-8")

    total = sum(f.stat().st_size for f in pdir.glob("*.json"))
    print(f"passports        {len(index):>7}   {total/1e3:.0f} KB "
          f"(largest {max(i['bytes'] for i in index)/1e3:.1f} KB)")
    print(f"destinations     {len(covered):>7}")
    print(f"uncovered        {len(uncovered):>7}   {', '.join(uncovered[:8])}...")


if __name__ == "__main__":
    main()
