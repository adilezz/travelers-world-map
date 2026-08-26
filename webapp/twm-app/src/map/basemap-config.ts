/**
 * Where the ground comes from.
 *
 * Two sources, two different cost postures, and the difference is the whole
 * point:
 *
 *   The photograph is Esri World Imagery — no API key, no per-load bill.
 *   Override with VITE_TWM_BASEMAP_SATELLITE if that source has to move. The
 *   toggle stays off at boot (Parked: basemap cost). The printable map fetches
 *   the same tiles at export, at the zoom the paper can hold.
 *
 *   The elevation model does not bill either, and unlike the Natural Earth
 *   relief pyramid this replaces, it costs the bundle nothing: Terrain Tiles
 *   on the AWS Open Data Registry are read over the wire, need no key, and
 *   carry an attribution licence — the same posture as every other source in
 *   doc 1 §18. So relief is wired to a working default rather than to an empty
 *   string, and the layer a traveler turns on actually turns on. An owner who
 *   wants no third-party request at all sets VITE_TWM_TERRAIN_DEM=off and the
 *   control says so honestly.
 *
 * Set VITE_TWM_BASEMAP_SATELLITE / VITE_TWM_TERRAIN_DEM to a template
 * containing {z} {x} {y}, or a comma-separated list of templates.
 */
function templates(raw: string | undefined): string[] {
  const s = (raw ?? '').trim();
  if (!s || s === 'off') return [];
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}

export const SATELLITE_MAXZOOM = 19;

export const SATELLITE_ATTRIBUTION =
  'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics';

const ESRI_WORLD_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export function satelliteRasterTiles(): string[] {
  const override = templates(
    import.meta.env.VITE_TWM_BASEMAP_SATELLITE as string | undefined);
  return override.length ? override : [ESRI_WORLD_IMAGERY];
}

export function satellitePrint(): { template: string; maxzoom: number } {
  return { template: satelliteRasterTiles()[0] ?? '', maxzoom: SATELLITE_MAXZOOM };
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
