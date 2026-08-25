/**
 * Basemap URLs.
 *
 * The photograph is Esri World Imagery — no API key, no per-load bill.
 * Override with VITE_TWM_BASEMAP_SATELLITE if that source has to move.
 * The toggle stays off at boot (Parked: basemap cost). The printable map
 * fetches the same tiles at export, at the zoom the paper can hold.
 */
function templates(raw: string | undefined): string[] {
  const s = (raw ?? '').trim();
  if (!s) return [];
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
