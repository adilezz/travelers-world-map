/**
 * The poster's projection, and the window it draws.
 *
 * Equirectangular, for one reason that outranks the cartography: the relief
 * raster is equirectangular, so a lon/lat rectangle is a pixel rectangle and
 * the background can be placed with one `drawImage` at full source
 * resolution. Reprojecting to Equal Earth or Robinson would be prettier at
 * world scope and would cost a per-pixel inverse pass over 30 million pixels
 * in the browser, plus a second projection to keep in step between the wall
 * map and the cut sheet — and the two must agree exactly or the pieces do not
 * fit their holes. Whatever the projection, both documents call this module.
 *
 * The scale is the contract between the two files: `mmPerDeg` is what makes a
 * cut tile the same size as the hole it goes into.
 */

export interface Bbox { w: number; s: number; e: number; n: number }

export interface Window {
  /** Geographic window actually drawn, after fitting to the page box. */
  box: Bbox;
  /** Page box in points. */
  x: number; y: number; width: number; height: number;
  /** Points per degree. Identical in both documents by construction. */
  scale: number;
  xOf(lon: number): number;
  yOf(lat: number): number;
}

export const PT_PER_MM = 72 / 25.4;

export function bboxOf(points: { lon: number; lat: number }[],
  rings: number[][][] = []): Bbox {
  let w = 180, s = 90, e = -180, n = -90;
  const eat = (lon: number, lat: number) => {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  };
  for (const p of points) eat(p.lon, p.lat);
  for (const r of rings) for (const c of r) eat(c[0], c[1]);
  if (w > e) return { w: -180, s: -60, e: 180, n: 84 };
  return { w, s, e, n };
}

export function padBbox(b: Bbox, frac = 0.03, minDeg = 0.3): Bbox {
  const dx = Math.max(minDeg, (b.e - b.w) * frac);
  const dy = Math.max(minDeg, (b.n - b.s) * frac);
  return {
    w: Math.max(-180, b.w - dx), e: Math.min(180, b.e + dx),
    s: Math.max(-90, b.s - dy), n: Math.min(90, b.n + dy),
  };
}

/**
 * Fit a geographic window into a page box, keeping the aspect ratio, and
 * *grow* the window rather than letterbox it.
 *
 * A wall map with white bars down the sides is not a wall map. The box the
 * traveler asked for is filled edge to edge, and the extra is spent on more
 * geography, which at world scope means more ocean and at country scope means
 * more of the neighbours.
 */
export function fitWindow(box: Bbox, x: number, y: number,
  width: number, height: number): Window {
  let { w, s, e, n } = box;
  const bw = Math.max(1e-6, e - w);
  const bh = Math.max(1e-6, n - s);
  const want = width / height;
  const have = bw / bh;
  if (have < want) {
    const grow = (bw * (want / have) - bw) / 2;
    w -= grow; e += grow;
  } else {
    const grow = (bh * (have / want) - bh) / 2;
    s -= grow; n += grow;
  }
  const scale = width / (e - w);
  return {
    box: { w, s, e, n },
    x, y, width, height, scale,
    xOf: (lon: number) => x + (lon - w) * scale,
    yOf: (lat: number) => y + (lat - s) * scale,
  };
}

/** The window a fixed scale implies, centred on a box. Used by the cut sheet
 *  so its tiles come out the size of the wall map's holes. */
export function windowAtScale(centreLon: number, centreLat: number,
  scale: number, x: number, y: number, width: number, height: number): Window {
  const w = centreLon - width / (2 * scale);
  const s = centreLat - height / (2 * scale);
  return {
    box: { w, s, e: w + width / scale, n: s + height / scale },
    x, y, width, height, scale,
    xOf: (lon: number) => x + (lon - w) * scale,
    yOf: (lat: number) => y + (lat - s) * scale,
  };
}

// ---------------------------------------------------------------------------
// the relief background
// ---------------------------------------------------------------------------

/**
 * Cut the relief raster to the drawn window and hand back JPEG bytes.
 *
 * The source is equirectangular and covers the whole sphere, so the window is
 * a plain source rectangle; nothing is resampled beyond the crop. The output
 * is sized to the print resolution the page asks for, capped so a 2 m poster
 * does not try to allocate a canvas the browser refuses.
 */
export async function reliefCrop(img: HTMLImageElement, win: Window,
  dpi: number, capPx = 10000): Promise<{
    jpeg: Uint8Array; width: number; height: number;
  } | null> {
  const { w, s, e, n } = win.box;
  const sx = ((w + 180) / 360) * img.naturalWidth;
  const sy = ((90 - n) / 180) * img.naturalHeight;
  const sw = ((e - w) / 360) * img.naturalWidth;
  const sh = ((n - s) / 180) * img.naturalHeight;

  const wantW = (win.width / PT_PER_MM / 25.4) * dpi;
  const wantH = (win.height / PT_PER_MM / 25.4) * dpi;
  // Never upsample past the source, and never past the canvas cap.
  const k = Math.min(1, capPx / Math.max(wantW, wantH));
  const outW = Math.max(1, Math.round(Math.min(wantW * k, sw * 2)));
  const outH = Math.max(1, Math.round(Math.min(wantH * k, sh * 2)));

  const cv = document.createElement('canvas');
  cv.width = outW; cv.height = outH;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // The window may run past the source at the poles or across the antimeridian.
  // Paint the ocean first so those bands are sea rather than transparent.
  ctx.fillStyle = '#B8D2E0';
  ctx.fillRect(0, 0, outW, outH);
  const kx = outW / sw;
  const ky = outH / sh;
  // Fitting a 2:1 page to the world grows the window past +/-180, and the
  // source stops there. The world does not: draw it again either side so the
  // map runs to the paper's edge instead of ending in two pale bars.
  const worldPx = img.naturalWidth;
  for (const shift of [-worldPx, 0, worldPx]) {
    const ox = sx - shift;
    const cx = Math.max(0, ox), cy = Math.max(0, sy);
    const cw = Math.min(img.naturalWidth, ox + sw) - cx;
    const ch = Math.min(img.naturalHeight, sy + sh) - cy;
    if (cw > 0 && ch > 0) {
      ctx.drawImage(img, cx, cy, cw, ch,
        (cx - ox) * kx, (cy - sy) * ky, cw * kx, ch * ky);
    }
  }

  const blob: Blob | null = await new Promise((res) =>
    cv.toBlob((b) => res(b), 'image/jpeg', 0.88));
  if (!blob) return null;
  return {
    jpeg: new Uint8Array(await blob.arrayBuffer()),
    width: outW, height: outH,
  };
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`could not load ${url}`));
    img.src = url;
  });
}
