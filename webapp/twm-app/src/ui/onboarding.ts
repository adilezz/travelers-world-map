/**
 * Onboarding, and bulk marking.
 *
 * The first ninety seconds have to produce a moment of recognition, not a form
 * (doc 2 §10). The map is already there and already populated behind this; no
 * sign-up wall, and it is dismissible at every step.
 *
 * Bulk marking is the critical path, not a nice-to-have (doc 4 §15): someone
 * with thirty years of travel behind them will not tap two hundred pins one at
 * a time, and if we cannot capture that history they leave before the point of
 * the product lands.
 */
import { el, clear, announce } from './dom';
import { gapSentence } from '../core/kinds';
import { coverage } from '../core/coverage';
import type { CountryIndexEntry, KindCode, Pin } from '../core/types';

export interface OnboardHooks {
  markMany(ids: string[]): void;
  scopeCountry(iso3: string): void;
  done(): void;
  keepSafe?: () => void;
}

export class Onboarding {
  private root: HTMLElement;
  private chosen = new Set<string>();
  private step: 'countries' | 'places' | 'reveal' = 'countries';
  private focusCountry: string | null = null;
  private suggested = new Set<string>();
  private lastFocus: Element | null = null;

  constructor(
    private countries: CountryIndexEntry[],
    private byCountry: Map<string, Pin[]>,
    private visited: ReadonlySet<string>,
    private labels: Record<KindCode, string>,
    private hooks: OnboardHooks,
  ) {
    this.root = el('div', {
      class: 'onboard', role: 'dialog', 'aria-modal': 'true',
      'aria-label': 'Set up your map',
    });
  }

  open(host: HTMLElement) {
    this.lastFocus = document.activeElement;
    host.append(this.root);
    this.render();
    this.root.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') this.close();
    });
    // Focus is never trapped by accident and never lost (doc 3 §11).
    requestAnimationFrame(() => this.root.querySelector<HTMLElement>('input, button')?.focus());
  }

  close() {
    this.root.remove();
    (this.lastFocus as HTMLElement | null)?.focus?.();
    this.hooks.done();
  }

  private render() {
    clear(this.root);
    const card = el('div', { class: 'onboard-card' });
    card.append(el('button', {
      class: 'icon-btn onboard-close', type: 'button',
      'aria-label': 'Skip setup', text: '✕', onclick: () => this.close(),
    }));
    if (this.step === 'countries') this.renderCountries(card);
    else if (this.step === 'places') this.renderPlaces(card);
    else this.renderReveal(card);
    this.root.append(card);
  }

  // Step 1 — one question, and it is answerable in under a minute.
  private renderCountries(card: HTMLElement) {
    card.append(
      el('p', { class: 'onboard-kicker', text: 'One question' }),
      el('h2', { class: 'onboard-title', text: 'Which countries have you been to?' }),
      el('p', { class: 'onboard-sub', text:
        'Tap as many as you like. Nothing is saved anywhere but this browser '
        + 'until you decide otherwise.' }),
    );

    const grid = el('div', { class: 'country-grid', role: 'group', 'aria-label': 'Countries' });
    const paint = (q = '') => {
      clear(grid);
      const list = this.countries
        .filter((c) => !q || c.country.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => a.country.localeCompare(b.country));
      for (const c of list.slice(0, 400)) {
        grid.append(el('button', {
          class: 'country-chip' + (this.chosen.has(c.iso3) ? ' is-on' : ''),
          type: 'button', 'aria-pressed': String(this.chosen.has(c.iso3)),
          onclick: (e: Event) => {
            this.chosen.has(c.iso3) ? this.chosen.delete(c.iso3) : this.chosen.add(c.iso3);
            (e.currentTarget as HTMLElement).classList.toggle('is-on');
            (e.currentTarget as HTMLElement).setAttribute(
              'aria-pressed', String(this.chosen.has(c.iso3)));
            count.textContent = summary(this.chosen.size);
            next.disabled = this.chosen.size === 0;
          },
        }, el('span', { text: c.country }),
           el('span', { class: 'mono muted', text: String(c.places) })));
      }
    };

    const search = el('input', {
      type: 'search', class: 'onboard-search', placeholder: 'Find a country',
      'aria-label': 'Find a country',
      oninput: (e: Event) => paint((e.target as HTMLInputElement).value),
    });
    const count = el('p', { class: 'muted small', text: summary(0) });
    const next = el('button', {
      class: 'primary', type: 'button', disabled: true, text: 'Next',
      onclick: () => {
        this.focusCountry = [...this.chosen]
          .map((iso3) => this.countries.find((c) => c.iso3 === iso3)!)
          .sort((a, b) => b.places - a.places)[0]?.iso3 ?? null;
        this.step = 'places';
        this.render();
      },
    });

    card.append(search, grid, el('div', { class: 'onboard-foot' }, count,
      el('button', { class: 'link-btn', type: 'button', text: 'Skip', onclick: () => this.close() }),
      next));
    paint();
  }

  // Step 2 — bulk marking, with the obvious ones already suggested. Suggested,
  // not assumed: the traveler unticks what they have not seen, which is faster
  // than ticking what they have and does not put words in their mouth.
  private renderPlaces(card: HTMLElement) {
    const iso3 = this.focusCountry!;
    const entry = this.countries.find((c) => c.iso3 === iso3)!;
    const pins = [...(this.byCountry.get(iso3) ?? [])].sort((a, b) => b.score - a.score);
    const obvious = pins.filter((p) => p.onPrintedMap).slice(0, 24);
    if (!this.suggested.size) for (const p of obvious) this.suggested.add(p.id);

    card.append(
      el('p', { class: 'onboard-kicker', text: `${entry.country} · the one you have most of` }),
      el('h2', { class: 'onboard-title', text: 'Which of these have you seen?' }),
      el('p', { class: 'onboard-sub', text:
        'The obvious ones are already ticked. Untick anything you have not been '
        + 'to — it is quicker than starting from nothing, and you can change any '
        + 'of it later.' }),
    );

    const list = el('div', { class: 'suggest-list' });
    for (const p of obvious) {
      list.append(el('label', { class: 'suggest' },
        el('input', {
          type: 'checkbox', checked: this.suggested.has(p.id),
          onchange: (e: Event) => {
            (e.target as HTMLInputElement).checked
              ? this.suggested.add(p.id) : this.suggested.delete(p.id);
          },
        }),
        el('span', { class: 'suggest-name', text: p.name }),
        el('span', { class: 'mono muted', text: p.score >= 100 ? 'top' : String(p.score) }),
      ));
    }

    card.append(list, el('div', { class: 'onboard-foot' },
      el('button', {
        class: 'link-btn', type: 'button', text: 'Back',
        onclick: () => { this.step = 'countries'; this.render(); },
      }),
      el('button', {
        class: 'primary', type: 'button', text: 'Mark these',
        onclick: () => {
          this.hooks.markMany([...this.suggested]);
          announce(`${this.suggested.size} places marked in ${entry.country}.`);
          this.step = 'reveal';
          this.render();
        },
      }),
    ));
  }

  // Step 3 — the moment the product either lands or does not.
  private renderReveal(card: HTMLElement) {
    const iso3 = this.focusCountry!;
    const entry = this.countries.find((c) => c.iso3 === iso3)!;
    const pins = this.byCountry.get(iso3) ?? [];
    const cov = coverage(pins, this.visited);
    const sentence = gapSentence(cov.unseen, this.labels);

    card.append(
      el('p', { class: 'onboard-kicker', text: entry.country }),
      el('h2', { class: 'onboard-title mono big',
        text: `${cov.seenKinds} of ${cov.availableKinds}` }),
      el('p', { class: 'onboard-sub', text: 'kinds of place seen here' }),
      el('p', { class: 'gap-sentence big', text: sentence
        || `Every kind of place ${entry.country} has is on your record.` }),
      el('p', { class: 'onboard-sub', text:
        'That is what this map is for. Not how many countries — which kinds of '
        + 'place you have never been to.' }),
      el('p', { class: 'onboard-sub', text:
        'An account would keep this record safe across devices. Until that '
        + 'exists, export a file — it is readable without this product.' }),
      el('div', { class: 'onboard-foot' },
        el('button', {
          class: 'link-btn', type: 'button', text: 'Export a copy',
          onclick: () => this.hooks.keepSafe?.(),
        }),
        el('button', {
          class: 'primary', type: 'button', text: `Open ${entry.country}`,
          onclick: () => { this.hooks.scopeCountry(iso3); this.close(); },
        }),
      ),
    );
  }
}

const summary = (n: number) =>
  n === 0 ? 'None chosen yet' : `${n} ${n === 1 ? 'country' : 'countries'} chosen`;
