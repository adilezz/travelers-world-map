/**
 * Last-write-wins per place_id by marked_at (doc 4 §8).
 * Local wins ties so an offline mark is not discarded on sign-in.
 */
import type { Trip, Visit } from './types';

export function mergeVisits(remote: Visit[], local: Visit[]): Visit[] {
  const out = new Map<string, Visit>();
  for (const v of remote) {
    if (v?.place_id) out.set(v.place_id, v);
  }
  for (const v of local) {
    if (!v?.place_id) continue;
    const cur = out.get(v.place_id);
    if (!cur || (v.marked_at ?? '') >= (cur.marked_at ?? '')) {
      out.set(v.place_id, cur ? { ...cur, ...v } : v);
    }
  }
  return [...out.values()];
}

export function mergeTrips(remote: Trip[], local: Trip[]): Trip[] {
  const out = new Map<string, Trip>();
  for (const t of remote) if (t?.id) out.set(t.id, t);
  for (const t of local) if (t?.id) out.set(t.id, t);
  return [...out.values()];
}
