/**
 * Printable-map geometry (doc 5 §8.2).
 *
 * Alerts are advisory and never block. Implied pin spacing is the square
 * root of area over count — the arithmetic the warning is tested against.
 * A world cap is distributed per country so it is not a global score rank.
 */
import type { Pin } from './types';

export const A4_MM = { w: 210, h: 297 };
export const SPACING_MM = 4.5;

export const DIAGRAM_COPY = 'This will be a diagram, not a wall map.';
export const OVERLAP_COPY = 'Pins will overlap. Raise the size or lower the count.';

export function impliedSpacingMm(widthMm: number, heightMm: number, n: number): number {
  if (!(widthMm > 0) || !(heightMm > 0) || n <= 0) return Infinity;
  return Math.sqrt((widthMm * heightMm) / n);
}

/** Fires when implied spacing is under 4.5 mm, not at the boundary. */
export function pinsWillOverlap(widthMm: number, heightMm: number, n: number): boolean {
  return impliedSpacingMm(widthMm, heightMm, n) < SPACING_MM;
}

export function belowA4(widthMm: number, heightMm: number): boolean {
  return widthMm * heightMm < A4_MM.w * A4_MM.h;
}

export function worldAllCopy(printed: number, budget: number): string {
  return `The wall map uses 60 km spacing and about ${printed.toLocaleString('en-US')} drilled holes against a budget of ${budget.toLocaleString('en-US')}. This export will not match it.`;
}

export type PosterScope = 'world' | 'country' | 'region';

export function suggestPoster(kind: PosterScope, filteredCount: number): {
  widthMm: number; heightMm: number; cap: number;
} {
  if (kind === 'world') return { widthMm: 700, heightMm: 500, cap: Math.min(800, filteredCount) };
  if (kind === 'country') return { widthMm: 400, heightMm: 500, cap: filteredCount };
  return { widthMm: 300, heightMm: 300, cap: filteredCount };
}

/** Best of each country first, round-robin. Not a world ranking by score. */
export function takeDistributed(pins: Pin[], n: number): Pin[] {
  if (n <= 0 || n >= pins.length) return pins;
  const by = new Map<string, Pin[]>();
  for (const p of pins) {
    const g = by.get(p.iso3);
    if (g) g.push(p); else by.set(p.iso3, [p]);
  }
  const queues = [...by.values()].map((g) => {
    g.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return g;
  });
  const out: Pin[] = [];
  while (out.length < n) {
    let added = 0;
    for (const q of queues) {
      if (!q.length) continue;
      out.push(q.shift()!);
      added++;
      if (out.length >= n) break;
    }
    if (!added) break;
  }
  return out;
}

export function posterAlerts(opts: {
  widthMm: number;
  heightMm: number;
  count: number;
  scope: PosterScope;
  exportingAllWorld: boolean;
  printed: number;
  holeBudget: number;
}): string[] {
  const out: string[] = [];
  if (belowA4(opts.widthMm, opts.heightMm)) out.push(DIAGRAM_COPY);
  if (pinsWillOverlap(opts.widthMm, opts.heightMm, opts.count)) out.push(OVERLAP_COPY);
  if (opts.scope === 'world' && opts.exportingAllWorld) {
    out.push(worldAllCopy(opts.printed, opts.holeBudget));
  }
  return out;
}
