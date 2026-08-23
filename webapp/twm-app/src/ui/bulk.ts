/**
 * Bulk marking, reachable from a country or a tile at any time (doc 4 §15).
 *
 * Onboarding still does this once, for one country. This surface is the same
 * action without the first-run wrapper: a list, already-marked rows ticked,
 * one apply for the whole diff, and one undo.
 */
import { el, clear, scoreText } from './dom';
import { KIND_GLYPH, KIND_SHORT, kindsOf } from '../core/kinds';
import type { KindCode, Pin } from '../core/types';

export interface BulkHooks {
  apply(universe: string[], ticked: ReadonlySet<string>): { marked: number; unmarked: number };
  undo(): boolean;
  back(): void;
}

export class BulkMark {
  private all: Pin[] = [];
  private ticked = new Set<string>();
  private showAll = false;
  private applied = false;
  private country = '';
  private title = '';

  constructor(
    private host: HTMLElement,
    private labels: Record<KindCode, string>,
    private countryName: (iso3: string) => string,
    private hooks: BulkHooks,
  ) {}

  open(title: string, pins: Pin[], visited: ReadonlySet<string>) {
    this.title = title;
    this.all = [...pins].sort((a, b) => b.score - a.score);
    this.country = pins[0] ? this.countryName(pins[0].iso3) : title;
    this.ticked = new Set(pins.filter((p) => visited.has(p.id)).map((p) => p.id));
    this.showAll = false;
    this.applied = false;
    this.render();
  }

  private listed(): Pin[] {
    if (this.showAll) return this.all;
    const printed = this.all.filter((p) => p.onPrintedMap);
    return printed.length ? printed : this.all.slice(0, 24);
  }

  private render() {
    clear(this.host);
    const listed = this.listed();
    const body = el('div', { class: 'detail-body bulk' });

    body.append(el('p', { class: 'note', text:
      'Tick what you have seen. One apply writes the whole list. '
      + 'Already-marked places start ticked, because this edits a record.' }));

    if (!this.showAll && listed.length < this.all.length) {
      body.append(el('button', {
        class: 'link-btn', type: 'button',
        text: `Show all ${this.all.length} places`,
        onclick: () => { this.showAll = true; this.render(); },
      }));
    }

    const list = el('div', {
      class: 'bulk-list', role: 'group',
      'aria-label': `Places in ${this.title}`,
    });
    for (const p of listed) list.append(this.row(p));
    body.append(list);

    const foot = el('div', { class: 'onboard-foot' });
    foot.append(el('button', {
      class: 'link-btn', type: 'button', text: 'Back',
      onclick: () => this.hooks.back(),
    }));
    if (this.applied) {
      foot.append(el('button', {
        class: 'link-btn', type: 'button', text: 'Undo that',
        onclick: () => {
          if (!this.hooks.undo()) return;
          this.applied = false;
          this.render();
        },
      }));
    }
    foot.append(el('button', {
      class: 'primary bulk-apply', type: 'button', text: 'Apply',
      onclick: () => {
        this.hooks.apply(listed.map((p) => p.id), this.ticked);
        this.applied = true;
        this.render();
      },
    }));
    body.append(foot);

    this.host.append(
      el('div', { class: 'detail-head' },
        el('div', { class: 'detail-kicker', text: 'Mark several at once' }),
        el('h2', { class: 'detail-title', text: this.title }),
        el('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Close',
          text: '✕', onclick: () => this.hooks.back(),
        }),
      ),
      body,
    );
    this.host.hidden = false;
  }

  private row(p: Pin) {
    const on = this.ticked.has(p.id);
    const kinds = kindsOf(p.kinds);
    const box = el('input', {
      type: 'checkbox', checked: on,
      'aria-label': `Visited: ${p.name}`,
      onchange: (e: Event) => {
        (e.target as HTMLInputElement).checked
          ? this.ticked.add(p.id) : this.ticked.delete(p.id);
      },
    }) as HTMLInputElement;
    const meta: Node[] = [
      el('span', { class: 'mono', text: scoreText(p.score, this.country) }),
    ];
    if (p.whs > 0) {
      meta.push(el('span', {
        class: 'tag',
        text: p.whs > 1 ? `World Heritage ×${p.whs}` : 'World Heritage',
      }));
    }
    return el('label', { class: 'bulk-row suggest' },
      box,
      el('span', { class: 'suggest-name' },
        el('span', { class: 'name', text: p.name }),
        el('span', { class: 'row-kinds' },
          ...kinds.map((k) => el('span', {
            class: 'kind', title: this.labels[k],
          }, el('span', { class: 'kg', 'aria-hidden': 'true', text: KIND_GLYPH[k] }),
             el('span', { text: KIND_SHORT[k] }))),
        ),
        el('span', { class: 'row-meta' }, ...meta),
      ),
    );
  }
}
