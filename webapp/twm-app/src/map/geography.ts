/**
 * The geographic layer — reliefs, mountains, rivers, lakes, ice, desert.
 *
 * Doc 5 §4.3 parked this as "owner cost decision, config URL", and the toggle
 * has been shipping with nothing behind it. Nothing behind it was the right
 * call while the only options billed per map load. This is the third option:
 * Natural Earth, public domain, hosted in our own bundle, so the layer costs
 * nothing per load, works with no network, and — the part a rented tile set
 * could never do — goes into the printed export.
 *
 * Two halves, because a wall map needs both:
 *
 *   relief   a Web Mercator pyramid of Natural Earth's 1:50m shaded relief.
 *            Soft, low-frequency, and it carries the *shape* of the land.
 *            It stops at z5 because the source stops there; MapLibre
 *            overzooms it, which is the honest behaviour for a backdrop.
 *   physical  1:10m vectors — rivers, lakes, glaciers, salt flats, reefs,
 *            named deserts and plateaux, named ranges and summits. These stay
 *            razor sharp at any zoom and at any print size, and they are what
 *            makes a mountain read as a mountain rather than as brown shading.
 *
 * The relief is a *basemap*, so it replaces our polygons rather than sitting
 * over them: with relief on, the country fill drops away and only the borders
 * stay. Two grounds fighting each other is how a map turns to mud.
 */
import type { Map as MLMap, StyleSpecification } from 'maplibre-gl';

export const GEO_SOURCES = {
  relief: 'geo-relief',
  rivers: 'geo-rivers',
  lakes: 'geo-lakes',
  glaciers: 'geo-glaciers',
  terrain: 'geo-terrain',
  ranges: 'geo-ranges',
  peaks: 'geo-peaks',
  saltflats: 'geo-saltflats',
  reefs: 'geo-reefs',
} as const;

export const GEO_LAYERS = [
  'geo-relief', 'geo-terrain-fill', 'geo-saltflat-fill', 'geo-glacier-fill',
  'geo-reef-line', 'geo-lake-fill', 'geo-river-line',
  'geo-range-label', 'geo-terrain-label', 'geo-peak-dot', 'geo-peak-label',
];

/** Painted only where the relief raster is absent, so the two never stack. */
const TERRAIN_TINT: Record<string, string> = {
  Desert: '#E4D8BC',
  Plateau: '#DCD7C4',
  Basin: '#DDE0D2',
  Plain: '#DDE3D4',
  Lowland: '#D9E1D6',
  Tundra: '#DCE2E2',
  Wetlands: '#CFDCD5',
  Delta: '#CFDCD5',
  Valley: '#D9DED0',
  Gorge: '#D4D2C6',
};

export interface GeoData {
  rivers: any; lakes: any; glaciers: any; terrain: any;
  ranges: any; peaks: any; saltflats: any; reefs: any;
}

const EMPTY = { type: 'FeatureCollection', features: [] };

/**
 * The one face the style's glyph server actually hosts.
 *
 * `atlas.ts` already records why: demotiles serves Noto Sans Regular, "Open
 * Sans Regular 404s, and a glyph 404 makes map.loaded() flap after the load
 * event". Asking for an italic that is not there costs the range and summit
 * names silently — they simply never draw. Letter-spacing and upper case do
 * the work italics would have done.
 */
const GLYPH_FONT = 'Noto Sans Regular';

export function emptyGeoData(): GeoData {
  return {
    rivers: EMPTY, lakes: EMPTY, glaciers: EMPTY, terrain: EMPTY,
    ranges: EMPTY, peaks: EMPTY, saltflats: EMPTY, reefs: EMPTY,
  };
}

/** Fetched on first use of the geographic basemap, never at boot. The world
 *  index has to be on screen before a backdrop is worth a byte. */
export async function loadGeoData(base: string): Promise<GeoData> {
  const names = ['rivers', 'lakes', 'glaciers', 'terrain',
    'ranges', 'peaks', 'saltflats', 'reefs'] as const;
  const out = emptyGeoData();
  await Promise.all(names.map(async (n) => {
    try {
      const r = await fetch(`${base}geo/physical/${n}.geojson`);
      if (r.ok) (out as any)[n] = await r.json();
    } catch { /* one missing layer must not cost the whole basemap */ }
  }));
  return out;
}

export function geoSources(reliefTiles: string[], maxzoom: number) {
  const src: StyleSpecification['sources'] = {};
  src[GEO_SOURCES.relief] = {
    type: 'raster',
    tiles: reliefTiles,
    tileSize: 256,
    maxzoom,
    attribution: 'Natural Earth',
  } as any;
  for (const key of ['rivers', 'lakes', 'glaciers', 'terrain',
    'ranges', 'peaks', 'saltflats', 'reefs'] as const) {
    src[GEO_SOURCES[key]] = { type: 'geojson', data: EMPTY } as any;
  }
  return src;
}

/**
 * Layers, in the order a physical map is drawn: ground, then what covers the
 * ground, then what runs across it, then the names.
 *
 * These colours do not take the theme. They belong to the relief raster
 * underneath them, which is one fixed image with its own greens and tans, and
 * a river drawn in dark-theme ink over a daylight hillshade reads as a crack
 * rather than as water. The theme still owns everything the product draws on
 * top: borders, tiles, pins, labels.
 *
 * `scalerank` is Natural Earth's own judgement of which features a map at a
 * given scale should carry. Using it as a zoom filter is the difference
 * between a river layer and a hairball: at world zoom only the Nile, the
 * Amazon and their peers are drawn, and the rest arrive as the traveler
 * comes down.
 */
export function geoLayers(): any[] {
  const river = '#6E96A8';
  const lake = '#BBD2DC';
  const ice = '#F2F6F7';
  return [
    {
      id: 'geo-relief', type: 'raster', source: GEO_SOURCES.relief,
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 1, 'raster-fade-duration': 150 },
    },
    {
      id: 'geo-terrain-fill', type: 'fill', source: GEO_SOURCES.terrain,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': [
          'match', ['get', 'cla'],
          ...Object.entries(TERRAIN_TINT).flatMap(([k, v]) => [k, v]),
          '#DEE2D8',
        ],
        'fill-opacity': 0.55,
      },
    },
    {
      id: 'geo-saltflat-fill', type: 'fill', source: GEO_SOURCES.saltflats,
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#EFEDE2', 'fill-opacity': 0.85 },
    },
    {
      id: 'geo-glacier-fill', type: 'fill', source: GEO_SOURCES.glaciers,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ice,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.55, 5, 0.85],
        'fill-outline-color': '#D3E0E4',
      },
    },
    {
      id: 'geo-reef-line', type: 'line', source: GEO_SOURCES.reefs,
      minzoom: 4, layout: { visibility: 'none' },
      paint: { 'line-color': '#8FBFC4', 'line-width': 0.6, 'line-opacity': 0.7 },
    },
    {
      id: 'geo-lake-fill', type: 'fill', source: GEO_SOURCES.lakes,
      layout: { visibility: 'none' },
      filter: ['<=', ['get', 'r'], ['+', 1, ['*', 1.1, ['zoom']]]],
      paint: { 'fill-color': lake, 'fill-opacity': 0.9 },
    },
    {
      id: 'geo-river-line', type: 'line', source: GEO_SOURCES.rivers,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      filter: ['<=', ['get', 'r'], ['+', 1, ['*', 1.1, ['zoom']]]],
      paint: {
        'line-color': river,
        'line-opacity': 0.75,
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          1, ['case', ['<=', ['get', 'r'], 2], 0.6, 0.3],
          6, ['case', ['<=', ['get', 'r'], 4], 1.6, 0.8],
          10, 2.4,
        ],
      },
    },
    {
      id: 'geo-range-label', type: 'symbol', source: GEO_SOURCES.ranges,
      minzoom: 3, layout: {
        visibility: 'none',
        'text-field': ['get', 'n'],
        'text-font': [GLYPH_FONT],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 9, 8, 13],
        'text-letter-spacing': 0.14,
        'text-max-width': 8,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#6A5A44', 'text-halo-color': '#FFFFFF',
        'text-halo-width': 1.1, 'text-opacity': 0.9,
      },
    },
    {
      id: 'geo-terrain-label', type: 'symbol', source: GEO_SOURCES.terrain,
      minzoom: 2.5, layout: {
        visibility: 'none',
        'text-field': ['get', 'n'],
        'text-font': [GLYPH_FONT],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 9, 8, 12],
        'text-letter-spacing': 0.18,
        'text-transform': 'uppercase',
        'text-max-width': 9,
      },
      paint: {
        'text-color': '#7A6E52', 'text-halo-color': '#FFFFFF',
        'text-halo-width': 1.1, 'text-opacity': 0.8,
      },
    },
    {
      id: 'geo-peak-dot', type: 'symbol', source: GEO_SOURCES.peaks,
      minzoom: 3.2, layout: {
        visibility: 'none',
        'text-field': '▲',
        'text-font': [GLYPH_FONT],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3.2, 7, 8, 11],
        'text-allow-overlap': false,
      },
      filter: ['<=', ['get', 'r'], ['+', 1, ['*', 1.2, ['zoom']]]],
      paint: {
        'text-color': '#5B4A38', 'text-halo-color': '#FFFFFF',
        'text-halo-width': 1,
      },
    },
    {
      id: 'geo-peak-label', type: 'symbol', source: GEO_SOURCES.peaks,
      minzoom: 4.5, layout: {
        visibility: 'none',
        'text-field': [
          'case', ['>', ['get', 'm'], 0],
          ['concat', ['get', 'n'], '  ', ['to-string', ['get', 'm']], ' m'],
          ['get', 'n'],
        ],
        'text-font': [GLYPH_FONT],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4.5, 9, 9, 12],
        'text-offset': [0, 0.9],
        'text-anchor': 'top',
        'text-max-width': 9,
      },
      filter: ['<=', ['get', 'r'], ['+', 1, ['*', 1.2, ['zoom']]]],
      paint: {
        'text-color': '#4A3E2E', 'text-halo-color': '#FFFFFF',
        'text-halo-width': 1.1,
      },
    },
  ];
}

/** Push the fetched vectors into their sources. Safe to call more than once. */
export function fillGeoSources(map: MLMap, data: GeoData) {
  const pairs: [string, any][] = [
    [GEO_SOURCES.rivers, data.rivers], [GEO_SOURCES.lakes, data.lakes],
    [GEO_SOURCES.glaciers, data.glaciers], [GEO_SOURCES.terrain, data.terrain],
    [GEO_SOURCES.ranges, data.ranges], [GEO_SOURCES.peaks, data.peaks],
    [GEO_SOURCES.saltflats, data.saltflats], [GEO_SOURCES.reefs, data.reefs],
  ];
  for (const [id, geo] of pairs) {
    const src = map.getSource(id) as any;
    if (src?.setData) src.setData(geo ?? EMPTY);
  }
}

export function setGeoVisible(map: MLMap, on: boolean) {
  for (const id of GEO_LAYERS) {
    try {
      map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    } catch { /* a layer may be absent on a failed style load */ }
  }
}
