/**
 * The coverage meter.
 *
 * A control, not a readout. Tapping a kind activates the matching filter chip
 * and narrows the register to it — see the gap, tap it, get the list. That
 * single loop is the product's core claim and the thing worth measuring
 * (doc 2 §14).
 *
 * Twelve rows, always, driven from the manifest. Seven of them are empty
 * today because the landform signals are not in the database yet; they are
 * shown as "none here yet" rather than as a gap in the traveler's travel,
 * because those are different facts and conflating them would be a lie about
 * their record.
 *
 * Never a percentage. A country is not a task (doc 3 §13).
 */
import { el, clear } from './dom';
import { ALL_KINDS, KIND_GLYPH, gapSentence } from '../core/kinds';
import type { Coverage } from '../core/coverage';
import type { KindCode } from '../core/types';

export class CoverageMeter {
  private list: HTMLElement;
  private headline: HTMLElement;
  private gap: HTMLElement;
  private depth: HTMLElement;
  private rowByKind = new Map<KindCode, HTMLElement>();

  constructor(
    private host: HTMLElement,
    private labels: Record<KindCode, string>,
    private onPick: (k: KindCode) => void,
    private active: () => Set<KindCode>,
  ) {
    this.headline = el('div', { class: 'coverage-headline' });
    this.gap = el('p', { class: 'gap-sentence' });
    this.depth = el('p', { class: 'coverage-depth' });
    this.list = el('div', { class: 'coverage-list', role: 'group', 'aria-label': 'Kinds of place' });
    // Doc 3 §12: below 1440px the meter condenses to the gap sentence plus a
    // count. The twelve rows are a disclosure rather than a deletion — they
    // are the control, and a control that disappears on a laptop is no use.
    this.details = el('details', { class: 'coverage-details' },
      el('summary', {}, el('span', { class: 'summary-label', text: 'All twelve kinds' })),
      this.list);
    if (window.matchMedia?.('(min-width: 1440px)').matches) this.details.open = true;
    this.host.append(this.headline, this.gap, this.depth, this.details);
  }

  private details: HTMLDetailsElement;

  render(cov: Coverage, scopeLabel: string) {
    clear(this.headline);
    this.headline.append(
      el('span', { class: 'coverage-count mono', text: `${cov.seenKinds} of ${cov.availableKinds}` }),
      el('span', { class: 'coverage-unit', text: cov.availableKinds === 1 ? 'kind of place seen' : 'kinds of place seen' }),
      el('span', { class: 'coverage-scope', text: scopeLabel }),
    );

    // The most important text in the product (doc 3 §8).
    const sentence = gapSentence(cov.unseen, this.labels);
    this.gap.textContent = sentence
      || (cov.availableKinds === 0
        ? 'No places here yet.'
        : `Every kind of place ${scopeLabel} has is on your record.`);
    this.gap.classList.toggle('is-complete', !sentence && cov.availableKinds > 0);

    // Breadth alone can be gamed by touching one place of each kind, so the
    // pair is always reported (doc 2 §6.2). Neither state is presented as
    // better; they are different ways of travelling.
    const perKind = cov.present.filter((r) => r.seen > 0);
    const total = perKind.reduce((s, r) => s + r.seen, 0);
    this.depth.textContent = perKind.length
      ? `${total} place${total === 1 ? '' : 's'} marked across those ${perKind.length}`
        + `${perKind.length === 1 ? ' kind' : ' kinds'}`
        + ` · deepest is ${this.labels[perKind.reduce((a, b) => (b.seen > a.seen ? b : a)).code].toLowerCase()}`
      : '';

    // The summary carries the count while the rows are collapsed, so the
    // control still says something when it is shut.
    const label = this.details.querySelector('.summary-label');
    if (label) {
      label.textContent = cov.unseen.length
        ? `${cov.unseen.length} unseen ${cov.unseen.length === 1 ? 'kind' : 'kinds'} · all twelve`
        : 'All twelve kinds';
    }

    // A keyboard traveler who activates a kind must not be thrown back to the
    // top of the document because the meter redrew itself underneath them.
    const focusedKind = (document.activeElement as HTMLElement | null)
      ?.closest<HTMLElement>('.kind-row')?.dataset.kind as KindCode | undefined;

    clear(this.list);
    this.rowByKind.clear();
    const activeSet = this.active();
    for (const code of ALL_KINDS) {
      const row = cov.rows.find((r) => r.code === code)!;
      const absent = row.available === 0;
      const seen = row.seen > 0;
      const node = el('button', {
        class: 'kind-row'
          + (seen ? ' is-seen' : '')
          + (absent ? ' is-absent' : '')
          + (activeSet.has(code) ? ' is-active' : ''),
        type: 'button',
        disabled: absent,
        'aria-pressed': String(activeSet.has(code)),
        'aria-label': absent
          ? `${this.labels[code]}: no places here yet`
          : `${this.labels[code]}: ${row.seen} of ${row.available} marked. `
            + `Filter the register to this kind.`,
        'data-kind': code,
        onclick: () => this.onPick(code),
      },
        el('span', { class: 'kind-glyph', 'aria-hidden': 'true', text: KIND_GLYPH[code] }),
        el('span', { class: 'kind-label', text: this.labels[code] }),
        el('span', {
          class: 'kind-count mono',
          text: absent ? 'none here yet' : `${row.seen} of ${row.available}`,
        }),
      );
      this.rowByKind.set(code, node);
      this.list.append(node);
    }
    if (focusedKind) this.rowByKind.get(focusedKind)?.focus();
  }

  /** Marking a place pulses the coverage row it affected. That link — this tap
   *  changed that meter — is the one animation that carries meaning
   *  (doc 3 §10), so it is honoured and nothing else is. */
  pulse(kinds: KindCode[]) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    for (const k of kinds) {
      const n = this.rowByKind.get(k);
      if (!n) continue;
      n.classList.remove('pulse');
      void n.offsetWidth;
      n.classList.add('pulse');
    }
  }
}
