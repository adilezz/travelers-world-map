/**
 * Export dialogs (doc 5 §8, interface PDF page 6).
 *
 * Spreadsheet and printable map. Both apply the current filters. Alerts are
 * advisory and never block. JSON of the record remains a separate action.
 * The accent is not used here — it means visited and nothing else.
 */
import { el, clear, announce, scoreText, fmtInt } from './dom';
import { kindsOf } from '../core/kinds';
import { buildXlsx, ROW_CAP, ROW_CAP_COPY, type SheetRow } from '../core/xlsx';
import {
  posterAlerts, suggestPoster, takeDistributed, type PosterScope,
} from '../core/poster';
import { buildPosterPdf, type PdfLand } from '../core/pdf';
import type { KindCode, Pin, Visit } from '../core/types';

export interface ExportHooks {
  filteredPins(): Pin[];
  posterSet(): Pin[];
  tickedIds(): ReadonlySet<string>;
  pinById(id: string): Pin | undefined;
  posterScope(): PosterScope;
  scopeTitle(): string;
  filterLine(): string;
  countryName(iso3: string): string;
  regionName(id: string): string;
  kindLabel(code: KindCode): string;
  visit(id: string): Visit | undefined;
  visited: ReadonlySet<string>;
  sourcesFor(pins: Pin[]): Promise<Map<string, string>>;
  printed: number;
  holeBudget: number;
  worldPlaceCount: number;
  land: PdfLand;
  posterIso3(): string | undefined;
  posterRegionId(): string | undefined;
  posterTerritoryId(): string | undefined;
  recordJson(): void;
}

export class ExportDialog {
  private root: HTMLElement | null = null;
  private mode: 'sheet' | 'poster' = 'sheet';
  private widthMm = 700;
  private heightMm = 500;
  private count = 800;
  private busy = false;

  constructor(private hooks: ExportHooks) {}

  get isOpen() { return !!this.root; }

  open() {
    this.mode = 'sheet';
    const sug = suggestPoster(this.hooks.posterScope(), this.hooks.posterSet().length);
    this.widthMm = sug.widthMm;
    this.heightMm = sug.heightMm;
    this.count = sug.cap;
    if (this.root) this.root.remove();
    this.root = el('div', {
      class: 'export-root', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'export-title',
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
    });
    document.body.append(this.root);
    this.paint();
  }

  close() {
    this.root?.remove();
    this.root = null;
  }

  private pinsForSheet(): Pin[] {
    const ids = this.hooks.tickedIds();
    if (ids.size) {
      const out: Pin[] = [];
      for (const id of ids) {
        const p = this.hooks.pinById(id);
        if (p) out.push(p);
      }
      return out;
    }
    return this.hooks.filteredPins();
  }

  private paint() {
    if (!this.root) return;
    clear(this.root);
    const card = el('div', { class: 'export-card' });
    card.append(el('button', {
      class: 'icon-btn export-close', type: 'button',
      'aria-label': 'Close export', text: '×',
      onclick: () => this.close(),
    }));
    card.append(
      el('p', { class: 'export-kicker', text: 'Export' }),
      el('div', { class: 'export-modes', role: 'tablist', 'aria-label': 'Export kind' },
        this.modeBtn('sheet', 'Spreadsheet'),
        this.modeBtn('poster', 'Printable map'),
      ),
    );
    if (this.mode === 'sheet') this.paintSheet(card);
    else this.paintPoster(card);
    this.root.append(card);
    card.querySelector<HTMLElement>('button.primary, input')?.focus();
  }

  private modeBtn(mode: 'sheet' | 'poster', label: string) {
    return el('button', {
      class: 'export-mode' + (this.mode === mode ? ' is-on' : ''),
      type: 'button', role: 'tab', 'aria-selected': String(this.mode === mode),
      text: label,
      onclick: () => { this.mode = mode; this.paint(); },
    });
  }

  private paintSheet(card: HTMLElement) {
    const pins = this.pinsForSheet();
    const ticked = this.hooks.tickedIds().size;
    card.append(
      el('h2', { id: 'export-title', class: 'export-title', text: 'Spreadsheet' }),
      el('p', { class: 'export-copy', text: 'Places in the current filter' }),
      el('p', { class: 'export-line', text: this.hooks.filterLine() }),
      el('p', { class: 'export-kicker', text: 'Columns' }),
      el('p', { class: 'export-copy', text:
        'name, country, region, latitude, longitude, kinds — labels, never codes, '
        + 'score with the country named, visited, visited_on, note, '
        + 'World Heritage inscriptions, sources and place_id.' }),
      el('p', { class: 'export-kicker', text: 'Rows' }),
      el('p', { class: 'export-line', text:
        ticked
          ? `${fmtInt(pins.length)} ticked ${pins.length === 1 ? 'row' : 'rows'}`
          : `${fmtInt(pins.length)} ${pins.length === 1 ? 'row' : 'rows'}` }),
    );
    if (pins.length > ROW_CAP) {
      card.append(el('p', { class: 'export-alert', text: ROW_CAP_COPY }));
    }
    card.append(el('p', { class: 'export-copy', text:
      ticked
        ? 'The tick set is exported. Untick every row to export the filtered set instead.'
        : 'If rows are ticked in the register, the tick set is exported. Otherwise the filtered set is. The file is a real .xlsx, readable without this product.' }));
    const exp = el('button', {
      class: 'primary', type: 'button', text: 'Export .xlsx',
      onclick: () => void this.writeXlsx(),
    });
    card.append(this.foot(exp));
  }

  private paintPoster(card: HTMLElement) {
    const filtered = this.hooks.posterSet();
    const scope = this.hooks.posterScope();
    card.append(
      el('h2', { id: 'export-title', class: 'export-title', text: 'Printable map' }),
      el('p', { class: 'export-copy', text: 'Poster of the current scope' }),
      el('p', { class: 'export-line', text:
        `${this.hooks.scopeTitle()} · ${fmtInt(filtered.length)} places in scope · current filters applied` }),
      el('p', { class: 'export-kicker', text: 'Size in millimetres — suggested, and yours to change' }),
      el('div', { class: 'export-nums' },
        this.num('export-w', 'Width', this.widthMm, (v) => { this.widthMm = v; this.refreshAlerts(); }),
        this.num('export-h', 'Height', this.heightMm, (v) => { this.heightMm = v; this.refreshAlerts(); }),
      ),
      el('p', { class: 'export-copy', text:
        'Width × height. World suggests 700 × 500, a country 400 × 500, a region 300 × 300.' }),
      el('p', { class: 'export-kicker', text: 'How many places' }),
      this.num('export-n', 'Places', this.count, (v) => { this.count = v; this.refreshAlerts(); }),
      el('p', { class: 'export-copy', text:
        scope === 'world'
          ? `A world export suggests 800. ${fmtInt(filtered.length)} pass the current filters.`
          : `All ${fmtInt(filtered.length)} in scope.` }),
      el('p', { class: 'export-kicker', text: 'Alerts — advisory, never blocking' }),
    );
    card.append(el('ul', { class: 'export-alerts' }));
    this.refreshAlerts();
    card.append(el('p', { class: 'export-copy', text:
      'Output is PDF — vector land, type as text. The accent still means visited; everything unmarked prints as an open ring.' }));
    const exp = el('button', {
      class: 'primary', type: 'button', text: 'Export PDF',
      onclick: () => this.writePdf(),
    });
    card.append(this.foot(exp));
  }

  private refreshAlerts() {
    const list = this.root?.querySelector('.export-alerts');
    if (!list) return;
    const filtered = this.hooks.posterSet();
    const scope = this.hooks.posterScope();
    const n = Math.max(0, Math.min(this.count, filtered.length));
    const alerts = posterAlerts({
      widthMm: this.widthMm, heightMm: this.heightMm, count: n, scope,
      exportingAllWorld: scope === 'world' && n >= this.hooks.worldPlaceCount,
      printed: this.hooks.printed, holeBudget: this.hooks.holeBudget,
    });
    clear(list);
    if (!alerts.length) {
      list.append(el('li', { class: 'export-copy', text: 'None at this size and count.' }));
    } else {
      for (const a of alerts) list.append(el('li', { class: 'export-alert', text: a }));
    }
  }

  private num(id: string, label: string, value: number, change: (n: number) => void) {
    const input = el('input', {
      id, type: 'number', min: '1', step: '1', value: String(value),
      'aria-label': label,
      oninput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v) && v > 0) change(v);
      },
    }) as HTMLInputElement;
    return el('label', { class: 'export-num' }, label, input);
  }

  private foot(primary: HTMLElement) {
    return el('div', { class: 'export-foot' },
      el('button', {
        class: 'link-btn', type: 'button', text: 'Cancel',
        onclick: () => this.close(),
      }),
      el('button', {
        class: 'link-btn export-json', type: 'button',
        text: 'Export the record as JSON',
        onclick: () => {
          this.hooks.recordJson();
          this.close();
        },
      }),
      primary,
    );
  }

  private async writeXlsx() {
    if (this.busy) return;
    this.busy = true;
    try {
      const pins = this.pinsForSheet();
      const sources = await this.hooks.sourcesFor(pins);
      const rows: SheetRow[] = pins.map((p) => this.row(p, sources.get(p.id) ?? ''));
      save(buildXlsx(rows),
        `travelers-world-map-places-${stamp()}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      announce(`Exported ${pins.length} ${pins.length === 1 ? 'place' : 'places'} as a spreadsheet.`);
      this.close();
    } finally {
      this.busy = false;
    }
  }

  private writePdf() {
    if (this.busy) return;
    this.busy = true;
    try {
      const filtered = this.hooks.posterSet();
      const pins = takeDistributed(filtered, Math.max(0, Math.min(this.count, filtered.length)));
      const bytes = buildPosterPdf({
        widthMm: this.widthMm, heightMm: this.heightMm,
        title: this.hooks.scopeTitle(),
        pins, visited: this.hooks.visited, land: this.hooks.land,
        iso3: this.hooks.posterIso3(),
        regionId: this.hooks.posterRegionId(),
        territoryId: this.hooks.posterTerritoryId(),
      });
      save(bytes, `travelers-world-map-poster-${stamp()}.pdf`, 'application/pdf');
      announce(`Exported a printable map of ${pins.length} ${pins.length === 1 ? 'place' : 'places'}.`);
      this.close();
    } finally {
      this.busy = false;
    }
  }

  private row(p: Pin, sources: string): SheetRow {
    const country = this.hooks.countryName(p.iso3);
    const v = this.hooks.visit(p.id);
    return {
      name: p.name,
      country,
      region: this.hooks.regionName(p.regionId),
      lat: p.lat,
      lon: p.lon,
      kinds: kindsOf(p.kinds).map((k) => this.hooks.kindLabel(k)).join('; '),
      score: scoreText(p.score, country),
      visited: this.hooks.visited.has(p.id) ? 'yes' : 'no',
      visited_on: v?.visited_on ?? '',
      note: v?.note ?? '',
      WHS: p.whs,
      sources,
      place_id: p.id,
    };
  }
}

function stamp() { return new Date().toISOString().slice(0, 10); }

function save(data: Uint8Array, name: string, type: string) {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const blob = new Blob([copy], { type });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
}
