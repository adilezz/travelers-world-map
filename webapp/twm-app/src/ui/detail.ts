/**
 * The detail panel — one panel, three scopes.
 *
 * Clicking a country, a tile or a place opens the same surface with a
 * different scope, and each answers the same question at its own level: what
 * is here, and what have I not seen here.
 *
 * A side panel on desktop, a bottom sheet on mobile, dismissible without
 * losing map position (doc 2 §8).
 */
import { el, clear, scoreText, fmtInt, announce } from './dom';
import { KIND_GLYPH, gapSentence } from '../core/kinds';
import { coverage } from '../core/coverage';
import { entrySentence, ENTRY_TONE } from '../core/passport';
import { haversine } from '../core/filters';
import { whyItIsHere, standing } from './why';
import type {
  CountryIndexEntry, Entry, KindCode, Pin, Place, Territory,
} from '../core/types';

export interface DetailHooks {
  toggle(id: string): void;
  open(id: string): void;
  scopeCountry(iso3: string): void;
  scopeTerritory(id: string): void;
  close(): void;
  hover(id: string | null): void;
  /** The camera moves only when the traveler asks it to (doc 3 §6.1). This is
   *  that ask, and the only thing in the interface wired to it. */
  showOnMap(points: { lat: number; lon: number }[]): void;
  annotate(id: string, patch: { visited_on?: string; note?: string }): void;
  addToTrip(id: string): void;
  tripTitle?: () => string | null;
  bulkMark(pins: Pin[], title: string): void;
}

export class Detail {
  constructor(
    private host: HTMLElement,
    private hooks: DetailHooks,
    private labels: Record<KindCode, string>,
  ) {}

  private frame(title: string, kicker: string, body: HTMLElement) {
    clear(this.host);
    this.host.append(
      el('div', { class: 'detail-head' },
        el('div', { class: 'detail-kicker', text: kicker }),
        el('h2', { class: 'detail-title', text: title }),
        el('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Close detail',
          text: '✕', onclick: () => this.hooks.close(),
        }),
      ),
      body,
    );
    this.host.hidden = false;
  }

  empty() {
    this.host.hidden = true;
    clear(this.host);
    this.showing = null;
  }

  /** The panel's own mark control has to answer its own tap. Re-rendering the
   *  whole panel would lose scroll position and focus, so the one control that
   *  changed is updated in place. */
  setMarked(id: string, visited: boolean) {
    if (this.showing !== id) return;
    const btn = this.host.querySelector<HTMLButtonElement>('.mark-control');
    if (!btn) return;
    btn.classList.toggle('is-on', visited);
    btn.setAttribute('aria-pressed', String(visited));
    const label = btn.querySelector('span:last-child');
    if (label) label.textContent = visited ? 'Marked as visited' : 'Mark as visited';
  }

  private showing: string | null = null;

  // ---- a place ----------------------------------------------------------

  place(p: Place, ctx: {
    visited: boolean; pins: Pin[]; visitedSet: ReadonlySet<string>;
    territoryName?: string; entry?: Entry; passportName?: string;
    visitedOn?: string; note?: string;
  }) {
    const kinds = p.archetypes;
    const body = el('div', { class: 'detail-body' });

    // Marking is the most repeated action in the product: large, unmistakable,
    // the same control everywhere it appears, one tap, no confirmation.
    body.append(el('button', {
      class: 'mark-control' + (ctx.visited ? ' is-on' : ''),
      type: 'button', 'aria-pressed': String(ctx.visited),
      onclick: () => this.hooks.toggle(p.place_id),
    },
      el('span', { class: 'mark-glyph', 'aria-hidden': 'true' }),
      el('span', { text: ctx.visited ? 'Marked as visited' : 'Mark as visited' }),
    ));

    body.append(el('button', {
      class: 'link-btn show-on-map', type: 'button',
      text: `Show ${p.name} on the map`,
      onclick: () => this.hooks.showOnMap([{ lat: p.lat, lon: p.lon }]),
    }));

    const tripName = this.hooks.tripTitle?.();
    body.append(el('button', {
      class: 'link-btn add-to-trip', type: 'button',
      text: tripName ? `Add to ${tripName}` : 'Add to a trip',
      onclick: () => this.hooks.addToTrip(p.place_id),
    }));

    // 1. Identity
    body.append(section('Identity', [
      row('Country', p.country, () => this.hooks.scopeCountry(isoOf(ctx.pins, p) ?? '')),
      p.territory_id
        ? row('Tile', ctx.territoryName ?? p.territory_id,
              () => this.hooks.scopeTerritory(p.territory_id!))
        : row('Tile', 'No tile — tiles only cover the parts of a country that carry a drilled hole'),
      row('Coordinates', `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`, undefined, true),
      row('Kind of feature', p.is_site ? 'A natural or archaeological site' : 'A settlement'),
    ]));

    // 2. Kinds, strongest first
    body.append(section('Kinds of place', [
      el('ul', { class: 'kind-list' },
        ...kinds.map((k, i) => el('li', {},
          el('span', { class: 'kind-glyph', 'aria-hidden': 'true', text: KIND_GLYPH[k] }),
          el('span', { class: 'kind-label', text: this.labels[k] }),
          el('span', { class: 'mono kind-weight',
            text: p.archetype_weights?.[i] != null ? p.archetype_weights[i].toFixed(2) : '' }),
        )),
      ),
    ]));

    // 3. Why it is here
    body.append(section('Why it is here', [
      el('p', { class: 'why', text: whyItIsHere(p) }),
      el('p', { class: 'muted small', text: `Built from ${p.sources.join(', ')}.` }),
    ]));

    // 4. Standing
    body.append(section('Standing', [
      el('p', { text: standing(p) }),
    ]));

    // 5. When to go — climate guidance, never a promise (doc 2 §8).
    body.append(section('When to go', [
      el('p', { text: whenToGo(p.best_months) }),
      el('p', { class: 'muted small', text:
        'A climate rule from the place’s latitude and season, not researched '
        + 'per-place seasonality.' }),
    ]));

    // Optional detail, never required (doc 2 §7): a date and a note.
    body.append(section('Your note', [
      el('label', { class: 'note-field' },
        el('span', { class: 'k', text: 'Visited on' }),
        el('input', {
          type: 'date', value: ctx.visitedOn ?? '',
          onchange: (e: Event) => this.hooks.annotate(p.place_id, {
            visited_on: (e.target as HTMLInputElement).value,
          }),
        }),
      ),
      el('label', { class: 'note-field' },
        el('span', { class: 'k', text: 'Note' }),
        el('textarea', {
          rows: '3', placeholder: 'Optional. Survives if you unmark by accident.',
          text: ctx.note ?? '',
          onchange: (e: Event) => this.hooks.annotate(p.place_id, {
            note: (e.target as HTMLTextAreaElement).value,
          }),
        }),
      ),
    ]));

    // Entry requirement, if a passport is chosen. Never in the accent.
    if (ctx.passportName) {
      body.append(section('Getting in', [
        el('p', {
          class: `entry-line entry-${ENTRY_TONE[ctx.entry?.r ?? 'vr']}`,
          text: entrySentence(ctx.entry, p.country, ctx.passportName),
        }),
      ]));
    }

    // 6. Nearby — other places within a day, and which of them are unvisited
    const near = ctx.pins
      .filter((q) => q.id !== p.place_id)
      .map((q) => ({ q, km: haversine({ lat: p.lat, lon: p.lon }, q) }))
      .filter((x) => x.km <= 120)
      .sort((a, b) => a.km - b.km)
      .slice(0, 8);
    if (near.length) {
      const unseen = near.filter((x) => !ctx.visitedSet.has(x.q.id)).length;
      body.append(section(`Nearby`, [
        el('p', { class: 'muted small',
          text: `${near.length} within a day’s reach · ${unseen} you have not marked` }),
        el('ul', { class: 'nearby' }, ...near.map((x) => el('li', {},
          el('button', {
            class: 'link-btn' + (ctx.visitedSet.has(x.q.id) ? ' is-visited' : ''),
            type: 'button', text: x.q.name,
            onmouseenter: () => this.hooks.hover(x.q.id),
            onmouseleave: () => this.hooks.hover(null),
            onclick: () => this.hooks.open(x.q.id),
          }),
          el('span', { class: 'mono muted', text: `${Math.round(x.km)} km` }),
        ))),
      ]));
    }

    // 7. Elsewhere — links out only. Our database never depends on a vendor
    //    (doc 2 §11): the traveler leaves for live hours and reviews.
    const q = encodeURIComponent(`${p.name} ${p.country}`);
    body.append(section('Elsewhere', [
      el('ul', { class: 'links' },
        link('Open in Maps', `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`),
        link('OpenStreetMap', `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=12/${p.lat}/${p.lon}`),
        link('Wikipedia', `https://en.wikipedia.org/w/index.php?search=${q}`),
        link('Wikimedia Commons', `https://commons.wikimedia.org/w/index.php?search=${q}`),
      ),
      el('button', {
        class: 'link-btn quiet', type: 'button',
        text: 'This place does not belong here',
        onclick: () => reportDispute(p),
      }),
    ]));

    this.showing = p.place_id;
    this.frame(p.name, p.country, body);
  }

  /** Every scope answers the same question at its own level. Without this the
   *  country panel is a fact sheet, and the fact sheet is not the product. */
  private gapBlock(pins: Pin[], visited: ReadonlySet<string>, scopeLabel: string) {
    const cov = coverage(pins, visited);
    const sentence = gapSentence(cov.unseen, this.labels);
    return section('Coverage', [
      el('p', { class: 'coverage-headline' },
        el('span', { class: 'coverage-count mono',
          text: `${cov.seenKinds} of ${cov.availableKinds}` }),
        el('span', { class: 'coverage-unit', text: ' kinds of place seen' })),
      el('p', { class: 'gap-sentence', text: sentence
        || (cov.availableKinds === 0 ? 'No places here yet.'
            : `Every kind of place ${scopeLabel} has is on your record.`) }),
    ]);
  }

  // ---- a country --------------------------------------------------------

  country(entry: CountryIndexEntry, ctx: {
    pins: Pin[]; visited: ReadonlySet<string>; tiles: Territory[];
    entryReq?: Entry; passportName?: string;
  }) {
    const body = el('div', { class: 'detail-body' });
    const marked = ctx.pins.filter((p) => ctx.visited.has(p.id)).length;

    body.append(el('div', { class: 'stat-row' },
      stat(fmtInt(entry.places), entry.places === 1 ? 'place' : 'places'),
      stat(fmtInt(marked), 'marked'),
      stat(fmtInt(entry.holes), 'on the printed map'),
      stat(fmtInt(entry.tiles), entry.tiles === 1 ? 'tile' : 'tiles'),
    ));

    body.append(this.gapBlock(ctx.pins, ctx.visited, `in ${entry.country}`));
    body.append(el('button', {
      class: 'link-btn', type: 'button', text: `Show ${entry.country} on the map`,
      onclick: () => this.hooks.showOnMap(ctx.pins),
    }));
    body.append(el('button', {
      class: 'link-btn', type: 'button', text: 'Mark several at once',
      onclick: () => this.hooks.bulkMark(ctx.pins, entry.country),
    }));

    if (ctx.passportName) {
      body.append(section('Getting in', [
        el('p', {
          class: `entry-line entry-${ENTRY_TONE[ctx.entryReq?.r ?? 'vr']}`,
          text: entrySentence(ctx.entryReq, entry.country, ctx.passportName),
        }),
      ]));
    }

    // Top places. Tappable, and each row marks with the same control as
    // everywhere else.
    const top = [...ctx.pins].sort((a, b) => b.score - a.score).slice(0, 12);
    body.append(section('Highest scoring here', [
      el('ul', { class: 'mini-list' }, ...top.map((p) => miniRow(p, entry.country, ctx.visited,
        () => this.hooks.open(p.id), () => this.hooks.toggle(p.id),
        (on) => this.hooks.hover(on ? p.id : null)))),
    ]));

    if (ctx.tiles.length) {
      body.append(section('Tiles', [
        el('ul', { class: 'mini-list' }, ...ctx.tiles.slice(0, 20).map((t) => el('li', {},
          el('button', {
            class: 'link-btn', type: 'button', text: t.name,
            onclick: () => this.hooks.scopeTerritory(t.territory_id),
          }),
          el('span', { class: 'mono muted',
            text: `${t.app_places ?? t.places} places` }),
          t.printable ? null : el('span', { class: 'tag', text: 'Inset panel' }),
        ))),
      ]));
    } else {
      body.append(section('Tiles', [
        el('p', { class: 'muted small',
          text: 'No tiles here. Tiles only cover the parts of a country that '
              + 'carry a drilled hole.' }),
      ]));
    }

    this.showing = null;
    this.frame(entry.country, 'Country', body);
  }

  // ---- a tile -----------------------------------------------------------

  territory(t: Territory & { iso3: string }, ctx: {
    pins: Pin[]; visited: ReadonlySet<string>;
  }) {
    const body = el('div', { class: 'detail-body' });
    const marked = ctx.pins.filter((p) => ctx.visited.has(p.id)).length;

    body.append(el('div', { class: 'stat-row' },
      stat(fmtInt(ctx.pins.length), 'places'),
      stat(fmtInt(marked), 'marked'),
      stat(fmtInt(t.places), 'drilled holes'),
    ));

    body.append(el('p', {
      class: 'muted small',
      text: t.printable
        ? 'This tile is large enough to cut as a magnetic piece.'
        : 'Too small to cut — it becomes an inset panel on the printed map.',
    }));

    body.append(this.gapBlock(ctx.pins, ctx.visited, `on ${t.name}`));
    body.append(el('button', {
      class: 'link-btn', type: 'button', text: 'Show this tile on the map',
      onclick: () => this.hooks.showOnMap(ctx.pins),
    }));
    body.append(el('button', {
      class: 'link-btn', type: 'button', text: 'Mark several at once',
      onclick: () => this.hooks.bulkMark(ctx.pins, t.name),
    }));

    const top = [...ctx.pins].sort((a, b) => b.score - a.score).slice(0, 20);
    body.append(section('Places on this tile', [
      el('ul', { class: 'mini-list' }, ...top.map((p) => miniRow(p, t.country, ctx.visited,
        () => this.hooks.open(p.id), () => this.hooks.toggle(p.id),
        (on) => this.hooks.hover(on ? p.id : null)))),
    ]));

    body.append(el('button', {
      class: 'link-btn', type: 'button', text: `See all of ${t.country}`,
      onclick: () => this.hooks.scopeCountry(t.iso3),
    }));

    this.showing = null;
    this.frame(t.name, `Tile · ${t.country}`, body);
  }
}

// ---- pieces -------------------------------------------------------------

function section(title: string, kids: (Node | null)[]) {
  return el('section', { class: 'detail-section' },
    el('h3', { text: title }), ...kids.filter(Boolean) as Node[]);
}

function row(label: string, value: string, onClick?: () => void, mono = false) {
  return el('div', { class: 'kv' },
    el('span', { class: 'k', text: label }),
    onClick
      ? el('button', { class: 'link-btn v', type: 'button', text: value, onclick: onClick })
      : el('span', { class: `v${mono ? ' mono' : ''}`, text: value }),
  );
}

function stat(value: string, label: string) {
  return el('div', { class: 'stat' },
    el('div', { class: 'stat-value mono', text: value }),
    el('div', { class: 'stat-label', text: label }),
  );
}

function link(label: string, href: string) {
  return el('li', {}, el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: label }));
}

function miniRow(p: Pin, country: string, visited: ReadonlySet<string>,
                 open: () => void, toggle: () => void, hover: (on: boolean) => void) {
  const seen = visited.has(p.id);
  return el('li', {
    class: seen ? 'is-visited' : '',
    onmouseenter: () => hover(true), onmouseleave: () => hover(false),
  },
    el('button', {
      class: 'mark small', type: 'button', 'aria-pressed': String(seen),
      'aria-label': seen ? `Unmark ${p.name}` : `Mark ${p.name} as visited`,
      onclick: toggle,
    }, el('span', { class: `glyph ${p.isSite ? 'is-site' : ''}`, 'aria-hidden': 'true' })),
    el('button', { class: 'link-btn grow', type: 'button', text: p.name, onclick: open }),
    el('span', { class: 'mono muted', text: scoreText(p.score, country) }),
  );
}

const isoOf = (pins: Pin[], p: Place) =>
  pins.find((q) => q.id === p.place_id)?.iso3;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const monthName = (m: number) => MONTHS[(m - 1) % 12] ?? String(m);

function whenToGo(months: number[] | undefined): string {
  if (!months?.length) return 'We don’t know when to go.';
  if (months.length === 12) return 'Any month.';
  if (months.length === 1) return `Typically better in ${monthName(months[0])}.`;
  const names = months.map(monthName);
  return `Typically better in ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`;
}

/** Doc 4 §4: POST /feedback/place. Queued locally until the service exists —
 *  this is the earliest warning of a scoring bug and must not be dropped. */
function reportDispute(p: Place) {
  try {
    const key = 'twm.disputes.v1';
    const all = JSON.parse(localStorage.getItem(key) ?? '[]');
    all.push({ place_id: p.place_id, name: p.name, at: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(all));
  } catch { /* non-fatal */ }
  announce(`Noted: ${p.name} disputed. It stays on your map; we will look at the scoring.`);
}
