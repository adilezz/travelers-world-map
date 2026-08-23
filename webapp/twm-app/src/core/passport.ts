/**
 * Entry requirements.
 *
 * A property of a pair — this passport, that destination — not of a place. It
 * never touches a score, never enters the coverage meter, and never uses the
 * accent: the accent means visited and nothing else (doc 3 §3). A visa
 * requirement is restricted access, so it borrows the status family's
 * amber-brown, always with a word beside it (doc 3 §3.1).
 *
 * The dataset is a planning snapshot. The destination's own mission is the
 * authority, and the interface says so rather than implying we know.
 */
import type { Entry, EntryState } from './types';

export const ENTRY_ORDER: EntryState[] = ['vf', 'voa', 'ev', 'vr', 'na'];

export const ENTRY_LABEL: Record<EntryState, string> = {
  vf: 'No visa needed',
  voa: 'Visa on arrival',
  ev: 'Apply online first',
  vr: 'Apply in advance',
  na: 'No admission',
  home: 'Your own country',
};

/** How restrictive, for styling. Only the restricted end is coloured; "no visa
 *  needed" is plain ink, because colouring the good news would put a second
 *  meaning-bearing colour on the map. */
export const ENTRY_TONE: Record<EntryState, 'plain' | 'restricted' | 'error'> = {
  vf: 'plain', voa: 'plain', home: 'plain',
  ev: 'restricted', vr: 'restricted', na: 'error',
};

/** Glyph, so the state never depends on colour alone (doc 3 §11). */
export const ENTRY_GLYPH: Record<EntryState, string> = {
  vf: '○', voa: '◐', ev: '◑', vr: '●', na: '✕', home: '⌂',
};

export function entryText(e: Entry | undefined): string {
  if (!e) return 'Not in the passport index';
  const base = ENTRY_LABEL[e.r];
  if (e.r === 'vf' && e.d) return `${base} · ${e.d} days`;
  if (e.r === 'ev' && e.v === 'eta') return 'Travel authorisation first';
  return base;
}

/** The one-line answer a traveler wants in the country panel. */
export function entrySentence(e: Entry | undefined, country: string, passport: string): string {
  if (!e) {
    return `${country} is not covered by the passport index, so no entry `
      + 'requirement is stated here.';
  }
  if (e.r === 'home') return `${country} is your own passport's country.`;
  const days = e.r === 'vf' && e.d ? ` for up to ${e.d} days` : '';
  const how = {
    vf: 'no visa', voa: 'a visa on arrival', ev: e.v === 'eta'
      ? 'a travel authorisation applied for online' : 'an e-visa applied for online',
    vr: 'a visa applied for before travelling', na: 'no admission at present',
  }[e.r as Exclude<EntryState, 'home'>];
  return e.r === 'na'
    ? `${country} allows ${how} on a ${passport} passport.`
    : `${country} needs ${how}${days} on a ${passport} passport.`;
}

/** Which states a traveler means by "I could just go". eTA and e-visa are
 *  paperwork before the flight, so they are deliberately not in it. */
export const OPEN_ON_ARRIVAL: EntryState[] = ['vf', 'voa'];
