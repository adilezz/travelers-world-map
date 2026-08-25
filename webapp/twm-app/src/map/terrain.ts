/**
 * Relief: the shape of the ground.
 *
 * Doc 1 §1.1 describes the object this product is about — a printed map with
 * "the rivers, mountains, lakes and deserts that shape travel behind them",
 * and magnetic pieces that "carry a relief of that territory's landmarks".
 * The web atlas was drawing flat polygons. A traveler cannot see why a place
 * is hard to reach, why a border follows a ridge, or why a desert is a desert,
 * from a fill colour.
 *
 * Three layers, three separate decisions, because they answer different
 * questions and cost different amounts of attention:
 *
 *   Shading    An engraved hillshade in the document's own neutrals. It reads
 *              as the relief plate the printed product is, adds no new
 *              meaning-bearing colour (doc 3 §3), and is the default.
 *   Elevation  A hypsometric tint — the atlas ramp, greens through browns to
 *              snow, and bathymetry under the sea. Full geographic colour, so
 *              it is opt-in, exactly like the raster basemaps.
 *   Mountains  True 3-D terrain. The camera pitches and the ranges stand up.
 *
 * All three read one raster-dem source. Turning every one of them off costs
 * nothing: the source stops being asked for tiles.
 *
 * Nothing here invents a height. If the elevation model cannot be reached the
 * layers say so and switch themselves off (doc 3 §9) rather than drawing a
 * flat surface and calling it terrain.
 */
import type {
  ExpressionSpecification, LayerSpecification, RasterDEMSourceSpecification,
} from 'maplibre-gl';
import {
  DEM_ATTRIBUTION, DEM_MAX_ZOOM, demEncoding, demTiles,
} from './basemap-config';

export const DEM = 'dem';

export const ELEVATION_LAYER = 'land-elevation';
export const HILLSHADE_LAYER = 'land-relief';

/** Tokens are opaque hex; shading has to sit on top of the ground rather than
 *  replace it, so every relief colour is the token with an alpha on it. */
function withAlpha(color: string, alpha: number): string {
  const hex = color.trim().replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((h) => h + h).join('') : hex;
  if (full.length < 6 || /[^0-9a-f]/i.test(full.slice(0, 6))) {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  const n = parseInt(full.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The neutrals the shading is cut from. Same tokens as everything else. */
export interface ReliefTokens {
  ink: string;
  land: string;
  landEdge: string;
  water: string;
  surface: string;
  inkFaint: string;
}

export function demSource(): RasterDEMSourceSpecification | null {
  const tiles = demTiles();
  if (!tiles.length) return null;
  return {
    type: 'raster-dem',
    tiles,
    tileSize: 256,
    encoding: demEncoding(),
    maxzoom: DEM_MAX_ZOOM,
    attribution: DEM_ATTRIBUTION,
  };
}

/**
 * The hypsometric ramp, in metres.
 *
 * Read from an atlas rather than from a gradient generator: the steps sit
 * where the eye expects a break — the continental shelf at −200, the tree line
 * around 1,400, permanent snow near 4,200 — so a mountain range separates from
 * a plateau instead of fading into it. Below zero is bathymetry, which
 * terrarium carries and which is why an ocean drawn from this ramp has a shape.
 */
export function elevationRamp(): ExpressionSpecification {
  return [
    'interpolate', ['linear'], ['elevation'],
    -8000, '#0a2038',
    -4000, '#12405f',
    -1000, '#1c6285',
    -200, '#2f88ab',
    -1, '#84c2d4',
    0, '#d8e6cd',
    60, '#a9c79b',
    300, '#bccf98',
    800, '#d2d29a',
    1400, '#dcc28b',
    2200, '#c8a476',
    2900, '#b08f6e',
    3500, '#a2938c',
    4200, '#cbc7c4',
    5000, '#f1f1ef',
    6500, '#ffffff',
  ];
}

export function elevationLayer(dark: boolean): LayerSpecification {
  return {
    id: ELEVATION_LAYER,
    type: 'color-relief',
    source: DEM,
    layout: { visibility: 'none' },
    paint: {
      'color-relief-color': elevationRamp(),
      // Geography, not chrome — the ramp does not change with the theme. It is
      // only pulled back in the dark theme so the neutrals still carry the
      // interface and the tint stays a map rather than a light source.
      'color-relief-opacity': dark ? 0.62 : 0.9,
    },
  } as LayerSpecification;
}

/**
 * Igor shading, not the standard method. Standard darkens every slope and
 * turns a mountainous country into a grey mass at country zoom; igor lightens
 * as much as it darkens and keeps the place labels on top of it readable,
 * which is the whole reason the layer is allowed to be on by default.
 */
export function hillshadeLayer(c: ReliefTokens): LayerSpecification {
  return {
    id: HILLSHADE_LAYER,
    type: 'hillshade',
    source: DEM,
    layout: { visibility: 'none' },
    paint: hillshadePaint(c, 0.45),
  } as LayerSpecification;
}

export function hillshadePaint(c: ReliefTokens, exaggeration: number) {
  return {
    'hillshade-method': 'igor',
    'hillshade-exaggeration': exaggeration,
    // Alpha, not opaque tokens.
    //
    // An opaque highlight paints every sunlit slope in the panel's own
    // near-white and the whole globe goes to paper: land and sea end up the
    // same tone and the coastline is the only thing left telling them apart.
    // Translucent shading multiplies into whatever is underneath instead, so
    // the land keeps its land colour, the sea keeps its water colour, and the
    // relief is a texture on both rather than a replacement for either.
    'hillshade-shadow-color': withAlpha(c.ink, 0.6),
    'hillshade-highlight-color': withAlpha(c.surface, 0.55),
    // MapLibre's "accent" is the slope-break colour, and it is not ours.
    // Doc 3 §3 reserves --accent for visited; this is a hairline (doc 3 §5).
    'hillshade-accent-color': withAlpha(c.landEdge, 0.22),
    'hillshade-illumination-direction': 315,
    'hillshade-illumination-altitude': 55,
    // Viewport-anchored so the light does not swing round when the traveler
    // rotates in the 3-D view. A relief lit from below reads as a hole.
    'hillshade-illumination-anchor': 'viewport',
  } as any;
}

/**
 * No atmosphere.
 *
 * MapLibre 5.24 carries a `sky` root property with `atmosphere-blend`, and on
 * paper a lit limb is the cheapest realism available on a globe. It does not
 * paint: set to magenta at full blend, against both the SwiftShader and the
 * Metal ANGLE backends, the viewport outside the globe stays empty. The
 * `background` layer, meanwhile, paints the globe's disc and nothing else, so
 * it is not covering it either. Re-check on the next renderer upgrade — the
 * spike is the place for that — but a property that renders nothing is not
 * shipped as a feature here.
 */

/** Exaggeration a traveler can choose. 1.0 is true scale, and true scale is
 *  disappointing at world zoom: the Earth is smoother than anyone believes. */
export const EXAGGERATION_MIN = 1;
export const EXAGGERATION_MAX = 4;
export const EXAGGERATION_DEFAULT = 1.6;

export const clampExaggeration = (n: number) =>
  Math.min(EXAGGERATION_MAX, Math.max(EXAGGERATION_MIN, Number.isFinite(n) ? n : EXAGGERATION_DEFAULT));

/** Hillshade wants a gentler hand than the 3-D surface: the same number that
 *  makes a range stand up makes a shaded slope read as soot. */
export const shadeStrength = (exaggeration: number) =>
  Math.min(1, 0.45 * clampExaggeration(exaggeration));
