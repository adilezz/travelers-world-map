/**
 * Loading the published bundle.
 *
 * Place data is static and immutable (doc 4 §1). The manifest is fetched once;
 * everything else is fetched by the path the manifest names and cached for the
 * life of the tab. Per-country registers and per-passport files are fetched on
 * demand, which is the whole reason they are separate files.
 */
import type {
  CountryFile, Manifest, PassportFile, Pin, KindCode, Territory,
} from './types';

const BASE = import.meta.env.BASE_URL + 'data/';

export class Bundle {
  manifest!: Manifest;
  pins: Pin[] = [];
  pinById = new Map<string, Pin>();
  byCountry = new Map<string, Pin[]>();
  byTerritory = new Map<string, Pin[]>();
  countryName = new Map<string, string>();
  /** Raw GeoJSON kept as fetched: MapLibre wants the object, and re-serialising
   *  eleven thousand features to hand it a copy is pure waste. */
  placesGeoJSON: any;
  territories = new Map<string, Territory & { iso3: string }>();

  private countries = new Map<string, Promise<CountryFile>>();
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
        whs: p.whs, territoryId: p.t,
        lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
      };
      this.pins.push(pin);
      this.pinById.set(pin.id, pin);
      push(this.byCountry, pin.iso3, pin);
      if (pin.territoryId) push(this.byTerritory, pin.territoryId, pin);
    }
  }

  /** Territory outlines carry the tile metadata the panel needs, so the layer
   *  fetch doubles as the territory index. */
  async loadTerritoryLayer(): Promise<any> {
    const geo = await getJSON(BASE + this.manifest.layers.territories);
    for (const f of geo.features) {
      const p = f.properties;
      this.territories.set(p.territory_id, {
        territory_id: p.territory_id, name: p.name, country: p.country,
        iso3: p.iso3, printable: p.printable, places: p.holes,
        app_places: p.places, place_ids: [], dominant_archetypes: p.kinds ?? [],
      });
    }
    return geo;
  }

  loadCountryLayer(): Promise<any> {
    return getJSON(BASE + this.manifest.layers.countries);
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

  countryEntry(iso3: string) {
    return this.manifest.countries.find((c) => c.iso3 === iso3);
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
