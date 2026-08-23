/**
 * Coverage. This is the product (doc 2 §6).
 *
 * For any scope — the world, a country, a tile — which of the twelve kinds of
 * place the traveler has seen and which they have not. As a count and as a
 * list. Never as a percentage of places: a percentage rewards volume and
 * punishes large countries, which is the behaviour this model exists to reject
 * (doc 2 §6.1).
 *
 * Reported as a pair (doc 2 §6.2): kinds seen, and places per kind. One place
 * in each of eight kinds and four places in each of eight kinds are visibly
 * different states, and neither is presented as better.
 */
import { ALL_KINDS, hasKind } from './kinds';
import type { KindCode, Pin } from './types';

export interface KindRow {
  code: KindCode;
  available: number;   // places of this kind in scope
  seen: number;        // how many of them are marked
}

export interface Coverage {
  rows: KindRow[];           // all twelve, always, in canonical order
  present: KindRow[];        // the kinds this scope actually has
  seenKinds: number;
  availableKinds: number;
  unseen: KindCode[];        // present in scope, not yet marked
  places: number;
  visited: number;
  /** Kinds with no place in scope at all. Not a gap in the traveler's travel —
   *  a gap in what is here — and the interface must not confuse the two. */
  absent: KindCode[];
}

export function coverage(pins: Iterable<Pin>, visited: ReadonlySet<string>): Coverage {
  const available = new Map<KindCode, number>();
  const seen = new Map<KindCode, number>();
  let places = 0, visitedCount = 0;

  for (const p of pins) {
    places++;
    const isSeen = visited.has(p.id);
    if (isSeen) visitedCount++;
    for (const k of ALL_KINDS) {
      if (!hasKind(p.kinds, k)) continue;
      available.set(k, (available.get(k) ?? 0) + 1);
      if (isSeen) seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }

  const rows: KindRow[] = ALL_KINDS.map((code) => ({
    code, available: available.get(code) ?? 0, seen: seen.get(code) ?? 0,
  }));
  const present = rows.filter((r) => r.available > 0);

  return {
    rows,
    present,
    seenKinds: present.filter((r) => r.seen > 0).length,
    availableKinds: present.length,
    unseen: present.filter((r) => r.seen === 0).map((r) => r.code),
    absent: rows.filter((r) => r.available === 0).map((r) => r.code),
    places,
    visited: visitedCount,
  };
}

/** Did this mark complete a kind the traveler had never seen in this scope?
 *  Doc 3 §10: worth a brief, restrained acknowledgement. Once per kind per
 *  scope. It is a fact being reported, not a reward being granted. */
export function newlySeen(before: Coverage, after: Coverage): KindCode[] {
  const was = new Set(before.present.filter((r) => r.seen > 0).map((r) => r.code));
  return after.present.filter((r) => r.seen > 0 && !was.has(r.code)).map((r) => r.code);
}
