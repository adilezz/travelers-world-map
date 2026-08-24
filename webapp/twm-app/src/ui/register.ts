/**
 * The register.
 *
 * Not a fallback — the accessible equivalent of the map (doc 3 §11), and a
 * first-class surface that mirrors it exactly. Hovering either highlights
 * both, which is what teaches a traveler that the two surfaces are the same
 * data. It is also what makes the product usable on a slow connection and by
 * anyone who prefers lists.
 *
 * Virtualised, because the world register is 15,770 rows and the product must
 * not stutter when someone clears every filter.
 */
import { el, clear, scoreText } from './dom';
import { KIND_GLYPH, KIND_SHORT, kindsOf } from '../core/kinds';
import { entryText, ENTRY_GLYPH, ENTRY_TONE } from '../core/passport';
import type { Entry, Pin, Scope, SortKey } from '../core/types';

const ROW_H = 62;
const OVERSCAN = 8;

export interface RegisterHooks {
  onOpen(id: string): void;
  onToggle(id: string): void;
  onHover(id: string | null): void;
  onSort(key: SortKey): void;
}

/** Doc 2 §5 lists four sorts. Three are the same everywhere; "best first" is
 *  not, because score is 0-100 against the top place in the SAME country and
 *  Rome, Kathmandu and Reykjavik are all 100. At world scope the option is
 *  named for what it actually does rather than quietly doing something else. */
const SORT_LABEL = (scope: Scope): Record<SortKey, string> => ({
  score: scope.kind === 'world' ? 'By country, best first' : 'Best first',
  name: 'Name',
  recent: 'Recently marked',
  distance: 'Nearest the middle of the map',
});

export class Register {
  private rows: Pin[] = [];
  private viewport: HTMLElement;
  private spacer: HTMLElement;
  private canvas: HTMLElement;
  private countEl: HTMLElement;
  private rendered = new Map<string, HTMLElement>();
  private first = -1;
  private last = -1;

  visited!: ReadonlySet<string>;
  countryName: (iso3: string) => string = (c) => c;
  entry: Record<string, Entry> | null = null;
  selected: string | null = null;
  hovered: string | null = null;
  /** Independent of visited. The tick set is what a spreadsheet exports when
   *  any row is ticked (doc 5 §8.1). */
  private ticked = new Set<string>();

  private sortEl: HTMLSelectElement;

  constructor(private host: HTMLElement, private hooks: RegisterHooks) {
    this.countEl = el('div', { class: 'register-count', 'aria-live': 'polite' });
    this.sortEl = el('select', {
      class: 'sort-select', 'aria-label': 'Sort the register',
      onchange: (e: Event) => this.hooks.onSort((e.target as HTMLSelectElement).value as SortKey),
    }) as HTMLSelectElement;
    this.spacer = el('div', { class: 'register-spacer' });
    this.canvas = el('div', { class: 'register-canvas' });
    this.viewport = el('div', {
      class: 'register-viewport', tabindex: '-1',
      role: 'listbox', 'aria-label': 'Register of places. The same data as the map.',
    }, this.spacer, this.canvas);
    this.viewport.addEventListener('scroll', () => this.paint());
    this.viewport.addEventListener('keydown', (e) => this.onKey(e as KeyboardEvent));
    this.host.append(
      el('div', { class: 'register-head' }, this.countEl, this.sortEl),
      this.viewport,
    );
    new ResizeObserver(() => this.paint()).observe(this.viewport);
  }

  /** The count line states how many are marked, so a mark has to move it.
   *  Rebuilding the list to change one sentence would be absurd. */
  setSummary(text: string) { this.countEl.textContent = text; }

  tickedIds(): ReadonlySet<string> { return this.ticked; }

  /** Relabelled per scope, so "best first" never claims to rank the world. */
  setSort(current: SortKey, scope: Scope) {
    const labels = SORT_LABEL(scope);
    clear(this.sortEl);
    for (const k of ['score', 'name', 'recent', 'distance'] as SortKey[]) {
      this.sortEl.append(el('option', {
        value: k, selected: k === current, text: labels[k],
      }));
    }
  }

  setRows(rows: Pin[], summary: string) {
    this.rows = rows;
    this.countEl.textContent = summary;
    this.spacer.style.height = `${rows.length * ROW_H}px`;
    this.first = this.last = -1;
    clear(this.canvas);
    this.rendered.clear();
    this.paint();
  }

  /** Repaint only the rows whose state changed. Marking is the hot path and it
   *  must not cost a list rebuild. */
  refreshRow(id: string) {
    const node = this.rendered.get(id);
    if (!node) return;
    const pin = this.rows.find((p) => p.id === id);
    if (pin) this.fill(node, pin);
  }

  setHover(id: string | null) {
    if (this.hovered === id) return;
    const was = this.hovered && this.rendered.get(this.hovered);
    if (was) was.classList.remove('is-hovered');
    this.hovered = id;
    const now = id && this.rendered.get(id);
    if (now) now.classList.add('is-hovered');
  }

  setSelected(id: string | null) {
    const was = this.selected && this.rendered.get(this.selected);
    if (was) { was.classList.remove('is-selected'); was.setAttribute('aria-selected', 'false'); }
    this.selected = id;
    const now = id && this.rendered.get(id);
    if (now) { now.classList.add('is-selected'); now.setAttribute('aria-selected', 'true'); }
  }

  /** Scrolls the register only — never the map. */
  reveal(id: string) {
    const i = this.rows.findIndex((p) => p.id === id);
    if (i < 0) return;
    const top = i * ROW_H;
    const { scrollTop, clientHeight } = this.viewport;
    if (top < scrollTop || top + ROW_H > scrollTop + clientHeight) {
      this.viewport.scrollTop = top - clientHeight / 2 + ROW_H / 2;
      this.paint();
    }
  }

  private paint() {
    const { scrollTop, clientHeight } = this.viewport;
    const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const last = Math.min(this.rows.length,
      Math.ceil((scrollTop + clientHeight) / ROW_H) + OVERSCAN);
    if (first === this.first && last === this.last) return;
    this.first = first; this.last = last;

    const keep = new Set<string>();
    for (let i = first; i < last; i++) keep.add(this.rows[i].id);
    for (const [id, node] of this.rendered) {
      if (!keep.has(id)) { node.remove(); this.rendered.delete(id); }
    }
    for (let i = first; i < last; i++) {
      const pin = this.rows[i];
      let node = this.rendered.get(pin.id);
      if (!node) {
        node = this.makeRow(pin);
        this.rendered.set(pin.id, node);
        this.canvas.append(node);
      }
      node.style.transform = `translateY(${i * ROW_H}px)`;
      node.setAttribute('aria-posinset', String(i + 1));
      node.setAttribute('aria-setsize', String(this.rows.length));
    }
  }

  private makeRow(pin: Pin) {
    const node = el('div', {
      class: 'row', role: 'option', tabindex: '-1',
      'data-id': pin.id,
      onclick: (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('.mark, .row-tick')) return;
        this.hooks.onOpen(pin.id);
      },
      onmouseenter: () => this.hooks.onHover(pin.id),
      onmouseleave: () => this.hooks.onHover(null),
      onfocus: () => this.hooks.onHover(pin.id),
    });
    this.fill(node, pin);
    return node;
  }

  private fill(node: HTMLElement, pin: Pin) {
    const seen = this.visited.has(pin.id);
    const country = this.countryName(pin.iso3);
    const kinds = kindsOf(pin.kinds);
    clear(node);
    node.classList.toggle('is-visited', seen);
    node.classList.toggle('is-selected', this.selected === pin.id);
    node.setAttribute('aria-selected', String(this.selected === pin.id));

    // The row is the tap target for marking, the same action as tapping the
    // pin (doc 2 §5) — one tap, no confirmation, and the same tap undoes it.
    const tick = el('label', {
      class: 'row-tick',
      onclick: (e: MouseEvent) => e.stopPropagation(),
    }, el('input', {
      type: 'checkbox',
      checked: this.ticked.has(pin.id),
      'aria-label': `Include ${pin.name} in the next spreadsheet`,
      onchange: (e: Event) => {
        const on = (e.target as HTMLInputElement).checked;
        if (on) this.ticked.add(pin.id); else this.ticked.delete(pin.id);
      },
    }));

    const mark = el('button', {
      class: 'mark',
      type: 'button',
      'aria-pressed': String(seen),
      'aria-label': seen ? `Marked visited: ${pin.name}. Tap to unmark.`
                         : `Mark as visited: ${pin.name}`,
      onclick: (e: MouseEvent) => { e.stopPropagation(); this.hooks.onToggle(pin.id); },
    }, el('span', {
      class: `glyph ${pin.isSite ? 'is-site' : ''} ${pin.onPrintedMap ? 'is-hole' : ''}`,
      'aria-hidden': 'true',
    }));

    const meta: (Node | string)[] = [
      el('span', { class: 'mono', text: scoreText(pin.score, country) }),
    ];
    if (pin.whs > 0) {
      meta.push(el('span', {
        class: 'tag', title: `${pin.whs} World Heritage inscription${pin.whs > 1 ? 's' : ''}`,
        text: pin.whs > 1 ? `World Heritage ×${pin.whs}` : 'World Heritage',
      }));
    }
    // No printed-map tag here: the mark's outer ring already says it, and
    // saying it twice is what pushed the row over its width.

    const e = this.entry?.[pin.iso3];
    if (this.entry) {
      meta.push(el('span', {
        class: `tag entry entry-${ENTRY_TONE[e?.r ?? 'vr']}`,
        text: `${e ? ENTRY_GLYPH[e.r] : '·'} ${entryText(e)}`,
      }));
    }

    node.append(
      mark,
      el('div', { class: 'row-body' },
        el('div', { class: 'row-name' },
          el('span', { class: 'name', text: pin.name }),
          el('span', { class: 'country', text: country }),
        ),
        el('div', { class: 'row-kinds' },
          ...kinds.map((k) => el('span', {
            class: 'kind', title: KIND_SHORT[k],
          }, el('span', { class: 'kg', 'aria-hidden': 'true', text: KIND_GLYPH[k] }),
             el('span', { text: KIND_SHORT[k] }))),
        ),
        el('div', { class: 'row-meta' }, ...meta),
      ),
      tick,
    );
  }

  /** Arrow keys move, Enter opens, M marks — the same key as on the map
   *  (doc 3 §11), so the two surfaces do not need separate muscle memory. */
  private onKey(e: KeyboardEvent) {
    const active = document.activeElement as HTMLElement | null;
    const id = active?.closest<HTMLElement>('.row')?.dataset.id;
    const i = id ? this.rows.findIndex((p) => p.id === id) : -1;
    const focusAt = (n: number) => {
      const clamped = Math.max(0, Math.min(this.rows.length - 1, n));
      this.reveal(this.rows[clamped].id);
      requestAnimationFrame(() => this.rendered.get(this.rows[clamped].id)?.focus());
    };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(i < 0 ? 0 : i + 1); break;
      case 'ArrowUp': e.preventDefault(); focusAt(i < 0 ? 0 : i - 1); break;
      case 'Home': e.preventDefault(); focusAt(0); break;
      case 'End': e.preventDefault(); focusAt(this.rows.length - 1); break;
      case 'PageDown': e.preventDefault(); focusAt((i < 0 ? 0 : i) + 10); break;
      case 'PageUp': e.preventDefault(); focusAt((i < 0 ? 0 : i) - 10); break;
      case 'Enter': if (id) { e.preventDefault(); this.hooks.onOpen(id); } break;
      case 'm': case 'M': if (id) { e.preventDefault(); this.hooks.onToggle(id); } break;
    }
  }

  focusFirst() {
    if (this.rows.length) {
      this.reveal(this.rows[0].id);
      requestAnimationFrame(() => this.rendered.get(this.rows[0].id)?.focus());
    }
  }
}
