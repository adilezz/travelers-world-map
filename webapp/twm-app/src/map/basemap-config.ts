/**
 * Basemap URLs.
 *
 * The geographic basemap is ours: Natural Earth's shaded relief, built into
 * the bundle by `build_geography.py`. It costs nothing per map load, works
 * with no network, and — the part a rented tile set could never do — is the
 * same raster the printed wall map puts behind its tiles.
 *
 * The street basemap is still a config decision (doc 5 §4.3): set
 * VITE_TWM_BASEMAP_STREET to a template containing {z} {x} {y}, or a
 * comma-separated list. Empty means the toggle exists and loads nothing.
 */
function templates(raw: string | undefined): string[] {
  const s = (raw ?? '').trim();
  if (!s) return [];
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}

export function dataBase(): string {
  return `${import.meta.env.BASE_URL}data/`;
}

/** Where the pyramid stops. The 1:50m source is 10,800 px of world, which is
 *  8,192 px of Web Mercator at z5; z6 would ship the same blur twice. */
export const RELIEF_MAXZOOM = 5;

export function geoRasterTiles(): string[] {
  const override = templates(import.meta.env.VITE_TWM_BASEMAP_GEO as string | undefined);
  if (override.length) return override;
  return [`${dataBase()}geo/relief/{z}/{x}/{y}.webp`];
}

export function streetRasterTiles(): string[] {
  return templates(import.meta.env.VITE_TWM_BASEMAP_STREET as string | undefined);
}

/** Equirectangular relief for the printed map. Fetched only on export. */
export function reliefPrintUrl(): string {
  return `${dataBase()}geo/relief-print.jpg`;
}
