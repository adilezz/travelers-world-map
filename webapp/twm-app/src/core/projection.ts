/**
 * The poster's projection, and the window it draws.
 *
 * Equirectangular, because the wall map and the cut sheet must agree exactly
 * or the pieces do not fit their holes. Reprojecting to Equal Earth would be
 * prettier at world scope and would cost a second projection to keep in step
 * between the two documents. Whatever the projection, both call this module.
 *
 * The scale is the contract between them: `mmPerDeg` is what makes a cut
 * tile the same size as the hole it goes into. The satellite photograph is
 * warped into this window at export, at the zoom the paper can actually hold.
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
// satellite photograph for print
// ---------------------------------------------------------------------------

export interface RasterTiles {
  template: string;
  maxzoom: number;
}

/** How many Web Mercator tiles a print will fetch. Past this we drop a zoom
 *  rather than stall the dialog. 512 at z10 is a country; a world sheet
 *  settles around z5. */
const PRINT_TILE_CAP = 512;
const PRINT_FETCH = 8;

function wantSize(win: Window, dpi: number, capPx: number): { wantW: number; wantH: number } {
  const wantW = (win.width / PT_PER_MM / 25.4) * dpi;
  const wantH = (win.height / PT_PER_MM / 25.4) * dpi;
  const k = Math.min(1, capPx / Math.max(wantW, wantH));
  return { wantW: wantW * k, wantH: wantH * k };
}

function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * (1 << z);
}

function latToTileY(lat: number, z: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return y * (1 << z);
}

function sampleBilinear(
  data: Uint8ClampedArray, w: number, h: number, x: number, y: number,
): [number, number, number] {
  if (x < 0 || y < 0 || x >= w || y >= h) return [20, 28, 36];
  const x0 = Math.min(w - 1, Math.max(0, Math.floor(x)));
  const y0 = Math.min(h - 1, Math.max(0, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  const r = data[i00] * (1 - fx) * (1 - fy) + data[i10] * fx * (1 - fy)
    + data[i01] * (1 - fx) * fy + data[i11] * fx * fy;
  const g = data[i00 + 1] * (1 - fx) * (1 - fy) + data[i10 + 1] * fx * (1 - fy)
    + data[i01 + 1] * (1 - fx) * fy + data[i11 + 1] * fx * fy;
  const b = data[i00 + 2] * (1 - fx) * (1 - fy) + data[i10 + 2] * fx * (1 - fy)
    + data[i01 + 2] * (1 - fx) * fy + data[i11 + 2] * fx * fy;
  return [r, g, b];
}

function tileUrl(template: string, z: number, x: number, y: number): string {
  return template
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y));
}

async function loadTile(url: string): Promise<HTMLImageElement | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    const href = URL.createObjectURL(blob);
    try {
      return await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error(url));
        img.src = href;
      });
    } finally {
      URL.revokeObjectURL(href);
    }
  } catch {
    return null;
  }
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  }));
}

/**
 * Warp satellite Mercator tiles into the equirectangular window the PDF draws.
 *
 * Print is the one time we spend the zoom the photograph actually has. The
 * screen globe can overzoom a parent tile; a metre of paper cannot.
 */
export async function satelliteFromTiles(
  tiles: RasterTiles, win: Window, dpi: number, capPx = 8192,
): Promise<{ jpeg: Uint8Array; width: number; height: number } | null> {
  if (!tiles.template) return null;
  const { w, s, e, n } = win.box;
  const { wantW, wantH } = wantSize(win, dpi, capPx);
  const lonSpan = Math.max(1e-6, e - w);
  let z = Math.ceil(Math.log2((wantW / 256) * (360 / lonSpan)));
  z = Math.max(0, Math.min(tiles.maxzoom, z));

  const cover = (zoom: number) => {
    const wrap = 1 << zoom;
    let x0 = Math.floor(lonToTileX(w, zoom));
    let x1 = Math.floor(lonToTileX(e, zoom));
    let y0 = Math.max(0, Math.min(wrap - 1, Math.floor(latToTileY(n, zoom))));
    let y1 = Math.max(0, Math.min(wrap - 1, Math.floor(latToTileY(s, zoom))));
    let nTy = y1 - y0 + 1;
    let nTx = x1 - x0 + 1;
    if (nTx <= 0) nTx += wrap;
    return { wrap, x0, x1, y0, y1, nTx, nTy };
  };

  let cov = cover(z);
  while (cov.nTx * cov.nTy > PRINT_TILE_CAP && z > 0) {
    z -= 1;
    cov = cover(z);
  }

  const mosaic = document.createElement('canvas');
  mosaic.width = cov.nTx * 256;
  mosaic.height = cov.nTy * 256;
  const mctx = mosaic.getContext('2d');
  if (!mctx) return null;
  mctx.fillStyle = '#141c24';
  mctx.fillRect(0, 0, mosaic.width, mosaic.height);

  const jobs: { url: string; dx: number; dy: number }[] = [];
  for (let ty = cov.y0; ty <= cov.y1; ty++) {
    for (let i = 0; i < cov.nTx; i++) {
      const tx = ((cov.x0 + i) % cov.wrap + cov.wrap) % cov.wrap;
      jobs.push({
        url: tileUrl(tiles.template, z, tx, ty),
        dx: i * 256,
        dy: (ty - cov.y0) * 256,
      });
    }
  }
  await pool(jobs, PRINT_FETCH, async (job) => {
    const img = await loadTile(job.url);
    if (img) mctx.drawImage(img, job.dx, job.dy);
  });

  const outW = Math.max(1, Math.round(wantW));
  const outH = Math.max(1, Math.round(wantH));
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const octx = out.getContext('2d');
  if (!octx) return null;
  const src = mctx.getImageData(0, 0, mosaic.width, mosaic.height);
  const dst = octx.createImageData(outW, outH);
  const originX = cov.x0 * 256;
  const originY = cov.y0 * 256;
  const worldPx = cov.wrap * 256;
  for (let py = 0; py < outH; py++) {
    const lat = n - ((py + 0.5) / outH) * (n - s);
    const mercY = latToTileY(lat, z) * 256 - originY;
    for (let px = 0; px < outW; px++) {
      const lon = w + ((px + 0.5) / outW) * lonSpan;
      let mercX = lonToTileX(lon, z) * 256 - originX;
      if (mercX < 0) mercX += worldPx;
      const [r, g, b] = sampleBilinear(src.data, mosaic.width, mosaic.height, mercX, mercY);
      const i = (py * outW + px) * 4;
      dst.data[i] = r; dst.data[i + 1] = g; dst.data[i + 2] = b; dst.data[i + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);
  const blob: Blob | null = await new Promise((res) =>
    out.toBlob((b) => res(b), 'image/jpeg', 0.92));
  if (!blob) return null;
  return {
    jpeg: new Uint8Array(await blob.arrayBuffer()),
    width: outW, height: outH,
  };
}
