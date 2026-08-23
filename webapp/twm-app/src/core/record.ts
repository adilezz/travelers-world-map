/**
 * The traveler's record.
 *
 * Local first (doc 4 §8). A mark writes to memory, repaints, and only then
 * touches storage and the sync queue — the tap must never wait on either. The
 * product works before an account exists and keeps working when the network
 * does not.
 *
 * Nothing is ever hard-deleted (P4, doc 4 §3.2). Unmarking sets visited false
 * and keeps the row, so a note survives an accidental tap. That is the whole
 * difference between a record a traveler trusts and one they do not.
 */
import type { Visit } from './types';

const KEY = 'twm.visits.v1';
const QUEUE = 'twm.queue.v1';
const PROFILE = 'twm.profile.v1';

export interface Profile {
  displayName?: string;
  homeCountry?: string;
  passport?: string | null;
  theme?: 'light' | 'dark' | 'system';
}

export class Record {
  private rows = new Map<string, Visit>();
  /** The hot set. Membership is what the map and every row test, thousands of
   *  times a second while panning, so it is a Set of ids and nothing else. */
  visited = new Set<string>();
  private queue: string[] = [];
  private writeTimer: number | null = null;
  /** Previous visited flags for the last bulk apply, so one action undoes it. */
  private lastBulk: Map<string, boolean> | null = null;
  profile: Profile = {};

  /** Storage can throw — a private window, a full quota — and the product must
   *  keep working when it does (doc 4 §10). */
  storageFailed = false;

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        for (const v of JSON.parse(raw) as Visit[]) {
          this.rows.set(v.place_id, v);
          if (v.visited) this.visited.add(v.place_id);
        }
      }
      this.queue = JSON.parse(localStorage.getItem(QUEUE) ?? '[]');
      this.profile = JSON.parse(localStorage.getItem(PROFILE) ?? '{}');
    } catch {
      this.storageFailed = true;
    }
  }

  isVisited(id: string) { return this.visited.has(id); }
  get(id: string) { return this.rows.get(id); }
  get count() { return this.visited.size; }
  get pending() { return this.queue.length; }
  all(): Visit[] { return [...this.rows.values()]; }

  /** One tap. Returns the new state. Undo is the same call. */
  toggle(id: string, at = new Date().toISOString()): boolean {
    const now = !this.visited.has(id);
    this.setOne(id, now, at);
    this.persist();
    return now;
  }

  /** Bulk marking — the onboarding path for someone with thirty years of travel
   *  behind them (doc 2 §7). One persist for the whole set, not one per place. */
  markMany(ids: Iterable<string>, visited = true) {
    const at = new Date().toISOString();
    let n = 0;
    for (const id of ids) {
      if (this.visited.has(id) === visited) continue;
      this.setOne(id, visited, at);
      n++;
    }
    this.persist();
    return n;
  }

  /** One confirm for a bulk surface. Diffs `universe` against `ticked` and
   *  stores an undo of the previous flags. Never deletes a row. */
  applyBulk(universe: Iterable<string>, ticked: ReadonlySet<string>): { marked: number; unmarked: number } {
    const at = new Date().toISOString();
    const prev = new Map<string, boolean>();
    let marked = 0, unmarked = 0;
    for (const id of universe) {
      prev.set(id, this.visited.has(id));
      const want = ticked.has(id);
      if (this.visited.has(id) === want) continue;
      this.setOne(id, want, at);
      if (want) marked++; else unmarked++;
    }
    this.lastBulk = prev;
    this.persist();
    return { marked, unmarked };
  }

  undoBulk(): boolean {
    if (!this.lastBulk) return false;
    const at = new Date().toISOString();
    for (const [id, was] of this.lastBulk) {
      if (this.visited.has(id) !== was) this.setOne(id, was, at);
    }
    this.lastBulk = null;
    this.persist();
    return true;
  }

  private setOne(id: string, visited: boolean, at: string) {
    const existing = this.rows.get(id);
    // Keep visited_on and note. Unmarking is a flag, never a delete.
    this.rows.set(id, { ...(existing ?? { place_id: id }), place_id: id, visited, marked_at: at });
    if (visited) this.visited.add(id); else this.visited.delete(id);
    if (!this.queue.includes(id)) this.queue.push(id);
  }

  annotate(id: string, patch: { visited_on?: string; note?: string }) {
    const existing = this.rows.get(id) ?? {
      place_id: id, visited: false, marked_at: new Date().toISOString(),
    };
    this.rows.set(id, { ...existing, ...patch });
    if (!this.queue.includes(id)) this.queue.push(id);
    this.persist();
  }

  /** Coalesced: a bulk mark of two hundred places is one write, and a fast
   *  sequence of taps does not serialise the whole record each time. */
  private persist() {
    if (this.writeTimer !== null) return;
    this.writeTimer = window.setTimeout(() => {
      this.writeTimer = null;
      try {
        localStorage.setItem(KEY, JSON.stringify([...this.rows.values()]));
        localStorage.setItem(QUEUE, JSON.stringify(this.queue));
        this.storageFailed = false;
      } catch {
        this.storageFailed = true;
      }
    }, 250);
  }

  saveProfile(patch: Profile) {
    this.profile = { ...this.profile, ...patch };
    try { localStorage.setItem(PROFILE, JSON.stringify(this.profile)); } catch { /* non-fatal */ }
  }

  /** Export is one action and produces a file readable without this product
   *  (doc 2 §12). Documented inline, because a format nobody can read is not
   *  ownership. */
  export(buildId: string, trips: unknown[] = []) {
    return {
      format: 'travelers-world-map/record',
      version: 1,
      exported_at: new Date().toISOString(),
      place_database_build: buildId,
      note: 'place_id values are stable across database rebuilds and are the '
          + 'only identifier this file depends on. visited=false rows are '
          + 'places that were marked and later unmarked; they are kept so that '
          + 'anything attached to them survives. trips is an ordered list of '
          + 'days, not a schedule: no times and no durations.',
      visits: this.all(),
      trips,
      profile: this.profile,
    };
  }

  /** Import merges rather than replaces — the same rule as signing in
   *  (doc 4 §8). Last write wins per place, by marked_at. */
  import(doc: any): { added: number; updated: number; skipped: number } {
    let added = 0, updated = 0, skipped = 0;
    const visits: Visit[] = Array.isArray(doc?.visits) ? doc.visits : [];
    for (const v of visits) {
      if (!v?.place_id) { skipped++; continue; }
      const mine = this.rows.get(v.place_id);
      if (!mine) { this.rows.set(v.place_id, v); added++; }
      else if ((v.marked_at ?? '') > (mine.marked_at ?? '')) {
        this.rows.set(v.place_id, { ...mine, ...v }); updated++;
      } else skipped++;
    }
    this.visited.clear();
    for (const v of this.rows.values()) if (v.visited) this.visited.add(v.place_id);
    this.persist();
    return { added, updated, skipped };
  }
}
