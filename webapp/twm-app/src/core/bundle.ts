/**
 * Loading the published bundle.
 *
 * Place data is static and immutable (doc 4 §1). The manifest is fetched once;
 * everything else is fetched by the path the manifest names and cached for the
 * life of the tab. Per-country registers and per-passport files are fetched on
 * demand, which is the whole reason they are separate files.
 */
import type {
  CountryFile, Manifest, PassportFile, Pin, KindCode, Territory, RegionRec,
} from './types';

const BASE = import.meta.env.BASE_URL + 'data/';

export class Bundle {
  manifest!: Manifest;
  pins: Pin[] = [];
  pinById = new Map<string, Pin>();
  byCountry = new Map<string, Pin[]>();
  byTerritory = new Map<string, Pin[]>();
  byRegion = new Map<string, Pin[]>();
  countryName = new Map<string, string>();
  regions = new Map<string, RegionRec>();
  /** Raw GeoJSON kept as fetched: MapLibre wants the object, and re-serialising
   *  eleven thousand features to hand it a copy is pure waste. */
  placesGeoJSON: any;
  territories = new Map<string, Territory & { iso3: string }>();

  private countries = new Map<string, Promise<CountryFile>>();
  private levels = new Map<string, Promise<any>>();
  private passports = new Map<string, Promise<PassportFile>>();
  private passportIndex?: Promise<{ passports: { iso3: string; name: string; free: number }[]; uncovered: string[] }>;

  async load(): Promise<void> {
    this.manifest = await getJSON(BASE + 'manifest.json');
    for (const c of this.manifest.countries) this.countryName.set(c.iso3, c.country);

    this.placesGeoJSON = await getJSON(BASE + this.manifest.layers.places);
    for (const f of this.placesGeoJSON.features) {
      const p = f.properties;
      const pin: Pin = {
        id: p.id, name: p.n, score: p.s, strongest: p.k as KindCode | '',
        kinds: p.a, months: p.m ?? 0, iso3: p.c, isSite: p.site === 1, onPrintedMap: p.hole === 1,
        whs: p.whs, territoryId: p.t || '', regionId: p.r || '',
        lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
      };
      this.pins.push(pin);
      this.pinById.set(pin.id, pin);
      push(this.byCountry, pin.iso3, pin);
      if (pin.territoryId) push(this.byTerritory, pin.territoryId, pin);
      if (pin.regionId) push(this.byRegion, pin.regionId, pin);
    }
    // Stage 0: the client refuses a bundle whose files do not match its
    // manifest. Both numbers are named so a silent mismatch cannot return.
    demandSame('places', this.manifest.totals.places, this.pins.length);
    demandSame('countries', this.manifest.totals.countries, this.manifest.countries.length);
    const printed = this.pins.filter((p) => p.onPrintedMap).length;
    demandSame('printed places', this.manifest.totals.printed, printed);
  }

  /** Territory outlines carry the tile metadata the panel needs, so the layer
   *  fetch doubles as the territory index. */
  async loadTerritoryLayer(): Promise<any> {
    // The tile layer covers every square metre of land as of
    // 2026-08-25; `territories.geojson` covered 66% per country and
    // is kept only so an older bundle still starts.
    const path = this.manifest.layers.tiles
      ?? this.manifest.layers.territories;
    const geo = await getJSON(BASE + path);
    for (const f of geo.features) {
      const p = f.properties;
      this.territories.set(p.territory_id, {
        territory_id: p.territory_id, name: p.name, country: p.country,
        iso3: p.iso3, printable: p.printable, places: p.holes,
        app_places: p.places, place_ids: [], dominant_archetypes: p.kinds ?? [],
      });
    }
    demandSame('tiles',
      this.manifest.totals.tiles ?? this.manifest.totals.territories,
      this.territories.size);
    return geo;
  }

  loadCountryLayer(): Promise<any> {
    return getJSON(BASE + this.manifest.layers.countries);
  }

  async loadRegionLayer(): Promise<any> {
    const path = this.manifest.layers.regions;
    if (!path) return { type: 'FeatureCollection', features: [] };
    const geo = await getJSON(BASE + path);
    for (const f of geo.features || []) {
      const p = f.properties || {};
      if (!p.region_id) continue;
      this.regions.set(p.region_id, {
        region_id: p.region_id,
        name: p.name || p.region_id,
        country: p.country || '',
        iso3: p.iso3 || '',
        places: p.places ?? 0,
      });
    }
    return geo;
  }

  country(iso3: string): Promise<CountryFile> {
    let p = this.countries.get(iso3);
    if (!p) {
      const entry = this.manifest.countries.find((c) => c.iso3 === iso3);
      if (!entry) return Promise.reject(new Error(`no register for ${iso3}`));
      p = getJSON(BASE + entry.file);
      this.countries.set(iso3, p);
    }
    return p;
  }

  /** The full record for one place, via its country's register. */
  async place(id: string) {
    const pin = this.pinById.get(id);
    if (!pin) return null;
    const file = await this.country(pin.iso3);
    return file.places.find((p) => p.place_id === id) ?? null;
  }

  passportList() {
    if (!this.passportIndex) {
      this.passportIndex = getJSON(BASE + (this.manifest.passports?.index ?? 'passports/index.json'));
    }
    return this.passportIndex;
  }

  passport(iso3: string): Promise<PassportFile> {
    let p = this.passports.get(iso3);
    if (!p) {
      p = getJSON(BASE + `passports/${iso3}.json`);
      this.passports.set(iso3, p);
    }
    return p;
  }

  /** One cut level's geometry. Fetched on export and kept for the tab:
   *  six megabytes is not worth paying twice, and not worth paying at
   *  boot for a traveler who never prints anything. */
  tileLevel(level: string): Promise<any> {
    let p = this.levels.get(level);
    if (!p) {
      const known = (this.manifest.tiles?.levels ?? [])
        .find((l) => l.level === level);
      p = getJSON(BASE + (known?.file ?? `tiles-${level}.geojson`));
      this.levels.set(level, p);
    }
    return p;
  }

  countryEntry(iso3: string) {
    return this.manifest.countries.find((c) => c.iso3 === iso3);
  }
}

/** Stage 0. The accent is not used here; a mismatch is a failed start, not a colour. */
export function demandSame(what: string, claimed: number, actual: number) {
  if (claimed !== actual) {
    throw new Error(
      `The bundle does not match its manifest. ${what}: manifest ${claimed}, files ${actual}.`,
    );
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v); else m.set(k, [v]);
}

async function getJSON(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} fetching ${url}`);
  return r.json();
}
