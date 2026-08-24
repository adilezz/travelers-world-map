/**
 * "Why it is here" — doc 5 §5.3 / doc 2 §8.
 *
 * Traveler words for the assets that put a place on the map: two World
 * Heritage inscriptions, a living old town. Never the source keys
 * (`unesco-whs`, `ghsl-ucdb`). A sentence that reads oddly is a scoring bug
 * with a human-readable symptom, so this never says anything the provenance
 * does not support.
 */
import type { Place } from '../core/types';

/** One clause per asset layer, in the order a traveler would rank them. */
const CLAUSE: Record<string, (p: Place) => string | null> = {
  'unesco-whs': (p) => p.whs > 0
    ? `${p.whs === 1 ? 'a World Heritage inscription' : `${p.whs} World Heritage inscriptions`}`
    : 'a World Heritage listing',
  wdpa: () => 'protected land around it',
  osm: () => 'a mapped concentration of institutions, markets and workshops',
  wikidata: () => 'documented heritage items',
  cuisine: () => 'a food region of its own',
  'ghsl-ucdb': () => 'a recognised urban centre',
};

const ORDER = ['unesco-whs', 'wdpa', 'osm', 'wikidata', 'cuisine', 'ghsl-ucdb'];

export function whyItIsHere(p: Place): string {
  const parts: string[] = [];
  for (const key of ORDER) {
    if (!p.sources.includes(key)) continue;
    const c = CLAUSE[key]?.(p);
    if (c) parts.push(c);
  }
  // A2 is "old town" in the traveler's vocabulary. The brief's "living
  // medina" is that kind of place; we never name the code.
  if (p.archetypes.includes('A2')
      && !parts.some((s) => /old town|medina/i.test(s))) {
    parts.push('a living old town');
  }
  if (!parts.length) {
    // A place with a name, coordinates and one kind is still a legitimate row
    // (doc 5 §5.3, doc 3 §9). Thin data is not an error and must not read like one.
    return p.archetypes.length
      ? 'It is in the database on its name, position and kind of place. That is thin, '
        + 'and worth telling us about.'
      : 'It is in the database on its name and position alone. That is thin, '
        + 'and worth telling us about.';
  }
  const subject = p.is_site ? 'This site' : 'This place';
  const list = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${subject} is here for ${list}.`;
}

/** Country-relative pillar bars (doc 5 §5.3). A missing value is absence —
 *  the row is omitted — never a zero-length bar pretending we measured. */
export type PillarId = 'heritage' | 'nature' | 'living';
export interface PillarBar {
  id: PillarId;
  label: string;
  /** 0–1 against the country maximum. Null means the pillar was not scored. */
  share: number | null;
}

function share01(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function pillars(p: Place, opts: { livability?: 'scored' | 'unscored' } = {}): PillarBar[] {
  const living = opts.livability === 'unscored' ? null : share01(p.liv);
  return [
    { id: 'heritage', label: 'Built heritage', share: share01(p.h) },
    { id: 'nature', label: 'Natural setting', share: share01(p.n) },
    { id: 'living', label: 'Living culture', share: living },
  ];
}

/** Travel effort only when reach was actually computed (doc 5 §5.3).
 *  `"near"` is the dummy the bundle used to ship for every place — absence. */
export function travelEffort(reach?: string): string | null {
  if (!reach || reach === 'near') return null;
  if (reach === 'mid') return 'A few hours from an international gateway.';
  if (reach === 'far') return 'A day’s travel from an international gateway.';
  if (reach === 'remote') return 'Remote from international gateways.';
  return null;
}

/** Doc 5 §5.1. The country sheet names a dispute without drawing a claim. */
export const DISPUTED_NOTE =
  'Some places sit in territory whose sovereignty is disputed. We do not draw that border.';

/** The standing line, shown beside the sentence: score is a country-relative
 *  number and the interface never lets it be read as a world ranking. */
export function standing(p: Place): string {
  const rank = p.on_printed_map && p.printed_rank
    ? ` It is number ${p.printed_rank} of the places in ${p.country} that reach the printed map.`
    : ' It does not reach the printed map, which is a question of hole spacing rather than of merit.';
  const rel = p.score >= 100
    ? `Nothing in ${p.country} scores higher.`
    : `It scores ${p.score} of 100 against the top place in ${p.country}.`;
  return rel + rank;
}
