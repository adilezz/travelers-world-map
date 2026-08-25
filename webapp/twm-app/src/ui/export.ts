/**
 * Export dialogs (doc 5 §8, interface PDF page 6).
 *
 * Spreadsheet and printable map. Both apply the current filters. Alerts are
 * advisory and never block. JSON of the record remains a separate action.
 * The accent is not used here — it means visited and nothing else.
 *
 * The printable map now writes two files, because the tiles are cut out of
 * paper rather than dropped on as magnets: a wall map with the relief, the
 * borders and a numbered hole for every tile, and a cut sheet carrying the
 * same tiles at the same scale. They are written from one click and both
 * carry the size in the filename, so a pair that does not match is obvious
 * before anyone pays a print shop.
 */
import { el, clear, announce, scoreText, fmtInt } from './dom';
import { kindsOf } from '../core/kinds';
import { buildXlsx, ROW_CAP, ROW_CAP_COPY, type SheetRow } from '../core/xlsx';
import {
  type LevelInfo, type TileSizeReport,
  levelForWidth, measureTiles, posterAdvice, posterAlerts, suggestPoster,
  takeDistributed, widthForLevel, type PosterScope,
} from '../core/poster';
import type { TileFeature } from '../core/wallmap';
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
  land: { countries: any; regions: any; territories: any };
  posterIso3(): string | undefined;
  posterRegionId(): string | undefined;
  posterTerritoryId(): string | undefined;
  recordJson(): void;

  /** The cut-level ladder, from the manifest. */
  tileLevels(): (LevelInfo & {
    roster?: [string, number, number, number][]; file?: string;
    pieces?: number; not_cuttable?: number; not_cuttable_places?: number;
  })[];
  /** Geometry for one level, fetched on demand and cached by the caller. */
  loadTileLevel(level: string): Promise<TileFeature[]>;
  /** Equirectangular relief for the poster background. */
  reliefUrl(): string;
  /** Every pin inside a level tile, by its base-tile members. */
  pinsInTile(members: string[]): Pin[];
}

export class ExportDialog {
  private root: HTMLElement | null = null;
  private mode: 'sheet' | 'poster' = 'sheet';
  private widthMm = 1400;
  private heightMm = 700;
  private count = 1200;
  private levelOverride: string | null = null;
  private busy = false;
  private progress = '';

  constructor(private hooks: ExportHooks) {}

  get isOpen() { return !!this.root; }

  open() {
    this.mode = 'sheet';
    const sug = suggestPoster(this.hooks.posterScope(), this.hooks.posterSet().length);
    this.widthMm = sug.widthMm;
    this.heightMm = sug.heightMm;
    this.count = sug.cap;
    this.levelOverride = null;
    this.progress = '';
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
    // Only now is the card in the document, and only now can the advice line
    // and the alert list be found and filled. Painting them before the append
    // left both blank until the traveler happened to touch a field.
    if (this.mode === 'poster') this.refreshAlerts();
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

  // -------------------------------------------------------------------------

  private level(): string {
    return this.levelOverride
      ?? levelForWidth(this.hooks.tileLevels(), this.widthMm);
  }

  /** Tiles in scope, from the level roster — sizes only, no geometry. */
  private roster(): { min_deg: number; max_deg: number; places: number }[] {
    const lvl = this.hooks.tileLevels().find((l) => l.level === this.level());
    const rows = lvl?.roster ?? [];
    const iso3 = this.hooks.posterIso3();
    return rows
      .filter((r) => !iso3 || r[0] === iso3)
      .map((r) => ({ min_deg: r[1], max_deg: r[2], places: r[3] }));
  }

  private tileReport(): TileSizeReport {
    return measureTiles(this.roster(), this.widthMm);
  }

  private paintPoster(card: HTMLElement) {
    const filtered = this.hooks.posterSet();
    const scope = this.hooks.posterScope();
    card.append(
      el('h2', { id: 'export-title', class: 'export-title', text: 'Printable map' }),
      el('p', { class: 'export-copy', text:
        'Two files: the wall map, and the tiles to cut out and place on it as you go.' }),
      el('p', { class: 'export-line', text:
        `${this.hooks.scopeTitle()} · ${fmtInt(filtered.length)} places in scope · current filters applied` }),
      el('p', { class: 'export-kicker', text: 'Size in millimetres — suggested, and yours to change' }),
      el('div', { class: 'export-nums' },
        this.num('export-w', 'Width', this.widthMm, (v) => { this.widthMm = v; this.refreshAlerts(); }),
        this.num('export-h', 'Height', this.heightMm, (v) => { this.heightMm = v; this.refreshAlerts(); }),
      ),
      el('p', { class: 'export-copy', text:
        'The world suggests 1400 × 700, a country 500 × 620, a region 400 × 400. '
        + 'A world map narrower than about a metre gives tiles too small to cut.' }),
      el('p', { class: 'export-kicker', text: 'How many places' }),
      this.num('export-n', 'Places', this.count, (v) => { this.count = v; this.refreshAlerts(); }),
      el('p', { class: 'export-copy', text:
        scope === 'world'
          ? `A world export suggests 1200. ${fmtInt(filtered.length)} pass the current filters.`
          : `All ${fmtInt(filtered.length)} in scope.` }),
      el('p', { class: 'export-kicker', text: 'Tile size' }),
      this.levelPicker(),
      el('p', { class: 'export-advice' }),
      el('p', { class: 'export-kicker', text: 'Alerts — advisory, never blocking' }),
      el('ul', { class: 'export-alerts' }),
    );
    card.append(el('p', { class: 'export-copy', text:
      'Output is PDF — vector borders, type as text, Natural Earth relief as the '
      + 'background. The accent still means visited; everything unmarked prints '
      + 'as an open ring.' }));
    const exp = el('button', {
      class: 'primary', type: 'button',
      text: 'Export PDF — wall map and tiles',
      onclick: () => void this.writePdf(),
    });
    card.append(this.foot(exp));
  }

  /**
   * The tile level, offered by the paper it needs rather than by its name.
   *
   * "w1400" means nothing to a traveler; "1.4 m — 568 tiles" is the same fact
   * in the units they are about to pay a print shop in.
   */
  private levelPicker() {
    const levels = this.hooks.tileLevels().filter((l) => l.for_map_mm !== null);
    const chosen = this.level();
    const wrap = el('div', { class: 'export-levels', role: 'radiogroup',
      'aria-label': 'Tile size' });
    for (const l of levels.sort((a, b) =>
      (a.for_map_mm as number) - (b.for_map_mm as number))) {
      const on = l.level === chosen;
      wrap.append(el('button', {
        class: 'export-level' + (on ? ' is-on' : ''),
        type: 'button', role: 'radio', 'aria-checked': String(on),
        text: `${(l.for_map_mm as number) / 1000} m · ${fmtInt(l.tiles)} tiles`,
        onclick: () => {
          this.levelOverride = l.level;
          this.paint();
        },
      }));
    }
    if (this.levelOverride) {
      wrap.append(el('button', {
        class: 'link-btn', type: 'button', text: 'Match the size',
        onclick: () => { this.levelOverride = null; this.paint(); },
      }));
    }
    return wrap;
  }

  private refreshAlerts() {
    const card = this.root?.querySelector('.export-card');
    const list = card?.querySelector('.export-alerts');
    if (!list) return;
    const filtered = this.hooks.posterSet();
    const scope = this.hooks.posterScope();
    const n = Math.max(0, Math.min(this.count, filtered.length));
    const rep = this.tileReport();
    const alerts = posterAlerts({
      widthMm: this.widthMm, heightMm: this.heightMm, count: n, scope,
      exportingAllWorld: scope === 'world' && n >= this.hooks.worldPlaceCount,
      printed: this.hooks.printed, holeBudget: this.hooks.holeBudget,
      tiles: rep,
      level: this.level(),
      levelWidthMm: this.levelOverride
        ? null : widthForLevel(this.hooks.tileLevels(), this.level()),
    });
    const advice = card?.querySelector('.export-advice');
    if (advice) {
      advice.textContent = this.progress || posterAdvice({
        scope, widthMm: this.widthMm, heightMm: this.heightMm,
        level: this.level(), tiles: rep.tiles,
        cuttable: rep.tiles - rep.tooSmall,
      });
    }
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

  private say(msg: string) {
    this.progress = msg;
    const advice = this.root?.querySelector('.export-advice');
    if (advice) advice.textContent = msg;
  }

  /**
   * Both files, from one click.
   *
   * The wall map is built first because it decides the scale, and the cut
   * sheet is handed that scale rather than computing its own. Two files from
   * one action rather than two buttons: a traveler who changes the width
   * between two clicks would get tiles that do not fit their holes, and
   * nothing on paper would say why.
   */
  private async writePdf() {
    if (this.busy) return;
    this.busy = true;
    const size = `${Math.round(this.widthMm)}x${Math.round(this.heightMm)}`;
    try {
      this.say('Fetching the tiles…');
      const level = this.level();
      const all = await this.hooks.loadTileLevel(level);
      const iso3 = this.hooks.posterIso3();
      const tiles = iso3
        ? all.filter((t) => t.properties.iso3 === iso3) : all;
      if (!tiles.length) throw new Error('no tiles in scope');

      // The PDF writer, the projection and the two documents are about 90 KB
      // and are needed by a traveler who prints, not by one who browses. Doc 4
      // §2 puts the initial payload first; this keeps it there.
      const { buildTileSheet, buildWallMap, loadImage } =
        await import('../core/wallmap');

      this.say('Loading the relief…');
      let relief: HTMLImageElement | null = null;
      try {
        relief = await loadImage(this.hooks.reliefUrl());
      } catch {
        relief = null;              // the map prints without it, and says so
      }

      const filtered = this.hooks.posterSet();
      const pins = takeDistributed(
        filtered, Math.max(0, Math.min(this.count, filtered.length)));
      const title = this.hooks.scopeTitle() || 'Travelers World Map';

      this.say('Drawing the wall map…');
      const wall = await buildWallMap({
        widthMm: this.widthMm, heightMm: this.heightMm,
        title, subtitle: `Travelers World Map · ${this.hooks.filterLine()}`,
        tiles, countries: this.hooks.land.countries,
        pins, visited: this.hooks.visited, relief,
        dpi: this.widthMm > 1200 ? 200 : 300,
      });
      save(wall.bytes,
        `travelers-world-map-wall-${size}mm-${stamp()}.pdf`, 'application/pdf');

      this.say('Drawing the tiles…');
      const chosen = new Set(pins.map((p) => p.id));
      const sheet = await buildTileSheet({
        widthMm: this.widthMm, heightMm: this.heightMm, title,
        tiles, numbers: wall.numbers, scale: wall.scale,
        pinsForTile: (t) => this.hooks
          .pinsInTile(t.properties.members).filter((p) => chosen.has(p.id)),
        visited: this.hooks.visited,
        kindLabel: (k) => this.hooks.kindLabel(k),
      });
      await wait(400);              // let the first download settle
      save(sheet.bytes,
        `travelers-world-map-tiles-${size}mm-${stamp()}.pdf`, 'application/pdf');

      announce(
        `Exported a wall map of ${pins.length} places and `
        + `${sheet.cut} tiles across ${sheet.sheets} sheets.`);
      this.close();
    } catch (err) {
      this.say(`The printable map failed: ${(err as Error).message}`);
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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stamp() { return new Date().toISOString().slice(0, 10); }

function save(data: Uint8Array, name: string, type: string) {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const blob = new Blob([copy], { type });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
}
