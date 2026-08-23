/**
 * Renderer spike — doc 4 §11 and §15.
 *
 * The one question that changes everything downstream: does feature-state
 * marking hold up with every place in the database marked at once? Earlier
 * MapLibre majors stalled for several frames at around twenty thousand
 * feature-state entries, which is this product's exact scale.
 *
 * Measures three things and writes them to window.__spike:
 *   1. cold load     — manifest to first idle with all places drawn
 *   2. mark-to-paint — one place marked, tap to repaint. Budget: < 100 ms
 *   3. bulk mark     — all 11,918 at once, the onboarding path
 *   4. pan fps       — world zoom, everything loaded. Budget: >= 50 fps
 */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const PLACES = '/data/places.geojson';
const SRC = 'places';

type Result = Record<string, unknown>;
const out: Result = {};
const t0 = performance.now();

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#E9EEEF' } }],
  },
  center: [10, 25],
  zoom: 1.4,
  attributionControl: false,
});

function frame(): Promise<number> {
  return new Promise((r) => requestAnimationFrame(() => r(performance.now())));
}

/** Wait until the renderer has actually put pixels on the screen. */
function painted(): Promise<number> {
  return new Promise((resolve) => {
    map.once('render', () => resolve(performance.now()));
    map.triggerRepaint();
  });
}

async function measurePan(seconds = 4): Promise<number> {
  let frames = 0;
  const start = performance.now();
  const end = start + seconds * 1000;
  return new Promise((resolve) => {
    const step = () => {
      const now = performance.now();
      // Drag the camera the way a traveler would: continuous, not stepped.
      const t = (now - start) / 1000;
      map.jumpTo({ center: [Math.sin(t) * 60, Math.cos(t) * 25] });
      frames++;
      if (now < end) requestAnimationFrame(step);
      else resolve(frames / ((now - start) / 1000));
    };
    requestAnimationFrame(step);
  });
}

map.on('load', async () => {
  const fetched = performance.now();
  const geo = await (await fetch(PLACES)).json();
  const ids: string[] = geo.features.map((f: any) => f.properties.id);
  out.places = ids.length;
  out.fetchMs = Math.round(performance.now() - fetched);

  map.addSource(SRC, {
    type: 'geojson',
    data: geo,
    promoteId: 'id', // feature-state needs a stable key, not a generated index
  });

  // Two layers, the governing contrast: an open ring, and a filled dot.
  map.addLayer({
    id: 'places',
    type: 'circle',
    source: SRC,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.5, 6, 5, 10, 7],
      'circle-color': [
        'case',
        ['boolean', ['feature-state', 'visited'], false],
        '#A87B22',
        'rgba(0,0,0,0)',
      ],
      'circle-stroke-width': 1.2,
      'circle-stroke-color': [
        'case',
        ['boolean', ['feature-state', 'visited'], false],
        '#A87B22',
        '#7B9198',
      ],
    },
  });

  await new Promise<void>((r) => map.once('idle', () => r()));
  out.coldLoadMs = Math.round(performance.now() - t0);

  // --- 0. baseline: what one repaint costs when nothing changed -----------
  // Under software rasterisation a frame is ~100 ms, so a mark that finishes
  // in one frame reads as "100 ms" and tells us nothing. Marking has to be
  // reported as what it adds on top of a repaint the renderer was going to
  // do anyway. On hardware the baseline is a frame at 60 Hz and this same
  // delta is the whole cost.
  const base: number[] = [];
  for (let i = 0; i < 40; i++) {
    const a = performance.now();
    await painted();
    base.push(performance.now() - a);
    await frame();
  }
  base.sort((a, b) => a - b);
  const baseline = base[Math.floor(base.length / 2)];
  out.repaintBaselineMs = +baseline.toFixed(1);

  // --- 1. single mark, the most repeated action in the product ------------
  const single: number[] = [];
  for (let i = 0; i < 40; i++) {
    const id = ids[i * 97 % ids.length];
    const a = performance.now();
    map.setFeatureState({ source: SRC, id }, { visited: true });
    await painted();
    single.push(performance.now() - a);
    map.setFeatureState({ source: SRC, id }, { visited: false });
    await frame();
  }
  single.sort((a, b) => a - b);
  out.markMedianMs = +single[Math.floor(single.length / 2)].toFixed(1);
  out.markP95Ms = +single[Math.floor(single.length * 0.95)].toFixed(1);
  out.markMaxMs = +single[single.length - 1].toFixed(1);
  out.markOverBaselineMs = +(out.markMedianMs as number - baseline).toFixed(1);

  // --- 2. bulk mark: every place in the database, the worst case ----------
  const b = performance.now();
  for (const id of ids) map.setFeatureState({ source: SRC, id }, { visited: true });
  const setDone = performance.now();
  await painted();
  out.bulkSetMs = Math.round(setDone - b);
  out.bulkPaintMs = Math.round(performance.now() - b);

  // --- 3. one more mark with all 11,918 states live ------------------------
  // This is the case that stalled on older majors: the cost of touching one
  // entry when the state table is already full.
  const loaded: number[] = [];
  for (let i = 0; i < 40; i++) {
    const id = ids[i * 89 % ids.length];
    const a = performance.now();
    map.setFeatureState({ source: SRC, id }, { visited: false });
    await painted();
    loaded.push(performance.now() - a);
    map.setFeatureState({ source: SRC, id }, { visited: true });
    await frame();
  }
  loaded.sort((x, y) => x - y);
  out.markWhenFullMedianMs = +loaded[Math.floor(loaded.length / 2)].toFixed(1);
  out.markWhenFullP95Ms = +loaded[Math.floor(loaded.length * 0.95)].toFixed(1);
  out.markWhenFullOverBaselineMs =
    +(out.markWhenFullMedianMs as number - baseline).toFixed(1);
  // The question doc 4 §15 actually asks: does a full state table make one
  // mark more expensive? Anything near 1.0 means no.
  out.fullStatePenalty =
    +((out.markWhenFullMedianMs as number) / (out.markMedianMs as number)).toFixed(2);

  // --- 4. panning at world zoom, everything marked ------------------------
  out.panFpsAllVisited = +(await measurePan(4)).toFixed(1);
  for (const id of ids) map.removeFeatureState({ source: SRC, id });
  await painted();
  out.panFpsNoneVisited = +(await measurePan(4)).toFixed(1);
  // Strip the places layer entirely: what the basemap alone costs. The gap
  // between this and panFpsAllVisited is the price of 11,918 pins; the
  // absolute number is the rasteriser, which is not what we are testing.
  map.removeLayer('places');
  await painted();
  out.panFpsNoPlaces = +(await measurePan(3)).toFixed(1);
  out.placesLayerFrameCostMs = +(
    1000 / (out.panFpsAllVisited as number) - 1000 / (out.panFpsNoPlaces as number)
  ).toFixed(1);

  // --- 5. does clustering rescue world zoom, and can it carry marking? ----
  // Doc 2 §4.2 asks for clusters that state total AND visited counts. Visited
  // is user state, so the obvious route is MapLibre's own clustering with
  // clusterProperties — except clusterProperties sums a data property, and
  // feature-state is not data. Test the two things that decide the design:
  // whether promoteId survives cluster: true at all, and what a hand-built
  // cluster layer costs.
  map.addSource('clustered', {
    type: 'geojson',
    data: geo,
    cluster: true,
    clusterRadius: 50,
    clusterMaxZoom: 6,
    promoteId: 'id',
  } as any);
  await new Promise<void>((r) => map.once('idle', () => r()));
  const probe = ids[0];
  map.setFeatureState({ source: 'clustered', id: probe }, { visited: true });
  const st = map.getFeatureState({ source: 'clustered', id: probe });
  // A source that ignores promoteId still stores the state object; what it
  // cannot do is match it to a feature. Query the rendered feature instead.
  out.promoteIdSurvivesClustering = (() => {
    const feats = map.querySourceFeatures('clustered', {
      filter: ['==', ['get', 'id'], probe],
    } as any);
    return feats.length > 0 && feats[0].id !== undefined;
  })();
  out.clusterStateEcho = JSON.stringify(st);

  // Hand-built clusters: one grid pass over every place, which is what lets a
  // cluster carry a visited count that feature-state cannot supply.
  const gridClusters = (cell: number) => {
    const bins = new Map<string, { n: number; x: number; y: number }>();
    for (const f of geo.features) {
      const [x, y] = f.geometry.coordinates;
      const k = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
      const b = bins.get(k) ?? { n: 0, x: 0, y: 0 };
      b.n++; b.x += x; b.y += y;
      bins.set(k, b);
    }
    return {
      type: 'FeatureCollection',
      features: [...bins.values()].map((b) => ({
        type: 'Feature',
        properties: { n: b.n, seen: 0 },
        geometry: { type: 'Point', coordinates: [b.x / b.n, b.y / b.n] },
      })),
    };
  };
  const gc0 = performance.now();
  const clusters = gridClusters(6);
  out.clusterBuildMs = +(performance.now() - gc0).toFixed(1);
  out.clusterCount = clusters.features.length;

  map.addSource('grid', { type: 'geojson', data: clusters as any });
  map.addLayer({
    id: 'grid-c', type: 'circle', source: 'grid',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 1, 6, 400, 20],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-width': 1.4, 'circle-stroke-color': '#7B9198',
    },
  });
  await new Promise<void>((r) => map.once('idle', () => r()));
  out.panFpsClustered = +(await measurePan(3)).toFixed(1);

  (window as any).__spike = out;
  document.getElementById('out')!.textContent = JSON.stringify(out, null, 2);
});
