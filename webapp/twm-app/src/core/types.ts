/** Shapes the bundle actually ships. Nothing here is aspirational. */

export type KindCode =
  | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6'
  | 'A7' | 'A8' | 'A9' | 'A10' | 'A11' | 'A12';

/** The trimmed pin record, from places.geojson. This is the world index: it is
 *  enough to draw the map, fill a register row and compute coverage at any
 *  scope, which is why nothing needs 233 fetches to browse. */
export interface Pin {
  id: string;
  name: string;
  score: number;
  strongest: KindCode | '';
  kinds: number;        // bitmask, bit (n-1) for An
  months: number;       // bitmask, bit (m-1) for month m
  iso3: string;
  isSite: boolean;
  onPrintedMap: boolean;
  whs: number;
  territoryId: string;
  regionId: string;
  lon: number;
  lat: number;
}

/** The full record, from countries/{ISO3}.json. Fetched when a place is opened
 *  or a country is browsed in depth. */
export interface Place {
  place_id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  is_site: boolean;
  score: number;
  archetypes: KindCode[];
  archetype_weights: number[];
  whs: number;
  reach?: string;
  best_months?: number[];
  on_printed_map: boolean;
  printed_rank: number | null;
  territory_id: string | null;
  region_id?: string;
  disputed?: string;
  sources: string[];
}

export interface Territory {
  territory_id: string;
  name: string;
  country: string;
  place_ids: string[];      // the drilled subset
  app_place_ids?: string[]; // everything the tile contains
  dominant_archetypes: KindCode[];
  printable: boolean;
  places: number;
  app_places?: number;
}

export interface CountryFile {
  country: string;
  iso3: string;
  area_km2: number | null;
  places: Place[];
  kinds: Record<string, number>;
  territories: Territory[];
  /** OSM livability harvest, or explicit absence. Empty must not look low. */
  livability?: 'scored' | 'unscored';
}

export interface CountryIndexEntry {
  country: string;
  iso3: string;
  file: string;
  places: number;
  holes: number;
  tiles: number;
  kinds: number;
  kind_counts: Record<string, number>;
  bytes: number;
  livability?: 'scored' | 'unscored';
}

export interface Manifest {
  build: string;
  model: Record<string, unknown>;
  archetypes: Record<KindCode, string>;
  archetype_counts: Record<KindCode, number>;
  totals: {
    places: number; printed: number; countries: number;
    territories: number; printable_territories: number; hole_budget: number;
  };
  printed_map: { min_tile_extent_km: number; map_width_m: number; min_spacing_km: number };
  layers: Record<string, string>;
  countries: CountryIndexEntry[];
  passports?: {
    source: string; licence: string; count: number; destinations: number;
    uncovered_in_register: number; states: Record<string, string>;
    index: string; note: string;
  };
}

/** Entry requirement for one passport-destination pair. */
export type EntryState = 'vf' | 'voa' | 'ev' | 'vr' | 'na' | 'home';
export interface Entry { r: EntryState; d?: number; v?: string }
export interface PassportFile {
  passport: string;
  name: string;
  counts: Record<EntryState, number>;
  in_database: number;
  destinations: Record<string, Entry>;
}

/** A traveler's record of one place. Never hard-deleted: unmarking sets
 *  visited false and keeps everything attached to it (doc 4 §3.2). */
export interface Visit {
  place_id: string;
  visited: boolean;
  marked_at: string;
  visited_on?: string;
  note?: string;
}

/** What is in scope. Every surface reads this, and the coverage meter is
 *  computed against it. */
export type Scope =
  | { kind: 'world' }
  | { kind: 'country'; iso3: string }
  | { kind: 'territory'; id: string };

export interface Filters {
  visited: 'all' | 'yes' | 'no';
  kinds: Set<KindCode>;
  printedOnly: boolean;
  whsOnly: boolean;
  scoreMin: number;          // only meaningful within a country. Doc 1 §3.
  months: Set<number>;       // 1–12; a place matches if any selected month is in season
  search: string;
  /** iso3 of the chosen passport, or null. Annotation is always on when a
   *  passport is chosen; this narrows as well. */
  passport: string | null;
  entryStates: Set<EntryState>;
  /** How many places to show per country after the other filters. 0 = all
   *  that pass. Never a global top-N (doc 5 §4.4). */
  densityPerCountry: number;
}

/** Independent map layers (doc 5 §4.3). Rasters are mutually exclusive
 *  basemaps; regions and places are overlays; tiles is a preview mode. */
export interface MapLayers {
  land: boolean;
  raster: 'off' | 'geo' | 'street';
  regions: boolean;
  places: boolean;
  tiles: boolean;
}

export function defaultLayers(): MapLayers {
  return { land: true, raster: 'off', regions: true, places: true, tiles: false };
}

/** A web-region tessellation unit (not a printed tile). */
export interface RegionRec {
  region_id: string;
  name: string;
  country: string;
  iso3: string;
  places: number;
}

export type SortKey = 'score' | 'name' | 'recent' | 'distance';

/** A trip is a list of days, not a schedule (doc 2 §9). No times, no durations. */
export interface TripStop {
  place_id: string;
  day: number;       // 0 = unassigned tray; 1+ is a day
  position: number;
}

export interface Trip {
  id: string;
  title: string;
  start?: string;    // ISO date, optional
  end?: string;
  dayCount: number;  // at least 1; empty days are kept
  stops: TripStop[];
}
