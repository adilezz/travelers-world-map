/**
 * The marks.
 *
 * The governing contrast is a ring against a filled dot — an empty hole and a
 * placed pin (doc 3 §1). Everything else in the system is quiet so that this
 * one distinction carries the map at a glance.
 *
 * Shape carries the second fact, never colour: a circle is a settlement, a
 * square is a natural or archaeological site (doc 3 §8). An extra outer ring
 * marks the places that reach the printed map — the bridge between the two
 * products, drawn as what it is: the hole that would be drilled.
 *
 * Drawn to a canvas rather than shipped as sprites so the two themes get their
 * own set at the device's pixel ratio, and so a token change is a token change.
 */
export interface MarkerTheme {
  ring: string;      // unvisited stroke
  fill: string;      // visited fill, the accent
  halo: string;      // the map ground the mark sits on
}

const SIZE = 26;               // logical box; the mark itself is 8-12px
const R = 4.6;                 // mark radius before the printed-map ring

function draw(
  ctx: CanvasRenderingContext2D, scale: number,
  opts: { site: boolean; visited: boolean; hole: boolean; theme: MarkerTheme },
) {
  const { site, visited, hole, theme } = opts;
  const c = (SIZE / 2) * scale;
  const r = R * scale;
  ctx.lineJoin = 'miter';

  // The printed-map ring sits outside the mark and is always open: it is the
  // hole, and a hole is never filled by anything but the pin inside it.
  if (hole) {
    ctx.beginPath();
    ctx.strokeStyle = theme.ring;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1 * scale;
    const rr = r + 3.2 * scale;
    if (site) ctx.rect(c - rr, c - rr, rr * 2, rr * 2);
    else ctx.arc(c, c, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // A hairline of the map ground behind the mark, so a pin over a coastline
  // still reads. Doc 3 §11 asks for 3:1 against the land fill; this is what
  // holds it when the land is not what is underneath.
  ctx.beginPath();
  ctx.strokeStyle = theme.halo;
  ctx.lineWidth = 2.4 * scale;
  if (site) ctx.rect(c - r, c - r, r * 2, r * 2);
  else ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  if (site) ctx.rect(c - r, c - r, r * 2, r * 2);
  else ctx.arc(c, c, r, 0, Math.PI * 2);
  if (visited) {
    ctx.fillStyle = theme.fill;
    ctx.fill();
    ctx.strokeStyle = theme.fill;
  } else {
    ctx.strokeStyle = theme.ring;
  }
  ctx.lineWidth = 1.5 * scale;
  ctx.stroke();
}

export function markerImages(theme: MarkerTheme, dpr = Math.min(2, devicePixelRatio || 1)) {
  const scale = Math.max(1, dpr) * 2; // 2x again: pins scale up with zoom
  const out: { id: string; data: ImageData; pixelRatio: number }[] = [];
  for (const site of [false, true]) {
    for (const visited of [false, true]) {
      for (const hole of [false, true]) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = SIZE * scale;
        const ctx = cv.getContext('2d')!;
        draw(ctx, scale, { site, visited, hole, theme });
        out.push({
          id: markerId(site, visited, hole),
          data: ctx.getImageData(0, 0, cv.width, cv.height),
          pixelRatio: scale,
        });
      }
    }
  }
  return out;
}

export const markerId = (site: boolean, visited: boolean, hole: boolean) =>
  `m-${site ? 'sq' : 'ci'}-${visited ? 'on' : 'off'}-${hole ? 'hole' : 'flat'}`;

/** The selection mark: a wide, quiet ring around whatever is selected. Not the
 *  accent — selection is not visitedness, and conflating them would make the
 *  map lie about the traveler's record. */
export function selectionImage(colour: string, dpr = Math.min(2, devicePixelRatio || 1)) {
  const scale = Math.max(1, dpr) * 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE * scale;
  const ctx = cv.getContext('2d')!;
  const c = (SIZE / 2) * scale;
  ctx.beginPath();
  ctx.arc(c, c, (R + 6) * scale, 0, Math.PI * 2);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.6 * scale;
  ctx.stroke();
  return { id: 'm-selected', data: ctx.getImageData(0, 0, cv.width, cv.height), pixelRatio: scale };
}
