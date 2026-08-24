/**
 * Raster basemap URLs. A commercial tile set bills per map load (Parked:
 * basemap cost, doc 5 §4.3). Empty means the toggle exists but loads nothing.
 *
 * Set VITE_TWM_BASEMAP_GEO / VITE_TWM_BASEMAP_STREET to a template containing
 * {z} {x} {y}, or a comma-separated list of templates.
 */
function templates(raw: string | undefined): string[] {
  const s = (raw ?? '').trim();
  if (!s) return [];
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}

export function geoRasterTiles(): string[] {
  return templates(import.meta.env.VITE_TWM_BASEMAP_GEO as string | undefined);
}

export function streetRasterTiles(): string[] {
  return templates(import.meta.env.VITE_TWM_BASEMAP_STREET as string | undefined);
}
