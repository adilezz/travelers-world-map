/**
 * Kinds of place.
 *
 * Twelve codes exist in the database; the interface never shows one, and never
 * says the word "archetype" — doc 3 §13 is explicit. Labels come from the
 * manifest so the seven kinds that are empty today light up on the next build
 * without a code change (nothing here hardcodes the five that have data).
 *
 * Kinds are distinguished by shape and label, never by colour (doc 3 §3.2):
 * twelve categorical colours cannot be made accessible and would compete with
 * the accent for meaning.
 */
import type { KindCode } from './types';

export const ALL_KINDS: KindCode[] = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12',
];

export const bit = (code: KindCode) => 1 << (Number(code.slice(1)) - 1);

export const hasKind = (mask: number, code: KindCode) => (mask & bit(code)) !== 0;

export function kindsOf(mask: number): KindCode[] {
  return ALL_KINDS.filter((k) => hasKind(mask, k));
}

export function maskOf(codes: Iterable<KindCode>): number {
  let m = 0;
  for (const c of codes) m |= bit(c);
  return m;
}

/** A distinct glyph per kind. Shape, not colour — and legible at 11px in a
 *  meter row. Deliberately geometric rather than pictorial: an icon of a
 *  mountain invites a traveler to read the kind as a photograph of one. */
export const KIND_GLYPH: Record<KindCode, string> = {
  A1: '◆', A2: '◇', A3: '≈', A4: '▲', A5: '▬', A6: '❖',
  A7: '∿', A8: '◭', A9: '✦', A10: '✧', A11: '▦', A12: '▮',
};

/** Short forms for chips, where the full label does not fit. The full label is
 *  always available as the accessible name. */
export const KIND_SHORT: Record<KindCode, string> = {
  A1: 'Historic capital',
  A2: 'Old town',
  A3: 'Coastal',
  A4: 'High mountain',
  A5: 'Desert & steppe',
  A6: 'Forest & jungle',
  A7: 'Lake & river',
  A8: 'Volcanic',
  A9: 'Wildlife',
  A10: 'Sacred',
  A11: 'Rural',
  A12: 'Metropolis',
};

/** The gap sentence — the most important text in the product (doc 3 §8).
 *  Lower-cased labels because it reads as prose, not as a legend. */
export function gapSentence(
  unseen: KindCode[],
  labels: Record<KindCode, string>,
): string {
  if (!unseen.length) return '';
  const names = unseen.map((k) => labels[k].toLowerCase().replace(' / ', ' or '));
  if (names.length === 1) return `Still unseen: ${names[0]}.`;
  if (names.length === 2) return `Still unseen: ${names[0]} and ${names[1]}.`;
  return `Still unseen: ${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}.`;
}
