/**
 * Cut drilled holes as true interior rings (doc 3 §7.1, doc 4 §6).
 *
 * The pipeline is supposed to do this at build time. The published tiles
 * do not yet carry holes, so we punch them once when the tile view opens.
 * A dark circle painted on the top face reads as a sticker; a ring the
 * renderer extrudes reads as a hole.
 */
import type { Pin } from '../core/types';

const HOLE_KM = 11;
const RING = 14;

export function punchHoles(geo: any, pins: Pin[]): any {
  const byTile = new Map<string, Pin[]>();
  for (const p of pins) {
    if (!p.onPrintedMap || !p.territoryId) continue;
    const a = byTile.get(p.territoryId);
    if (a) a.push(p); else byTile.set(p.territoryId, [p]);
  }

  return {
    type: 'FeatureCollection',
    features: geo.features.map((f: any) => {
      const holes = byTile.get(f.properties.territory_id);
      if (!holes?.length || !f.geometry) return f;
      return {
        ...f,
        geometry: withHoles(f.geometry, holes),
      };
    }),
  };
}

function withHoles(geom: any, holes: Pin[]) {
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: punchPolygon(geom.coordinates, holes) };
  }
  if (geom.type === 'MultiPolygon') {
    const coords = geom.coordinates.map((poly: number[][][]) => punchPolygon(poly, holes));
    return { type: 'MultiPolygon', coordinates: coords };
  }
  return geom;
}

function punchPolygon(rings: number[][][], holes: Pin[]): number[][][] {
  const out = rings.map((r) => r.slice());
  const ext = out[0];
  if (!ext) return out;
  for (const p of holes) {
    if (!ringContains(ext, p.lon, p.lat)) continue;
    if (out.slice(1).some((h) => ringContains(h, p.lon, p.lat))) continue;
    out.push(circleHole(p.lon, p.lat, HOLE_KM));
  }
  return out;
}

function circleHole(lon: number, lat: number, km: number): number[][] {
  const dLat = km / 111.32;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLon = km / (111.32 * Math.max(0.2, Math.abs(cos)));
  const ring: number[][] = [];
  // Clockwise — GeoJSON holes wind opposite the exterior.
  for (let i = 0; i <= RING; i++) {
    const a = -((i / RING) * Math.PI * 2);
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return ring;
}

function ringContains(ring: number[][], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const hit = ((yi > lat) !== (yj > lat))
      && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}
