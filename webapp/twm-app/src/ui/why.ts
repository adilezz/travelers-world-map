/**
 * "Why it is here" — doc 2 §8.
 *
 * Not decoration. A traveler who disagrees with a place's presence will trust
 * the whole database less unless the model can explain itself in one sentence,
 * and a sentence that reads oddly is a scoring bug with a human-readable
 * symptom. So it is derived strictly from `sources[]` and `whs`, and it never
 * says anything the provenance does not support.
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
  if (!parts.length) {
    // A place with a name, coordinates and one kind is still a legitimate row
    // (doc 3 §9). Thin data is not an error and must not read like one.
    return 'It is in the database on its name and position alone. That is thin, '
      + 'and worth telling us about.';
  }
  const subject = p.is_site ? 'This site' : 'This place';
  const list = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${subject} is here for ${list}.`;
}

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
