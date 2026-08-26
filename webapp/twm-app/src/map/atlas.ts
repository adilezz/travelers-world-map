/**
 * The Atlas view.
 *
 * Rules this file exists to keep (doc 3 §6.1, and they are not negotiable):
 *   selecting never zooms; marking never moves the camera; clusters state
 *   their contents; hit targets exceed the visual mark; and the map is never
 *   the only route to anything.
 *
 * Two point sources, split at CLUSTER_MAX_Z, because the spike settled it:
 * MapLibre's own clustering silently drops `promoteId`, so feature-state
 * marking cannot ride on a clustered source — and `clusterProperties` could
 * never have supplied the visited count anyway, since visited is user state
 * rather than data. Below the split we build clusters ourselves and they carry
 * both counts honestly. Above it, feature-state does the marking with no
 * geometry re-upload.
 */
import maplibregl, { type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import { markerImages, selectionImage, type MarkerTheme } from './markers';
import {
  SATELLITE_ATTRIBUTION, SATELLITE_MAXZOOM, satelliteRasterTiles,
} from './basemap-config';
import {
  DEM, ELEVATION_LAYER, HILLSHADE_LAYER, clampExaggeration, demSource,
  elevationLayer, hillshadeLayer, hillshadePaint, shadeStrength,
  type ReliefTokens,
} from './terrain';
import type { MapLayers, Pin } from '../core/types';
import { defaultLayers } from '../core/types';

export const CLUSTER_MAX_Z = 4.6;
const PLACES = 'places';
const CLUSTERS = 'clusters';
const COUNTRIES = 'countries';
const TERRITORIES = 'territories';
const TILES = 'tiles';
const REGIONS = 'regions';
const TRIP = 'trip';
const GRATICULE = 'graticule';

/** How many elevation tiles must fail, with none ever delivered, before the
 *  relief is called unreachable rather than slow. */
const DEM_FAILURES_BEFORE_GIVING_UP = 6;

/** Country zoom. Regions are off at world zoom and on from here (doc 5 §4.3). */
export const REGION_MIN_Z = 3.6;

export interface AtlasHooks {
  /** The elevation model went away. Doc 3 §9: say what failed and what still
   *  works — never draw a flat surface and call it terrain. */
  onReliefUnavailable?(): void;
  onPlace(id: string): void;
  onCountry(iso3: string): void;
  onTerritory(id: string): void;
  onRegion(id: string): void;
  onBackground(): void;
  onHoverPlace(id: string | null): void;
  /** True while a sheet is open, so a click that is not a pin dismisses
   *  rather than opening a country or zooming a cluster (doc 3 §6.1). */
  hasSelection(): boolean;
}

function tokens() {
  const s = getComputedStyle(document.documentElement);
  const t = (n: string) => s.getPropertyValue(n).trim();
  return {
    surface: t('--surface'), land: t('--land'), landEdge: t('--land-edge'),
    water: t('--water'), accent: t('--accent'), inkFaint: t('--ink-faint'),
    ink: t('--ink'), focus: t('--focus'), sunken: t('--surface-sunken'),
    surfaceRaised: t('--surface-raised'),
  };
}

const isDark = () => document.documentElement.dataset.theme === 'dark';

/** The shading is cut from the surface, not from the panel, so a highlight on
 *  a ridge is the same tone as the water beside it. */
const reliefTokens = (c: ReturnType<typeof tokens>): ReliefTokens => ({
  ink: c.ink, land: c.land, landEdge: c.landEdge,
  water: c.water, surface: c.surfaceRaised, inkFaint: c.inkFaint,
});

export type BasemapKind = 'satellite';

export function rasterTiles(): string[] {
  return satelliteRasterTiles();
}

const BASEMAP = 'basemap';
/** One transparent pixel. A raster source with no tiles logs errors. */
const BLANK_TILE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export class Atlas {
  map!: MLMap;
  private pins: Pin[] = [];
  private visited!: ReadonlySet<string>;
  private visible = new Set<string>();     // ids passing the current filter
  /** Null at world scope. Otherwise the pins the panel is about — quieted
   *  elsewhere rather than removed. */
  private scopeIds: Set<string> | null = null;

  private hovered: string | null = null;
  private countryTint = new Map<string, number>();
  private clusterTimer = 0;
  private layers: MapLayers = defaultLayers();
  private rawTerritories: any;
  private rawRegions: any;
  private styleReady = false;
  /** Null when no elevation model is configured at all. */
  private dem = demSource();
  /** Set once the model has been asked for and could not answer at all. */
  private reliefBroken = false;
  private reliefWarned = false;
  private demFailures = 0;
  private demDelivered = false;

  constructor(private container: HTMLElement, private hooks: AtlasHooks) {}

  async init(opts: {
    placesGeoJSON: any; countriesGeoJSON: any; territoriesGeoJSON: any;
    regionsGeoJSON?: any;
    pins: Pin[]; visited: ReadonlySet<string>;
  }) {
    this.pins = opts.pins;
    this.visited = opts.visited;
    this.rawTerritories = opts.territoriesGeoJSON;
    this.rawRegions = opts.regionsGeoJSON ?? emptyFC();
    for (const p of this.pins) this.visible.add(p.id);
    const c = tokens();

    const style: StyleSpecification = {
      version: 8,
      // Doc 4 §5.1: a globe at world zoom easing into Mercator as the traveler
      // zooms in. The globe supplies the whole-world-as-an-object feeling the
      // printed product has, without fighting the tile pyramid.
      projection: { type: 'globe' },
      // Noto Sans Regular is what demotiles actually hosts. Open Sans Regular
      // 404s, and a glyph 404 makes map.loaded() flap after the load event.
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        [BASEMAP]: {
          type: 'raster',
          tiles: [BLANK_TILE],
          tileSize: 256,
          attribution: '',
          maxzoom: SATELLITE_MAXZOOM,
        },
        // The elevation model. Absent from the style entirely when no DEM is
        // configured, so an owner who rules the request out pays nothing for
        // the control still being in the menu.
        ...(this.dem ? { [DEM]: this.dem } : {}),
        [GRATICULE]: { type: 'geojson', data: graticule() },
        [COUNTRIES]: { type: 'geojson', data: opts.countriesGeoJSON, promoteId: 'iso3' },
        [TERRITORIES]: { type: 'geojson', data: opts.territoriesGeoJSON, promoteId: 'territory_id' },
        [REGIONS]: {
          type: 'geojson', data: this.rawRegions, promoteId: 'region_id',
          // 14 MB of tessellation. Coarser tiles so country zoom can paint.
          tolerance: 1.2, maxzoom: 8,
        },
        [TILES]: { type: 'geojson', data: emptyFC() },
        [PLACES]: { type: 'geojson', data: opts.placesGeoJSON, promoteId: 'id' },
        [CLUSTERS]: { type: 'geojson', data: emptyFC() },
        [TRIP]: { type: 'geojson', data: emptyFC() },
      },
      layers: [
        { id: 'water', type: 'background', paint: { 'background-color': c.water } },
        {
          id: 'basemap', type: 'raster', source: BASEMAP,
          layout: { visibility: 'none' },
          paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
        },
        // Hypsometric ground, above the photograph and under our own land so
        // the land fill can be pulled back to a wash rather than removed when
        // the tint is on. The two are never both wanted, and the layer menu
        // does not stop a traveler asking: whichever is on top wins, and the
        // tint is opaque enough to be that.
        ...(this.dem ? [elevationLayer(isDark())] : []),
        {
          id: 'country-fill', type: 'fill', source: COUNTRIES,
          paint: { 'fill-color': c.land, 'fill-opacity': 0.28 },
        },
        // Shading sits above the land fill and below the coverage tint: it
        // engraves our own ground, and it never darkens the one place the
        // accent is allowed to mean something.
        ...(this.dem ? [hillshadeLayer(reliefTokens(c))] : []),
        {
          // Meridians and parallels, at world zoom only. An atlas has them and
          // a chart without them has no scale; by country zoom they are noise.
          id: 'graticule', type: 'line', source: GRATICULE,
          maxzoom: 4.2,
          paint: {
            'line-color': c.landEdge,
            'line-width': 0.5,
            'line-opacity': [
              'interpolate', ['linear'], ['zoom'], 1.4, 0.35, 3, 0.2, 4.2, 0,
            ],
          },
        },
        {
          // Coverage tint. The accent means visited, and a country the traveler
          // has seen kinds of place in is exactly that — so this is the one
          // place besides a pin where it belongs. No number is ever attached:
          // a country is not a task (doc 3 §13).
          id: 'country-coverage', type: 'fill', source: COUNTRIES,
          paint: {
            'fill-color': c.accent,
            'fill-opacity': ['coalesce', ['feature-state', 'tint'], 0],
          },
        },
        {
          // Coastal halo. A blurred stroke on the shoreline is the oldest
          // trick in printed cartography and it does more for "this is the
          // sea" than any colour choice: land stops looking like a sticker.
          id: 'coast-halo', type: 'line', source: COUNTRIES,
          paint: {
            'line-color': c.landEdge,
            'line-width': ['interpolate', ['linear'], ['zoom'], 1.4, 3, 5, 8, 9, 14],
            'line-blur': ['interpolate', ['linear'], ['zoom'], 1.4, 3, 5, 8, 9, 14],
            'line-opacity': 0.4,
          },
        },
        {
          id: 'country-line', type: 'line', source: COUNTRIES,
          paint: { 'line-color': c.landEdge, 'line-width': 0.8 },
        },
        {
          id: 'country-selected', type: 'line', source: COUNTRIES,
          filter: ['==', ['get', 'iso3'], ''],
          paint: { 'line-color': c.ink, 'line-width': 1.8 },
        },
        {
          // Web regions: the tessellation. Off at world zoom, on at country
          // zoom. Never the accent — kinds of place are shape, not colour,
          // and this is land, not a visit (doc 5 §4.3).
          id: 'region-fill', type: 'fill', source: REGIONS,
          minzoom: REGION_MIN_Z,
          paint: { 'fill-color': c.ink, 'fill-opacity': 0.08 },
        },
        {
          id: 'region-line', type: 'line', source: REGIONS,
          minzoom: REGION_MIN_Z,
          paint: {
            'line-color': c.landEdge,
            'line-width': ['interpolate', ['linear'], ['zoom'], 3.6, 0.5, 7, 1.2],
            'line-opacity': 0.85,
          },
        },
        {
          id: 'region-selected', type: 'line', source: REGIONS,
          minzoom: REGION_MIN_Z,
          filter: ['==', ['get', 'region_id'], ''],
          paint: { 'line-color': c.ink, 'line-width': 1.6 },
        },
        {
          // Tiles come in at country zoom (doc 2 §4.2) and strengthen at region
          // zoom. Below that they are noise over a globe.
          id: 'territory-line', type: 'line', source: TERRITORIES,
          minzoom: 3.6,
          paint: {
            'line-color': c.landEdge,
            'line-dasharray': [2, 2],
            'line-width': ['interpolate', ['linear'], ['zoom'], 3.6, 0.4, 6, 1.1],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 3.6, 0, 4.4, 0.85],
          },
        },
        {
          id: 'territory-selected', type: 'fill', source: TERRITORIES,
          filter: ['==', ['get', 'territory_id'], ''],
          paint: { 'fill-color': c.ink, 'fill-opacity': 0.07 },
        },
        {
          // Clusters: an open ring, filled only when everything inside it has
          // been seen, so progress is legible at world zoom without a number
          // having to be read (doc 3 §8).
          id: 'cluster-shape', type: 'circle', source: CLUSTERS,
          maxzoom: CLUSTER_MAX_Z,
          paint: {
            'circle-radius': [
              'interpolate', ['linear'], ['get', 'n'], 1, 9, 20, 13, 200, 19, 1200, 26,
            ],
            'circle-color': [
              'case', ['==', ['get', 'seen'], ['get', 'n']], c.accent, 'rgba(0,0,0,0)',
            ],
            'circle-opacity': ['case', ['==', ['get', 'inScope'], 0], 0.3, 0.9],
            'circle-stroke-width': 1.3,
            'circle-stroke-color': ['case', ['>', ['get', 'seen'], 0], c.accent, c.inkFaint],
          },
        },
        // The mark, as two layers rather than one.
        //
        // `icon-image` is a LAYOUT property, and MapLibre does not allow
        // feature-state in layout expressions — so the icon cannot switch from
        // ring to filled dot when a place is marked. Shape comes from the data
        // (`site`, `hole`), which layout does allow; visitedness comes from
        // `icon-opacity`, which is paint and does allow it. Two stacked
        // layers, one showing at a time. Discovered by the renderer failing
        // loudly at style load, which is the good kind of failure.
        ...(['off', 'on'] as const).map((state) => ({
          id: state === 'off' ? 'place-open' : 'place-filled',
          type: 'symbol' as const, source: PLACES,
          minzoom: CLUSTER_MAX_Z,
          layout: {
            'icon-image': [
              'concat', 'm-',
              ['case', ['==', ['get', 'site'], 1], 'sq', 'ci'], `-${state}-`,
              ['case', ['==', ['get', 'hole'], 1], 'hole', 'flat'],
            ],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 4.6, 0.42, 8, 0.6, 12, 0.78],
            // Collision, not fill rate, is what stutters a mid-range phone
            // (doc 4 §5.2). Nothing here is allowed to collide.
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          } as any,
          paint: {
            // Three states, and the distinction matters.
            //
            // A FILTER removes: the traveler asked not to see these.
            // A SCOPE emphasises: the panel is about one country, but the
            // product's claim is whole-world, and a globe that empties itself
            // when you click a country reads as broken rather than as focused.
            'icon-opacity': [
              'case',
              ['!=', ['boolean', ['feature-state', 'visited'], false], state === 'on'], 0,
              ['boolean', ['feature-state', 'hidden'], false], 0,
              ['boolean', ['feature-state', 'outOfScope'], false], 0.3,
              1,
            ],
          } as any,
        })),
        {
          id: 'place-selected', type: 'symbol', source: PLACES,
          minzoom: CLUSTER_MAX_Z,
          filter: ['==', ['get', 'id'], ''],
          layout: {
            'icon-image': 'm-selected',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 4.6, 0.5, 12, 0.9],
            'icon-allow-overlap': true, 'icon-ignore-placement': true,
          },
        },
        {
          id: 'place-hovered', type: 'symbol', source: PLACES,
          minzoom: CLUSTER_MAX_Z,
          filter: ['==', ['get', 'id'], ''],
          layout: {
            'icon-image': 'm-selected',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 4.6, 0.46, 12, 0.82],
            'icon-allow-overlap': true, 'icon-ignore-placement': true,
          },
          paint: { 'icon-opacity': 0.55 },
        },
        {
          // Region zoom: place names. Collision, not fill rate, is what
          // stutters a mid-range phone — so labels may drop rather than fight.
          id: 'place-label', type: 'symbol', source: PLACES,
          minzoom: 5.8,
          layout: {
            'text-field': ['get', 'n'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, 1.15],
            'text-optional': true,
            'text-padding': 2,
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': c.ink,
            'text-halo-color': c.land,
            'text-halo-width': 1.2,
            'text-opacity': [
              'case', ['boolean', ['feature-state', 'hidden'], false], 0, 1,
            ],
          },
        },
        {
          id: 'cluster-label', type: 'symbol', source: CLUSTERS,
          maxzoom: CLUSTER_MAX_Z,
          layout: {
            'text-field': ['concat', ['to-string', ['get', 'seen']], ' / ', ['to-string', ['get', 'n']]],
            'text-font': ['Noto Sans Regular'],
            'text-size': 10,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: { 'text-color': c.ink, 'text-halo-color': c.land, 'text-halo-width': 1.1 },
        },
        {
          // Grounding shadow for the tile view. The renderer casts none
          // (doc 3 §7.1); without this the tiles float.
          id: 'tile-shadow', type: 'fill', source: TILES,
          layout: { visibility: 'none' },
          paint: {
            'fill-color': '#000000',
            'fill-opacity': 0.18,
            'fill-translate': [6, 8],
            'fill-translate-anchor': 'viewport',
          },
        },
        {
          id: 'tile-extrude', type: 'fill-extrusion', source: TILES,
          layout: { visibility: 'none' },
          paint: {
            'fill-extrusion-color': c.land,
            'fill-extrusion-opacity': 0.92,
            'fill-extrusion-vertical-gradient': true,
            // Height is a function of zoom: extrusion is real-world metres
            // and a fixed height is invisible at world zoom and absurd close in.
            'fill-extrusion-height': [
              'interpolate', ['exponential', 1.6], ['zoom'],
              2, 120000, 4, 40000, 6, 12000, 8, 3500, 11, 600,
            ],
            'fill-extrusion-base': 0,
            // Bevel is parked: MapLibre has no fill-extrusion-edge-radius.
            // Setting an unknown paint property fails style validation and
            // the map never loads. Do not add one here.
          },
        },
        {
          id: 'trip-line', type: 'line', source: TRIP,
          filter: ['==', ['get', 'kind'], 'line'],
          paint: {
            'line-color': c.ink,
            'line-width': 2,
            'line-opacity': 0.85,
          },
        },
        {
          id: 'trip-label', type: 'symbol', source: TRIP,
          filter: ['==', ['get', 'kind'], 'stop'],
          layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, 1.4],
            'text-optional': true,
          },
          paint: { 'text-color': c.ink, 'text-halo-color': c.surface, 'text-halo-width': 1.2 },
        },
      ],
    };

    this.map = new maplibregl.Map({
      container: this.container,
      style,
      center: [12, 24],
      zoom: 2.1,
      minZoom: 1.4,
      maxZoom: 14,
      attributionControl: false,
      // Pitch and rotate belong to the tile view (doc 3 §6); the Atlas is flat.
      pitchWithRotate: false,
      dragRotate: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.NavigationControl({
      showCompass: false, visualizePitch: false,
    }), 'bottom-right');
    const fsRoot = this.container.closest('.workspace') as HTMLElement | null;
    this.map.addControl(new maplibregl.FullscreenControl(
      fsRoot ? { container: fsRoot } : {},
    ), 'bottom-right');
    (this.container as any)._twmFullscreenRoot = fsRoot;
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    // Handle for the acceptance tests and for debugging in the console. The
    // camera rules ("selecting never zooms", "marking never moves the map")
    // are only enforceable if something outside can read the camera.
    (this.container as any)._twmMap = this.map;
    (this.container as any)._twmLayers = () => ({ ...this.layers });
    (this.container as any)._twmVisible = () => this.visible.size;

    // A tile that will not load is not an exception to be swallowed. If the
    // elevation model is unreachable the relief layers come off and the menu
    // says why — a flat surface presented as terrain is the lie doc 3 §9 is
    // written against.
    // One failed tile is not a broken model. DEM requests are cancelled by the
    // renderer every time the camera moves, and a single abort taking the
    // relief off for the rest of the session would be a worse lie than the
    // flat surface this is here to prevent. The model is declared unreachable
    // only when it has never delivered anything and has failed repeatedly.
    this.map.on('sourcedata', (e: any) => {
      if (e?.sourceId !== DEM || !e?.tile) return;
      this.demDelivered = true;
      this.demFailures = 0;
    });
    this.map.on('error', (e: any) => {
      if (e?.sourceId !== DEM || this.reliefBroken || this.demDelivered) return;
      if (++this.demFailures < DEM_FAILURES_BEFORE_GIVING_UP) return;
      this.reliefBroken = true;
      this.applyRelief();
      if (!this.reliefWarned) {
        this.reliefWarned = true;
        this.hooks.onReliefUnavailable?.();
      }
    });

    await new Promise<void>((r) => this.map.on('load', () => r()));
    this.styleReady = true;
    this.installImages();
    this.map.on('moveend', () => this.scheduleClusters());
    this.map.on('zoomend', () => this.scheduleClusters());
    this.applyLayers(this.layers, { pitch: false });
    this.wireInteraction();
    this.syncVisited();
    this.rebuildClusters();
    // State that arrived before 'load' was stored but not painted.
    if (this.scopeIds) {
      const ids = this.scopeIds;
      this.scopeIds = null;
      this.setScope(ids);
    }
    this.setVisible(new Set(this.visible));
    // Glyph and GeoJSON work after 'load' can make map.loaded() flap. Wait
    // until the style is idle so the suite's check is boring.
    if (!this.map.loaded()) {
      await new Promise<void>((r) => this.map.once('idle', () => r()));
    }
  }

  private installImages() {
    const s = getComputedStyle(document.documentElement);
    const theme: MarkerTheme = {
      ring: s.getPropertyValue('--ink-faint').trim(),
      fill: s.getPropertyValue('--accent').trim(),
      halo: s.getPropertyValue('--land').trim(),
    };
    for (const img of markerImages(theme)) {
      if (this.map.hasImage(img.id)) this.map.removeImage(img.id);
      this.map.addImage(img.id, img.data, { pixelRatio: img.pixelRatio });
    }
    const sel = selectionImage(s.getPropertyValue('--ink').trim());
    if (this.map.hasImage(sel.id)) this.map.removeImage(sel.id);
    this.map.addImage(sel.id, sel.data, { pixelRatio: sel.pixelRatio });
  }

  /** Re-cut the marks when the theme flips. Cheap, and the alternative is a
   *  light-theme pin sitting on dark land. */
  retheme() {
    this.installImages();
    const c = tokens();
    this.map.setPaintProperty('water', 'background-color', c.water);
    this.map.setPaintProperty('country-fill', 'fill-color', c.land);
    this.applyLayers(this.layers, { pitch: false });
    this.map.setPaintProperty('country-line', 'line-color', c.landEdge);
    try {
      this.map.setPaintProperty('coast-halo', 'line-color', c.landEdge);
      this.map.setPaintProperty('graticule', 'line-color', c.landEdge);
    } catch { /* halo and graticule are cosmetic; a failed style stops here */ }
    if (this.dem) {
      // The shading is cut from the neutrals, so a theme flip re-cuts it for
      // the same reason the marks are re-cut: a light-theme relief on dark
      // land reads as fog.
      try {
        const paint = hillshadePaint(reliefTokens(c),
          shadeStrength(this.layers.exaggeration));
        for (const [k, v] of Object.entries(paint)) {
          this.map.setPaintProperty(HILLSHADE_LAYER, k as any, v as any);
        }
        this.map.setPaintProperty(ELEVATION_LAYER, 'color-relief-opacity',
          isDark() ? 0.62 : 0.9);
      } catch { /* relief layers may be absent on a failed style */ }
    }
    try {
      this.map.setPaintProperty('region-fill', 'fill-color', c.ink);
      this.map.setPaintProperty('region-line', 'line-color', c.landEdge);
      this.map.setPaintProperty('region-selected', 'line-color', c.ink);
    } catch { /* region layers may be absent on a failed style */ }
    this.map.setPaintProperty('country-coverage', 'fill-color', c.accent);
    this.map.setPaintProperty('territory-line', 'line-color', c.landEdge);
    this.map.setPaintProperty('cluster-shape', 'circle-stroke-color',
      ['case', ['>', ['get', 'seen'], 0], c.accent, c.inkFaint]);
    this.map.setPaintProperty('cluster-shape', 'circle-color',
      ['case', ['==', ['get', 'seen'], ['get', 'n']], c.accent, 'rgba(0,0,0,0)']);
    this.map.setPaintProperty('cluster-shape', 'circle-opacity',
      ['case', ['==', ['get', 'inScope'], 0], 0.3, 0.9]);
    try {
      this.map.setPaintProperty('tile-extrude', 'fill-extrusion-color', c.land);
      this.map.setPaintProperty('place-label', 'text-color', c.ink);
      this.map.setPaintProperty('place-label', 'text-halo-color', c.land);
      this.map.setPaintProperty('cluster-label', 'text-color', c.ink);
      this.map.setPaintProperty('cluster-label', 'text-halo-color', c.land);
      this.map.setPaintProperty('trip-line', 'line-color', c.ink);
    } catch { /* layers may not have loaded on a failed style */ }
    this.rebuildClusters();
  }

  // ---- interaction ------------------------------------------------------

  /** Hit targets exceed the visual mark: pins draw at 8-12px and take taps at
   *  44px (doc 3 §6.1, §11). Query a box, not a point. */
  private queryAt(pt: maplibregl.Point, layers: string[], pad = 22) {
    const box: [maplibregl.PointLike, maplibregl.PointLike] = [
      [pt.x - pad, pt.y - pad], [pt.x + pad, pt.y + pad],
    ];
    const hits = this.map.queryRenderedFeatures(box, { layers });
    if (layers.some((id) => id === 'place-open' || id === 'place-filled')) {
      return hits.filter((f) => this.visible.has(String(f.properties?.id)));
    }
    return hits;
  }

  private wireInteraction() {
    this.map.on('click', (e) => {
      // Three levels, most specific first: a place, then the tile it sits in,
      // then the country. Each opens the same panel with a different scope.
      const place = this.queryAt(e.point, ['place-open', 'place-filled']);
      if (place.length) {
        // Nearest to the tap, not first in the draw order.
        const best = place.reduce((a, b) =>
          dist(e.point, this.map.project((b.geometry as any).coordinates))
          < dist(e.point, this.map.project((a.geometry as any).coordinates)) ? b : a);
        this.hooks.onPlace(String(best.properties!.id));
        return;
      }
      // A sheet is open and this tap is not a pin: that is "empty map".
      // Dismiss; do not zoom a cluster or open a country from under it.
      if (this.hooks.hasSelection()) {
        this.hooks.onBackground();
        return;
      }
      const cluster = this.queryAt(e.point, ['cluster-shape'], 16);
      if (cluster.length) {
        // A cluster is not a thing to open a panel about. Zooming here is the
        // traveler asking to, which is the one case where the camera may move.
        const co = (cluster[0].geometry as any).coordinates;
        this.map.easeTo({ center: co, zoom: Math.max(CLUSTER_MAX_Z + 0.4, this.map.getZoom() + 2) });
        return;
      }
      if (this.layers.regions && this.map.getZoom() >= REGION_MIN_Z) {
        const region = this.map.queryRenderedFeatures(e.point, { layers: ['region-fill'] });
        if (region.length) {
          this.hooks.onRegion(String(region[0].properties!.region_id));
          return;
        }
      }
      const terrLayers = this.layers.tiles
        ? ['tile-extrude', 'tile-shadow'] : ['territory-line'];
      const terr = this.map.queryRenderedFeatures(e.point, { layers: terrLayers });
      if (terr.length && (this.layers.tiles || this.map.getZoom() >= REGION_MIN_Z)) {
        this.hooks.onTerritory(String(terr[0].properties!.territory_id));
        return;
      }
      const country = this.map.queryRenderedFeatures(e.point, { layers: ['country-fill'] });
      if (country.length) {
        this.hooks.onCountry(String(country[0].properties!.iso3));
        return;
      }
      this.hooks.onBackground();
    });

    this.map.on('mousemove', (e) => {
      const f = this.queryAt(e.point, ['place-open', 'place-filled']);
      const id = f.length ? String(f[0].properties!.id) : null;
      if (id !== this.hovered) {
        this.hovered = id;
        this.map.getCanvas().style.cursor = id ? 'pointer' : '';
        this.hooks.onHoverPlace(id);
      }
    });
  }

  // ---- state ------------------------------------------------------------

  /** Marking never moves the map. This function must never touch the camera. */
  setVisited(id: string, visited: boolean) {
    if (!this.ready()) return;
    this.map.setFeatureState({ source: PLACES, id }, { visited });
    this.scheduleClusters();
  }

  syncVisited() {
    for (const p of this.pins) {
      this.map.setFeatureState({ source: PLACES, id: p.id },
        { visited: this.visited.has(p.id) });
    }
    this.scheduleClusters();
  }

  /** Filtering removes. A place that fails the filter is gone from the map
   *  (density is how crowded the globe is — a trace of the rest would still
   *  crowd it) and from taps. Scope still only dims. */
  setVisible(ids: Set<string>) {
    if (!this.ready()) { this.visible = ids; return; }
    for (const p of this.pins) {
      const wasHidden = !this.visible.has(p.id);
      const isHidden = !ids.has(p.id);
      if (wasHidden !== isHidden) {
        this.map.setFeatureState({ source: PLACES, id: p.id }, { hidden: isHidden });
      }
    }
    this.visible = ids;
    this.scheduleClusters();
  }

  /** What the panel is currently about. Everything else goes quiet; nothing
   *  leaves the map. */
  setScope(ids: Set<string> | null) {
    if (!this.ready()) { this.scopeIds = ids; return; }
    for (const p of this.pins) {
      this.map.setFeatureState({ source: PLACES, id: p.id },
        { outOfScope: ids !== null && !ids.has(p.id) });
    }
    this.scopeIds = ids;
    this.scheduleClusters();
  }

  private ready() {
    // map.loaded() goes false again while optional glyphs 404. The 'load'
    // event is the contract: after it, feature-state is legal.
    return this.styleReady;
  }

  select(id: string | null) {
    if (!this.ready()) return;
    this.map.setFilter('place-selected', ['==', ['get', 'id'], id ?? '']);
  }

  hover(id: string | null) {
    if (!this.ready()) return;
    this.map.setFilter('place-hovered', ['==', ['get', 'id'], id ?? '']);
  }

  get layerState(): MapLayers { return { ...this.layers }; }

  applyLayers(next: MapLayers, opts: { pitch?: boolean } = {}) {
    const wasTiles = this.layers.tiles;
    const wasTerrain = this.layers.terrain3d && this.reliefUsable();
    this.layers = { ...next };
    if (!this.ready()) return;
    const vis = (on: boolean) => on ? 'visible' : 'none';
    const land = vis(this.layers.land);
    for (const id of ['country-fill', 'country-coverage', 'country-line', 'country-selected']) {
      try { this.map.setLayoutProperty(id, 'visibility', land); } catch { /* */ }
    }
    const tilesOn = this.layers.tiles;
    const src = this.map.getSource(TILES) as maplibregl.GeoJSONSource | undefined;
    src?.setData(tilesOn ? this.rawTerritories : emptyFC());
    this.map.setLayoutProperty('tile-shadow', 'visibility', vis(tilesOn));
    this.map.setLayoutProperty('tile-extrude', 'visibility', vis(tilesOn));
    this.map.setLayoutProperty('territory-line', 'visibility', vis(!tilesOn));
    const regionsOn = vis(this.layers.regions);
    for (const id of ['region-fill', 'region-line', 'region-selected']) {
      try { this.map.setLayoutProperty(id, 'visibility', regionsOn); } catch { /* */ }
    }
    const placesOn = vis(this.layers.places);
    for (const id of ['place-open', 'place-filled', 'place-selected', 'place-hovered',
                      'place-label', 'cluster-shape', 'cluster-label']) {
      try { this.map.setLayoutProperty(id, 'visibility', placesOn); } catch { /* */ }
    }
    this.applyRelief();
    this.applyRaster();
    if (opts.pitch === false) return;
    // Two things can pitch this map, and only one of them may be doing it at a
    // time: the tile preview is an object on a table, and 3-D terrain is the
    // ground itself. `applyLayers` is given a state where at most one is on.
    const pitched = tilesOn || (this.layers.terrain3d && this.reliefUsable());
    const wasPitched = wasTiles || wasTerrain;
    if (wasPitched === pitched) return;
    const pitch = pitched ? (tilesOn ? 42 : 58) : 0;
    const dur = prefersReducedMotion() ? 0 : 600;
    this.map.easeTo({ pitch, bearing: pitched ? this.map.getBearing() : 0, duration: dur });
    if (pitched) {
      this.map.dragRotate.enable();
      this.map.touchZoomRotate.enableRotation();
    } else {
      this.map.dragRotate.disable();
      this.map.touchZoomRotate.disableRotation();
    }
  }

  /** True when there is a model to read heights from and it has answered. */
  reliefUsable() { return !!this.dem && !this.reliefBroken; }

  /** What the layers menu says under the relief group. Never a promise the
   *  data cannot keep (doc 3 §9). */
  reliefStatus(): 'ok' | 'unconfigured' | 'unreachable' {
    if (!this.dem) return 'unconfigured';
    return this.reliefBroken ? 'unreachable' : 'ok';
  }

  private applyRelief() {
    if (!this.dem) return;
    const usable = this.reliefUsable();
    const ex = clampExaggeration(this.layers.exaggeration);
    const vis = (on: boolean) => on ? 'visible' : 'none';
    try {
      this.map.setLayoutProperty(HILLSHADE_LAYER, 'visibility',
        vis(usable && this.layers.relief));
      this.map.setPaintProperty(HILLSHADE_LAYER, 'hillshade-exaggeration',
        shadeStrength(ex));
      this.map.setLayoutProperty(ELEVATION_LAYER, 'visibility',
        vis(usable && this.layers.elevation));
    } catch { /* the relief layers are absent on a failed style */ }
    // Terrain is the expensive one: it re-tiles the whole surface. Only ask
    // for it while it is actually being looked at.
    const want3d = usable && this.layers.terrain3d && !this.layers.tiles;
    try {
      const has = !!this.map.getTerrain?.();
      if (want3d) this.map.setTerrain({ source: DEM, exaggeration: ex });
      else if (has) this.map.setTerrain(null);
    } catch { /* terrain is unavailable on this renderer or projection */ }
  }

  /** One decision, one place: how much of our own land colour survives under
   *  whatever ground is switched on beneath it. */
  private groundOpacity() {
    if (!this.layers.land) return 0;
    // Satellite is a photograph and wins outright: two grounds fighting each
    // other is how a map turns to mud.
    if (this.layers.raster !== 'off' && rasterTiles().length) return 0.06;
    if (this.layers.elevation && this.reliefUsable()) return 0.06;
    // Near-opaque, and this is a palette decision rather than a taste one.
    //
    // The old land and water tokens were 1.03:1 apart — visually the same
    // colour — so a 0.28 wash cost nothing and the coastline hairline carried
    // the whole land/sea distinction. Warm land against cool water is a real
    // difference, and a 0.28 wash throws it away: the globe goes back to one
    // pale mass. Paint the land, and let the translucent hillshade texture it.
    return 0.92;
  }

  /**
   * Switch the ground.
   *
   * Satellite is a photograph. With it on, our own land fill drops to a
   * whisper so the picture can be the map — `groundOpacity` above is the one
   * place that decision is taken.
   */
  private applyRaster() {
    const src = this.map.getSource(BASEMAP) as maplibregl.RasterTileSource | undefined;
    const satTiles = this.layers.raster === 'satellite' ? satelliteRasterTiles() : [];
    src?.setTiles?.(satTiles.length ? satTiles : [BLANK_TILE]);
    if (src) {
      (src as { attribution?: string }).attribution =
        satTiles.length ? SATELLITE_ATTRIBUTION : '';
    }
    try {
      this.map.setLayoutProperty('basemap', 'visibility',
        satTiles.length ? 'visible' : 'none');
    } catch { /* */ }
    try {
      this.map.setPaintProperty('country-fill', 'fill-opacity', this.groundOpacity());
    } catch { /* style may still be loading */ }
  }

  selectRegion(id: string | null) {
    if (!this.ready()) return;
    try {
      this.map.setFilter('region-selected', ['==', ['get', 'region_id'], id ?? '']);
    } catch { /* */ }
  }

  /** Straight lines between trip stops, grouped by day. Not a route.
   *  Two vertices are a chord through the globe; densify so the stroke
   *  lies on the disc a traveler can see (doc 2 §9). */
  setTrip(stops: { lon: number; lat: number; day: number; name: string }[]) {
    const src = this.map.getSource(TRIP) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const byDay = new Map<number, typeof stops>();
    for (const s of stops) {
      if (s.day <= 0) continue;
      const a = byDay.get(s.day);
      if (a) a.push(s); else byDay.set(s.day, [s]);
    }
    const features: any[] = [];
    for (const [day, list] of byDay) {
      if (list.length >= 2) {
        const raw = list.map((s) => [s.lon, s.lat] as [number, number]);
        features.push({
          type: 'Feature',
          properties: { kind: 'line', day },
          geometry: { type: 'LineString', coordinates: densifyLine(raw) },
        });
      }
      list.forEach((s, i) => {
        features.push({
          type: 'Feature',
          properties: { kind: 'stop', label: `D${day} · ${i + 1}` },
          geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        });
      });
    }
    src.setData({ type: 'FeatureCollection', features });
  }

  selectCountry(iso3: string | null) {
    if (!this.ready()) return;
    this.map.setFilter('country-selected', ['==', ['get', 'iso3'], iso3 ?? '']);
  }

  selectTerritory(id: string | null) {
    if (!this.ready()) return;
    this.map.setFilter('territory-selected', ['==', ['get', 'territory_id'], id ?? '']);
  }

  setCountryTint(tints: Map<string, number>) {
    for (const [iso3, v] of tints) {
      if (this.countryTint.get(iso3) === v) continue;
      this.map.setFeatureState({ source: COUNTRIES, id: iso3 }, { tint: v });
      this.countryTint.set(iso3, v);
    }
  }

  /** The traveler's decision, never ours (doc 3 §6.1). Only called from an
   *  explicit "show me this" control, never from selection and never from a
   *  mark. */
  flyToCountry(bbox: [number, number, number, number],
               padding: number | maplibregl.PaddingOptions = 60) {
    this.map.fitBounds(bbox, {
      padding, maxZoom: 8,
      duration: prefersReducedMotion() ? 0 : 900,
    });
  }

  // ---- clusters ---------------------------------------------------------

  private scheduleClusters() {
    if (this.clusterTimer) return;
    this.clusterTimer = requestAnimationFrame(() => {
      this.clusterTimer = 0;
      this.rebuildClusters();
    });
  }

  /** A grid pass over everything in view. Measured at 3-10 ms for the whole
   *  world, which is why it can be redone on every mark and every move rather
   *  than cached and invalidated. */
  private rebuildClusters() {
    const src = this.map.getSource(CLUSTERS) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!this.layers.places || this.map.getZoom() >= CLUSTER_MAX_Z) { src.setData(emptyFC()); return; }

    const cell = 360 / Math.max(6, Math.round(8 * Math.pow(2, this.map.getZoom())));
    type Bin = { n: number; seen: number; inScope: number; x: number; y: number };
    const bins = new Map<string, Bin>();
    for (const p of this.pins) {
      if (!this.visible.has(p.id)) continue;
      const k = `${Math.floor(p.lon / cell)}:${Math.floor(p.lat / cell)}`;
      let b = bins.get(k);
      if (!b) { b = { n: 0, seen: 0, inScope: 0, x: 0, y: 0 }; bins.set(k, b); }
      b.n++; b.x += p.lon; b.y += p.lat;
      if (this.visited.has(p.id)) b.seen++;
      if (this.scopeIds === null || this.scopeIds.has(p.id)) b.inScope++;
    }
    src.setData({
      type: 'FeatureCollection',
      features: [...bins.values()].map((b) => ({
        type: 'Feature' as const,
        properties: { n: b.n, seen: b.seen, inScope: b.inScope },
        geometry: { type: 'Point' as const, coordinates: [b.x / b.n, b.y / b.n] },
      })),
    });
  }
}

const emptyFC = () => ({ type: 'FeatureCollection' as const, features: [] });

/** Meridians and parallels every 30°, densified so they curve on the globe
 *  instead of cutting through it — the same reason a trip leg is densified. */
function graticule() {
  const features: any[] = [];
  const line = (coordinates: [number, number][]) => features.push({
    type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates },
  });
  for (let lon = -180; lon <= 180; lon += 30) {
    const pts: [number, number][] = [];
    for (let lat = -80; lat <= 80; lat += 4) pts.push([lon, lat]);
    line(pts);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 4) pts.push([lon, lat]);
    line(pts);
  }
  return { type: 'FeatureCollection' as const, features };
}

/** Interpolate vertices so a long hop follows the globe instead of
 *  vanishing as a chord through it. */
function densifyLine(coords: [number, number][]): [number, number][] {
  if (coords.length < 2) return coords;
  const out: [number, number][] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    let [x0, y0] = coords[i];
    let [x1, y1] = coords[i + 1];
    if (x1 - x0 > 180) x0 += 360;
    if (x0 - x1 > 180) x1 += 360;
    const steps = 48;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      let lon = x0 + (x1 - x0) * t;
      const lat = y0 + (y1 - y0) * t;
      while (lon > 180) lon -= 360;
      while (lon < -180) lon += 360;
      const prev = out[out.length - 1];
      if (!prev || prev[0] !== lon || prev[1] !== lat) out.push([lon, lat]);
    }
  }
  return out;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
