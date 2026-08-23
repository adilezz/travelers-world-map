/**
 * Trips. Version one is the flow travelers actually complete (doc 2 §9):
 * save places → assign them to days → see them connected. Straight lines,
 * not routes. No times, no durations, no collaboration.
 *
 * Local-first, same as the visit record. Ordered by explicit position so two
 * later devices can converge without corrupting the sequence (doc 4 §8).
 */
import type { Trip, TripStop } from './types';

const KEY = 'twm.trips.v1';

export class TripBook {
  trips: Trip[] = [];
  activeId: string | null = null;
  storageFailed = false;
  private writeTimer: number | null = null;

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const doc = JSON.parse(raw);
        this.trips = (Array.isArray(doc?.trips) ? doc.trips : []).map(normalise);
        this.activeId = doc?.activeId ?? this.trips[0]?.id ?? null;
      }
    } catch {
      this.storageFailed = true;
    }
  }

  get active(): Trip | null {
    return this.trips.find((t) => t.id === this.activeId) ?? null;
  }

  create(title = 'Untitled trip'): Trip {
    const trip: Trip = {
      id: `trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      dayCount: 1,
      stops: [],
    };
    this.trips.push(trip);
    this.activeId = trip.id;
    this.persist();
    return trip;
  }

  remove(id: string) {
    this.trips = this.trips.filter((t) => t.id !== id);
    if (this.activeId === id) this.activeId = this.trips[0]?.id ?? null;
    this.persist();
  }

  select(id: string | null) {
    this.activeId = id;
    this.persist();
  }

  rename(id: string, title: string) {
    const t = this.trips.find((x) => x.id === id);
    if (!t) return;
    t.title = title.trim() || t.title;
    this.persist();
  }

  setDates(id: string, start?: string, end?: string) {
    const t = this.trips.find((x) => x.id === id);
    if (!t) return;
    t.start = start || undefined;
    t.end = end || undefined;
    this.persist();
  }

  /** Add a place to a day of the active trip. Day 1 is the first day;
   *  the tray (day 0) is a holding place, not a day that draws. */
  add(placeId: string, day = 1): boolean {
    const t = this.active;
    if (!t) return false;
    if (t.stops.some((s) => s.place_id === placeId)) return false;
    const peers = t.stops.filter((s) => s.day === day);
    t.stops.push({
      place_id: placeId,
      day,
      position: peers.length ? Math.max(...peers.map((s) => s.position)) + 1 : 0,
    });
    this.persist();
    return true;
  }

  drop(placeId: string) {
    const t = this.active;
    if (!t) return;
    t.stops = t.stops.filter((s) => s.place_id !== placeId);
    this.persist();
  }

  /** Move a stop to a day (0 = tray) and optional index within that day. */
  move(placeId: string, day: number, index?: number) {
    const t = this.active;
    if (!t) return;
    const stop = t.stops.find((s) => s.place_id === placeId);
    if (!stop) return;
    stop.day = day;
    const peers = t.stops.filter((s) => s.day === day && s.place_id !== placeId)
      .sort((a, b) => a.position - b.position);
    const at = index == null ? peers.length : Math.max(0, Math.min(peers.length, index));
    peers.splice(at, 0, stop);
    peers.forEach((s, i) => { s.position = i; });
    this.persist();
  }

  addDay() {
    const t = this.active;
    if (!t) return 1;
    const maxStop = t.stops.reduce((m, s) => Math.max(m, s.day), 0);
    t.dayCount = Math.max(t.dayCount ?? 1, maxStop) + 1;
    this.persist();
    return t.dayCount;
  }

  ordered(trip: Trip = this.active!): TripStop[] {
    if (!trip) return [];
    return [...trip.stops].sort((a, b) => a.day - b.day || a.position - b.position);
  }

  /** Days that exist, including an empty day the traveler just added. */
  days(trip: Trip = this.active!): number[] {
    if (!trip) return [];
    const maxStop = trip.stops.reduce((m, s) => Math.max(m, s.day), 0);
    const n = Math.max(trip.dayCount ?? 1, maxStop, 1);
    return Array.from({ length: n }, (_, i) => i + 1);
  }

  export(): Trip[] { return this.trips; }

  import(trips: Trip[]) {
    if (!Array.isArray(trips)) return;
    const byId = new Map(this.trips.map((t) => [t.id, t]));
    for (const t of trips) {
      if (!t?.id) continue;
      byId.set(t.id, t);
    }
    this.trips = [...byId.values()].map(normalise);
    if (!this.activeId) this.activeId = this.trips[0]?.id ?? null;
    this.persist();
  }

  private persist() {
    if (this.writeTimer !== null) return;
    this.writeTimer = window.setTimeout(() => {
      this.writeTimer = null;
      try {
        localStorage.setItem(KEY, JSON.stringify({
          trips: this.trips, activeId: this.activeId,
        }));
        this.storageFailed = false;
      } catch {
        this.storageFailed = true;
      }
    }, 250);
  }
}

function normalise(t: Trip): Trip {
  const maxStop = (t.stops ?? []).reduce((m, s) => Math.max(m, s.day), 0);
  return { ...t, dayCount: Math.max(t.dayCount ?? 1, maxStop, 1), stops: t.stops ?? [] };
}

/** Months touched by an inclusive date range. Empty if either end is missing. */
export function monthsInRange(start?: string, end?: string): Set<number> {
  const out = new Set<number>();
  if (!start) return out;
  const a = new Date(start + 'T00:00:00');
  const b = new Date((end || start) + 'T00:00:00');
  if (Number.isNaN(+a) || Number.isNaN(+b)) return out;
  const cur = new Date(Math.min(+a, +b));
  const last = new Date(Math.max(+a, +b));
  let guard = 0;
  while (cur <= last && guard++ < 24) {
    out.add(cur.getMonth() + 1);
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}
