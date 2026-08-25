/**
 * Filters, and the passport.
 *
 * One state, both surfaces (doc 2 §5). Nothing here decides what to draw; it
 * only edits the state that the map and the register both read.
 *
 * Best months are shown when any pin carries a month mask. The score band
 * appears only once a single country is in scope, since score is
 * country-relative and a world-wide band would be nonsense.
 */
import { el, clear } from './dom';
import { ALL_KINDS, KIND_GLYPH } from '../core/kinds';
import { ENTRY_GLYPH, ENTRY_LABEL, ENTRY_ORDER, OPEN_ON_ARRIVAL } from '../core/passport';
import {
  DENSITY_CHOICES, DENSITY_MAX, DENSITY_WARNING, clampDensity, isActive,
  type SearchHit,
} from '../core/filters';
import type { EntryState, Filters, KindCode, Scope } from '../core/types';

export interface FilterHooks {
  change(patch: Partial<Filters>): void;
  clearAll(): void;
  pickPassport(iso3: string | null): void;
  /** Choosing a hit opens the sheet and does not move the camera (doc 5 §4.5). */
  pickSearch(hit: SearchHit): void;
}

export class FilterBar {
  private root: HTMLElement;
  private passports: { iso3: string; name: string; free: number }[] = [];
  /** Keep the density panel open across a cap change so releasing the
   *  slider does not dismiss the control the traveler is using. */
  private densityOpen = false;

  constructor(private host: HTMLElement, private hooks: FilterHooks,
              private labels: Record<KindCode, string>) {
    this.root = el('div', { class: 'filters' });
    this.host.append(this.root);
  }

  setPassportList(list: { iso3: string; name: string; free: number }[]) {
    this.passports = list;
  }

  render(f: Filters, scope: Scope, opts: {
    seasonalityAvailable: boolean;
    passportName?: string;
    uncoveredInView?: number;
    coverageCount?: string;
    coverageCountTitle?: string;
    coverageSentence?: string;
    searchHits?: SearchHit[];
    searchQuery?: string;
  }) {
    // Collapse puts `on-map` on the host; keep it on this root so a later
    // render cannot leave the overlay class only on the panel-block wrapper.
    this.root.classList.toggle('on-map', this.host.classList.contains('on-map'));
    document.querySelectorAll('.map-wrap > .filter-more-pop, .map-wrap > .search-hits').forEach((n) => n.remove());
    const typing = document.activeElement;
    const keepSearch = typing instanceof HTMLInputElement
      && typing.type === 'search' && this.root.contains(typing);
    const caret = keepSearch ? [typing.selectionStart, typing.selectionEnd] as const : null;
    clear(this.root);

    const onMap = this.host.classList.contains('on-map');

    const seg = (label: string, value: Filters['visited']) => el('button', {
      class: 'seg' + (f.visited === value ? ' is-on' : ''),
      type: 'button', 'aria-pressed': String(f.visited === value),
      text: label,
      onclick: () => this.hooks.change({ visited: value }),
    });

    if (onMap && opts.coverageSentence) {
      this.root.append(el('div', { class: 'coverage-compact' },
        opts.coverageCount
          ? el('p', {
            class: 'coverage-compact-count',
            text: opts.coverageCount,
            title: opts.coverageCountTitle ?? opts.coverageCount,
          })
          : null,
        el('p', {
          class: 'gap-sentence compact',
          text: opts.coverageSentence,
          title: opts.coverageSentence,
        }),
      ));
    }

    this.root.append(el('div', { class: 'filter-row' },
      el('div', { class: 'segmented', role: 'group', 'aria-label': 'Visited' },
        seg('All', 'all'),
        // Not-visited is the default working state for planning (doc 2 §5).
        seg('Not visited', 'no'),
        seg('Visited', 'yes'),
      ),
      el('label', { class: 'search' },
        el('span', { class: 'sr-only', text: 'Search places, regions and countries' }),
        el('input', {
          type: 'search',
          placeholder: onMap ? 'Search' : 'Search places, regions, countries',
          value: f.search,
          oninput: (e: Event) => this.hooks.change({
            search: (e.target as HTMLInputElement).value,
          }),
        }),
      ),
    ));
    if (onMap && opts.searchHits) {
      this.root.append(this.hitList(opts.searchHits, opts.searchQuery ?? f.search));
    }

    const searching = onMap && !!opts.searchHits;
    if (searching) this.densityOpen = false;

    if (!searching) {
      this.root.append(this.passportBlock(f, opts));
    }

    // Kinds. Twelve chips, driven from the manifest, so the seven that are
    // empty today appear as soon as their data lands.
    const kinds = el('div', { class: 'chips', role: 'group', 'aria-label': 'Kind of place' },
      ...ALL_KINDS.map((k) => el('button', {
        class: 'chip' + (f.kinds.has(k) ? ' is-on' : ''),
        type: 'button', 'aria-pressed': String(f.kinds.has(k)),
        'data-kind': k,
        onclick: () => {
          const next = new Set(f.kinds);
          next.has(k) ? next.delete(k) : next.add(k);
          this.hooks.change({ kinds: next });
        },
      }, el('span', { class: 'kg', 'aria-hidden': 'true', text: KIND_GLYPH[k] }),
         el('span', { text: this.labels[k] }))),
    );

    const extra: HTMLElement[] = [kinds];
    if (!onMap) extra.unshift(this.densityBlock(f));
    extra.unshift(el('div', { class: 'chips', role: 'group', 'aria-label': 'World Heritage' },
      el('button', {
        class: 'chip' + (f.whsOnly ? ' is-on' : ''), type: 'button',
        'aria-pressed': String(f.whsOnly), text: 'World Heritage',
        onclick: () => this.hooks.change({ whsOnly: !f.whsOnly }),
      }),
    ));
    extra.push(el('div', { class: 'chips', role: 'group', 'aria-label': 'Other filters' },
      el('button', {
        class: 'chip' + (f.printedOnly ? ' is-on' : ''), type: 'button',
        'aria-pressed': String(f.printedOnly), text: 'On the printed map',
        onclick: () => this.hooks.change({ printedOnly: !f.printedOnly }),
      }),
    ));

    if (opts.seasonalityAvailable) {
      extra.push(el('div', { class: 'chips', role: 'group', 'aria-label': 'Best months' },
        el('span', { class: 'filter-kicker', text: 'Best months' }),
        ...MONTHS.map((label, i) => {
          const mo = i + 1;
          return el('button', {
            class: 'chip' + (f.months.has(mo) ? ' is-on' : ''),
            type: 'button', 'aria-pressed': String(f.months.has(mo)),
            text: label,
            title: `Typically better in ${MONTH_FULL[i]}`,
            onclick: () => {
              const next = new Set(f.months);
              next.has(mo) ? next.delete(mo) : next.add(mo);
              this.hooks.change({ months: next });
            },
          });
        }),
      ));
    }

    // Score band: only when a single country is in scope. The constraint is
    // the explanation — a band that cannot be applied across borders is never
    // offered across borders (doc 1 §3).
    if (scope.kind === 'country') {
      extra.push(el('div', { class: 'filter-row band' },
        el('label', { class: 'band-label', for: 'scoreband' },
          el('span', { text: 'Score, within this country' }),
          el('span', { class: 'mono band-value', text: f.scoreMin === 0 ? 'any' : `${f.scoreMin}+` }),
        ),
        el('input', {
          id: 'scoreband', type: 'range', min: '0', max: '95', step: '5',
          value: String(f.scoreMin),
          oninput: (e: Event) => this.hooks.change({
            scoreMin: Number((e.target as HTMLInputElement).value),
          }),
        }),
      ));
    }

    if (isActive(f)) {
      extra.push(el('div', { class: 'filter-row' },
        el('button', {
          class: 'link-btn', type: 'button', text: 'Clear filters',
          onclick: () => this.hooks.clearAll(),
        }),
      ));
    }

    // On the map the twelve chips are a disclosure so the globe stays the
    // interface. Density is its own control (doc 5 §4.1, interface PDF p.2).
    // Hits take that slot while searching, so the name stays on the card.
    if (onMap && !searching) {
      const pop = el('div', { class: 'filter-more-pop', id: 'kind-pop' }, ...extra);
      const more = el('details', {
        class: 'filter-more',
        open: f.kinds.size > 0 || f.printedOnly || f.months.size > 0
          || f.scoreMin > 0,
      },
        el('summary', { text: 'Kinds of place' }),
        pop,
      );
      const n = clampDensity(f.densityPerCountry);
      const densityPop = el('div', { class: 'filter-more-pop', id: 'density-pop' },
        this.densityBlock(f));
      const density = el('details', {
        class: 'filter-density',
        'aria-label': 'Places per country',
        open: this.densityOpen,
      },
        el('summary', {
          text: 'Density',
          title: n === 0 ? 'All that pass' : `${n} per country`,
          'aria-label': n === 0
            ? 'Places per country: all that pass'
            : `Places per country: ${n}`,
        }),
        densityPop,
      );
      const closeSibling = (open: HTMLDetailsElement, other: HTMLDetailsElement) => {
        if (open.open && other.open) other.open = false;
      };
      more.addEventListener('toggle', () => {
        closeSibling(more, density);
        placeFilterPop(more);
      });
      density.addEventListener('toggle', () => {
        this.densityOpen = density.open;
        closeSibling(density, more);
        placeFilterPop(density);
      });
      const searchRow = this.root.querySelector('.filter-row');
      const compact = this.root.querySelector('.coverage-compact');
      const host = searchRow ?? compact;
      if (host) {
        host.after(density);
        host.after(more);
      } else {
        this.root.prepend(density);
        this.root.prepend(more);
      }
      if (more.open) queueMicrotask(() => placeFilterPop(more));
      if (density.open) queueMicrotask(() => placeFilterPop(density));
    } else if (!onMap) {
      for (const n of extra) this.root.append(n);
    }

    if (keepSearch) {
      const input = this.root.querySelector<HTMLInputElement>('input[type=search]');
      input?.focus();
      if (input && caret && caret[0] != null) input.setSelectionRange(caret[0], caret[1] ?? caret[0]);
    }
  }

  /** Marking must not rebuild the card (doc 4 §11). The sentence still has
   *  to move: it is the product, and a stale Still unseen is a lie. */
  setCoverage(sentence: string, count?: string, countTitle?: string) {
    const gap = this.root.querySelector('.gap-sentence.compact');
    if (gap) {
      gap.textContent = sentence;
      gap.setAttribute('title', sentence);
    }
    const n = this.root.querySelector('.coverage-compact-count');
    if (n && count) {
      n.textContent = count;
      n.setAttribute('title', countTitle ?? count);
    }
  }

  private hitList(hits: SearchHit[], query: string) {
    const list = el('div', {
      class: 'search-hits',
      role: 'listbox',
      'aria-label': 'Matching places, regions and countries',
    });
    if (!hits.length) {
      const q = query.trim();
      list.append(el('p', {
        class: 'muted small search-empty',
        text: q
          ? `Nothing matches “${q}”.`
          : 'Nothing matches these filters.',
      }));
      list.append(el('button', {
        class: 'link-btn', type: 'button', text: 'Clear filters',
        onclick: () => this.hooks.clearAll(),
      }));
      return list;
    }
    const kindLabel = { place: 'Place', region: 'Region', country: 'Country' };
    for (const h of hits) {
      list.append(el('button', {
        class: 'search-hit',
        type: 'button',
        role: 'option',
        'data-kind': h.kind,
        'data-place': h.kind === 'place' ? h.id : undefined,
        'data-id': h.id,
        onclick: () => this.hooks.pickSearch(h),
      },
        el('span', { class: 'suggest-name', text: h.name }),
        el('span', { class: 'muted small', text: `${kindLabel[h.kind]} · ${h.country}` }),
      ));
    }
    return list;
  }

  private densityBlock(f: Filters) {
    const n = clampDensity(f.densityPerCountry);
    const shown = n === 0 ? 'All that pass' : `${n} per country`;
    return el('div', { class: 'density', 'aria-label': 'Places per country' },
      el('label', { class: 'band-label', for: 'density-pick' },
        el('span', { text: 'How many places to show per country' }),
        el('span', { class: 'mono band-value', text: shown }),
      ),
      el('input', {
        id: 'density-pick',
        type: 'range',
        min: '0',
        max: String(DENSITY_MAX),
        step: '1',
        value: String(n),
        list: 'density-ticks',
        title: DENSITY_WARNING,
        'aria-valuemin': '0',
        'aria-valuemax': String(DENSITY_MAX),
        'aria-valuenow': String(n),
        'aria-valuetext': shown,
        onchange: (e: Event) => this.hooks.change({
          densityPerCountry: clampDensity(
            Number((e.target as HTMLInputElement).value),
          ),
        }),
      }),
      el('datalist', { id: 'density-ticks' },
        ...DENSITY_CHOICES.map((v) => el('option', { value: String(v) }))),
      el('p', { class: 'note density-warning', text: DENSITY_WARNING }),
    );
  }

  private passportBlock(f: Filters, opts: { passportName?: string; uncoveredInView?: number }) {
    const wrap = el('div', { class: 'passport' });
    const select = el('select', {
      id: 'passport-pick',
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        this.hooks.pickPassport(v || null);
      },
    }, el('option', { value: '', text: 'No passport chosen' }),
       ...this.passports.map((p) => el('option', {
         value: p.iso3, selected: f.passport === p.iso3, text: p.name,
       })));

    wrap.append(el('div', { class: 'filter-row' },
      el('label', { class: 'passport-label', for: 'passport-pick', text: 'Passport' }),
      select,
    ));

    if (f.passport) {
      wrap.append(el('div', { class: 'chips', role: 'group', 'aria-label': 'Entry requirement' },
        el('button', {
          class: 'chip' + (setsEqual(f.entryStates, new Set(OPEN_ON_ARRIVAL)) ? ' is-on' : ''),
          type: 'button', text: 'Could just go',
          title: 'No visa needed, or a visa on arrival',
          onclick: () => this.hooks.change({
            entryStates: setsEqual(f.entryStates, new Set(OPEN_ON_ARRIVAL))
              ? new Set<EntryState>() : new Set(OPEN_ON_ARRIVAL),
          }),
        }),
        ...ENTRY_ORDER.map((s) => el('button', {
          class: 'chip chip-entry' + (f.entryStates.has(s) ? ' is-on' : ''),
          type: 'button', 'aria-pressed': String(f.entryStates.has(s)),
          onclick: () => {
            const next = new Set(f.entryStates);
            next.has(s) ? next.delete(s) : next.add(s);
            this.hooks.change({ entryStates: next });
          },
        }, el('span', { class: 'kg', 'aria-hidden': 'true', text: ENTRY_GLYPH[s] }),
           el('span', { text: ENTRY_LABEL[s] }))),
      ));

      // Honesty about coverage: 37 dependencies and overseas territories are
      // not in the index, and several of them plainly do not follow their
      // sovereign state's policy. Saying so beats guessing.
      if (opts.uncoveredInView) {
        wrap.append(el('p', { class: 'note', text:
          `${opts.uncoveredInView} ${opts.uncoveredInView === 1 ? 'country is' : 'countries are'} `
          + 'not in the passport index, so no requirement is stated for them.' }));
      }
      wrap.append(el('p', { class: 'note', text:
        'A planning snapshot, not legal advice. The destination’s own mission '
        + 'is the authority.' }));
    }
    return wrap;
  }

}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function placeFilterPop(details: HTMLDetailsElement) {
  const fallback = details.classList.contains('filter-density')
    ? 'density-pop' : 'kind-pop';
  const pop = (details.querySelector('.filter-more-pop')
    ?? document.getElementById(fallback)) as HTMLElement | null;
  const sum = details.querySelector('summary');
  const wrap = details.closest('.map-wrap') ?? document.querySelector('.map-wrap');
  if (!pop || !sum || !wrap) return;
  if (!details.open) {
    details.append(pop);
    return;
  }
  // Park the panel on .map-wrap (position: relative, overflow visible) so
  // the card's overflow: hidden cannot clip it. top/left are wrap-relative.
  const wr = wrap.getBoundingClientRect();
  const r = sum.getBoundingClientRect();
  wrap.append(pop);
  const maxW = Math.min(340, Math.max(200, wrap.clientWidth - 16));
  const maxH = wrap.clientWidth <= 1023 ? Math.min(156, Math.round(wrap.clientHeight * 0.36)) : 240;
  pop.style.top = `${Math.round(r.bottom - wr.top + 4)}px`;
  pop.style.left = `${Math.round(Math.max(8, r.left - wr.left))}px`;
  pop.style.width = `${Math.round(Math.min(maxW, Math.max(r.width, 200)))}px`;
  pop.style.maxHeight = `${maxH}px`;
}

function setsEqual<T>(a: Set<T>, b: Set<T>) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}
