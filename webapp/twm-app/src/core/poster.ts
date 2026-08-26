/**
 * Printable-map geometry, and the advice that goes with it.
 *
 * Doc 5 §8.2's alerts are kept exactly as they were: size under A4, implied
 * pin spacing under 4.5 mm, and the world at every place. Two more join them,
 * because the product changed on 2026-08-25 and the tiles are now cut out
 * rather than dropped on:
 *
 *   - a tile has to be big enough to cut, and at 700 mm the median world tile
 *     prints 4 mm, so the size the traveler types decides which tile level is
 *     even possible;
 *   - the tiles that stay too small however coarse the level -- islands, and
 *     countries smaller than a piece -- have to be named rather than quietly
 *     dropped from the sheet.
 *
 * Everything here is advisory. Nothing blocks an export: it is the traveler's
 * paper, and doc 5 says so.
 */
import type { Pin } from './types';

export const A4_MM = { w: 210, h: 297 };
export const SPACING_MM = 4.5;
/** The smallest square a person can cut out, separate and glue down. */
export const CUT_MM = 12;

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

// ---------------------------------------------------------------------------
// tile levels
// ---------------------------------------------------------------------------

export interface LevelInfo {
  level: string;
  tiles: number;
  /** The wall-map width this level was built for, or null for the base. */
  for_map_mm: number | null;
}

/**
 * The finest level that is still cuttable on the paper the traveler asked for.
 *
 * Finest, not coarsest: more tiles is a better jigsaw right up to the point
 * where the pieces stop being cuttable, and that point is a property of the
 * paper. A 2 m map earns 700 pieces; a 700 mm map earns 369 and no more.
 */
export function levelForWidth(levels: LevelInfo[], widthMm: number): string {
  const usable = levels.filter((l) => l.for_map_mm !== null);
  if (!usable.length) return 'L0';
  const fits = usable.filter((l) => (l.for_map_mm as number) <= widthMm);
  if (!fits.length) {
    // Narrower than every level. Take the coarsest and let the alert say so.
    return usable.reduce((a, b) =>
      (a.for_map_mm as number) <= (b.for_map_mm as number) ? a : b).level;
  }
  return fits.reduce((a, b) =>
    (a.for_map_mm as number) >= (b.for_map_mm as number) ? a : b).level;
}

/** The width at which a level's own threshold is met. */
export function widthForLevel(levels: LevelInfo[], level: string): number | null {
  return levels.find((l) => l.level === level)?.for_map_mm ?? null;
}

export interface TileSizeReport {
  tiles: number;
  tooSmall: number;
  placesLost: number;
  /** The width, in mm, at which nothing but the unmergeable islands is small. */
  suggestWidthMm: number;
}

/**
 * How the chosen level lands on the chosen paper.
 *
 * `side_deg` is the square root of the tile's area in degrees, precomputed at
 * build time, so this is arithmetic rather than geometry and can run on every
 * keystroke in the size field.
 */
/** The smallest a piece may be across its narrow way and still be handled. */
export const CUT_MIN_MM = 6;

/**
 * What a pair of scissors can do, measured on the piece's bounding box.
 *
 * The square root of the area was tried first and is wrong: it punishes
 * anything long or ragged. Western Honshu measured 10.8 mm that way and was
 * refused, though its box is 26 x 12 mm; so were the Netherlands and Belgium.
 * Between them they were most of the "places on uncuttable tiles" figure, and
 * not one of them was uncuttable.
 */
export function cuttable(minDeg: number, maxDeg: number, mmPerDeg: number) {
  return maxDeg * mmPerDeg >= CUT_MM && minDeg * mmPerDeg >= CUT_MIN_MM;
}

export function measureTiles(
  tiles: { min_deg: number; max_deg: number; places: number }[],
  widthMm: number,
): TileSizeReport {
  const mmPerDeg = widthMm / 360;
  let tooSmall = 0;
  let placesLost = 0;
  const smallSides: number[] = [];
  for (const t of tiles) {
    if (!cuttable(t.min_deg, t.max_deg, mmPerDeg)) {
      tooSmall++;
      placesLost += t.places;
      smallSides.push(t.max_deg);
    }
  }
  // Ignore the smallest tenth: those are atolls and city-states, and no width
  // a printer can reach will fix them. Sizing the advice to them would tell
  // every traveler to print an eight-metre map.
  smallSides.sort((a, b) => b - a);
  const pick = smallSides[Math.floor(smallSides.length * 0.35)] ?? 0;
  const suggest = pick > 0 ? Math.ceil((CUT_MM / pick) * 360 / 100) * 100 : widthMm;
  return {
    tiles: tiles.length, tooSmall, placesLost,
    suggestWidthMm: Math.max(widthMm, suggest),
  };
}

// ---------------------------------------------------------------------------
// suggestions
// ---------------------------------------------------------------------------

export function suggestPoster(kind: PosterScope, filteredCount: number): {
  widthMm: number; heightMm: number; cap: number;
} {
  // The world suggestion is 1400 x 700, not doc 5's 700 x 500. At 700 mm the
  // median tile is 4 mm across and a third of all places sit on tiles nobody
  // can cut; the old number was sized for a poster with pins in it, and does
  // not survive the tiles becoming cut-outs.
  if (kind === 'world') {
    return { widthMm: 1400, heightMm: 700, cap: Math.min(1200, filteredCount) };
  }
  if (kind === 'country') return { widthMm: 500, heightMm: 620, cap: filteredCount };
  return { widthMm: 400, heightMm: 400, cap: filteredCount };
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
  tiles?: TileSizeReport;
  level?: string;
  levelWidthMm?: number | null;
}): string[] {
  const out: string[] = [];
  if (belowA4(opts.widthMm, opts.heightMm)) out.push(DIAGRAM_COPY);
  if (pinsWillOverlap(opts.widthMm, opts.heightMm, opts.count)) {
    out.push(OVERLAP_COPY);
  }
  if (opts.scope === 'world' && opts.exportingAllWorld) {
    out.push(worldAllCopy(opts.printed, opts.holeBudget));
  }
  if (opts.levelWidthMm && opts.widthMm < opts.levelWidthMm) {
    out.push(
      `This is the coarsest tile level there is, and it still needs about `
      + `${opts.levelWidthMm} mm. At ${Math.round(opts.widthMm)} mm most tiles `
      + 'will be too small to cut.');
  }
  const t = opts.tiles;
  if (t && t.tooSmall) {
    const share = t.placesLost ? ` holding ${t.placesLost.toLocaleString('en-US')} places` : '';
    out.push(
      `${t.tooSmall} of ${t.tiles} tiles print under ${CUT_MM} mm${share}. `
      + 'They stay part of the wall map and are listed in the tile index. '
      + (t.suggestWidthMm > opts.widthMm
        ? `About ${t.suggestWidthMm} mm wide would cut most of them.`
        : 'The rest are islands and city-states, which no width fixes.'));
  }
  return out;
}

/** Plain-language sizing advice, shown whether or not anything is wrong. */
export function posterAdvice(opts: {
  scope: PosterScope; widthMm: number; heightMm: number;
  level: string; tiles: number; cuttable: number;
}): string {
  const where = opts.scope === 'world' ? 'the world'
    : opts.scope === 'country' ? 'this country' : 'this region';
  return `At ${Math.round(opts.widthMm)} × ${Math.round(opts.heightMm)} mm, `
    + `${where} comes out as ${opts.cuttable.toLocaleString('en-US')} cuttable `
    + `${opts.cuttable === 1 ? 'tile' : 'tiles'} of ${opts.tiles.toLocaleString('en-US')}.`;
}
