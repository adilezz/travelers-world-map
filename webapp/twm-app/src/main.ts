/**
 * Travelers World Map — the client.
 *
 * The wiring, and nothing else. Every rule this file enforces is written down
 * in doc 2 or doc 3; where a line here looks arbitrary it is quoting one.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import './style/tokens.css';
import './style/app.css';

import { Bundle } from './core/bundle';
import { Record } from './core/record';
import { Store } from './core/store';
import { coverage, newlySeen, type Coverage } from './core/coverage';
import { apply, emptyFilters, inScope, rankSearchHits, sortPins } from './core/filters';
import {
  impliedSpacingMm, pinsWillOverlap, posterAlerts, A4_MM, SPACING_MM,
} from './core/poster';
import { SHEET_COLUMNS } from './core/xlsx';
import { ALL_KINDS, gapSentence, kindsOf } from './core/kinds';
import { Atlas } from './map/atlas';
import {
  EXAGGERATION_MAX, EXAGGERATION_MIN, clampExaggeration,
} from './map/terrain';
import { Register } from './ui/register';
import { CoverageMeter } from './ui/coverage-meter';
import { FilterBar } from './ui/filter-bar';
import { Detail } from './ui/detail';
import { Onboarding } from './ui/onboarding';
import { AccountSheet } from './ui/account';
import { ExportDialog } from './ui/export';
import { Session } from './core/session';
import { TripBook } from './core/trips';
import { TripPanel } from './ui/trips';
import { BulkMark } from './ui/bulk';
import { el, clear, announce, fmtInt } from './ui/dom';
import type {
  Entry, Filters, KindCode, MapLayers, PassportFile, Pin, Place, Scope, SortKey, Trip, Visit,
} from './core/types';
import { defaultLayers } from './core/types';

interface AppState {
  scope: Scope;
  filters: Filters;
  sort: SortKey;
  selected: string | null;
  detail: { kind: 'none' } | { kind: 'place'; id: string }
        | { kind: 'country'; iso3: string } | { kind: 'territory'; id: string }
        | { kind: 'region'; id: string };
  passport: PassportFile | null;
  theme: 'light' | 'dark';
  panelOpen: boolean;
  sheet: 'peek' | 'half' | 'full';
  layers: MapLayers;
  tripsOpen: boolean;
}

const bundle = new Bundle();
const record = new Record();
const session = new Session();
const store = new Store<AppState>({
  scope: { kind: 'world' },
  filters: emptyFilters(),
  sort: 'score',
  selected: null,
  detail: { kind: 'none' },
  passport: null,
  theme: 'light',
  panelOpen: true,
  sheet: 'peek',
  layers: defaultLayers(),
  tripsOpen: false,
});
const trips = new TripBook();

let atlas: Atlas | undefined;
let register: Register;
let meter: CoverageMeter;
let filterBar: FilterBar;
let detail: Detail;
let tripPanel: TripPanel;
let bulk: BulkMark;
let lastCoverage: Coverage;
let shell: ReturnType<typeof buildShell>;
let account: AccountSheet;
let exporter: ExportDialog;
let landHold = {
  countries: { type: 'FeatureCollection', features: [] as any[] },
  regions: { type: 'FeatureCollection', features: [] as any[] },
  territories: { type: 'FeatureCollection', features: [] as any[] },
};
let bulkReturn: AppState['detail'] = { kind: 'none' };

boot().catch((err) => {
  document.body.append(el('div', { class: 'fatal' },
    el('p', { text: 'The place database could not be loaded.' }),
    el('pre', { class: 'muted small', text: String(err?.stack ?? err) }),
    el('button', { class: 'primary', type: 'button', text: 'Try again',
      onclick: () => location.reload() }),
  ));
});

async function boot() {
  record.load();
  trips.load();
  session.load();
  applyTheme(record.profile.theme ?? 'system');
  account = new AccountSheet(session, {
    payload: () => {
      record.flush();
      trips.flush();
      return { visits: record.all(), trips: trips.export(), profile: record.profile };
    },
    applyMerged: (rec) => applyAccountMerge(rec),
    exportLocal: () => doExport(),
    signedIn: () => { void kickSync(); refresh(); },
    signedOut: () => { refresh(); },
  });
  shell = buildShell();
  await bundle.load();
  const about = document.getElementById('about-line');
  if (about) about.textContent = `Build ${bundle.manifest.build}`;

  const layers = Promise.all([
    bundle.loadCountryLayer(),
    bundle.loadTerritoryLayer(),
    bundle.loadRegionLayer(),
  ]);

  // The register is the accessible equivalent of the map (doc 3 §11) and
  // must not wait on WebGL. Build the panel first; the map joins when ready.
  register = new Register(shell.register, {
    onOpen: (id) => openPlace(id),
    onToggle: (id) => toggle(id),
    onHover: (id) => { register.setHover(id); atlas?.hover(id); },
    onSort: (sort) => store.set({ sort }),
  });
  register.visited = record.visited;
  register.countryName = (iso3) => bundle.countryName.get(iso3) ?? iso3;

  exporter = new ExportDialog({
    filteredPins: () => apply(currentScopePins(), store.state.filters, applyCtx()),
    posterSet: () => posterPinSet(),
    tickedIds: () => register.tickedIds(),
    pinById: (id) => bundle.pinById.get(id),
    posterScope: () => posterScopeKind(),
    scopeTitle: () => posterScopeTitle(),
    filterLine: () => exportFilterLine(),
    countryName: (iso3) => bundle.countryName.get(iso3) ?? iso3,
    regionName: (id) => bundle.regions.get(id)?.name ?? '',
    kindLabel: (k) => bundle.manifest.archetypes[k],
    visit: (id) => record.get(id),
    visited: record.visited,
    sourcesFor: (pins) => sourcesForPins(pins),
    printed: bundle.manifest.totals.printed,
    holeBudget: bundle.manifest.totals.hole_budget,
    worldPlaceCount: bundle.pins.length,
    land: landHold,
    posterIso3: () => {
      if (store.state.detail.kind === 'region') return undefined;
      return store.state.scope.kind === 'country' ? store.state.scope.iso3 : undefined;
    },
    posterRegionId: () =>
      store.state.detail.kind === 'region' ? store.state.detail.id : undefined,
    posterTerritoryId: () =>
      store.state.scope.kind === 'territory' && store.state.detail.kind !== 'region'
        ? store.state.scope.id : undefined,
    recordJson: () => doExport(),
  });

  meter = new CoverageMeter(shell.coverage, bundle.manifest.archetypes,
    (k) => pickKind(k), () => store.state.filters.kinds);

  filterBar = new FilterBar(shell.filters, {
    change: (patch) => store.set({ filters: { ...store.state.filters, ...patch } }),
    clearAll: () => store.set({
      filters: { ...emptyFilters(), passport: store.state.filters.passport },
    }),
    pickPassport: (iso3) => choosePassport(iso3),
    pickSearch: (hit) => {
      store.set({ filters: { ...store.state.filters, search: '' } });
      if (hit.kind === 'place') openPlace(hit.id);
      else if (hit.kind === 'country') openCountry(hit.id);
      else openRegion(hit.id);
    },
  }, bundle.manifest.archetypes);
  window.matchMedia('(max-width: 1023px)').addEventListener('change', () => {
    placeFilters();
    placeCollapse();
    refresh();
  });
  window.addEventListener('resize', () => { placeCollapse(); });
  placeFilters();
  placeCollapse();
  try {
    const idx = await bundle.passportList();
    filterBar.setPassportList(idx.passports);
    if (record.profile.passport) await choosePassport(record.profile.passport);
  } catch { /* the passport layer is optional; the map is not */ }

  detail = new Detail(shell.detail, {
    toggle: (id) => toggle(id),
    open: (id) => openPlace(id),
    scopeCountry: (iso3) => openCountry(iso3),
    scopeTerritory: (id) => openTerritory(id),
    scopeRegion: (id) => openRegion(id),
    close: () => dismissDetail(),
    hideSheet: () => hideSheet(),
    hover: (id) => { register.setHover(id); atlas?.hover(id); },
    annotate: (id, patch) => { record.annotate(id, patch); void kickSync(); },
    addToTrip: (id) => addToTrip(id),
    tripTitle: () => trips.active?.title ?? null,
    bulkMark: (pins, title) => openBulk(pins, title),
    showOnMap: (points) => {
      if (!points.length) return;
      let w = 180, s2 = 90, e = -180, n = -90;
      for (const p of points) {
        w = Math.min(w, p.lon); e = Math.max(e, p.lon);
        s2 = Math.min(s2, p.lat); n = Math.max(n, p.lat);
      }
      // A single place is a point; pad so fitBounds does not slam to max zoom.
      if (w >= e) { w -= 4; e += 4; }
      if (s2 >= n) { s2 -= 4; n += 4; }
      atlas?.flyToCountry([w, s2, e, n], showOnMapPadding());
    },
  }, bundle.manifest.archetypes);

  tripPanel = new TripPanel(shell.trips, trips, bundle.pinById, {
    open: (id) => openPlace(id),
    hover: (id) => { register.setHover(id); atlas?.hover(id); },
    changed: () => { paintTrip(); tripPanel.render(); refresh(); void kickTripSync(); },
  });
  tripPanel.render();

  bulk = new BulkMark(shell.detail, bundle.manifest.archetypes,
    (iso3) => bundle.countryName.get(iso3) ?? iso3, {
      apply: (universe, ticked) => applyBulkEdits(universe, ticked),
      undo: () => undoBulkEdits(),
      back: () => restoreFromBulk(),
    });

  showDangling();

  store.subscribe(() => refresh());
  wireKeys();
  refresh();
  await consumeAuthFromUrl();
  document.body.classList.remove('is-booting');

  if (record.count === 0 && !localStorage.getItem('twm.onboarded')) {
    localStorage.setItem('twm.onboarded', '1');
    new Onboarding(bundle.manifest.countries, bundle.byCountry, record.visited,
      bundle.manifest.archetypes, {
        markMany: (ids) => { record.markMany(ids); atlas?.syncVisited(); refresh(); paintCountryTint(); void kickSync(); },
        scopeCountry: (iso3) => openCountry(iso3),
        done: () => refresh(),
        keepSafe: () => doExport(),
      }).open(document.body);
  }

  const [countriesGeoJSON, territoriesGeoJSON, regionsGeoJSON] = await layers;
  landHold.countries = countriesGeoJSON;
  landHold.territories = territoriesGeoJSON;
  landHold.regions = regionsGeoJSON;
  atlas = new Atlas(shell.map, {
    onPlace: (id) => openPlace(id),
    onCountry: (iso3) => openCountry(iso3),
    onTerritory: (id) => openTerritory(id),
    onRegion: (id) => openRegion(id),
    onBackground: () => dismissDetail(),
    hasSelection: () => store.state.detail.kind !== 'none',
    onHoverPlace: (id) => { register.setHover(id); atlas?.hover(id); },
    onReliefUnavailable: () => {
      paintReliefNote();
      announce('The elevation model could not be reached, so relief is not '
        + 'drawn. Everything else on the map still works.');
    },
  });
  await atlas.init({
    placesGeoJSON: bundle.placesGeoJSON,
    countriesGeoJSON, territoriesGeoJSON, regionsGeoJSON,
    pins: bundle.pins, visited: record.visited,
  });
  atlas.applyLayers(store.state.layers);
  paintLayerButtons(store.state.layers);
  paintCountryTint();
  paintTrip();
  refresh();
  // Same reason as _twmMap: the suite has to read trip geometry without
  // depending on HTML5 drag, which Playwright does not fire.
  (shell.map as any)._twmTrip = {
    snapshot: () => trips.active
      ? { title: trips.active.title, stops: trips.active.stops.map((s) => ({ id: s.place_id, day: s.day })) }
      : null,
    assignTray: (day: number) => {
      const t = trips.active;
      if (!t) return 0;
      const ids = t.stops.filter((s) => s.day === 0).map((s) => s.place_id);
      for (const id of ids) trips.move(id, day);
      paintTrip();
      tripPanel.render();
      return ids.length;
    },
  };
  (window as any)._twmAuth = {
    signedIn: () => session.signedIn,
    email: () => session.user?.email ?? null,
    open: () => account.open(),
    finish: (token: string) => account.finish(token),
    visits: () => record.all(),
    token: () => session.token,
    mark: (id: string) => record.toggle(id),
  };
  (window as any)._twmExport = {
    impliedSpacingMm, pinsWillOverlap, posterAlerts, A4_MM, SPACING_MM, SHEET_COLUMNS,
  };
}

// ---- the shell ----------------------------------------------------------

function buildShell() {
  const app = document.getElementById('app')!;
  clear(app);

  const map = el('div', { id: 'map', class: 'map', 'aria-hidden': 'true' });
  // The map carries a text alternative naming the scope and the counts
  // (doc 3 §11); the register is the accessible equivalent and says so.
  const mapAlt = el('p', { id: 'map-alt', class: 'sr-only' });

  const coverageHost = el('div', { class: 'panel-block coverage' });
  const filters = el('div', { class: 'panel-block' });
  const registerHost = el('div', { class: 'panel-block register' });
  const tripsHost = el('div', { class: 'panel-block trips', hidden: true, 'aria-label': 'Trips' });
  const detailHost = el('aside', { class: 'detail', hidden: true, 'aria-label': 'Detail' });
  const dangling = el('div', { class: 'dangling', hidden: true });

  const scopeLabel = el('button', {
    class: 'scope-btn', type: 'button', id: 'scope-btn',
    onclick: () => setScope({ kind: 'world' }),
  });
  const themeBtn = el('button', {
    class: 'icon-btn', type: 'button', 'aria-label': 'Switch theme', text: '◐',
    onclick: () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      record.saveProfile({ theme: next });
      atlas?.retheme();
    },
  });

  const header = el('header', { class: 'header' },
    el('div', { class: 'brand' },
      el('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
      el('div', { class: 'brand-copy' },
        el('span', { class: 'brand-name', text: 'Travelers World Map' }),
        el('span', { class: 'about-line', id: 'about-line', text: '' }))),
    scopeLabel,
    el('div', { class: 'header-right' },
      el('button', {
        class: 'link-btn account-btn', type: 'button',
        'aria-label': 'Account',
        onclick: () => account.open(),
      }, el('span', { class: 'account-btn-label', text: 'Account' })),
      el('button', {
        class: 'link-btn', type: 'button', text: 'Trips',
        onclick: () => {
          const next = !store.state.tripsOpen;
          store.set({ tripsOpen: next });
          tripsHost.hidden = !next;
          if (next) tripPanel.render();
          placeTrips();
        },
      }),
      el('button', {
        class: 'link-btn', type: 'button', text: 'Export',
        onclick: () => exporter.open(),
      }),
      el('label', { class: 'link-btn file' }, 'Import',
        el('input', {
          type: 'file', accept: 'application/json',
          onchange: (e: Event) => {
            const input = e.target as HTMLInputElement;
            void doImport(input.files?.[0]);
            input.value = '';
          },
        })),
      themeBtn,
    ),
  );

  // Coverage and filters scroll together above a register that always keeps a
  // usable height. Without this the twelve meter rows plus twelve kind chips
  // squeeze the register to nothing on a laptop, which is the one surface
  // doc 3 §11 says must always be there.
  const resize = el('div', {
    class: 'panel-resize', role: 'separator', 'aria-orientation': 'vertical',
    'aria-label': 'Resize panel',
  });
  wirePanelResize(resize);
  const collapse = el('button', {
    class: 'icon-btn panel-collapse', type: 'button',
    'aria-label': 'Hide the register', text: '⟩',
    onclick: () => {
      const next = !store.state.panelOpen;
      store.set({ panelOpen: next });
      document.querySelector('.workspace')?.classList.toggle('panel-collapsed', !next);
      collapse.textContent = next ? '⟩' : '⟨';
      collapse.setAttribute('aria-label', next ? 'Hide the register' : 'Show the register');
      placeFilters();
      placeCollapse();
      // The bar picks the coverage sentence up as the column puts it down.
      refresh();
    },
  });

  const L0 = store.state.layers;
  /** One row, one layer. Sub says what it costs or what it is for, because a
   *  menu of eight bare nouns is a quiz (doc 3 §13: controls say what happens). */
  const layerRow = (
    id: string, label: string, sub: string, on: boolean, onclick: () => void,
  ) => el('button', {
    class: 'seg layer-row' + (on ? ' is-on' : ''), type: 'button', id,
    role: 'menuitemcheckbox', 'aria-pressed': String(on), onclick,
  },
    el('span', { class: 'layer-row-label', text: label }),
    el('span', { class: 'layer-row-sub', text: sub }),
  );

  const layers = el('details', { class: 'layers-menu', 'aria-label': 'Map layers' },
    el('summary', {
      id: 'view-layers',
      'aria-label': 'Layers', text: 'Layers',
    }),
    el('div', { class: 'layers-pop', id: 'layers-pop', role: 'menu' },
      el('p', { class: 'layer-kicker', text: 'Basemap' }),
      layerRow('view-atlas', 'Own land', 'Our polygons. Works offline.',
        L0.land, () => toggleLayer('land')),
      layerRow('view-geo', 'Geographic map', 'Third-party raster. Needs a tile URL.',
        L0.raster === 'geo', () => toggleLayer('geo')),
      layerRow('view-street', 'Street map', 'Roads and labels. Needs a tile URL.',
        L0.raster === 'street', () => toggleLayer('street')),

      // Relief. The ground the printed object is moulded from (doc 1 §1.1),
      // and the reason a traveler can see a mountain range before reading a
      // single place name.
      el('p', { class: 'layer-kicker', text: 'Terrain' }),
      layerRow('view-relief', 'Relief shading', 'Hillshade on the land and the sea floor.',
        L0.relief, () => toggleLayer('relief')),
      layerRow('view-elevation', 'Elevation tint', 'Greens, browns, snow, and ocean depth.',
        L0.elevation, () => toggleLayer('elevation')),
      layerRow('view-terrain3d', '3-D mountains', 'The ground stands up. Pitches the camera.',
        L0.terrain3d, () => toggleLayer('terrain3d')),
      el('label', { class: 'layer-range', for: 'terrain-exaggeration' },
        el('span', { class: 'layer-range-label' },
          el('span', { text: 'Height' }),
          el('span', { class: 'mono layer-range-value', id: 'exaggeration-value',
            text: `${L0.exaggeration.toFixed(1)}×` })),
        el('input', {
          id: 'terrain-exaggeration', type: 'range',
          min: String(EXAGGERATION_MIN), max: String(EXAGGERATION_MAX), step: '0.2',
          value: String(L0.exaggeration),
          'aria-label': 'Relief height, one is true scale',
          oninput: (e: Event) => setExaggeration(
            Number((e.target as HTMLInputElement).value)),
        })),
      el('p', { class: 'layer-note', id: 'relief-note' }),

      el('p', { class: 'layer-kicker', text: 'Overlays' }),
      layerRow('view-regions', 'Regions', 'The tessellation, from country zoom.',
        L0.regions, () => toggleLayer('regions')),
      layerRow('view-places', 'Places', 'Every pin that passes the filters.',
        L0.places, () => toggleLayer('places')),
      el('p', { class: 'layer-kicker', text: 'Preview' }),
      layerRow('view-tiles', 'Printed tiles', 'The magnetic pieces, drilled.',
        L0.tiles, () => toggleLayer('tiles')),
    ),
  );
  layers.addEventListener('toggle', () => {
    document.querySelector('.map-wrap')?.classList.toggle('layers-open', layers.open);
    placeLayersPop();
  });

  const sheetHandle = el('button', {
    class: 'sheet-handle', type: 'button', 'aria-label': 'Resize the sheet',
    onclick: () => cycleSheet(),
  });

  const panel = el('section', { class: 'panel', 'aria-label': 'Coverage, filters and register' },
    sheetHandle,
    el('div', { class: 'panel-top' }, filters, coverageHost, tripsHost),
    dangling, registerHost);

  const status = el('div', { class: 'status-bar', hidden: true });

  const workspace = el('main', { class: 'workspace', 'data-sheet': 'half' },
    el('div', { class: 'map-wrap' }, map, mapAlt, layers, status),
    resize, panel, detailHost, collapse);

  app.append(header, workspace);

  return {
    map, register: registerHost, coverage: coverageHost, filters,
    detail: detailHost, status, trips: tripsHost, dangling,
  };
}

/**
 * Does the map bar carry the coverage sentence?
 *
 * It is the product's own sentence, so it must always be on screen — but it
 * was on screen twice: once truncated to an ellipsis in the map bar, and once
 * full size in the register column three hundred pixels away. The register
 * owns it whenever the register is there. The bar picks it up when the column
 * is collapsed, and on a phone, where the sheet can sit at peek.
 */
function barCarriesCoverage(): boolean {
  const narrow = window.matchMedia('(max-width: 1023px)').matches;
  return narrow || !store.state.panelOpen;
}

/** On a phone the column chevron is gone, so Hide the register lives in the
 *  header — still 44×44, still the same control that brings the register back
 *  (doc 3 §11, §12). */
function placeCollapse() {
  const btn = document.querySelector('.panel-collapse');
  if (!btn) return;
  const narrow = window.matchMedia('(max-width: 1023px)').matches;
  const headerRight = document.querySelector('.header-right');
  const workspace = document.querySelector('.workspace');
  if (narrow && headerRight) {
    if (btn.parentElement !== headerRight) headerRight.prepend(btn);
  } else if (workspace && btn.parentElement !== workspace) {
    workspace.append(btn);
  }
}

/** Filters live on the map, as a top bar — never in the register column. */
function placeFilters() {
  if (!shell) return;
  const host = shell.filters;
  const mapWrap = shell.map.parentElement!;
  host.classList.add('on-map');
  host.querySelector('.filters')?.classList.add('on-map');
  if (host.parentElement !== mapWrap) mapWrap.append(host);
  const layers = mapWrap.querySelector('.layers-menu');
  if (layers && layers.parentElement !== host) host.append(layers);
  ensureChromeToggles();
  atlas?.map?.resize();
  placeTrips();
  placeDetail();
}

/** Filter bar and sheet collapse to 44×44 chevrons on the page and in
 *  fullscreen (doc 5 §4.1). They do not disappear. */
function ensureChromeToggles() {
  const wrap = document.querySelector('.map-wrap');
  const host = shell?.filters;
  if (!wrap || !host) return;
  if (!host.querySelector(':scope > .filter-collapse')) {
    host.append(el('button', {
      class: 'icon-btn filter-collapse', type: 'button',
      'aria-label': 'Hide the filters', text: '︿',
      onclick: (e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement;
        const collapsed = wrap.classList.toggle('filters-collapsed');
        btn.setAttribute('aria-label', collapsed ? 'Show the filters' : 'Hide the filters');
        btn.textContent = collapsed ? '﹀' : '︿';
      },
    }));
  }
  const workspace = wrap.parentElement;
  if (workspace && !workspace.querySelector(':scope > .sheet-show')) {
    workspace.append(el('button', {
      class: 'icon-btn sheet-show', type: 'button', hidden: true,
      'aria-label': 'Show the sheet', text: '⟨',
      onclick: () => revealSheet(),
    }));
  }
}

function hideSheet() {
  document.querySelector('.workspace')?.classList.add('sheet-collapsed');
  const show = document.querySelector<HTMLButtonElement>('.sheet-show');
  if (show) show.hidden = false;
}

function revealSheet() {
  document.querySelector('.workspace')?.classList.remove('sheet-collapsed');
  const show = document.querySelector<HTMLButtonElement>('.sheet-show');
  if (show) show.hidden = true;
  placeDetail();
}

function placeLayersPop() {
  const details = document.querySelector('.layers-menu') as HTMLDetailsElement | null;
  const pop = document.getElementById('layers-pop');
  const sum = details?.querySelector('summary');
  const wrap = document.querySelector('.map-wrap');
  if (!details || !pop || !sum || !wrap) return;
  if (!details.open) {
    details.append(pop);
    return;
  }
  const wr = wrap.getBoundingClientRect();
  const r = sum.getBoundingClientRect();
  wrap.append(pop);
  // Nine layers and a slider is taller than a phone. Park it against the map's
  // own box and let it scroll inside itself; the page body never scrolls.
  const w = Math.round(Math.min(280, Math.max(200, wrap.clientWidth - 16)));
  const top = Math.round(r.bottom - wr.top + 4);
  pop.style.top = `${top}px`;
  pop.style.left = `${Math.round(Math.max(8, Math.min(
    r.right - wr.left - w, wrap.clientWidth - w - 8,
  )))}px`;
  pop.style.width = `${w}px`;
  pop.style.maxHeight = `${Math.max(180, wrap.clientHeight - top - 12)}px`;
}

function placeTrips() {
  if (!shell) return;
  const narrow = window.matchMedia('(max-width: 1023px)').matches;
  const onMap = !!store.state.tripsOpen && (narrow || !store.state.panelOpen);
  const host = shell.trips;
  const mapWrap = shell.map.parentElement!;
  if (onMap) {
    host.classList.add('trips-on-map');
    host.hidden = false;
    mapWrap.append(host);
  } else {
    host.classList.remove('trips-on-map');
    host.hidden = !store.state.tripsOpen;
    shell.coverage.parentElement?.append(host);
  }
}

/** Selection opens the panel (doc 3 §6.1). With the column gone, the sheet
 *  parks on the map so Add to a trip is still a tap, not a hidden control. */
function placeDetail() {
  if (!shell) return;
  const host = shell.detail;
  const narrow = window.matchMedia('(max-width: 1023px)').matches;
  const park = !narrow && !store.state.panelOpen && !host.hidden;
  const mapWrap = shell.map.parentElement!;
  const workspace = mapWrap.parentElement!;
  if (park) {
    host.classList.add('detail-on-map');
    mapWrap.append(host);
  } else {
    host.classList.remove('detail-on-map');
    const panel = workspace.querySelector('.panel');
    if (panel) panel.after(host);
    else workspace.append(host);
  }
}

/** Keep the place on the visible disc, not under the filter bar or sheet. */
function showOnMapPadding(): { top: number; right: number; bottom: number; left: number } {
  const map = shell?.map.getBoundingClientRect();
  if (!map) return { top: 60, right: 60, bottom: 60, left: 60 };
  const chrome = [
    document.querySelector('.filters.on-map')?.getBoundingClientRect(),
    shell && !shell.detail.hidden ? shell.detail.getBoundingClientRect() : undefined,
  ];
  let top = 24, right = 24, bottom = 24, left = 24;
  for (const r of chrome) {
    if (!r || r.width < 8 || r.height < 8) continue;
    const ix = Math.max(0, Math.min(r.right, map.right) - Math.max(r.left, map.left));
    const iy = Math.max(0, Math.min(r.bottom, map.bottom) - Math.max(r.top, map.top));
    if (ix < 8 || iy < 8) continue;
    // A full-width sheet is a bottom strip; a corner card is a side strip.
    // Pad the shallow edge so we do not consume the whole map on a phone.
    if (iy <= ix) {
      if (r.top <= map.top + 4) top = Math.max(top, Math.round(iy + 8));
      else if (r.bottom >= map.bottom - 4) bottom = Math.max(bottom, Math.round(iy + 8));
    } else {
      if (r.left <= map.left + 4) left = Math.max(left, Math.round(ix + 8));
      else if (r.right >= map.right - 4) right = Math.max(right, Math.round(ix + 8));
    }
  }
  const minVisible = 120;
  if (top + bottom > map.height - minVisible) {
    const scale = (map.height - minVisible) / (top + bottom);
    top = Math.round(top * scale);
    bottom = Math.round(bottom * scale);
  }
  if (left + right > map.width - minVisible) {
    const scale = (map.width - minVisible) / (left + right);
    left = Math.round(left * scale);
    right = Math.round(right * scale);
  }
  return { top, right, bottom, left };
}

// ---- actions ------------------------------------------------------------

function dismissDetail() {
  // Selecting never zooms; dismissing must also not move the camera (doc 3 §6.1).
  revealSheet();
  detail.empty();
  register.setSelected(null);
  atlas?.select(null);
  atlas?.selectRegion(null);
  store.set({ detail: { kind: 'none' }, selected: null });
  const show = document.querySelector<HTMLButtonElement>('.sheet-show');
  if (show) show.hidden = true;
  placeDetail();
}

function toggle(id: string) {
  const scopePins = currentScopePins();
  const before = coverage(scopePins, record.visited);
  const now = record.toggle(id);

  // Marking never moves the map (doc 3 §6.1). Nothing below touches the camera.
  atlas?.setVisited(id, now);
  register.refreshRow(id);
  detail.setMarked(id, now);
  const after = coverage(scopePins, record.visited);
  lastCoverage = after;
  meter.render(after, scopeLabel(store.state.scope));

  const pin = bundle.pinById.get(id)!;
  const completed = now ? newlySeen(before, after) : [];
  meter.pulse(now ? kindsOf(pin.kinds) : []);
  const label = scopeLabel(store.state.scope);
  const count = barCoverageCount(after, label);
  filterBar.setCoverage(
    gapSentence(after.unseen, bundle.manifest.archetypes)
      || (after.availableKinds === 0
        ? 'No places here yet.'
        : `Every kind of place ${label} has is on your record.`),
    count.shown,
    count.full,
  );

  const country = bundle.countryName.get(pin.iso3) ?? pin.iso3;
  announce(
    `${pin.name}, ${country}. ${now ? 'Marked as visited' : 'No longer marked'}.`
    + (completed.length
      ? ` That is the first ${completed.map((k) => bundle.manifest.archetypes[k].toLowerCase()).join(' and ')} on your record ${scopeLabel(store.state.scope)}.`
      : ` ${after.seenKinds} of ${after.availableKinds} kinds seen ${scopeLabel(store.state.scope)}.`),
  );
  paintCountryTint();
  updateMapAlt();
  refreshStatus();
  const shown = apply(scopePins, store.state.filters, {
    visited: record.visited, scope: store.state.scope,
    entry: store.state.passport?.destinations,
  }).length;
  register.setSummary(registerSummary(shown, scopePins.length, store.state));
  void kickSync();
}

function pickKind(k: KindCode) {
  // The meter is a control, not a readout (doc 3 §8): tapping a gap activates
  // the chip and narrows the register to it. This is the product's core loop.
  const kinds = new Set(store.state.filters.kinds);
  kinds.has(k) ? kinds.delete(k) : kinds.add(k);
  store.set({ filters: { ...store.state.filters, kinds } });
  const label = bundle.manifest.archetypes[k];
  announce(kinds.has(k) ? `Register filtered to ${label}.` : `${label} filter cleared.`);
}

function setScope(scope: Scope) {
  // Score is country-relative, so a band set inside one country must not
  // silently follow the traveler out of it.
  const filters = scope.kind === 'country'
    ? store.state.filters
    : { ...store.state.filters, scoreMin: 0 };
  store.set({ scope, filters });
  atlas?.selectCountry(scope.kind === 'country' ? scope.iso3 : null);
  atlas?.selectTerritory(scope.kind === 'territory' ? scope.id : null);
}

let openSeq = 0;

async function openPlace(id: string) {
  // Selecting never zooms (doc 3 §6.1). Selection opens the panel; the camera
  // is the traveler's business. The pin is enough to un-hide the sheet; the
  // country file enriches it when it arrives.
  const pin = bundle.pinById.get(id);
  if (!pin) return;
  const seq = ++openSeq;
  revealSheet();
  store.set({ selected: id, detail: { kind: 'place', id } });
  atlas?.select(id);
  atlas?.selectRegion(null);
  register.setSelected(id);
  register.reveal(id);
  const ctx = {
    visited: record.isVisited(id),
    pins: bundle.byCountry.get(pin.iso3) ?? [],
    visitedSet: record.visited,
    territoryName: pin.territoryId ? bundle.territories.get(pin.territoryId)?.name : undefined,
    entry: entryFor(pin.iso3),
    passportName: store.state.passport?.name,
    visitedOn: record.get(id)?.visited_on,
    note: record.get(id)?.note,
    livability: bundle.countryEntry(pin.iso3)?.livability,
  };
  detail.place(pinAsPlace(pin), ctx);
  placeDetail();
  try {
    const place = await bundle.place(id);
    if (seq !== openSeq || !place) return;
    detail.place(place, {
      ...ctx,
      visited: record.isVisited(id),
      visitedOn: record.get(id)?.visited_on,
      note: record.get(id)?.note,
      livability: bundle.countryEntry(pin.iso3)?.livability,
    });
  } catch { /* keep the pin sheet */ }
}

function pinAsPlace(pin: Pin): Place {
  const months = monthsFromMask(pin.months);
  return {
    place_id: pin.id,
    name: pin.name,
    country: bundle.countryName.get(pin.iso3) ?? pin.iso3,
    lat: pin.lat,
    lon: pin.lon,
    is_site: pin.isSite,
    score: pin.score,
    archetypes: kindsOf(pin.kinds),
    archetype_weights: [],
    whs: pin.whs,
    ...(months.length ? { best_months: months } : {}),
    on_printed_map: pin.onPrintedMap,
    printed_rank: null,
    territory_id: pin.territoryId || null,
    sources: [],
  };
}

function monthsFromMask(mask: number): number[] {
  const out: number[] = [];
  for (let m = 1; m <= 12; m++) if (mask & (1 << (m - 1))) out.push(m);
  return out;
}

async function openCountry(iso3: string) {
  const entry = bundle.countryEntry(iso3);
  if (!entry) return;
  const seq = ++openSeq;
  revealSheet();
  setScope({ kind: 'country', iso3 });
  store.set({ detail: { kind: 'country', iso3 }, selected: null });
  atlas?.select(null);
  atlas?.selectRegion(null);
  const ctx = {
    pins: bundle.byCountry.get(iso3) ?? [],
    visited: record.visited,
    tiles: [...bundle.territories.values()].filter((t) => t.iso3 === iso3),
    entryReq: entryFor(iso3),
    passportName: store.state.passport?.name,
    regions: [...bundle.regions.values()]
      .filter((r) => r.iso3 === iso3)
      .sort((a, b) => a.name.localeCompare(b.name)),
    density: store.state.filters.densityPerCountry,
    livability: entry.livability,
  };
  detail.country(entry, ctx);
  placeDetail();
  try {
    const file = await bundle.country(iso3);
    if (seq !== openSeq) return;
    detail.country(entry, {
      ...ctx,
      disputed: file.places.some((p) => !!p.disputed),
      livability: file.livability ?? entry.livability,
    });
  } catch { /* the index sheet is enough */ }
}

function openRegion(id: string) {
  const r = bundle.regions.get(id);
  if (!r) return;
  ++openSeq;
  revealSheet();
  store.set({ detail: { kind: 'region', id }, selected: null });
  atlas?.select(null);
  atlas?.selectRegion(id);
  detail.region(r, {
    pins: bundle.byRegion.get(id) ?? [],
    visited: record.visited,
    countryName: bundle.countryName.get(r.iso3) ?? r.country,
  });
  placeDetail();
}

function openTerritory(id: string) {
  const t = bundle.territories.get(id);
  if (!t) return;
  ++openSeq;
  revealSheet();
  setScope({ kind: 'territory', id });
  store.set({ detail: { kind: 'territory', id }, selected: null });
  atlas?.select(null);
  atlas?.selectRegion(null);
  detail.territory(t, { pins: bundle.byTerritory.get(id) ?? [], visited: record.visited });
  placeDetail();
}

async function choosePassport(iso3: string | null) {
  if (!iso3) {
    store.set({
      passport: null,
      filters: { ...store.state.filters, passport: null, entryStates: new Set() },
    });
    record.saveProfile({ passport: null });
    register.entry = null;
    refresh();
    return;
  }
  try {
    store.set({ filters: { ...store.state.filters, passport: iso3 } });
    refresh();
    const file = await bundle.passport(iso3);
    store.set({ passport: file, filters: { ...store.state.filters, passport: iso3 } });
    record.saveProfile({ passport: iso3 });
    register.entry = file.destinations;
    announce(`Entry requirements shown for a ${file.name} passport.`);
    refresh();
  } catch {
    announce('That passport is not in the index.');
  }
}

const entryFor = (iso3: string): Entry | undefined =>
  store.state.passport?.destinations[iso3];

// ---- rendering ----------------------------------------------------------

function currentScopePins(): Pin[] {
  return inScope(bundle.pins, bundle.byCountry, bundle.byTerritory, store.state.scope);
}

function applyCtx() {
  return {
    visited: record.visited, scope: store.state.scope,
    entry: store.state.passport?.destinations,
  };
}

function posterScopeKind(): 'world' | 'country' | 'region' {
  if (store.state.detail.kind === 'region') return 'region';
  if (store.state.scope.kind === 'country') return 'country';
  if (store.state.scope.kind === 'territory') return 'region';
  return 'world';
}

function posterScopeTitle(): string {
  const d = store.state.detail;
  if (d.kind === 'region') return bundle.regions.get(d.id)?.name ?? 'This region';
  const s = store.state.scope;
  if (s.kind === 'country') return bundle.countryName.get(s.iso3) ?? s.iso3;
  if (s.kind === 'territory') return bundle.territories.get(s.id)?.name ?? 'This tile';
  return 'The world';
}

function posterPinSet(): Pin[] {
  const d = store.state.detail;
  if (d.kind === 'region') {
    const r = bundle.regions.get(d.id);
    return apply(bundle.byRegion.get(d.id) ?? [], store.state.filters, {
      visited: record.visited,
      scope: r ? { kind: 'country', iso3: r.iso3 } : store.state.scope,
      entry: store.state.passport?.destinations,
    });
  }
  return apply(currentScopePins(), store.state.filters, applyCtx());
}

function exportFilterLine(): string {
  const f = store.state.filters;
  const labels = bundle.manifest.archetypes;
  const parts = [posterScopeTitle()];
  parts.push(f.visited === 'all' ? 'all' : f.visited === 'yes' ? 'visited' : 'not visited');
  parts.push(f.kinds.size
    ? [...f.kinds].map((k) => labels[k]).join(', ')
    : 'all kinds');
  if (f.densityPerCountry > 0) parts.push(`${f.densityPerCountry} per country`);
  if (store.state.passport) parts.push(`${store.state.passport.name} passport`);
  if (f.whsOnly) parts.push('World Heritage');
  if (f.printedOnly) parts.push('on the printed map');
  return parts.join(' · ');
}

async function sourcesForPins(pins: Pin[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const isos = [...new Set(pins.map((p) => p.iso3))];
  for (let i = 0; i < isos.length; i += 8) {
    await Promise.all(isos.slice(i, i + 8).map(async (iso) => {
      try {
        const file = await bundle.country(iso);
        const want = new Set(pins.filter((p) => p.iso3 === iso).map((p) => p.id));
        for (const pl of file.places) {
          if (want.has(pl.place_id)) out.set(pl.place_id, (pl.sources || []).join('; '));
        }
      } catch { /* sources stay blank — absence is honest */ }
    }));
  }
  return out;
}

function scopeLabel(scope: Scope): string {
  if (scope.kind === 'country') return `in ${bundle.countryName.get(scope.iso3) ?? scope.iso3}`;
  if (scope.kind === 'territory') return `on ${bundle.territories.get(scope.id)?.name ?? 'this tile'}`;
  return 'worldwide';
}

function barCoverageCount(cov: { seenKinds: number; availableKinds: number }, label: string) {
  const full = `${cov.seenKinds} of ${cov.availableKinds} kinds of place seen ${label}`;
  const narrow = window.matchMedia('(max-width: 1023px)').matches;
  return { shown: narrow ? `${cov.seenKinds} of ${cov.availableKinds} kinds` : full, full };
}

function refresh() {
  const s = store.state;
  const scopePins = currentScopePins();
  const cov = coverage(scopePins, record.visited);
  lastCoverage = cov;
  meter.render(cov, scopeLabel(s.scope));

  const uncovered = s.passport
    ? new Set(scopePins.filter((p) => !s.passport!.destinations[p.iso3]).map((p) => p.iso3)).size
    : 0;
  const sentence = gapSentence(cov.unseen, bundle.manifest.archetypes)
    || (cov.availableKinds === 0
      ? 'No places here yet.'
      : `Every kind of place ${scopeLabel(s.scope)} has is on your record.`);
  const filtered = apply(scopePins, s.filters, {
    visited: record.visited, scope: s.scope, entry: s.passport?.destinations,
  });
  const label = scopeLabel(s.scope);
  const count = barCoverageCount(cov, label);
  filterBar.render(s.filters, s.scope, {
    showCoverage: barCarriesCoverage(),
    seasonalityAvailable: bundle.pins.some((p) => p.months > 0),
    passportName: s.passport?.name,
    uncoveredInView: uncovered,
    coverageCount: count.shown,
    coverageCountTitle: count.full,
    coverageSentence: sentence,
    searchHits: s.filters.search.trim()
      ? rankSearchHits(
        s.filters.search.trim(),
        filtered,
        [...bundle.regions.values()].map((r) => ({
          id: r.region_id, name: r.name, country: r.country,
        })),
        bundle.manifest.countries.map((c) => ({ iso3: c.iso3, name: c.country })),
        (iso3) => bundle.countryName.get(iso3) ?? iso3,
      )
      : undefined,
    searchQuery: s.filters.search,
  });
  // "Distance from a chosen point" (doc 2 §5). The chosen point is where the
  // traveler has put the camera, which is the only point they have expressed
  // an opinion about.
  const selected = s.selected ? bundle.pinById.get(s.selected) : undefined;
  const centre = atlas?.map?.getCenter();
  const sorted = sortPins(filtered, s.sort, s.scope, {
    markedAt: (id) => record.get(id)?.marked_at,
    countryName: (iso3) => bundle.countryName.get(iso3) ?? iso3,
    from: selected ? { lat: selected.lat, lon: selected.lon }
      : centre ? { lat: centre.lat, lon: centre.lng } : undefined,
  });

  register.visited = record.visited;
  register.setRows(sorted, registerSummary(sorted.length, scopePins.length, s));
  register.setSort(s.sort, s.scope);
  register.setSelected(s.selected);

  // Scope emphasises, filters remove. The map keeps every place that passes
  // the filter row, wherever it is; the scoped ones stay at full weight and
  // the rest go quiet. A globe that empties itself when a country is opened
  // reads as broken, and the product's claim is whole-world.
  const scopeSet = s.scope.kind === 'world'
    ? null : new Set(scopePins.map((p) => p.id));
  const visible = new Set(filtered.map((p) => p.id));
  if (scopeSet) {
    // Outside the scope the score band cannot apply: score is country-relative
    // and a band set inside Italy means nothing in Peru (doc 1 §3).
    const outside = bundle.pins.filter((p) => !scopeSet.has(p.id));
    for (const p of apply(outside, s.filters, {
      visited: record.visited, scope: { kind: 'world' },
      entry: s.passport?.destinations,
    })) visible.add(p.id);
  }
  atlas?.setVisible(visible);
  atlas?.setScope(scopeSet);

  const btn = document.getElementById('scope-btn')!;
  btn.textContent = s.scope.kind === 'world' ? 'The world'
    : s.scope.kind === 'country' ? (bundle.countryName.get(s.scope.iso3) ?? '')
    : (bundle.territories.get(s.scope.id)?.name ?? '');
  btn.setAttribute('aria-label', s.scope.kind === 'world'
    ? 'Scope: the world' : `Scope: ${btn.textContent}. Tap to return to the world.`);

  updateMapAlt();
  refreshStatus();
}

/** A filter that returns nothing restates itself in words and offers one
 *  action to clear it (doc 3 §9). */
function registerSummary(shown: number, total: number, s: AppState): string {
  if (shown === 0) return `Nothing matches these filters ${scopeLabel(s.scope)}.`;
  const of = shown === total ? '' : ` of ${fmtInt(total)}`;
  const marked = ` · ${fmtInt(currentScopePins().filter((p) => record.isVisited(p.id)).length)} marked`;
  return `${fmtInt(shown)}${of} place${shown === 1 ? '' : 's'} ${scopeLabel(s.scope)}${marked}`;
}

function updateMapAlt() {
  const alt = document.getElementById('map-alt');
  if (!alt || !lastCoverage) return;
  alt.textContent =
    `Map, ${scopeLabel(store.state.scope)}: ${fmtInt(lastCoverage.places)} places, `
    + `${fmtInt(lastCoverage.visited)} marked as visited, `
    + `${lastCoverage.seenKinds} of ${lastCoverage.availableKinds} kinds of place seen. `
    + 'Everything on the map is also in the register below, which is the '
    + 'accessible equivalent of this map.';
}

/** The coverage tint at world zoom. Driven by kinds seen, never by a count of
 *  places, and no number is ever attached to it — a country is not a task. */
function paintCountryTint() {
  const tints = new Map<string, number>();
  for (const [iso3, pins] of bundle.byCountry) {
    const cov = coverage(pins, record.visited);
    tints.set(iso3, cov.availableKinds === 0 || cov.seenKinds === 0
      ? 0 : 0.06 + 0.16 * (cov.seenKinds / cov.availableKinds));
  }
  atlas?.setCountryTint(tints);
}

/** Offline and storage trouble get a quiet persistent bar, never a dialog
 *  (doc 3 §9). Marking still works and queues. */
function refreshStatus() {
  const bar = document.querySelector<HTMLElement>('.status-bar');
  if (!bar) return;
  const offline = !navigator.onLine;
  if (!offline && !record.storageFailed) { bar.hidden = true; return; }
  clear(bar);
  bar.hidden = false;
  bar.append(el('span', {
    text: record.storageFailed
      ? 'This browser is not letting the page save. Your marks are held in memory '
        + 'for this session only.'
      : `Offline. Marking still works — ${record.pending} change`
        + `${record.pending === 1 ? '' : 's'} waiting to sync.`,
  }));
}
window.addEventListener('online', refreshStatus);
window.addEventListener('offline', refreshStatus);

// ---- keyboard -----------------------------------------------------------

function wireKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (exporter?.isOpen) { exporter.close(); return; }
      if (account?.isOpen) { account.close(); return; }
      dismissDetail();
      return;
    }
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // M marks the selected place, from either surface.
    if ((e.key === 'm' || e.key === 'M') && store.state.selected) {
      e.preventDefault();
      toggle(store.state.selected);
    }
    if ((e.key === 't' || e.key === 'T') && store.state.selected) {
      e.preventDefault();
      addToTrip(store.state.selected);
    }
    if (e.key === '/') { e.preventDefault();
      document.querySelector<HTMLInputElement>('.search input')?.focus(); }
  });
}

// ---- theme, export, import ----------------------------------------------

function applyTheme(pref: 'light' | 'dark' | 'system') {
  const dark = pref === 'dark'
    || (pref === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

async function consumeAuthFromUrl() {
  const url = new URL(location.href);
  const magic = url.searchParams.get('magic');
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sess = hash.get('twm-session');
  if (magic) {
    url.searchParams.delete('magic');
    history.replaceState(null, '', url.pathname + url.search);
    record.flush();
    trips.flush();
    try {
      const rec = await session.consumeMagic(magic, {
        visits: record.all(), trips: trips.export(), profile: record.profile,
      });
      applyAccountMerge(rec);
    } catch {
      announce('That sign-in link could not be used.');
    }
    return;
  }
  if (sess) {
    history.replaceState(null, '', url.pathname + url.search);
    session.remember(sess, { id: '', providers: ['google'] });
    try {
      const me = await session.me();
      session.remember(sess, me);
      record.flush();
      trips.flush();
      const rec = await session.pullMerge({
        visits: record.all(), trips: trips.export(), profile: record.profile,
      });
      applyAccountMerge(rec);
    } catch {
      session.clear();
    }
  }
}

function applyAccountMerge(rec: { visits?: Visit[]; trips?: Trip[]; profile?: import('./core/record').Profile }) {
  if (Array.isArray(rec.visits)) record.replaceAll(rec.visits);
  if (Array.isArray(rec.trips)) trips.replaceAll(rec.trips);
  if (rec.profile) record.saveProfile(rec.profile);
  atlas?.syncVisited();
  tripPanel?.render();
  paintTrip();
  refresh();
  paintCountryTint();
  showDangling();
}

async function kickSync() {
  if (!session.signedIn || session.paused) return;
  for (const id of record.pendingIds()) {
    const v = record.get(id);
    if (!v) { record.ack(id); continue; }
    try {
      await session.putVisit(v);
      record.ack(id);
    } catch {
      break;
    }
  }
  await kickTripSync();
}

async function kickTripSync() {
  if (!session.signedIn || session.paused) return;
  for (const t of trips.export()) {
    try { await session.putTrip(t); } catch { break; }
  }
}

function doExport() {
  const doc = record.export(bundle.manifest.build || 'unversioned', trips.export());
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = el('a', {
    href: URL.createObjectURL(blob),
    download: `travelers-world-map-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.append(a); a.click(); a.remove();
  announce(`Exported ${doc.visits.length} records and ${trips.trips.length} trip${trips.trips.length === 1 ? '' : 's'}.`);
}

async function doImport(file?: File) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const res = record.import(parsed);
    if (Array.isArray(parsed?.trips)) trips.import(parsed.trips);
    atlas?.syncVisited();
    tripPanel.render();
    paintTrip();
    refresh(); paintCountryTint();
    showDangling();
    announce(`Imported: ${res.added} added, ${res.updated} updated, ${res.skipped} already current.`);
    void kickSync();
  } catch {
    announce('That file could not be read as a Travelers World Map export.');
  }
}

function openBulk(pins: Pin[], title: string) {
  bulkReturn = store.state.detail;
  bulk.open(title, pins, record.visited);
  placeDetail();
}

function restoreFromBulk() {
  const d = bulkReturn;
  if (d.kind === 'country') openCountry(d.iso3);
  else if (d.kind === 'territory') openTerritory(d.id);
  else if (d.kind === 'region') openRegion(d.id);
  else { detail.empty(); store.set({ detail: { kind: 'none' } }); }
}

/** Marking never moves the camera — bulk marking especially (doc 3 §6.1). */
function applyBulkEdits(universe: string[], ticked: ReadonlySet<string>) {
  const scopePins = currentScopePins();
  const before = coverage(scopePins, record.visited);
  const result = record.applyBulk(universe, ticked);
  atlas?.syncVisited();
  refresh();
  paintCountryTint();
  void kickSync();
  const after = coverage(scopePins, record.visited);
  lastCoverage = after;
  const opened = newlySeen(before, after);
  announce(
    `${result.marked} marked, ${result.unmarked} unmarked. `
    + (opened.length
      ? `First ${opened.map((k) => bundle.manifest.archetypes[k].toLowerCase()).join(' and ')} on your record ${scopeLabel(store.state.scope)}.`
      : `${after.seenKinds} of ${after.availableKinds} kinds seen ${scopeLabel(store.state.scope)}.`),
  );
  return result;
}

function undoBulkEdits(): boolean {
  if (!record.undoBulk()) return false;
  atlas?.syncVisited();
  refresh();
  paintCountryTint();
  void kickSync();
  announce('Bulk marking undone. The previous marks are back.');
  return true;
}

function addToTrip(id: string) {
  if (!trips.active) trips.create('New trip');
  const ok = trips.add(id);
  store.set({ tripsOpen: true });
  if (shell) shell.trips.hidden = false;
  tripPanel.render();
  placeTrips();
  paintTrip();
  const pin = bundle.pinById.get(id);
  announce(ok
    ? `${pin?.name ?? 'Place'} added to ${trips.active!.title}, Day ${trips.active!.stops.find((s) => s.place_id === id)?.day || 1}.`
    : `${pin?.name ?? 'Place'} is already on this trip.`);
}

function paintTrip() {
  const t = trips.active;
  if (!atlas) return;
  if (!t) { atlas.setTrip([]); return; }
  const stops = trips.ordered(t).map((s) => {
    const p = bundle.pinById.get(s.place_id);
    return p ? { lon: p.lon, lat: p.lat, day: s.day, name: p.name } : null;
  }).filter((x): x is { lon: number; lat: number; day: number; name: string } => !!x);
  atlas.setTrip(stops);
}

type LayerToggle =
  | 'land' | 'geo' | 'street' | 'regions' | 'places' | 'tiles'
  | 'relief' | 'elevation' | 'terrain3d';

function toggleLayer(which: LayerToggle) {
  const cur = store.state.layers;
  const next: MapLayers = { ...cur };
  if (which === 'land') {
    // Clicking Own land while the tile preview is on exits the preview and
    // keeps land on (always available). Otherwise it toggles land.
    if (cur.tiles) { next.tiles = false; next.land = true; }
    else next.land = !cur.land;
  } else if (which === 'geo') {
    next.raster = cur.raster === 'geo' ? 'off' : 'geo';
  } else if (which === 'street') {
    next.raster = cur.raster === 'street' ? 'off' : 'street';
  } else if (which === 'regions') {
    next.regions = !cur.regions;
  } else if (which === 'places') {
    next.places = !cur.places;
  } else if (which === 'relief') {
    next.relief = !cur.relief;
  } else if (which === 'elevation') {
    next.elevation = !cur.elevation;
  } else if (which === 'terrain3d') {
    next.terrain3d = !cur.terrain3d;
    // Two pitched readings of the same ground cannot both be true: the tile
    // preview is an object on a table, terrain is the Earth. One at a time.
    if (next.terrain3d) next.tiles = false;
  } else {
    next.tiles = !cur.tiles;
    if (next.tiles) next.terrain3d = false;
  }
  store.set({ layers: next });
  atlas?.applyLayers(next);
  paintLayerButtons(next);
  // Terrain is a working surface, not a menu pick: the traveler will want the
  // height slider next, so the tray stays open for it.
  if (which !== 'relief' && which !== 'elevation' && which !== 'terrain3d') {
    const menu = document.querySelector('.layers-menu') as HTMLDetailsElement | null;
    if (menu) menu.open = false;
    document.querySelector('.map-wrap')?.classList.remove('layers-open');
  }
  placeLayersPop();
  const reliefOk = atlas?.reliefUsable() ?? true;
  const noModel = ' No elevation model is available, so nothing changed on the map.';
  const msg =
    which === 'tiles' ? (next.tiles
      ? 'Printed-tile preview. Raised pieces with drilled holes.'
      : 'Printed-tile preview off.')
    : which === 'geo' ? (next.raster === 'geo'
      ? 'Geographic map. A raster basemap needs a configured tile URL.'
      : 'Geographic map off.')
    : which === 'street' ? (next.raster === 'street'
      ? 'Street map. A raster basemap needs a configured tile URL.'
      : 'Street map off.')
    : which === 'relief' ? (next.relief
      ? 'Relief shading on. Hillshade over the land and the sea floor.' + (reliefOk ? '' : noModel)
      : 'Relief shading off.')
    : which === 'elevation' ? (next.elevation
      ? 'Elevation tint on. Land coloured by height, sea by depth.' + (reliefOk ? '' : noModel)
      : 'Elevation tint off.')
    : which === 'terrain3d' ? (next.terrain3d
      ? 'Three-dimensional terrain on. The camera is pitched; drag with the right button or two fingers to turn it.' + (reliefOk ? '' : noModel)
      : 'Three-dimensional terrain off. The map is flat again.')
    : which === 'regions' ? (next.regions ? 'Regions overlay on.' : 'Regions overlay off.')
    : which === 'places' ? (next.places ? 'Places overlay on.' : 'Places overlay off.')
    : (next.land ? 'Own land on.' : 'Own land off.');
  announce(msg);
}

/** Height is a slider, not a toggle: it must repaint the relief without
 *  rebuilding the tray under the traveler's finger. */
function setExaggeration(raw: number) {
  const exaggeration = clampExaggeration(raw);
  const next: MapLayers = { ...store.state.layers, exaggeration };
  store.set({ layers: next });
  atlas?.applyLayers(next, { pitch: false });
  const out = document.getElementById('exaggeration-value');
  if (out) out.textContent = `${exaggeration.toFixed(1)}×`;
}

function paintLayerButtons(l: MapLayers) {
  const set = (id: string, on: boolean) => {
    const n = document.getElementById(id);
    n?.classList.toggle('is-on', on);
    n?.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  // Own land stays drawn during tile preview; is-on is false while tiles are
  // the mode so existing Atlas-returns-from-Tiles checks still read the control.
  set('view-atlas', l.land && !l.tiles);
  set('view-geo', l.raster === 'geo');
  set('view-street', l.raster === 'street');
  set('view-relief', l.relief);
  set('view-elevation', l.elevation);
  set('view-terrain3d', l.terrain3d);
  set('view-regions', l.regions);
  set('view-places', l.places);
  set('view-tiles', l.tiles);
  paintReliefNote();
}

/** The relief group says what it can actually do. An unreachable elevation
 *  model is stated, not hidden behind a control that silently does nothing
 *  (doc 3 §9). */
function paintReliefNote() {
  const note = document.getElementById('relief-note');
  if (!note) return;
  const status = atlas?.reliefStatus() ?? 'ok';
  const disabled = status !== 'ok';
  note.textContent =
    status === 'unconfigured'
      ? 'No elevation model is configured, so these three do nothing. Set VITE_TWM_TERRAIN_DEM to a terrarium tile URL.'
      : status === 'unreachable'
        ? 'The elevation model could not be reached. Everything else on the map still works, and marking still works offline.'
        : 'Heights from SRTM, 3DEP, GMTED and ETOPO1. 1× is true scale.';
  note.classList.toggle('is-warning', disabled);
  for (const id of ['view-relief', 'view-elevation', 'view-terrain3d']) {
    document.getElementById(id)?.toggleAttribute('data-unavailable', disabled);
  }
  const range = document.getElementById('terrain-exaggeration') as HTMLInputElement | null;
  if (range) range.disabled = disabled;
}

function cycleSheet() {
  const order: AppState['sheet'][] = ['peek', 'half', 'full'];
  const i = order.indexOf(store.state.sheet);
  const next = order[(i + 1) % order.length];
  store.set({ sheet: next });
  document.querySelector('.workspace')?.setAttribute('data-sheet', next);
}

function wirePanelResize(handle: HTMLElement) {
  let startX = 0, startW = 0;
  handle.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    startW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-w')) || 400;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const next = Math.max(360, Math.min(480, startW - (e.clientX - startX)));
    document.documentElement.style.setProperty('--panel-w', `${next}px`);
    atlas?.map?.resize();
  });
}

function showDangling() {
  if (!shell) return;
  const lost = record.all().filter((v) => v.visited && !bundle.pinById.has(v.place_id));
  if (!lost.length) { shell.dangling.hidden = true; return; }
  clear(shell.dangling);
  shell.dangling.hidden = false;
  shell.dangling.append(
    el('p', { class: 'note', text:
      `${lost.length} marked ${lost.length === 1 ? 'place is' : 'places are'} `
      + 'not in this build of the database. They stay on your record and will '
      + 'be in any export. They do not count toward coverage — their kinds of '
      + 'place are no longer known.' }),
    el('button', {
      class: 'link-btn', type: 'button', text: 'Export a copy',
      onclick: () => doExport(),
    }),
  );
}

// Re-cut the marks if the system theme flips under a "system" preference.
window.matchMedia?.('(prefers-color-scheme: dark)')
  .addEventListener?.('change', () => {
    if ((record.profile.theme ?? 'system') === 'system') {
      applyTheme('system');
      atlas?.retheme();
    }
  });

export { ALL_KINDS };
