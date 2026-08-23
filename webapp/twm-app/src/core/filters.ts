/**
 * One filter state, read by both surfaces.
 *
 * Filtering the list filters the pins, always — the register and the map are
 * the same data (doc 3 §8), and two filter states would let them disagree,
 * which is the one thing this pairing cannot afford.
 */
import { hasKind } from './kinds';
import type { Entry, EntryState, Filters, KindCode, Pin, Scope, SortKey } from './types';

export function emptyFilters(): Filters {
  return {
    visited: 'all',
    kinds: new Set<KindCode>(),
    printedOnly: false,
    whsOnly: false,
    scoreMin: 0,
    months: new Set<number>(),
    search: '',
    passport: null,
    entryStates: new Set<EntryState>(),
  };
}

export function isActive(f: Filters): boolean {
  return f.visited !== 'all' || f.kinds.size > 0 || f.printedOnly || f.whsOnly
    || f.scoreMin > 0 || f.months.size > 0 || f.search.trim() !== ''
    || f.entryStates.size > 0;
}

export interface ApplyContext {
  visited: ReadonlySet<string>;
  scope: Scope;
  /** Destination lookup for the chosen passport, if any. */
  entry?: Record<string, Entry>;
}

/** Pins in scope, before the filter row is applied. Scope is a different thing
 *  from a filter: it is what the traveler is looking at, and the coverage meter
 *  is computed against it whether or not anything is filtered. */
export function inScope(all: Pin[], byCountry: Map<string, Pin[]>,
                        byTerritory: Map<string, Pin[]>, scope: Scope): Pin[] {
  if (scope.kind === 'country') return byCountry.get(scope.iso3) ?? [];
  if (scope.kind === 'territory') return byTerritory.get(scope.id) ?? [];
  return all;
}

export function apply(pins: Pin[], f: Filters, ctx: ApplyContext): Pin[] {
  const q = f.search.trim().toLowerCase();
  const scoreBandApplies = ctx.scope.kind === 'country' && f.scoreMin > 0;
  const out: Pin[] = [];

  for (const p of pins) {
    if (f.visited === 'yes' && !ctx.visited.has(p.id)) continue;
    if (f.visited === 'no' && ctx.visited.has(p.id)) continue;
    if (f.printedOnly && !p.onPrintedMap) continue;
    if (f.whsOnly && p.whs === 0) continue;
    // Score is country-relative and never comparable across borders (doc 1),
    // so the band can only ever narrow a single country's list.
    if (scoreBandApplies && p.score < f.scoreMin) continue;
    if (f.kinds.size) {
      let any = false;
      for (const k of f.kinds) if (hasKind(p.kinds, k)) { any = true; break; }
      if (!any) continue;
    }
    if (f.months.size) {
      // Unknown seasonality (mask 0) cannot confirm a month, so it drops.
      let any = false;
      for (const mo of f.months) {
        if (p.months & (1 << (mo - 1))) { any = true; break; }
      }
      if (!any) continue;
    }
    if (f.entryStates.size && ctx.entry) {
      const e = ctx.entry[p.iso3];
      // A destination the passport index does not carry is not silently
      // dropped and not silently kept: it fails the filter, and the interface
      // says how many were set aside and why.
      if (!e || !f.entryStates.has(e.r)) continue;
    }
    if (q && !p.name.toLowerCase().includes(q)) continue;
    out.push(p);
  }
  return out;
}

export interface SortContext {
  markedAt: (id: string) => string | undefined;
  from?: { lat: number; lon: number };
  countryName: (iso3: string) => string;
}

export function sortPins(pins: Pin[], key: SortKey, scope: Scope, ctx: SortContext): Pin[] {
  const a = [...pins];
  switch (key) {
    case 'name':
      return a.sort((x, y) => x.name.localeCompare(y.name));
    case 'recent':
      return a.sort((x, y) => (ctx.markedAt(y.id) ?? '').localeCompare(ctx.markedAt(x.id) ?? ''));
    case 'distance': {
      const o = ctx.from;
      if (!o) return a;
      return a.sort((x, y) => haversine(o, x) - haversine(o, y));
    }
    case 'score':
    default:
      // Sorting the world by score produces nonsense (doc 1 §3): 100 means
      // "best in this country", so Rome, Kathmandu and Reykjavik are all 100.
      // At world scope, group by country first and let score order within it.
      if (scope.kind === 'world') {
        return a.sort((x, y) =>
          (ctx.countryName(x.iso3) ?? '').localeCompare(ctx.countryName(y.iso3) ?? '')
          || y.score - x.score);
      }
      return a.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
  }
}

function haversine(o: { lat: number; lon: number }, p: Pin): number {
  const R = 6371, r = Math.PI / 180;
  const dLat = (p.lat - o.lat) * r, dLon = (p.lon - o.lon) * r;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(o.lat * r) * Math.cos(p.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export { haversine };
