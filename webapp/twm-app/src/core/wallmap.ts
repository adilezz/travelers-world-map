/**
 * The two printed files.
 *
 *   wall map    relief and geography, country borders, every tile's outline
 *               and its number. This is the thing on the wall, and the holes
 *               in it are the tiles that have not been visited yet.
 *   cut sheet   the same tiles, at the same scale, laid out to be cut out.
 *               A tile carries what its best places are; a small one carries
 *               only their names; a grey one carries nothing but its number.
 *
 * The contract between them is `scale` — points per degree. It is computed
 * once from the wall map and handed to the cut sheet unchanged, because a
 * tile that is 3% off does not go into its hole.
 *
 * Both are drawn in light-theme ink. A wall map is paper, and paper has no
 * dark mode. The accent still means visited and nothing else.
 */
import {
  Content, PT_PER_MM, Pdf, n, textWidth,
} from './pdfkit';
import {
  type Bbox, type Window, bboxOf, fitWindow, loadImage, padBbox, reliefCrop,
} from './projection';
import type { KindCode, Pin } from './types';

const INK = [0.063, 0.149, 0.173] as const;
const INK_SOFT = [0.35, 0.44, 0.47] as const;
const EDGE = [0.42, 0.50, 0.52] as const;
const CUT = [0.20, 0.28, 0.31] as const;
const LAND = [0.835, 0.871, 0.867] as const;
const WATER = [0.722, 0.824, 0.878] as const;
const GREY = [0.80, 0.82, 0.82] as const;
const PALE = [0.902, 0.929, 0.925] as const;
const ACCENT = [0.659, 0.482, 0.133] as const;
const PAPER = [1, 1, 1] as const;

export const CUT_MM = 12;
export const CUT_MIN_MM = 6;

export interface TileFeature {
  properties: {
    tile_id: string; name: string; country: string; iso3: string;
    places: number; holes: number; members: string[];
    kinds: KindCode[]; inhabited: number;
    side_deg: number; min_deg: number; max_deg: number;
    at: [number, number]; bbox: [number, number, number, number];
  };
  geometry: any;
}

export interface WallMapOpts {
  widthMm: number;
  heightMm: number;
  title: string;
  subtitle: string;
  tiles: TileFeature[];
  countries: any;
  pins: Pin[];
  visited: ReadonlySet<string>;
  /** Equirectangular relief, whole sphere. Absent means print without it. */
  relief: HTMLImageElement | null;
  dpi: number;
  bbox?: Bbox;
}

// ---------------------------------------------------------------------------
// shared drawing
// ---------------------------------------------------------------------------

function rings(geom: any): number[][][] {
  if (!geom) return [];
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.flatMap((p: number[][][]) => p);
  }
  return [];
}

/** Emit one geometry as a path. Ring winding is left alone and the caller
 *  fills with the even-odd rule, which is what makes an interior ring a hole. */
function path(c: Content, geom: any, win: Window, minPt = 0.25): boolean {
  let any = false;
  for (const ring of rings(geom)) {
    const pts: number[][] = [];
    let lx = NaN, ly = NaN;
    for (const [lon, lat] of ring) {
      const x = win.xOf(lon), y = win.yOf(lat);
      // Drop points the printer cannot resolve. At 0.25 pt this is a tenth of
      // a millimetre, well under the line width, and it is the difference
      // between a 4 MB file and a 60 MB one at world scope.
      if (pts.length && Math.abs(x - lx) < minPt && Math.abs(y - ly) < minPt) continue;
      pts.push([x, y]); lx = x; ly = y;
    }
    if (pts.length >= 3) { c.poly(pts); any = true; }
  }
  return any;
}

/**
 * The kind glyphs, as paths.
 *
 * Doc 3 §3.2 and `kinds.ts` are explicit that a kind is carried by shape and
 * never by colour, and that the glyphs are geometric rather than pictorial —
 * "an icon of a mountain invites a traveler to read the kind as a photograph
 * of one". The tile faces use the same twelve shapes the interface uses, so a
 * traveler who learned them on screen recognises them on paper.
 */
function glyph(c: Content, kind: KindCode, x: number, y: number, s: number) {
  const h = s / 2;
  const box = (w: number, hh: number) => c.rect(x - w, y - hh, w * 2, hh * 2, 'f');
  const diamond = (op: string) => {
    c.poly([[x, y + h], [x + h, y], [x, y - h], [x - h, y]]);
    c.push(op);
  };
  const tri = (op: string) => {
    c.poly([[x, y + h], [x + h * 0.92, y - h * 0.7], [x - h * 0.92, y - h * 0.7]]);
    c.push(op);
  };
  const wave = (amp: number, rows: number) => {
    for (let i = 0; i < rows; i++) {
      const yy = y + h - (i + 0.5) * (s / rows);
      c.push(`${n(x - h)} ${n(yy)} m ${n(x - h / 3)} ${n(yy + amp)} `
        + `${n(x + h / 3)} ${n(yy - amp)} ${n(x + h)} ${n(yy)} c S`);
    }
  };
  switch (kind) {
    case 'A1': diamond('f'); break;
    case 'A2': diamond('S'); break;
    case 'A3': c.width(s * 0.11); wave(s * 0.22, 2); break;
    case 'A4': tri('f'); break;
    case 'A5': box(h, s * 0.16); break;
    case 'A6': diamond('f'); c.push('q'); c.fill(PAPER); c.circle(x, y, h * 0.34, 'f'); c.push('Q'); break;
    case 'A7': c.width(s * 0.11); wave(s * 0.3, 1); break;
    case 'A8':
      tri('S');
      c.poly([[x, y + h], [x - h * 0.92, y - h * 0.7], [x, y - h * 0.7]]);
      c.push('f');
      break;
    case 'A9': {
      const star = (r1: number, r2: number, pts: number) => {
        const p: number[][] = [];
        for (let i = 0; i < pts * 2; i++) {
          const a = (Math.PI / pts) * i - Math.PI / 2;
          const r = i % 2 ? r2 : r1;
          p.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
        }
        c.poly(p);
      };
      star(h, h * 0.42, 4);
      c.push('f');
      break;
    }
    case 'A10': {
      c.width(s * 0.13);
      c.push(`${n(x)} ${n(y - h)} m ${n(x)} ${n(y + h)} l S`);
      c.push(`${n(x - h * 0.62)} ${n(y + h * 0.28)} m ${n(x + h * 0.62)} ${n(y + h * 0.28)} l S`);
      break;
    }
    case 'A11':
      c.width(s * 0.09);
      for (let i = 0; i <= 2; i++) {
        const t = -h + (i * s) / 2;
        c.push(`${n(x - h)} ${n(y + t)} m ${n(x + h)} ${n(y + t)} l S`);
        c.push(`${n(x + t)} ${n(y - h)} m ${n(x + t)} ${n(y + h)} l S`);
      }
      break;
    default: box(h * 0.46, h); break;      // A12, a standing block
  }
}

/** Longest first, so a tile shows its best place rather than its shortest. */
function topPlaces(pins: Pin[], limit: number): Pin[] {
  return [...pins]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function fmt(x: number) { return x.toLocaleString('en-US'); }

// ---------------------------------------------------------------------------
// the wall map
// ---------------------------------------------------------------------------

export async function buildWallMap(o: WallMapOpts): Promise<{
  bytes: Uint8Array; scale: number; numbers: Map<string, number>;
}> {
  const W = o.widthMm * PT_PER_MM;
  const H = o.heightMm * PT_PER_MM;
  const pad = Math.max(8, Math.min(24, o.widthMm * 0.022)) * PT_PER_MM;
  const head = Math.max(10, o.heightMm * 0.035) * PT_PER_MM;
  const foot = Math.max(6, o.heightMm * 0.02) * PT_PER_MM;
  const mapX = pad, mapY = pad + foot;
  const mapW = W - pad * 2, mapH = H - pad * 2 - head - foot;

  const box = o.bbox ?? padBbox(bboxOf([],
    o.tiles.flatMap((t) => rings(t.geometry))), 0.02);
  const win = fitWindow(box, mapX, mapY, mapW, mapH);
  const numbers = numberTiles(o.tiles);

  const pdf = new Pdf();
  pdf.title = `Travelers World Map — ${o.title}`;
  pdf.subject = `Wall map, ${o.widthMm} x ${o.heightMm} mm, `
    + `${o.tiles.length} tiles. Relief and geography: Natural Earth, public domain.`;
  const c = new Content();
  const images: Record<string, number> = {};

  c.fill(PAPER).rect(0, 0, W, H, 'f');
  c.save().clipRect(mapX, mapY, mapW, mapH);
  c.fill(WATER).rect(mapX, mapY, mapW, mapH, 'f');

  if (o.relief) {
    const crop = await reliefCrop(o.relief, win, o.dpi);
    if (crop) {
      images.Relief = pdf.addJpeg(crop.jpeg, crop.width, crop.height);
      c.image('Relief', mapX, mapY, mapW, mapH);
    }
  } else {
    // No relief: the land still has to read as land.
    c.fill(LAND);
    let drew = false;
    for (const f of o.countries.features ?? []) drew = path(c, f.geometry, win) || drew;
    if (drew) c.push('f*');
  }

  // Country borders sit above the relief and below the cut lines: they are
  // context, not something anybody cuts along.
  c.stroke(EDGE).width(Math.max(0.3, o.widthMm / 1400));
  let drewC = false;
  for (const f of o.countries.features ?? []) drewC = path(c, f.geometry, win) || drewC;
  if (drewC) c.push('S');

  // Places, faint. They say what is in a tile before its tile is earned; once
  // the tile is glued down they are underneath it, which is the point.
  const r = Math.max(0.7, (o.widthMm / 700) * 1.1);
  for (const p of o.pins) {
    const x = win.xOf(p.lon), y = win.yOf(p.lat);
    if (x < mapX || x > mapX + mapW || y < mapY || y > mapY + mapH) continue;
    if (o.visited.has(p.id)) {
      c.fill(ACCENT).stroke(ACCENT).width(r * 0.35);
      if (p.isSite) c.rect(x - r, y - r, r * 2, r * 2, 'B');
      else c.circle(x, y, r, 'B');
    } else {
      c.stroke(INK).width(r * 0.45);
      if (p.isSite) c.rect(x - r, y - r, r * 2, r * 2, 'S');
      else c.circle(x, y, r, 'S');
    }
  }

  // The cut lines, and the number that ties a hole to its piece.
  const cutW = Math.max(0.25, o.widthMm / 1800);
  for (const t of o.tiles) {
    c.stroke(CUT).width(cutW);
    if (path(c, t.geometry, win)) c.push('S');
  }
  for (const t of o.tiles) {
    const num = numbers.get(t.properties.tile_id);
    if (!num) continue;
    const sideMm = t.properties.side_deg * win.scale / PT_PER_MM;
    if (sideMm < 4) continue;                    // no room for a legible digit
    const size = Math.min(9, Math.max(3.2, sideMm * 0.30)) * PT_PER_MM * 0.36;
    const [lon, lat] = t.properties.at;
    c.text(String(num), win.xOf(lon), win.yOf(lat) - size * 0.35, size,
      { align: 'centre', bold: true, rgb: CUT });
  }
  c.restore();

  frame(c, o, W, H, pad, foot, win, numbers.size);

  pdf.addPage({ widthPt: W, heightPt: H, content: c.toString(), images });
  return { bytes: await pdf.build(), scale: win.scale, numbers };
}

function frame(c: Content, o: WallMapOpts, W: number, H: number,
  pad: number, foot: number, win: Window, tiles: number) {
  const titleSize = Math.max(11, Math.min(34, o.widthMm * 0.026));
  c.text(o.title, pad, H - pad - titleSize * 0.85, titleSize,
    { bold: true, rgb: INK });
  const sub = Math.max(7, titleSize * 0.36);
  c.text(o.subtitle, pad, H - pad - titleSize * 0.85 - sub * 1.5, sub,
    { rgb: INK_SOFT });

  // Scale bar. A wall map without one cannot be read as a map.
  const barY = pad + foot * 0.55;
  const kmPerDeg = 111.32;
  const targetPt = Math.min(win.width * 0.16, 160 * PT_PER_MM);
  const rawKm = (targetPt / win.scale) * kmPerDeg;
  const step = niceStep(rawKm);
  const barW = (step / kmPerDeg) * win.scale;
  c.stroke(INK_SOFT).width(0.7);
  c.push(`${n(pad)} ${n(barY)} m ${n(pad + barW)} ${n(barY)} l S`);
  c.push(`${n(pad)} ${n(barY - 2)} m ${n(pad)} ${n(barY + 2)} l S`);
  c.push(`${n(pad + barW)} ${n(barY - 2)} m ${n(pad + barW)} ${n(barY + 2)} l S`);
  c.text(`${fmt(step)} km at the equator`, pad + barW + 6, barY - 2.4,
    Math.max(6, sub * 0.8), { rgb: INK_SOFT });

  const note = `${fmt(tiles)} tiles · cut them from the tile sheet and place each one after you visit it`
    + ' · relief and geography: Natural Earth, public domain';
  c.text(note, W - pad, barY - 2.4, Math.max(6, sub * 0.8),
    { align: 'right', rgb: INK_SOFT });
}

function niceStep(km: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, km)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (km <= m * pow) return m * pow;
  }
  return 10 * pow;
}

/**
 * Number the tiles by country, then west to east.
 *
 * A global 1..N is what lets a piece find its hole, and grouping by country
 * first means the numbers in one region are near each other — hunting for
 * 437 across a two-metre map is the difference between a pleasant evening
 * and giving up.
 */
export function numberTiles(tiles: TileFeature[]): Map<string, number> {
  const sorted = [...tiles].sort((a, b) =>
    a.properties.country.localeCompare(b.properties.country)
    || a.properties.at[0] - b.properties.at[0]
    || b.properties.at[1] - a.properties.at[1]);
  const m = new Map<string, number>();
  sorted.forEach((t, i) => m.set(t.properties.tile_id, i + 1));
  return m;
}

// ---------------------------------------------------------------------------
// the cut sheet
// ---------------------------------------------------------------------------

export interface TileSheetOpts {
  widthMm: number;
  heightMm: number;
  title: string;
  tiles: TileFeature[];
  numbers: Map<string, number>;
  /** Points per degree — the wall map's, unchanged. */
  scale: number;
  pinsForTile(t: TileFeature): Pin[];
  visited: ReadonlySet<string>;
  kindLabel(k: KindCode): string;
}

export async function buildTileSheet(o: TileSheetOpts): Promise<{
  bytes: Uint8Array; sheets: number; cut: number; skipped: TileFeature[];
}> {
  const W = o.widthMm * PT_PER_MM;
  const H = o.heightMm * PT_PER_MM;
  const pad = 12 * PT_PER_MM;
  const head = 12 * PT_PER_MM;
  const gap = 3.5 * PT_PER_MM;    // room for the blade between two pieces
  const areaX = pad, areaW = W - pad * 2;
  const areaY = pad, areaH = H - pad * 2 - head;

  const cutPt = CUT_MM * PT_PER_MM;
  const laid: { t: TileFeature; w: number; h: number }[] = [];
  const skipped: TileFeature[] = [];
  for (const t of o.tiles) {
    const [w0, s0, e0, n0] = t.properties.bbox;
    const w = (e0 - w0) * o.scale;
    const h = (n0 - s0) * o.scale;
    // Too small to cut, or too big for the sheet: neither belongs here, and
    // saying so beats printing a piece nobody can use. The same scissors test
    // the dialog applies, on the same numbers.
    if (Math.max(w, h) < cutPt || Math.min(w, h) < CUT_MIN_MM * PT_PER_MM
      || w > areaW || h > areaH) {
      skipped.push(t);
      continue;
    }
    laid.push({ t, w, h });
  }
  // Tallest first. Shelf packing in number order puts Antarctica on a shelf of
  // its own and leaves the rest of that band empty; the first run wasted about
  // a fifth of every sheet that way. Height-ordered shelves fill, and the
  // index page carries the sheet number so a piece is still findable.
  laid.sort((a, b) => b.h - a.h
    || (o.numbers.get(a.t.properties.tile_id) ?? 0)
    - (o.numbers.get(b.t.properties.tile_id) ?? 0));

  const pdf = new Pdf();
  pdf.title = `Travelers World Map — ${o.title}, tiles to cut out`;
  pdf.subject = `Cut sheet at the wall map's scale, ${o.widthMm} x ${o.heightMm} mm.`;
  let page = new Content();
  let sheets = 0;
  let cx = areaX, cy = areaY + areaH, shelfH = 0;

  const startPage = () => {
    page = new Content();
    page.fill(PAPER).rect(0, 0, W, H, 'f');
    cx = areaX; cy = areaY + areaH; shelfH = 0;
    sheets++;
  };
  const endPage = () => {
    page.text(`${o.title} — tiles to cut out`, pad, H - pad - 9, 11,
      { bold: true, rgb: INK });
    page.text(`Sheet ${sheets} · cut on the outline · the number matches the wall map`,
      W - pad, H - pad - 9, 8, { align: 'right', rgb: INK_SOFT });
    pdf.addPage({ widthPt: W, heightPt: H, content: page.toString() });
  };

  const sheetOf = new Map<string, number>();
  startPage();
  for (const item of laid) {
    if (cx + item.w > areaX + areaW) {          // next shelf
      cx = areaX;
      cy -= shelfH + gap;
      shelfH = 0;
    }
    if (cy - item.h < areaY) {                  // next sheet
      endPage();
      startPage();
    }
    drawTile(page, item.t, cx, cy - item.h, o);
    sheetOf.set(item.t.properties.tile_id, sheets);
    cx += item.w + gap;
    shelfH = Math.max(shelfH, item.h);
  }
  endPage();

  indexPage(pdf, o, W, H, pad, laid.map((l) => l.t), skipped, sheetOf);
  return { bytes: await pdf.build(), sheets, cut: laid.length, skipped };
}

/**
 * One tile face.
 *
 * How much a tile says is decided by how big it prints, not by how much there
 * is to say. Below 22 mm only the number fits and only the number is drawn;
 * a name crammed into 15 mm is unreadable *and* makes the piece look wrong.
 * The tile's own outline is the clip, so nothing can spill past the cut line
 * however badly the estimate goes.
 */
function drawTile(c: Content, t: TileFeature, x: number, y: number,
  o: TileSheetOpts) {
  const [w0, s0, e0, n0] = t.properties.bbox;
  const win: Window = {
    box: { w: w0, s: s0, e: e0, n: n0 },
    x, y, width: (e0 - w0) * o.scale, height: (n0 - s0) * o.scale,
    scale: o.scale,
    xOf: (lon: number) => x + (lon - w0) * o.scale,
    yOf: (lat: number) => y + (lat - s0) * o.scale,
  };
  const p = t.properties;
  const mm = Math.min(win.width, win.height) / PT_PER_MM;
  const pins = p.inhabited ? topPlaces(o.pinsForTile(t), 8) : [];
  const seen = pins.filter((q) => o.visited.has(q.id)).length;

  c.save();
  if (!path(c, t.geometry, win)) { c.restore(); return; }
  c.fill(p.inhabited ? PALE : GREY).push('f*');

  c.save();
  path(c, t.geometry, win);
  c.push('W* n');                                  // clip to the tile

  // The label point is guaranteed inside the tile but can sit hard against an
  // edge, and the number then prints half-clipped. Pull it back inside the
  // piece's own box before anything is drawn.
  const inset = Math.min(win.width, win.height) * 0.18;
  const cxp = Math.min(Math.max(win.xOf(p.at[0]), x + inset),
    x + win.width - inset);
  const cyp = Math.min(Math.max(win.yOf(p.at[1]), y + inset),
    y + win.height - inset);
  const numSize = Math.min(16, Math.max(5, mm * 0.34)) * PT_PER_MM * 0.36;

  if (mm < 22) {
    c.text(String(o.numbers.get(p.tile_id) ?? ''), cxp, cyp - numSize * 0.35,
      numSize, { align: 'centre', bold: true, rgb: CUT });
  } else {
    const lines: { text: string; kind?: KindCode }[] = [];
    if (mm >= 45) {
      for (const q of pins.slice(0, mm >= 70 ? 6 : 3)) {
        lines.push({ text: q.name, kind: (q.strongest || undefined) as KindCode });
      }
    } else {
      for (const q of pins.slice(0, 2)) lines.push({ text: q.name });
    }

    const nameSize = Math.min(9, Math.max(5, mm * 0.13)) * PT_PER_MM * 0.36;
    const lineH = nameSize * 1.5;
    const block = lines.length * lineH;
    const top = cyp + block / 2;

    c.text(String(o.numbers.get(p.tile_id) ?? ''), cxp, top + numSize * 0.55,
      numSize, { align: 'centre', bold: true, rgb: CUT });
    if (mm >= 30) {
      c.text(p.country, cxp, top + numSize * 0.55 - nameSize * 1.25,
        nameSize * 0.85, { align: 'centre', rgb: INK_SOFT });
    }

    lines.forEach((ln, i) => {
      const yy = top - (i + 1) * lineH;
      const gw = ln.kind ? nameSize * 1.5 : 0;
      const tw = textWidth(ln.text, nameSize);
      // Only draw what fits between the tile's own sides at this height.
      if (tw + gw > win.width * 0.92) return;
      const left = cxp - (tw + gw) / 2;
      if (ln.kind) {
        c.fill(INK_SOFT).stroke(INK_SOFT);
        glyph(c, ln.kind, left + nameSize * 0.5, yy + nameSize * 0.32,
          nameSize * 0.9);
      }
      c.text(ln.text, left + gw, yy, nameSize, { rgb: INK });
    });

    if (seen && mm >= 30) {
      c.fill(ACCENT).circle(cxp, cyp - block / 2 - nameSize * 1.1,
        nameSize * 0.36, 'f');
    }
  }
  c.restore();

  c.stroke(CUT).width(0.6);
  path(c, t.geometry, win, 0.15);
  c.push('S');
  c.restore();
}

function indexPage(pdf: Pdf, o: TileSheetOpts, W: number, H: number,
  pad: number, cut: TileFeature[], skipped: TileFeature[],
  sheetOf: Map<string, number>) {
  const rows = [...cut].sort((a, b) =>
    (o.numbers.get(a.properties.tile_id) ?? 0)
    - (o.numbers.get(b.properties.tile_id) ?? 0));
  const size = 7.4;
  const lineH = size * 1.42;
  const colW = 150;
  const cols = Math.max(1, Math.floor((W - pad * 2) / colW));
  const perCol = Math.floor((H - pad * 2 - 40) / lineH);
  const perPage = cols * perCol;

  for (let start = 0; start < rows.length; start += perPage) {
    const c = new Content();
    c.fill(PAPER).rect(0, 0, W, H, 'f');
    c.text(`${o.title} — index of tiles`, pad, H - pad - 10, 11,
      { bold: true, rgb: INK });
    c.text('Number · tile · country · sheet', pad, H - pad - 24, 8,
      { rgb: INK_SOFT });
    const slice = rows.slice(start, start + perPage);
    slice.forEach((t, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const x = pad + col * colW;
      const y = H - pad - 40 - row * lineH;
      const num = String(o.numbers.get(t.properties.tile_id) ?? '');
      c.text(num, x + 16, y, size, { align: 'right', bold: true, rgb: CUT });
      const label = t.properties.inhabited
        ? t.properties.name : `${t.properties.name}`;
      c.text(trim(label, colW - 60, size), x + 22, y, size, { rgb: INK });
      c.text(trim(t.properties.country, 40, size * 0.9),
        x + colW - 22, y, size * 0.9, { align: 'right', rgb: INK_SOFT });
      c.text(String(sheetOf.get(t.properties.tile_id) ?? ''),
        x + colW - 8, y, size * 0.9, { align: 'right', rgb: CUT });
    });
    if (start + perPage >= rows.length && skipped.length) {
      c.text(
        `${skipped.length} tiles are not on these sheets: they print under `
        + `${CUT_MM} mm and cannot be cut at this size. They stay part of the `
        + 'wall map. Print wider, or choose a coarser tile level, to include them.',
        pad, pad + 12, 7.6, { rgb: INK_SOFT });
    }
    pdf.addPage({ widthPt: W, heightPt: H, content: c.toString() });
  }
}

function trim(s: string, maxPt: number, size: number): string {
  if (textWidth(s, size) <= maxPt) return s;
  let out = s;
  while (out.length > 1 && textWidth(`${out}…`, size) > maxPt) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

export { loadImage };
