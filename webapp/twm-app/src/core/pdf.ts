/**
 * A real PDF: vector land, type as text (doc 5 §8.2). Printed in light-theme
 * ink — a wall map is paper, not a screen. The accent fills a visited pin
 * and is not used for chrome, land, or type.
 */
import type { Pin } from './types';

const PT = 72 / 25.4;
const LAND = [0.835, 0.871, 0.867];
const EDGE = [0.576, 0.655, 0.663];
const WATER = [0.890, 0.918, 0.922];
const INK = [0.063, 0.149, 0.173];
const ACCENT = [0.659, 0.482, 0.133];

export interface PdfLand {
  countries: any;
  regions: any;
  territories: any;
}

export function buildPosterPdf(opts: {
  widthMm: number;
  heightMm: number;
  title: string;
  pins: Pin[];
  visited: ReadonlySet<string>;
  land: PdfLand;
  iso3?: string;
  regionId?: string;
  territoryId?: string;
}): Uint8Array {
  const W = Math.max(40, opts.widthMm) * PT;
  const H = Math.max(40, opts.heightMm) * PT;
  const pad = 12 * PT;
  const innerW = W - 2 * pad;
  const innerH = H - 2 * pad - 16 * PT;

  const feats = landFeatures(opts);
  const box = bboxOf(opts.pins, feats);
  const sx = innerW / Math.max(1e-6, box.maxLon - box.minLon);
  const sy = innerH / Math.max(1e-6, box.maxLat - box.minLat);
  const s = Math.min(sx, sy);
  const ox = pad + (innerW - s * (box.maxLon - box.minLon)) / 2;
  const oy = pad + 14 * PT + (innerH - s * (box.maxLat - box.minLat)) / 2;
  const xOf = (lon: number) => ox + (lon - box.minLon) * s;
  const yOf = (lat: number) => oy + (lat - box.minLat) * s;

  const eps = Math.max(0.008, (box.maxLon - box.minLon) / 280);
  const paths: string[] = [];
  paths.push(`${WATER.join(' ')} rg 0 0 ${n(W)} ${n(H)} re f`);
  paths.push(`${LAND.join(' ')} rg ${EDGE.join(' ')} RG 0.4 w`);
  for (const f of feats) walkGeom(f.geometry, (ring) => {
    const pts = simplify(ring, eps);
    if (pts.length < 3) return;
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      const x = n(xOf(pts[i][0])), y = n(yOf(pts[i][1]));
      d += i === 0 ? `${x} ${y} m ` : `${x} ${y} l `;
    }
    paths.push(`${d}h`);
  });
  paths.push('f*');

  const r = 1.15 * PT;
  for (const p of opts.pins) {
    const x = xOf(p.lon), y = yOf(p.lat);
    const seen = opts.visited.has(p.id);
    const op = seen ? 'B' : 'S';
    if (seen) {
      paths.push(`${ACCENT.join(' ')} rg ${ACCENT.join(' ')} RG 0.4 w`);
    } else {
      paths.push(`${INK.join(' ')} RG 0.9 w`);
    }
    if (p.isSite) {
      const a = n(x - r), b = n(y - r), d = n(r * 2);
      paths.push(`${a} ${b} ${d} ${d} re ${op}`);
    } else {
      paths.push(`${n(x)} ${n(y)} ${n(r)} 0 360 arc ${op}`);
    }
  }

  const title = pdfSafe(opts.title || 'Travelers World Map');
  const cap = pdfSafe(`Travelers World Map · ${opts.pins.length} places. Accent means visited.`);
  paths.push(`${INK.join(' ')} rg`);
  paths.push(`BT /F1 ${n(11)} Tf ${n(pad)} ${n(H - pad - 10)} Td (${title}) Tj ET`);
  paths.push(`BT /F1 ${n(8)} Tf ${n(pad)} ${n(pad - 2)} Td (${cap}) Tj ET`);

  return assemblePdf(W, H, paths.join('\n'));
}

function landFeatures(opts: {
  land: PdfLand; iso3?: string; regionId?: string; territoryId?: string;
}): any[] {
  if (opts.regionId) {
    return (opts.land.regions?.features || []).filter(
      (f: any) => f.properties?.region_id === opts.regionId);
  }
  if (opts.territoryId) {
    return (opts.land.territories?.features || []).filter(
      (f: any) => f.properties?.territory_id === opts.territoryId);
  }
  if (opts.iso3) {
    return (opts.land.countries?.features || []).filter(
      (f: any) => f.properties?.iso3 === opts.iso3);
  }
  return opts.land.countries?.features || [];
}

function bboxOf(pins: Pin[], feats: any[]): {
  minLon: number; minLat: number; maxLon: number; maxLat: number;
} {
  let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
  const eat = (lon: number, lat: number) => {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  };
  for (const p of pins) eat(p.lon, p.lat);
  for (const f of feats) walkGeom(f.geometry, (ring) => {
    for (const c of ring) eat(c[0], c[1]);
  });
  if (minLon > maxLon) { minLon = -180; maxLon = 180; minLat = -60; maxLat = 85; }
  const dx = Math.max(0.4, (maxLon - minLon) * 0.08);
  const dy = Math.max(0.4, (maxLat - minLat) * 0.08);
  return {
    minLon: minLon - dx, minLat: minLat - dy,
    maxLon: maxLon + dx, maxLat: maxLat + dy,
  };
}

function walkGeom(g: any, ring: (pts: number[][]) => void) {
  if (!g) return;
  if (g.type === 'Polygon') for (const r of g.coordinates || []) ring(r);
  else if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates || []) for (const r of poly) ring(r);
  }
}

function simplify(ring: number[][], eps: number): number[][] {
  if (ring.length < 8) return ring;
  const out: number[][] = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const p = ring[i], prev = out[out.length - 1];
    if (Math.abs(p[0] - prev[0]) >= eps || Math.abs(p[1] - prev[1]) >= eps) {
      out.push(p);
      if (out.length > 480) break;
    }
  }
  out.push(ring[ring.length - 1]);
  return out;
}

function n(v: number): string { return v.toFixed(2); }

function pdfSafe(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** PDF 1.4 has no `arc` operator; emit a Bézier circle approximation. */
function assemblePdf(W: number, H: number, raw: string): Uint8Array {
  const body = raw.replace(/(\S+) (\S+) (\S+) 0 360 arc ([BS])/g, (_, x, y, r, op) =>
    bezierCircle(Number(x), Number(y), Number(r), op));
  const stream = `\n${body}\n`;
  const objs: string[] = [];
  objs.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');
  objs.push('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n');
  objs.push(
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(W)} ${n(H)}]`
    + ' /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n');
  objs.push(
    `4 0 obj << /Length ${stream.length} >> stream${stream}endstream endobj\n`);
  objs.push('5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n');

  let out = '%PDF-1.4\n';
  const offs = [0];
  for (const o of objs) {
    offs.push(out.length);
    out += o;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${objs.length + 1}\n`;
  out += '0000000000 65535 f \n';
  for (let i = 1; i <= objs.length; i++) {
    out += `${String(offs[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\n`;
  out += `startxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

function bezierCircle(x: number, y: number, r: number, op: string): string {
  const k = r * 0.5522847498;
  return [
    `${n(x + r)} ${n(y)} m`,
    `${n(x + r)} ${n(y + k)} ${n(x + k)} ${n(y + r)} ${n(x)} ${n(y + r)} c`,
    `${n(x - k)} ${n(y + r)} ${n(x - r)} ${n(y + k)} ${n(x - r)} ${n(y)} c`,
    `${n(x - r)} ${n(y - k)} ${n(x - k)} ${n(y - r)} ${n(x)} ${n(y - r)} c`,
    `${n(x + k)} ${n(y - r)} ${n(x + r)} ${n(y - k)} ${n(x + r)} ${n(y)} c`,
    op,
  ].join(' ');
}
