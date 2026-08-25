/**
 * Where the ground comes from.
 *
 * Two different cost postures live in this file, and the difference is the
 * whole point:
 *
 *   Raster basemaps (geographic, street) bill per map load. Doc 5 §4.3 parks
 *   them behind config and defaults them off; the toggle exists and loads
 *   nothing until an owner rules on cost. Unchanged.
 *
 *   The elevation model does not bill. Terrain Tiles on the AWS Open Data
 *   Registry are free to read, need no key, and carry an attribution licence —
 *   the same posture as every other source in doc 1 §18. So relief is wired to
 *   a working default rather than to an empty string, and the layer a traveler
 *   turns on actually turns on. An owner who wants no third-party request at
 *   all sets VITE_TWM_TERRAIN_DEM=off and the control says so honestly.
 *
 * Set VITE_TWM_BASEMAP_GEO / VITE_TWM_BASEMAP_STREET / VITE_TWM_TERRAIN_DEM to
 * a template containing {z} {x} {y}, or a comma-separated list of templates.
 */
function templates(raw: string | undefined): string[] {
  const s = (raw ?? '').trim();
  if (!s || s === 'off') return [];
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}

export function geoRasterTiles(): string[] {
  return templates(import.meta.env.VITE_TWM_BASEMAP_GEO as string | undefined);
}

export function streetRasterTiles(): string[] {
  return templates(import.meta.env.VITE_TWM_BASEMAP_STREET as string | undefined);
}

/**
 * Mapzen terrarium tiles, mirrored by the AWS Open Data Registry: SRTM and
 * 3DEP on land, GMTED filling the high latitudes, ETOPO1 for bathymetry. That
 * last one is why the ocean has a floor on this map and not a flat colour.
 */
export const DEFAULT_DEM =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const DEM_ATTRIBUTION =
  'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/" '
  + 'target="_blank" rel="noopener">Terrain Tiles</a> (SRTM, 3DEP, GMTED, ETOPO1)';

/** Terrarium above 15 is upsampled from nothing; asking for it wastes requests. */
export const DEM_MAX_ZOOM = 13;

export function demTiles(): string[] {
  const raw = (import.meta.env.VITE_TWM_TERRAIN_DEM as string | undefined)?.trim();
  if (raw === undefined || raw === '') return [DEFAULT_DEM];
  return templates(raw);
}

/** Terrarium unless an owner points the config at a Mapbox-encoded set. */
export function demEncoding(): 'terrarium' | 'mapbox' {
  const raw = (import.meta.env.VITE_TWM_TERRAIN_ENCODING as string | undefined)?.trim();
  return raw === 'mapbox' ? 'mapbox' : 'terrarium';
}

/** True when relief has somewhere to read heights from at all. */
export const demConfigured = () => demTiles().length > 0;
