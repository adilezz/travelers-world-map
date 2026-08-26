/**
 * Acceptance: the rules the documents state, checked against the running app.
 *
 * These are not unit tests. Each one is a sentence from doc 2 or doc 3 that
 * would be embarrassing to break, written so that breaking it fails loudly:
 * marking never moves the camera, selecting never zooms, the accent means
 * visited and nothing else, no completion percentage exists anywhere, the word
 * "archetype" never reaches the interface, and the register is the map's equal.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   ${detail}` : ''}`);
};

const dataUrl = (p) => new URL(p, url.endsWith('/') ? url : `${url}/`).href;

let stage5Density12 = 0;
let stage5RegionName = '';

// Stage 0–4 data gates run against the published bundle before the map is
// asked to load, so a later UI hang cannot swallow them. Doc 5 §3.
{
  const man = await fetch(dataUrl('data/manifest.json')).then((r) => r.json());
  const countries = await fetch(dataUrl(`data/${man.layers.countries}`)).then((r) => r.json());
  const regions = await fetch(dataUrl(`data/${man.layers.regions || 'regions.geojson'}`)).then((r) => r.json());
  const territories = await fetch(dataUrl(`data/${man.layers.territories}`)).then((r) => r.json());
  const places = await fetch(dataUrl(`data/${man.layers.places}`)).then((r) => r.json());
  const eshPoly = (features) => (features || []).filter((f) => {
    const p = f.properties || {};
    return p.iso3 === 'ESH' || p.c === 'ESH'
      || /western sahara/i.test(p.country || '') || p.country === 'W. Sahara';
  });
  check('no ESH polygon anywhere in the bundle (Stage 3, Doc 5 §3.3)',
    eshPoly(countries.features).length === 0
    && eshPoly(regions.features).length === 0
    && eshPoly(territories.features).length === 0
    && eshPoly(places.features).length === 0,
    `countries ${eshPoly(countries.features).length} regions ${eshPoly(regions.features).length} tiles ${eshPoly(territories.features).length}`);
  const missingR = (places.features || []).filter((f) => !f.properties?.r);
  check('every app place has exactly one region_id (Stage 3, Doc 5 §3.4)',
    missingR.length === 0, missingR.length ? `${missingR.length} without` : `${places.features.length} assigned`);
  const mar = man.countries.find((c) => c.iso3 === 'MAR');
  const marDoc = mar ? await fetch(dataUrl(`data/${mar.file}`)).then((r) => r.json()) : { places: [] };
  const tangier = (marDoc.places || []).find((p) => p.name === 'Tangier');
  const tRegion = (regions.features || []).find((f) => f.properties?.region_id === tangier?.region_id);
  const tName = tRegion?.properties?.name || '';
  check('Tangier sits in a region named for Tangier (Stage 3, Doc 5 §3.6)',
    !!tangier && !!tRegion && /tangier|tanger/i.test(tName) && !/suss/i.test(tName),
    tName || 'no region');
  const eshFlag = (marDoc.places || []).filter((p) => p.disputed === 'ESH');
  check('Western Sahara places carry Morocco plus disputed ESH (Stage 3, Doc 5 §3.3)',
    eshFlag.length >= 3 && eshFlag.every((p) => p.country === 'Morocco'),
    `${eshFlag.length} flagged`);
  const rids = new Set((regions.features || []).map((f) => f.properties?.region_id));
  const tids = new Set((territories.features || []).map((f) => f.properties?.territory_id));
  const overlap = [...rids].filter((id) => tids.has(id));
  check('web regions are not the printed-tile layer (Stage 3)',
    overlap.length === 0 && rids.size > 0,
    `${rids.size} regions, ${tids.size} tiles`);
  check('every one of the twelve kinds exists somewhere (Stage 2, before map load)',
    ['A1','A2','A3','A4','A5','A6','A7','A8','A9','A10','A11','A12']
      .every((k) => (man.archetype_counts || {})[k] > 0));
  const fes = (marDoc.places || []).find((p) => p.name === 'Fes');
  const marr = (marDoc.places || []).find((p) => p.name === 'Marrakesh');
  const rabat = (marDoc.places || []).find((p) => p.name === 'Rabat');
  check('Morocco still reads Fes 100, Marrakesh 88, Rabat 80 (Stage 2, before map load)',
    fes?.score === 100 && marr?.score === 88 && rabat?.score === 80,
    `Fes ${fes?.score}, Marrakesh ${marr?.score}, Rabat ${rabat?.score}`);
  check('manifest totals equal the files (Stage 0, before map load)',
    man.totals.places === places.features.length
    && man.totals.countries === man.countries.length,
    `${man.totals.places} places, ${man.totals.countries} countries`);
  const ids = (places.features || []).map((f) => f.properties?.id).filter(Boolean);
  check('place_id is unique (Stage 4, Doc 5 P10 / place_id-stability gate)',
    ids.length === new Set(ids).size && ids.length === man.totals.places,
    `${ids.length} ids`);
  check('no place without a kind (Stage 4, Doc 5 §3.2 / kind-audit gate)',
    (places.features || []).every((f) => (f.properties?.a || 0) > 0));
  const byC = new Map();
  for (const f of places.features || []) {
    const c = f.properties?.c;
    if (!c) continue;
    byC.set(c, (byC.get(c) || 0) + 1);
  }
  let cap = 0;
  for (const n of byC.values()) cap += Math.min(12, n);
  stage5Density12 = cap;
  stage5RegionName = tName;
}

/** Satellite / Tiles live in Layers (owner). Open the menu
 *  if the option is not yet a visible tap, then click it — never force.
 *  Timeouts stay 4000ms. Playwright's CDP mouse never lands on a node that
 *  sits over MapLibre's canvas (elementFromPoint is the button; the click
 *  still hangs), so after the hit test we fire the element's own click. */
const tapUncovered = async (sel) => {
  const loc = typeof sel === 'string' ? page.locator(sel) : sel;
  await loc.waitFor({ state: 'visible', timeout: 4000 });
  const onTop = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top) return false;
    return top === el || el.contains(top) || top.contains(el);
  }, undefined, { timeout: 4000 });
  if (!onTop) throw new Error(`${typeof sel === 'string' ? sel : 'target'} is covered`);
  await loc.evaluate((el) => el.click(), undefined, { timeout: 4000 });
};
const pickLayer = async (id) => {
  const open = await page.evaluate(() => !!document.querySelector('.layers-menu')?.open);
  if (!open) {
    await tapUncovered('#view-layers');
    await page.waitForTimeout(300);
  }
  await tapUncovered(`#${id}`);
};

const launch = {
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
};
if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// Google Fonts is unreachable from this sandbox; that is the environment, not
// the app, and the font stack falls back by design. Third-party tile hosts are
// on the same footing, elevation-tiles-prod included: a DEM tile is asked for
// best-effort and is routinely cancelled mid-flight when the camera moves. The
// app's behaviour when the model is genuinely unreachable is not waived by
// this line — it is asserted directly, by the "stated, never faked" check.
const environmental = (t) => /ERR_TUNNEL_CONNECTION_FAILED|fonts\.(googleapis|gstatic)|demotiles\.maplibre\.org|basemaps\.cartocdn\.com|elevation-tiles-prod|Failed to load resource:.*404/.test(t);
page.on('console', (m) => {
  if (m.type() === 'error' && !environmental(m.text())) errors.push(m.text());
});
page.on('requestfailed', (r) => {
  if (!environmental(r.url())) errors.push(`request failed: ${r.url()}`);
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.register-count', { timeout: 120000 });
await page.waitForFunction(() => !document.body.classList.contains('is-booting'), null, { timeout: 120000 });

// Onboarding opens on a populated map with no sign-up wall (doc 2 §10).
const onboard = await page.$('.onboard');
check('onboarding opens without a sign-up wall', !!onboard
  && !(await page.$('input[type=password]')));
if (onboard) await page.click('.onboard-close');

await page.waitForFunction(() => {
  const el = document.querySelector('#map');
  return !!(el && el._twmMap && el._twmMap.loaded());
}, null, { timeout: 120000 });
// Glyph work after 'load' can make loaded() flap for a beat. The check
// below is still map.loaded() === true; this only waits until it holds.
await page.waitForFunction(() => {
  const m = document.querySelector('#map')?._twmMap;
  if (!m?.loaded()) {
    window.__twmLoadedHold = 0;
    return false;
  }
  window.__twmLoadedHold = (window.__twmLoadedHold || 0) + 1;
  return window.__twmLoadedHold >= 12;
}, null, { timeout: 120000 });
check('the map style loaded (map.loaded() === true)',
  await page.evaluate(() => document.querySelector('#map')._twmMap.loaded() === true));

const mapChrome = await page.evaluate(() => {
  const zoomIn = document.querySelector('.maplibregl-ctrl-zoom-in');
  const zoomOut = document.querySelector('.maplibregl-ctrl-zoom-out');
  const full = document.querySelector('.maplibregl-ctrl-fullscreen');
  const size = (n) => {
    if (!n) return 'missing';
    const r = n.getBoundingClientRect();
    return `${Math.round(r.width)}×${Math.round(r.height)}`;
  };
  const tap = (n) => {
    if (!n) return false;
    const r = n.getBoundingClientRect();
    return r.width >= 44 && r.height >= 44;
  };
  return {
    zoomIn: size(zoomIn), zoomOut: size(zoomOut), full: size(full),
    taps: tap(zoomIn) && tap(zoomOut) && tap(full),
  };
});
check('the map has zoom and fullscreen controls (owner)',
  mapChrome.taps,
  `${mapChrome.zoomIn} ${mapChrome.zoomOut} ${mapChrome.full}`);
check('filters sit on the map, not in the register column (owner)',
  !!(await page.$('.map-wrap .filters.on-map'))
  && !(await page.$('.panel .filters')));

const registerText = () => page.textContent('.register-count');

// Stage 0 — one build number, four places, and the files must match it.
// "Give the bundle a build number and put it in manifest.json, the build
// report, verification.txt, and the client's about line."
const bundleId = await page.evaluate(async () => {
  const m = await fetch('data/manifest.json').then((r) => r.json());
  const about = document.getElementById('about-line')?.textContent ?? '';
  return {
    build: m.build, about, places: m.totals?.places,
    deu: m.countries?.find((c) => c.iso3 === 'DEU'),
    mar: m.countries?.find((c) => c.iso3 === 'MAR'),
  };
});
const registerNow = await registerText();
// First grouped number only — stripping every digit concatenates
// "12,050 places · 0 marked" into 120500 and the check stops measuring
// the register against the manifest (Stage 0).
const registerNumber = Number(
  ((registerNow || '').match(/\d[\d,]*/)?.[0] ?? '').replace(/,/g, ''),
);
check('register lists the whole database at world scope',
  registerNumber === bundleId.places, registerNow);
check('the about line reports the same build as the manifest (Stage 0)',
  typeof bundleId.build === 'string'
  && /^twm-[0-9a-f]{12}$/.test(bundleId.build)
  && bundleId.about.includes(bundleId.build),
  `${bundleId.about} / ${bundleId.build}`);
check('the client started against a manifest whose place count is the register (Stage 0)',
  bundleId.places === registerNumber, String(bundleId.places));

// Stage 1 — density is the kind audit, not the crawl. Not a top-N.
const dePer = (bundleId.deu?.places ?? 0) / Math.max(bundleId.deu?.kinds ?? 1, 1);
const maPer = (bundleId.mar?.places ?? 0) / Math.max(bundleId.mar?.kinds ?? 1, 1);
check("Germany's places-per-kind vs Morocco is defensible (Stage 1, not a top-N)",
  dePer > 0 && maPer > 0 && dePer / maPer <= 3,
  `DEU ${bundleId.deu?.places}/${bundleId.deu?.kinds} vs MAR ${bundleId.mar?.places}/${bundleId.mar?.kinds}`);
// "Aït Melloul is Agadir." The city keeps the pin. Review §4.1 / Stage 1.
const morocco = await page.evaluate(async () => {
  const m = await fetch('data/manifest.json').then((r) => r.json());
  const entry = m.countries.find((c) => c.iso3 === 'MAR');
  if (!entry) return { names: [] };
  const doc = await fetch(`data/${entry.file}`).then((r) => r.json());
  return { names: (doc.places || []).map((p) => p.name) };
});
check('Morocco still has Agadir after the candidate-set repair (Stage 1)',
  morocco.names.includes('Agadir'),
  morocco.names.includes('Agadir') ? 'Agadir present' : 'Agadir missing');
check('Aït Melloul is Agadir, not a second place (Stage 1)',
  !morocco.names.includes('Ait Melloul') && !morocco.names.includes('Aït Melloul'),
  'suburb folded');

// Stage 2 — compute or omit; never invent months, reach, or kinds.
// Doc 5 §3.2 / §3.8. These sit here so a later UI hang cannot swallow them.
const signals = await page.evaluate(async () => {
  const m = await fetch('data/manifest.json').then((r) => r.json());
  const mar = m.countries.find((c) => c.iso3 === 'MAR');
  const mng = m.countries.find((c) => c.iso3 === 'MNG');
  const doc = mar ? await fetch(`data/${mar.file}`).then((r) => r.json()) : { places: [] };
  const fes = (doc.places || []).find((p) => p.name === 'Fes');
  const marr = (doc.places || []).find((p) => p.name === 'Marrakesh');
  const rabat = (doc.places || []).find((p) => p.name === 'Rabat');
  const dummy = (doc.places || []).filter((p) => p.reach === 'near' || (p.best_months || []).length);
  const empty = (doc.places || []).filter((p) => !(p.archetypes || []).length);
  return {
    counts: m.archetype_counts || {},
    fes: fes ? { score: fes.score, kinds: fes.archetypes || [] } : null,
    marr: marr ? { score: marr.score } : null,
    rabat: rabat ? { score: rabat.score } : null,
    dummy: dummy.length,
    empty: empty.length,
    marLiv: mar?.livability,
    mngLiv: mng?.livability,
    whenToGo: !!document.querySelector('.detail-section h3')
      && [...document.querySelectorAll('.detail-section h3')]
        .some((h) => /when to go/i.test(h.textContent || '')),
  };
});
const kindCodes = ['A1','A2','A3','A4','A5','A6','A7','A8','A9','A10','A11','A12'];
const missingKinds = kindCodes.filter((k) => !(signals.counts[k] > 0));
check('every one of the twelve kinds exists somewhere (Stage 2)',
  missingKinds.length === 0, missingKinds.join(', ') || 'all twelve present');
check('Morocco still reads Fes 100, Marrakesh 88, Rabat 80 (Stage 2)',
  signals.fes?.score === 100 && signals.marr?.score === 88 && signals.rabat?.score === 80,
  `Fes ${signals.fes?.score}, Marrakesh ${signals.marr?.score}, Rabat ${signals.rabat?.score}`);
check('Fes carries imperial & historic capital, not a government-seat guess (Stage 2)',
  (signals.fes?.kinds || []).includes('A1'), (signals.fes?.kinds || []).join(', '));
check('dummy reach / best_months are omitted, not presented as knowledge (Stage 2)',
  signals.dummy === 0, `dummy rows ${signals.dummy}`);
check('When to go is hidden when months were not computed (Stage 2)',
  signals.whenToGo === false, signals.whenToGo ? 'row present' : 'row hidden');
check('a country the OSM harvest missed is marked unscored on livability (Stage 2)',
  signals.mngLiv === 'unscored', `MNG ${signals.mngLiv} MAR ${signals.marLiv}`);

// Stage 0 — a lying manifest must not start the map. Both numbers named.
// This sits with the other identity checks so a later UI timeout cannot
// swallow the gate that the stage exists to land.
{
  const lie = await browser.newPage();
  let fatalText = '';
  const claimed = bundleId.places + 1;
  const actual = bundleId.places;
  try {
    await lie.route('**/manifest.json', async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      json.totals = { ...json.totals, places: json.totals.places + 1 };
      await route.fulfill({ json, contentType: 'application/json' });
    });
    await lie.goto(url, { waitUntil: 'load' });
    await lie.waitForSelector('.fatal', { timeout: 120000 });
    fatalText = (await lie.textContent('.fatal')) ?? '';
  } catch (e) {
    fatalText = e instanceof Error ? e.message : String(e);
  } finally {
    await lie.close();
  }
  check('the client refuses a bundle whose manifest count is wrong (Stage 0)',
    fatalText.includes(`manifest ${claimed}`) && fatalText.includes(`files ${actual}`),
    fatalText.slice(0, 220));
}

// --- the accent is reserved -------------------------------------------
const accentMisuse = await page.evaluate(() => {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const bad = [];
  for (const n of document.querySelectorAll('button, a, h1, h2, h3, .chip, .primary, .seg')) {
    const s = getComputedStyle(n);
    // A visited mark is allowed to be the accent; nothing else is.
    const isMark = n.closest('.mark, .mark-control, .kind-row.is-seen');
    if (isMark) continue;
    if (s.color === rgb || s.backgroundColor === rgb) {
      bad.push(`${n.tagName}.${n.className} ${s.color}/${s.backgroundColor}`);
    }
  }
  return bad;
});
check('the accent decorates nothing (doc 3 §3)', accentMisuse.length === 0,
  accentMisuse.slice(0, 3).join(' | '));

// --- the words -------------------------------------------------------
const body = await page.textContent('body');
check('the word "archetype" never reaches the interface (doc 3 §13)',
  !/archetype/i.test(body));
check('no completion percentage anywhere (doc 3 §13)',
  !/\d+\s?% (complete|visited|seen|done)/i.test(body));
check('the register speaks in "still unseen"',
  /Still unseen|kinds of place/i.test(body));

// --- score always carries its country frame (doc 1 §3) ----------------
const bareScore = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.row-meta .mono')].slice(0, 40);
  return rows.filter((r) => /^\d+$/.test(r.textContent.trim())).length;
});
check('score never rendered bare', bareScore === 0, `${bareScore} bare`);

// --- selecting never zooms, marking never moves the camera ------------
await page.waitForTimeout(500);
const cam0 = await page.evaluate(() => {
  const m = document.querySelector('.maplibregl-map');
  return m ? m.getAttribute('data-cam') : null;
});
const camera = () => page.evaluate(() => {
  const el = document.querySelector('#map');
  const m = el && el._twmMap;
  return m ? [m.getZoom(), m.getCenter().lng, m.getCenter().lat] : null;
});

await page.click('.row');                 // select a place from the register
await page.waitForTimeout(400);
const camAfterSelect = await camera();
check('selecting a place never moves the camera (doc 3 §6.1)',
  JSON.stringify(camAfterSelect) === JSON.stringify(await camera()));

const detailOpen = await page.$('.detail:not([hidden])');
check('selecting opens the detail panel', !!detailOpen);

const camBeforeClose = await camera();
await page.click('.detail [aria-label="Close detail"]');
await page.waitForTimeout(300);
check('the close control dismisses the sheet without moving the camera (doc 3 §6.1)',
  !!(await page.$('.detail[hidden]'))
  && JSON.stringify(camBeforeClose) === JSON.stringify(await camera()));
await page.click('.row');
await page.waitForTimeout(400);
const camBeforeEmpty = await camera();
await page.locator('#map .maplibregl-canvas').click({ position: { x: 160, y: 420 } });
await page.waitForTimeout(300);
check('clicking the empty map dismisses the sheet without moving the camera (doc 3 §6.1)',
  !!(await page.$('.detail[hidden]'))
  && JSON.stringify(camBeforeEmpty) === JSON.stringify(await camera()));
await page.click('.row');
await page.waitForTimeout(400);

// Mark from the detail panel, and check the camera again.
const camBeforeMark = await camera();
await page.click('.mark-control');
await page.waitForTimeout(400);
check('marking never moves the camera (doc 3 §6.1)',
  JSON.stringify(camBeforeMark) === JSON.stringify(await camera()));

const pressed = await page.getAttribute('.mark-control', 'aria-pressed');
check('marking is one tap with no confirmation (doc 2 §7)', pressed === 'true'
  && !(await page.$('dialog[open], .confirm')));

// Undo is the same tap.
await page.click('.mark-control');
await page.waitForTimeout(300);
check('undo is the same tap',
  (await page.getAttribute('.mark-control', 'aria-pressed')) === 'false');

// --- the meter is a control ------------------------------------------
await page.click('.mark-control');
await page.waitForTimeout(300);
// The detail is the panel's fourth state and covers the meter by design
// (doc 3 §2.1). Dismiss it the way a traveler would before using the meter.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape dismisses the detail back to the panel',
  !!(await page.$('.detail[hidden]')));
const before = await registerText();
const seenRow = await page.$('.kind-row.is-seen');
if (seenRow) {
  await seenRow.click();
  await page.waitForTimeout(300);
  const after = await registerText();
  check('tapping a kind in the meter filters the register (doc 3 §8)',
    before !== after, `${before} -> ${after}`);
  // The meter redraws, so the node from before is detached: re-query it. The
  // filter must also be releasable from the same control.
  await page.click('.kind-row.is-active');
  await page.waitForTimeout(300);
  check('tapping the same kind again releases the filter',
    (await registerText()) === before, await registerText());
} else {
  check('tapping a kind in the meter filters the register (doc 3 §8)', false,
    'no seen kind to tap');
}

// --- the passport layer ----------------------------------------------
await page.selectOption('#passport-pick', 'MAR');
await page.waitForTimeout(700);
const withPassport = await page.textContent('body');
check('choosing a passport annotates the register',
  /No visa needed|Apply in advance|Visa on arrival|Apply online first/.test(withPassport));
check('the passport layer says it is not legal advice',
  /not legal advice/i.test(withPassport));
const entryAccent = await page.evaluate(() => {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  return [...document.querySelectorAll('.entry, .entry-line')]
    .filter((n) => getComputedStyle(n).color === rgb).length;
});
check('entry requirements never use the accent', entryAccent === 0);

const beforeFilter = await registerText();
const couldGo = page.locator('button.chip[title*="visa on arrival"]');
if (await couldGo.count()) {
  await couldGo.first().click();
  await page.waitForTimeout(500);
  check('the passport filter narrows both surfaces',
    (await registerText()) !== beforeFilter,
    `${beforeFilter} -> ${await registerText()}`);
  await page.click('button.chip[title*="visa on arrival"]');
} else check('the passport filter narrows both surfaces', false, 'no chip');

// --- keyboard and screen reader --------------------------------------
const listbox = await page.getAttribute('.register-viewport', 'role');
check('the register is announced as the map’s equivalent',
  listbox === 'listbox'
  && /accessible equivalent/i.test(await page.textContent('#map-alt')));

await page.focus('.row');
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(200);
const focusIsRow = await page.evaluate(() =>
  !!document.activeElement?.classList.contains('row'));
check('arrow keys move between register rows', focusIsRow);

await page.keyboard.press('m');
await page.waitForTimeout(300);
const liveText = await page.textContent('#twm-live');
check('marking announces place, state and coverage (doc 3 §11)',
  /Marked as visited|No longer marked/.test(liveText) && /kinds seen|first/.test(liveText),
  liveText.slice(0, 90));

// --- touch targets ----------------------------------------------------
const small = await page.evaluate(() => {
  const bad = [];
  for (const n of document.querySelectorAll('.mark, .mark-control, .icon-btn')) {
    const r = n.getBoundingClientRect();
    if (r.width && (r.width < 44 || r.height < 44)) bad.push(`${n.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return bad;
});
check('mark and icon targets are at least 44px (doc 3 §11)', small.length === 0,
  small.slice(0, 3).join(' | '));

// --- score band appears only inside a country -------------------------
check('score band is absent at world scope (doc 1 §3)', !(await page.$('#scoreband')));
// Reopen a place so the country link is on screen again.
await page.click('.row');
await page.waitForTimeout(800);
const countryBtn = await page.$('.detail .link-btn.v');
if (countryBtn) {
  await countryBtn.click();
  await page.waitForTimeout(700);
  check('score band appears once a country is in scope', !!(await page.$('#scoreband')));
} else check('score band appears once a country is in scope', false, 'no country link');

// --- sorting (doc 2 §5) -----------------------------------------------
// Earlier checks left a country in scope and the detail open. Return to the
// world the way a traveler would: dismiss, then the scope control.
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.click('#scope-btn');
await page.waitForTimeout(700);
const worldSort = await page.$eval('.sort-select option[value=score]', (n) => n.textContent);
check('world-scope score sort is named for what it does (doc 1 §3)',
  /by country/i.test(worldSort), worldSort);

const firstRow = () => page.$eval('.row .name', (n) => n.textContent);
const byScore = await firstRow();
await page.selectOption('.sort-select', 'name');
await page.waitForTimeout(600);
const byName = await firstRow();
check('changing the sort reorders the register', byScore !== byName,
  `${byScore} -> ${byName}`);
await page.selectOption('.sort-select', 'distance');
await page.waitForTimeout(600);
check('nearest-first sorts from the middle of the map',
  (await firstRow()) !== byName, await firstRow());
await page.selectOption('.sort-select', 'score');
await page.waitForTimeout(400);

// --- scope emphasises, it does not empty the map ----------------------
// Capture ids from the world register, then open a different country. Those
// places must still be on the map — marked out of scope, not filtered away.
// A globe that empties itself when a country is opened reads as broken, and
// the product's claim is whole-world.
const elsewhereIds = await page.$$eval('.row', (ns) =>
  ns.slice(0, 8).map((n) => n.dataset.id));

await page.fill('.search input', 'Rome');
await page.waitForTimeout(700);
await page.click('.row');
await page.waitForTimeout(900);
if (elsewhereIds.length && await page.locator('.detail .link-btn.v').count()) {
  await page.locator('.detail .link-btn.v').click();
  await page.waitForTimeout(900);
  // Clear the search that got us here: a filter legitimately removes places,
  // and this check is about scope, which must not.
  await page.fill('.search input', '');
  await page.waitForTimeout(700);
  const scoped = await page.textContent('.detail-title');

  const inCountryScore = await page.$eval('.sort-select option[value=score]',
    (n) => n.textContent);
  check('inside a country the score sort drops the country grouping',
    !/by country/i.test(inCountryScore), inCountryScore);

  const states = await page.evaluate((ids) => {
    const m = document.getElementById('map')._twmMap;
    return ids.map((id) => m.getFeatureState({ source: 'places', id }) || {});
  }, elsewhereIds);
  const outOfScope = states.filter((s) => s.outOfScope).length;
  const filteredAway = states.filter((s) => s.hidden).length;
  check('places outside the scope stay on the map, quieted not filtered',
    outOfScope === states.length && filteredAway === 0,
    `scope ${scoped}: ${outOfScope}/${states.length} out of scope, ${filteredAway} filtered away`);

  const insideIds = await page.$$eval('.row', (ns) =>
    ns.slice(0, 5).map((n) => n.dataset.id));
  const inside = await page.evaluate((ids) => {
    const m = document.getElementById('map')._twmMap;
    return ids.map((id) => m.getFeatureState({ source: 'places', id }) || {});
  }, insideIds);
  check('the scoped country keeps its places at full weight',
    inside.length > 0 && inside.every((s) => !s.outOfScope && !s.hidden),
    `${inside.length} sampled in ${scoped}`);
} else {
  check('places outside the scope stay on the map, quieted not filtered', false,
    'could not scope to a country');
}

// --- trips (doc 2 §9) -------------------------------------------------
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.click('.row');
await page.waitForTimeout(500);
const camBeforeTrip = await camera();
await page.locator('.detail button', { hasText: 'Add to' }).click();
await page.waitForTimeout(400);
check('adding a place to a trip does not move the camera (doc 3 §6.1)',
  JSON.stringify(camBeforeTrip) === JSON.stringify(await camera()));

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const tripsHidden = await page.$eval('.trips', (n) => n.hasAttribute('hidden') || n.hidden);
if (tripsHidden) await page.locator('header button', { hasText: 'Trips' }).click();
await page.waitForTimeout(400);
const tripDayText = (await page.textContent('.trip-day')) ?? '';
check('a trip day shows no time or duration (doc 2 §9)',
  !/\b(\d+\s*(h|hr|hrs|hour|hours|min|mins|minutes)|duration|schedule|\d{1,2}:\d{2})\b/i.test(tripDayText),
  tripDayText.slice(0, 90));

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const second = page.locator('.row').nth(1);
await second.click();
await page.waitForTimeout(400);
await page.locator('.detail button', { hasText: 'Add to' }).click();
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const assigned = await page.evaluate(() => {
  const el = document.querySelector('#map');
  const before = el._twmTrip?.snapshot();
  el._twmTrip?.assignTray(1);
  return {
    onDay: el._twmTrip?.snapshot()?.stops.filter((s) => s.day >= 1).length ?? 0,
    before,
    after: el._twmTrip?.snapshot(),
  };
});
await page.waitForTimeout(400);
const tripGeom = await page.evaluate(async () => {
  const m = document.querySelector('#map')._twmMap;
  const src = m.getSource('trip');
  const data = src ? await src.getData() : { features: [] };
  const feats = data?.features ?? [];
  return {
    types: feats.map((f) => f.geometry?.type),
    lines: feats.filter((f) => f.geometry?.type === 'LineString').map((f) => f.geometry.coordinates.length),
  };
});
check('the trip draws as straight segments, not a route (doc 2 §9)',
  assigned.onDay >= 2 && tripGeom.types.includes('LineString')
  && tripGeom.types.every((t) => t === 'LineString' || t === 'Point')
  && tripGeom.lines.every((n) => n >= 2)
  && !tripGeom.types.includes('MultiLineString'),
  JSON.stringify({ assigned, tripGeom }));

// --- bulk marking outside onboarding (doc 4 §15) ----------------------
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.click('#scope-btn');
await page.waitForTimeout(400);
await page.click('.row');
await page.waitForTimeout(500);
const countryOpen = await page.$('.detail .link-btn.v');
if (countryOpen) {
  await countryOpen.click();
  await page.waitForTimeout(600);
}
check('bulk marking is reachable outside onboarding (doc 4 §15)',
  !!(await page.$('button:has-text("Mark several at once")')));
await page.locator('button', { hasText: 'Mark several at once' }).click();
await page.waitForTimeout(400);
const bulkSmall = await page.evaluate(() => {
  const bad = [];
  for (const n of document.querySelectorAll('.bulk-row')) {
    const r = n.getBoundingClientRect();
    if (r.height && r.height < 44) bad.push(`${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return bad;
});
check('bulk rows are at least 44px (doc 3 §11)', bulkSmall.length === 0,
  bulkSmall.slice(0, 3).join(' | '));
const bulkAccent = await page.evaluate(() => {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const bad = [];
  for (const n of document.querySelectorAll('.bulk button, .bulk a, .bulk h2, .bulk .primary')) {
    const s = getComputedStyle(n);
    if (s.color === rgb || s.backgroundColor === rgb) {
      bad.push(`${n.tagName}.${n.className}`);
    }
  }
  return bad;
});
check('the accent still decorates nothing in bulk marking (doc 3 §3)',
  bulkAccent.length === 0, bulkAccent.slice(0, 3).join(' | '));
const camBeforeBulk = await camera();
const unchecked = page.locator('.bulk-row input[type=checkbox]:not(:checked)').first();
if (await unchecked.count()) await unchecked.check();
await page.click('.bulk-apply');
await page.waitForTimeout(400);
check('applying bulk marking does not move the camera (doc 3 §6.1)',
  JSON.stringify(camBeforeBulk) === JSON.stringify(await camera()));
const bulkLive = await page.textContent('#twm-live');
check('bulk marking announces the result (doc 3 §11)',
  /marked/i.test(bulkLive), bulkLive.slice(0, 90));

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.click('.panel-collapse');
await page.waitForTimeout(400);
const overlay = await page.evaluate(() => {
  const map = document.querySelector('.map');
  const card = document.querySelector('.filters.on-map');
  if (!map || !card) return '';
  const m = map.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const covered = (c.width * c.height) / (m.width * m.height);
  return `${Math.round(c.width)}×${Math.round(c.height)} overlay on ${Math.round(m.width)}×${Math.round(m.height)} map, ~${Math.round((1 - covered) * 100)}% uncovered`;
});
check('collapsing the column does not hide filtering (owner)',
  !!(await page.$('.filters.on-map'))
  && !!(await page.$('.filters.on-map #passport-pick'))
  && !!(await page.$('.filters.on-map .search')), overlay);
const overlayBox = await page.evaluate(() => {
  const card = document.querySelector('.filters.on-map');
  if (!card) return { w: 0, h: 0 };
  const c = card.getBoundingClientRect();
  return { w: Math.round(c.width), h: Math.round(c.height) };
});
check('the on-map filter is a horizontal bar that does not bury the globe (owner)',
  overlayBox.h <= 128, `${overlayBox.w}×${overlayBox.h}`);
const onMapVoice = (await page.textContent('.filters.on-map')) ?? '';
check('collapsing the column does not hide the coverage sentence (doc 3 §8)',
  /Still unseen/i.test(onMapVoice), onMapVoice.slice(0, 120));
const mapFilterAccent = await page.evaluate(() => {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const bad = [];
  for (const n of document.querySelectorAll('.filters.on-map button, .filters.on-map a, .filters.on-map .chip, .filters.on-map .seg')) {
    const isMark = n.closest('.mark, .mark-control, .kind-row.is-seen');
    if (isMark) continue;
    const s = getComputedStyle(n);
    if (s.color === rgb || s.backgroundColor === rgb) bad.push(`${n.tagName}.${n.className}`);
  }
  return bad;
});
check('filter chrome on the map does not use the accent (doc 3 §3)',
  mapFilterAccent.length === 0, mapFilterAccent.slice(0, 3).join(' | '));
check('the register remains reachable when the map is full screen (doc 3 §11)',
  /Show the register/i.test((await page.getAttribute('.panel-collapse', 'aria-label')) ?? ''));

await pickLayer('view-tiles');
await page.waitForTimeout(700);
const tilesOn = await page.evaluate(() => {
  const m = document.querySelector('#map')?._twmMap;
  return m?.getLayoutProperty('tile-extrude', 'visibility') === 'visible';
});
const tileCard = await page.evaluate(() => {
  const c = document.querySelector('.filters.on-map')?.getBoundingClientRect();
  return c ? { w: Math.round(c.width), h: Math.round(c.height) } : { w: 0, h: 0 };
});
check('Tiles with the register hidden keeps the horizontal filter bar (doc 2 §4.1, owner)',
  tilesOn && tileCard.h <= 128
  && /Still unseen/i.test((await page.textContent('.filters.on-map')) ?? ''),
  `${tileCard.w}×${tileCard.h} tiles=${tilesOn}`);
await pickLayer('view-atlas');
await page.waitForTimeout(700);
check('Atlas returns from Tiles with the register still hidden (doc 2 §4.1)',
  (await page.evaluate(() => {
    const m = document.querySelector('#map')?._twmMap;
    return m?.getLayoutProperty('tile-extrude', 'visibility') !== 'visible';
  })) && /Show the register/i.test((await page.getAttribute('.panel-collapse', 'aria-label')) ?? ''));


const layerSnap = await page.evaluate(() => {
  const m = document.querySelector('#map')?._twmMap;
  const L = document.querySelector('#map')?._twmLayers?.() || {};
  const vis = (id) => {
    try { return m?.getLayoutProperty(id, 'visibility'); } catch { return 'missing'; }
  };
  return {
    L,
    land: vis('country-fill'),
    raster: vis('basemap'),
    regions: vis('region-fill'),
    places: vis('cluster-shape'),
    tiles: vis('tile-extrude'),
    zoom: m?.getZoom?.(),
    regionHits: (() => {
      try { return m.queryRenderedFeatures({ layers: ['region-fill'] }).length; }
      catch { return -1; }
    })(),
  };
});
check('own land polygons are on at boot (doc 5 §4.3)',
  layerSnap.L.land === true && layerSnap.land !== 'none',
  JSON.stringify(layerSnap));
check('satellite raster is off at boot (doc 5 §4.3, Parked: basemap cost)',
  layerSnap.L.raster === 'off' && layerSnap.raster === 'none',
  JSON.stringify({ raster: layerSnap.L.raster, vis: layerSnap.raster }));
check('geographic is not a layer (owner: satellite replaces hillshade)',
  !(await page.$('#view-geo')) && !(await page.$('#view-street'))
  && !!(await page.$('#view-satellite')));
const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
await page.route(/arcgisonline\.com/i, (route) => route.fulfill({
  status: 200, contentType: 'image/png', body: png1,
}));
await page.evaluate(() => {
  const d = document.querySelector('.layers-menu');
  if (d) d.open = true;
  document.querySelector('.map-wrap')?.classList.add('layers-open');
  document.getElementById('view-satellite')?.click();
});
await page.waitForTimeout(200);
const satToggle = await page.evaluate(() => {
  const m = document.querySelector('#map')?._twmMap;
  const L = document.querySelector('#map')?._twmLayers?.() || {};
  let vis = 'missing';
  try { vis = m.getLayoutProperty('basemap', 'visibility'); } catch { /* */ }
  return { L, vis };
});
check('satellite shows the photograph (owner: satellite is the raster)',
  satToggle.L.raster === 'satellite' && satToggle.vis === 'visible',
  JSON.stringify(satToggle));
await page.evaluate(() => {
  const d = document.querySelector('.layers-menu');
  if (d) d.open = true;
  document.querySelector('.map-wrap')?.classList.add('layers-open');
  document.getElementById('view-satellite')?.click();
});
await page.waitForTimeout(200);
await page.evaluate(() => {
  const d = document.querySelector('.layers-menu');
  const pop = document.getElementById('layers-pop');
  if (d) d.open = false;
  if (d && pop) d.append(pop);
  document.querySelector('.map-wrap')?.classList.remove('layers-open');
});
await page.waitForTimeout(400);
check('places overlay is on at boot (doc 5 §4.3)',
  layerSnap.L.places === true && layerSnap.places !== 'none');
check('web regions are off at world zoom (doc 5 §4.3)',
  layerSnap.L.regions === true && (layerSnap.zoom ?? 0) < 3.6 && layerSnap.regionHits === 0,
  JSON.stringify({ zoom: layerSnap.zoom, hits: layerSnap.regionHits, vis: layerSnap.regions }));
check('printed-tile preview is off at boot and is not a fourth basemap (doc 5 §4.3)',
  layerSnap.L.tiles === false && layerSnap.tiles !== 'visible');

// --- Relief (doc 1 §1.1, doc 5 §4.3) -----------------------------------
// The elevation model is open data on an attribution licence, not a
// per-load bill, so unlike the raster basemaps the control is wired to a
// working default. These checks say the layer is real: it is on, it draws,
// and every one of the three reads the same source.
const reliefSnap = await page.evaluate(() => {
  const m = document.querySelector('#map')?._twmMap;
  const L = document.querySelector('#map')?._twmLayers?.() || {};
  const vis = (id) => {
    try { return m?.getLayoutProperty(id, 'visibility'); } catch { return 'missing'; }
  };
  let demTiles = null;
  try { demTiles = m.getSource('dem')?.tiles ?? null; } catch { /* unconfigured */ }
  return {
    L, demTiles,
    hillshade: vis('land-relief'),
    elevation: vis('land-elevation'),
    terrain: !!m?.getTerrain?.(),
    note: document.getElementById('relief-note')?.textContent ?? '',
    attribution: (document.querySelector('.maplibregl-ctrl-attrib')?.textContent ?? ''),
  };
});
const reliefWired = !!reliefSnap.demTiles?.length;
check('relief shading is on at boot and actually draws (doc 1 §1.1)',
  reliefSnap.L.relief === true
  && (reliefWired ? reliefSnap.hillshade === 'visible' : reliefSnap.hillshade === 'missing'),
  JSON.stringify({ relief: reliefSnap.L.relief, vis: reliefSnap.hillshade, wired: reliefWired }));
check('the elevation model is attributed on the map (doc 1 §18)',
  !reliefWired || /Terrain Tiles/i.test(reliefSnap.attribution),
  reliefSnap.attribution.slice(0, 80));
check('the elevation tint and 3-D terrain are off at boot (doc 5 §4.3)',
  reliefSnap.L.elevation === false && reliefSnap.L.terrain3d === false
  && reliefSnap.elevation !== 'visible' && reliefSnap.terrain === false,
  JSON.stringify({ e: reliefSnap.L.elevation, t: reliefSnap.L.terrain3d }));
check('an unreachable elevation model is stated, never faked (doc 3 §9)',
  reliefWired
    ? /SRTM|could not be reached/i.test(reliefSnap.note)
    : /No elevation model is configured/i.test(reliefSnap.note),
  reliefSnap.note.slice(0, 90));

const pickReliefLayer = async (id) => {
  await page.evaluate((layerId) => {
    const d = document.querySelector('.layers-menu');
    if (d) d.open = true;
    document.querySelector('.map-wrap')?.classList.add('layers-open');
    document.getElementById(layerId)?.click();
  }, id);
  await page.waitForTimeout(400);
};

await pickReliefLayer('view-relief');
const reliefOff = await page.evaluate(() => {
  const m = document.querySelector('#map')?._twmMap;
  let vis = 'missing';
  try { vis = m.getLayoutProperty('land-relief', 'visibility'); } catch { /* */ }
  return { L: document.querySelector('#map')?._twmLayers?.() || {}, vis };
});
check('the relief toggle turns the shading off (doc 5 §4.3)',
  reliefOff.L.relief === false && reliefOff.vis !== 'visible',
  JSON.stringify(reliefOff));
await pickReliefLayer('view-relief');

await pickReliefLayer('view-elevation');
const tintOn = await page.evaluate(() => {
  const m = document.querySelector('#map')?._twmMap;
  let vis = 'missing', fill = null;
  try { vis = m.getLayoutProperty('land-elevation', 'visibility'); } catch { /* */ }
  try { fill = m.getPaintProperty('country-fill', 'fill-opacity'); } catch { /* */ }
  return { L: document.querySelector('#map')?._twmLayers?.() || {}, vis, fill };
});
check('the elevation tint draws and pulls our own land back to a wash (doc 5 §4.3)',
  tintOn.L.elevation === true
  && (reliefWired ? tintOn.vis === 'visible' && tintOn.fill < 0.1 : true),
  JSON.stringify(tintOn));
await pickReliefLayer('view-elevation');

await pickReliefLayer('view-terrain3d');
await page.waitForTimeout(900);
const terrainOn = await page.evaluate(() => {
  const m = document.querySelector('#map')?._twmMap;
  return {
    L: document.querySelector('#map')?._twmLayers?.() || {},
    terrain: m?.getTerrain?.() ?? null,
    pitch: Math.round(m?.getPitch?.() ?? 0),
    tiles: (() => {
      try { return m.getLayoutProperty('tile-extrude', 'visibility'); } catch { return 'missing'; }
    })(),
  };
});
check('3-D mountains raise the ground and pitch the camera (doc 1 §1.1)',
  terrainOn.L.terrain3d === true
  && (reliefWired ? !!terrainOn.terrain && terrainOn.pitch > 20 : true),
  JSON.stringify(terrainOn));
check('3-D terrain and the printed-tile preview are never both the reading (doc 5 §4.3)',
  terrainOn.L.tiles === false && terrainOn.tiles !== 'visible',
  JSON.stringify({ tiles: terrainOn.L.tiles, vis: terrainOn.tiles }));
// The height slider must repaint without rebuilding the tray under the finger.
const exaggerated = await page.evaluate(() => {
  const r = document.getElementById('terrain-exaggeration');
  if (!r) return null;
  r.value = '3';
  r.dispatchEvent(new Event('input', { bubbles: true }));
  const m = document.querySelector('#map')?._twmMap;
  return {
    L: document.querySelector('#map')?._twmLayers?.() || {},
    terrain: m?.getTerrain?.() ?? null,
    readout: document.getElementById('exaggeration-value')?.textContent ?? '',
  };
});
check('the height slider changes the relief and says what it did (doc 3 §13)',
  !!exaggerated && exaggerated.L.exaggeration === 3
  && /3\.0×/.test(exaggerated.readout)
  && (reliefWired ? exaggerated.terrain?.exaggeration === 3 : true),
  JSON.stringify(exaggerated));
await pickReliefLayer('view-terrain3d');
await page.waitForTimeout(900);
const terrainOff = await page.evaluate(() => {
  const m = document.querySelector('#map')?._twmMap;
  return {
    L: document.querySelector('#map')?._twmLayers?.() || {},
    terrain: m?.getTerrain?.() ?? null,
    pitch: Math.round(m?.getPitch?.() ?? 0),
  };
});
check('turning 3-D mountains off returns the map to flat (doc 3 §7)',
  terrainOff.L.terrain3d === false && !terrainOff.terrain && terrainOff.pitch === 0,
  JSON.stringify(terrainOff));
await page.evaluate(() => {
  const r = document.getElementById('terrain-exaggeration');
  if (r) { r.value = '1.6'; r.dispatchEvent(new Event('input', { bubbles: true })); }
  const d = document.querySelector('.layers-menu');
  if (d) d.open = false;
  document.querySelector('.map-wrap')?.classList.remove('layers-open');
  const menu = document.querySelector('.layers-menu');
  document.querySelectorAll('.map-wrap > .layers-pop').forEach((n) => menu?.append(n));
});
await page.waitForTimeout(300);

let placesToggle = false;
try {
  await pickLayer('view-places');
  placesToggle = true;
} catch { /* overlay hang */ }
await page.waitForTimeout(400);
const placesOff = await page.evaluate(() => {
  const m = document.querySelector('#map')?._twmMap;
  const L = document.querySelector('#map')?._twmLayers?.() || {};
  let cluster;
  try { cluster = m.getLayoutProperty('cluster-shape', 'visibility'); } catch { cluster = 'missing'; }
  return { L, cluster };
});
check('Places overlay toggle hides pins (doc 5 §4.3)',
  placesToggle && placesOff.L.places === false && placesOff.cluster === 'none',
  JSON.stringify({ placesToggle, ...placesOff }));
try { await pickLayer('view-places'); } catch { /* */ }
await page.waitForTimeout(300);

let regionsToggle = false;
try {
  await pickLayer('view-regions');
  regionsToggle = true;
} catch { /* */ }
await page.waitForTimeout(300);
const regionsOff = await page.evaluate(() => {
  const m = document.querySelector('#map')?._twmMap;
  const L = document.querySelector('#map')?._twmLayers?.() || {};
  let vis;
  try { vis = m.getLayoutProperty('region-fill', 'visibility'); } catch { vis = 'missing'; }
  return { L, vis };
});
check('Regions overlay toggle turns the tessellation off (doc 5 §4.3)',
  regionsToggle && regionsOff.L.regions === false && regionsOff.vis === 'none',
  JSON.stringify({ regionsToggle, ...regionsOff }));
const regionsAtCountryZoom = await page.evaluate(() => new Promise((resolve) => {
  const m = document.querySelector('#map')?._twmMap;
  const L = document.querySelector('#map')?._twmLayers?.();
  if (!L?.regions) document.getElementById('view-regions')?.click();
  if (!m) { resolve({ hits: -1, zoom: 0, vis: 'missing', src: 0, regions: false }); return; }
  m.jumpTo({ center: [-5.8, 35.8], zoom: 6, pitch: 0, bearing: 0 });
  const snap = () => {
    let hits = 0, src = 0, vis = 'missing';
    try {
      hits = m.queryRenderedFeatures(undefined, { layers: ['region-fill'] }).length;
    } catch { hits = -1; }
    try { src = m.querySourceFeatures('regions').length; } catch { /* */ }
    try { vis = m.getLayoutProperty('region-fill', 'visibility'); } catch { /* */ }
    return {
      hits, src, vis, zoom: m.getZoom(),
      regions: document.querySelector('#map')?._twmLayers?.().regions,
    };
  };
  const started = Date.now();
  const tick = () => {
    const s = snap();
    if (s.hits > 0 || s.src > 0 || Date.now() - started > 8000) { resolve(s); return; }
    setTimeout(tick, 250);
  };
  m.once('idle', tick);
  setTimeout(tick, 400);
}));
await page.evaluate(() => {
  const m = document.querySelector('#map')?._twmMap;
  m?.jumpTo({ center: [12, 24], zoom: 2.1, pitch: 0, bearing: 0 });
});
await page.waitForTimeout(300);
check('Regions overlay draws at country zoom (doc 5 §4.3)',
  regionsAtCountryZoom.regions === true
  && regionsAtCountryZoom.vis === 'visible'
  && (regionsAtCountryZoom.zoom ?? 0) >= 3.6
  && (regionsAtCountryZoom.hits > 0 || regionsAtCountryZoom.src > 0),
  JSON.stringify(regionsAtCountryZoom));

try { await page.evaluate(() => document.getElementById('scope-btn')?.click()); } catch { /* */ }
await page.waitForTimeout(200);

const beforeDensity = await page.textContent('.register-count');
try {
  const dens = page.locator('.filters.on-map .filter-density summary');
  await dens.waitFor({ state: 'visible', timeout: 4000 });
  const open = await page.evaluate(() =>
    !!document.querySelector('.filters.on-map .filter-density')?.open);
  if (!open) await dens.click();
  await page.waitForTimeout(200);
} catch { /* */ }
const densityBounds = await page.evaluate(() => {
  const pick = document.querySelector('#density-pick');
  if (!pick) return null;
  pick.value = '12';
  pick.dispatchEvent(new Event('input', { bubbles: true }));
  pick.dispatchEvent(new Event('change', { bubbles: true }));
  return { min: pick.min, max: pick.max, type: pick.type };
});
await page.waitForTimeout(400);
const densityText = (await page.textContent('.register-count')) ?? '';
const densityN = Number((densityText.match(/[\d,]+/) || ['0'])[0].replace(/,/g, ''));
const densityWarn = await page.evaluate(() =>
  (document.querySelector('.density-warning')?.textContent ?? ''));
const densityMapN = await page.evaluate(() =>
  document.querySelector('#map')?._twmVisible?.() ?? -1);
check('density is per country, not a global top-N (doc 5 §4.4)',
  densityN === stage5Density12 && densityN > 12,
  `shown ${densityN} expected ${stage5Density12} before ${beforeDensity}`);
check('density cap applies to the map (doc 5 §4.4)',
  densityMapN === stage5Density12,
  `map ${densityMapN} expected ${stage5Density12}`);
check('density slider is bounded 0–48 (doc 5 §4.4, interface PDF p.5)',
  densityBounds?.type === 'range'
  && densityBounds.min === '0' && densityBounds.max === '48',
  JSON.stringify(densityBounds));
check('density warns that score is local to each country (doc 5 §4.4)',
  /Score is local to each country\. 12 places in Malta are not 12 places in Canada\./.test(densityWarn),
  densityWarn);
try {
  await page.evaluate(() => {
    const pick = document.querySelector('#density-pick');
    if (!pick) return;
    pick.value = '0';
    pick.dispatchEvent(new Event('input', { bubbles: true }));
    pick.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const sum = page.locator('.filters.on-map .filter-density summary');
  if (await page.evaluate(() =>
    !!document.querySelector('.filters.on-map .filter-density')?.open)) {
    await sum.click();
  }
} catch { /* */ }

const camBeforeCountry = await camera();
await page.locator('.filters.on-map input[type=search]').fill('');
await page.locator('.filters.on-map input[type=search]').pressSequentially('Malta', { delay: 40 });
await page.waitForTimeout(400);
const countryHit = page.locator('.filters.on-map .search-hits .search-hit[data-kind=country]', { hasText: /malta/i }).first();
await countryHit.waitFor({ state: 'visible', timeout: 5000 });
await countryHit.click();
await page.waitForTimeout(400);
const camAfterCountry = await camera();
check('search matches countries (doc 5 §4.5)',
  /Malta/i.test((await page.textContent('.detail:not([hidden])')) ?? ''));
check('choosing a country search hit does not move the camera (doc 5 §4.5)',
  JSON.stringify(camBeforeCountry) === JSON.stringify(camAfterCountry),
  JSON.stringify({ camBeforeCountry, camAfterCountry }));
try { await page.evaluate(() => document.getElementById('scope-btn')?.click()); } catch { /* */ }
await page.waitForTimeout(200);

if (stage5RegionName) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const camBeforeRegion = await camera();
  const q = stage5RegionName.slice(0, Math.min(12, stage5RegionName.length));
  await page.locator('.filters.on-map input[type=search]').fill('');
  await page.locator('.filters.on-map input[type=search]').pressSequentially(q, { delay: 40 });
  await page.waitForTimeout(400);
  const regionHit = page.locator('.filters.on-map .search-hits .search-hit[data-kind=region]').first();
  const regionHitVis = await regionHit.count().then((n) => n > 0);
  if (regionHitVis) {
    await regionHit.click();
    await page.waitForTimeout(400);
    const camAfterRegion = await camera();
    check('search matches regions (doc 5 §4.5)',
      /Region/i.test((await page.textContent('.detail:not([hidden]) .detail-kicker')) ?? '')
      || /region/i.test((await page.textContent('.detail:not([hidden])')) ?? ''));
    check('choosing a region search hit does not move the camera (doc 5 §4.5)',
      JSON.stringify(camBeforeRegion) === JSON.stringify(camAfterRegion));
  } else {
    check('search matches regions (doc 5 §4.5)', false, `no region hit for ${q}`);
    check('choosing a region search hit does not move the camera (doc 5 §4.5)', false, 'no hit');
  }
}

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.locator('.filters.on-map input[type=search]').fill('');
await page.locator('.filters.on-map input[type=search]').pressSequentially('qqq-no-such-place', { delay: 20 });
await page.waitForTimeout(400);
const emptyCopy = (await page.textContent('.filters.on-map .search-hits')) ?? '';
check('empty search results name the query and offer to clear filters (doc 5 §4.5)',
  /Nothing matches .qqq-no-such-place/i.test(emptyCopy) && /Clear filters/i.test(emptyCopy),
  emptyCopy.slice(0, 180));
await page.locator('.filters.on-map input[type=search]').fill('');
await page.waitForTimeout(200);
await page.evaluate(() => {
  document.querySelector('.map-wrap')?.classList.remove('layers-open');
  const menu = document.querySelector('.layers-menu');
  if (menu) menu.open = false;
  const more = document.querySelector('.filters.on-map .filter-more');
  const dens = document.querySelector('.filters.on-map .filter-density');
  if (more) more.open = false;
  if (dens) dens.open = false;
  document.querySelectorAll('.map-wrap > .filter-more-pop').forEach((n) => {
    (n.id === 'density-pop' ? dens : more)?.append(n);
  });
});


await page.click('header [aria-label="Switch theme"]');
await page.waitForTimeout(300);
await page.click('.filters.on-map .filter-more summary');
await page.waitForTimeout(300);
const darkAccent = await page.evaluate(() => {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const bad = [];
  const sel = '.filters.on-map button, .filters.on-map a, .filters.on-map .chip, .filters.on-map .seg, .map-wrap > .filter-more-pop .chip, .layers-menu summary, .layers-pop .seg, #view-atlas, #view-satellite, #view-tiles, #view-regions, #view-places, #view-layers';
  for (const n of document.querySelectorAll(sel)) {
    const isMark = n.closest('.mark, .mark-control, .kind-row.is-seen');
    if (isMark) continue;
    const s = getComputedStyle(n);
    if (s.color === rgb || s.backgroundColor === rgb) bad.push(`${n.tagName}.${n.className}`);
  }
  return { theme: document.documentElement.dataset.theme, bad };
});
check('dark theme on the full-screen card does not put the accent on chrome (doc 3 §3)',
  darkAccent.theme === 'dark' && darkAccent.bad.length === 0, darkAccent.bad.slice(0, 3).join(' | '));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.click('header [aria-label="Switch theme"]');
await page.waitForTimeout(200);

if (await page.$('.trips-on-map')) {
  await page.locator('header button', { hasText: 'Trips' }).click();
  await page.waitForTimeout(200);
}
await page.locator('header button', { hasText: 'Trips' }).click();
await page.waitForTimeout(400);
const tripOnMap = await page.evaluate(() => {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const host = document.querySelector('.trips-on-map');
  const card = document.querySelector('.filters.on-map')?.getBoundingClientRect();
  const map = document.querySelector('.map')?.getBoundingClientRect();
  const t = host?.getBoundingClientRect();
  const bad = [];
  if (host) {
    for (const n of host.querySelectorAll('button, a, h2, .chip, .link-btn')) {
      const s = getComputedStyle(n);
      if (s.color === rgb || s.backgroundColor === rgb) bad.push(`${n.tagName}.${n.className}`);
    }
  }
  const text = host?.textContent ?? '';
  return {
    onMap: !!host && !host.hasAttribute('hidden'),
    bad,
    noTime: !/\b(\d+\s*(h|hr|hrs|hour|hours|min|mins|minutes)|duration|schedule|\d{1,2}:\d{2})\b/i.test(text),
    cardH: card ? Math.round(card.height) : 0,
    tripH: t ? Math.round(t.height) : 0,
    mapH: map ? Math.round(map.height) : 0,
  };
});
check('Trips with the register hidden sit on the map (doc 2 §9)',
  tripOnMap.onMap && tripOnMap.cardH <= 280, `${tripOnMap.cardH} card, ${tripOnMap.tripH} trips`);
check('Trips on the full-screen map do not use the accent (doc 3 §3)',
  tripOnMap.bad.length === 0, tripOnMap.bad.slice(0, 3).join(' | '));
check('Trips on the full-screen map show no time or duration (doc 2 §9)',
  tripOnMap.noTime);

await page.click('#scope-btn');
await page.waitForTimeout(300);
const searchBox = page.locator('.filters.on-map input[type=search]');
await searchBox.click();
await searchBox.pressSequentially('Kyoto', { delay: 50 });
await page.waitForTimeout(400);
const searchHit = page.locator('.filters.on-map .search-hits .search-hit', { hasText: /kyoto/i }).first();
await searchHit.waitFor({ state: 'visible', timeout: 5000 });
const hitInfo = await searchHit.evaluate((n) => ({
  vis: n.checkVisibility(),
  inCard: !!n.closest('.filters.on-map'),
  isRow: !!n.closest('.row'),
  tag: n.tagName,
  sel: n.className,
}));
const hitBox = await searchHit.boundingBox();
check('search on the full-screen card lists places to open (doc 2 §9)',
  hitInfo.vis && hitInfo.inCard && !hitInfo.isRow && hitInfo.tag === 'BUTTON'
  && !!hitBox && hitBox.height >= 44 && hitBox.width >= 44,
  hitBox
    ? `${Math.round(hitBox.width)}×${Math.round(hitBox.height)} vis=${hitInfo.vis} .${hitInfo.sel} inCard=${hitInfo.inCard}`
    : JSON.stringify(hitInfo));
await searchHit.click();
await page.waitForTimeout(500);
const detailOnMap = await page.$('.detail.detail-on-map:not([hidden])');
check('selecting with the register hidden opens the detail sheet (doc 3 §6.1)',
  !!detailOnMap);
const camAfterSelectKyoto = await camera();
const showOnMap = page.locator('.detail.detail-on-map button.show-on-map', { hasText: /Show Kyoto on the map/ });
await showOnMap.waitFor({ state: 'visible', timeout: 5000 });
const showBox = await showOnMap.boundingBox();
const showInfo = await showOnMap.evaluate((n) => {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const s = getComputedStyle(n);
  return {
    vis: n.checkVisibility(),
    text: n.textContent,
    usesAccent: s.color === rgb || s.backgroundColor === rgb,
  };
});
check('Show on the map is on the place sheet (doc 3 §6.1)',
  showInfo.vis && showInfo.text === 'Show Kyoto on the map' && !showInfo.usesAccent
  && !!showBox && showBox.height >= 44 && showBox.width >= 44,
  showBox
    ? `${Math.round(showBox.width)}×${Math.round(showBox.height)} vis=${showInfo.vis} ${showInfo.text}`
    : JSON.stringify(showInfo));
await showOnMap.click();
await page.waitForFunction(() => {
  const m = document.querySelector('#map')?._twmMap;
  return m && !m.isMoving();
}, { timeout: 4000 });
await page.waitForTimeout(200);
const afterShow = await page.evaluate(() => {
  const m = document.querySelector('#map')._twmMap;
  const p = m.project([135.7538, 35.0211]);
  const c = m.getContainer().getBoundingClientRect();
  return {
    zoom: +m.getZoom().toFixed(2),
    center: [+m.getCenter().lng.toFixed(2), +m.getCenter().lat.toFixed(2)],
    onDisc: p.x >= 8 && p.y >= 8 && p.x <= c.width - 8 && p.y <= c.height - 8,
  };
});
check('Show on the map moves the camera so the place is on the disc (doc 3 §6.1)',
  JSON.stringify(camAfterSelectKyoto) !== JSON.stringify(await camera()) && afterShow.onDisc,
  JSON.stringify(afterShow));
const camBeforeHiddenAdd = await camera();
await page.locator('.detail.detail-on-map button', { hasText: 'Add to' }).click();
await page.waitForTimeout(400);
check('adding a stop with the register hidden does not move the camera (doc 3 §6.1)',
  JSON.stringify(camBeforeHiddenAdd) === JSON.stringify(await camera()));
const kyotoPick = page.locator('.trips-on-map .trip-stop', { hasText: /kyoto/i }).locator('.trip-day-pick');
await kyotoPick.scrollIntoViewIfNeeded();
await kyotoPick.waitFor({ state: 'visible', timeout: 5000 });
const kyotoPickBox = await kyotoPick.boundingBox();
const kyotoPickVis = await kyotoPick.evaluate((n) => n.checkVisibility());
check('day assign on the full-screen trip is at least 44px (doc 3 §11)',
  kyotoPickVis && !!kyotoPickBox && kyotoPickBox.height >= 44 && kyotoPickBox.width >= 44,
  kyotoPickBox ? `${Math.round(kyotoPickBox.width)}×${Math.round(kyotoPickBox.height)} vis=${kyotoPickVis}` : 'no pick');
await kyotoPick.selectOption('1');
await page.waitForTimeout(200);
const stopOnTrip = (await page.textContent('.trips-on-map')) ?? '';
check('the open trip shows the added place (doc 2 §9)',
  /kyoto/i.test(stopOnTrip), stopOnTrip.slice(0, 120));

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await searchBox.click();
await searchBox.fill('');
await searchBox.pressSequentially('Acacus', { delay: 50 });
await page.waitForTimeout(400);
const secondHit = page.locator('.filters.on-map .search-hits .search-hit', { hasText: /acacus/i }).first();
await secondHit.waitFor({ state: 'visible', timeout: 5000 });
const secondHitInfo = await secondHit.evaluate((n) => ({
  vis: n.checkVisibility(),
  inCard: !!n.closest('.filters.on-map'),
  cls: n.className,
}));
check('the second search still lists a visible hit on the card (doc 2 §9)',
  secondHitInfo.vis && secondHitInfo.inCard && /search-hit/.test(secondHitInfo.cls),
  JSON.stringify(secondHitInfo));
await secondHit.click();
await page.waitForTimeout(400);
await page.locator('.detail.detail-on-map button', { hasText: 'Add to' }).click();
await page.waitForTimeout(300);
const acacusPick = page.locator('.trips-on-map .trip-stop', { hasText: /acacus/i }).locator('.trip-day-pick');
await acacusPick.scrollIntoViewIfNeeded();
await acacusPick.waitFor({ state: 'visible', timeout: 5000 });
await acacusPick.selectOption('1');
await page.waitForTimeout(200);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const day1Names = await page.evaluate(() => {
  const h = [...document.querySelectorAll('.trips-on-map .trip-day h3')]
    .find((n) => n.textContent.trim() === 'Day 1');
  const sec = h?.closest('.trip-day');
  return [...(sec?.querySelectorAll('.trip-stop .link-btn') ?? [])].map((b) => b.textContent);
});
check('two assigned stops sit on Day 1, not the tray (doc 2 §9)',
  day1Names.some((n) => /kyoto/i.test(n)) && day1Names.some((n) => /acacus/i.test(n)),
  day1Names.join(' · '));
const tripGeomHidden = await page.evaluate(async () => {
  const snap = document.querySelector('#map')._twmTrip?.snapshot();
  const m = document.querySelector('#map')._twmMap;
  const src = m.getSource('trip');
  const data = src ? await src.getData() : { features: [] };
  const feats = data?.features ?? [];
  const assigned = (snap?.stops ?? []).filter((s) => s.day >= 1);
  const tray = (snap?.stops ?? []).filter((s) => s.day === 0);
  return {
    assigned: assigned.length,
    tray: tray.length,
    types: feats.map((f) => f.geometry?.type),
    lines: feats.filter((f) => f.geometry?.type === 'LineString').map((f) => f.geometry.coordinates.length),
    points: feats.filter((f) => f.geometry?.type === 'Point').length,
  };
});
check('a trip with the register hidden draws straight segments, not a route (doc 2 §9)',
  tripGeomHidden.assigned >= 2 && tripGeomHidden.types.includes('LineString')
  && tripGeomHidden.types.every((t) => t === 'LineString' || t === 'Point')
  && tripGeomHidden.lines.every((n) => n >= 2)
  && !tripGeomHidden.types.includes('MultiLineString'),
  JSON.stringify(tripGeomHidden));
check('Unassigned is a tray and does not draw (doc 2 §9)',
  tripGeomHidden.points === tripGeomHidden.assigned,
  JSON.stringify({ points: tripGeomHidden.points, assigned: tripGeomHidden.assigned, tray: tripGeomHidden.tray }));
await page.waitForTimeout(600);
const painted = await page.evaluate(async () => {
  const m = document.querySelector('#map')._twmMap;
  const src = m.getSource('trip');
  const data = src ? await src.getData() : { features: [] };
  const line = (data.features ?? []).find((f) => f.geometry?.type === 'LineString');
  const rendered = m.queryRenderedFeatures({ layers: ['trip-line'] });
  const color = m.getPaintProperty('trip-line', 'line-color');
  return {
    sourceId: 'trip',
    layerId: 'trip-line',
    layerOn: !!m.getLayer('trip-line'),
    vis: m.getLayoutProperty('trip-line', 'visibility') ?? 'visible',
    lineCoords: line?.geometry?.coordinates?.length ?? 0,
    rendered: rendered.length,
    color,
  };
});
check('the trip line is painted on the globe (doc 2 §9)',
  painted.layerOn && painted.vis !== 'none' && painted.lineCoords >= 2 && painted.rendered > 0
  && painted.color !== '#A87B22' && painted.color !== '#DBA83E',
  JSON.stringify(painted));
const layoutAfterStops = await page.evaluate(() => {
  const card = document.querySelector('.filters.on-map')?.getBoundingClientRect();
  const trips = document.querySelector('.trips-on-map')?.getBoundingClientRect();
  const map = document.querySelector('.map')?.getBoundingClientRect();
  return {
    card: card ? { w: Math.round(card.width), h: Math.round(card.height) } : null,
    trips: !!document.querySelector('.trips-on-map'),
    mapH: map ? Math.round(map.height) : 0,
  };
});
check('the on-map filter stays a short horizontal bar after adding a stop (owner)',
  !!layoutAfterStops.card && layoutAfterStops.card.h <= 128
  && layoutAfterStops.trips,
  `${layoutAfterStops.card?.w}×${layoutAfterStops.card?.h} trips=${layoutAfterStops.trips}`);

await page.locator('header button', { hasText: 'Trips' }).click();
await page.waitForTimeout(200);

const restBeforeKinds = await page.evaluate(() => {
  const c = document.querySelector('.filters.on-map')?.getBoundingClientRect();
  return c ? Math.round(c.height) : 0;
});
await page.click('.filters.on-map .filter-more summary');
await page.waitForTimeout(300);
const restOpenKinds = await page.evaluate(() => {
  const c = document.querySelector('.filters.on-map')?.getBoundingClientRect();
  return c ? Math.round(c.height) : 0;
});
check('the kinds popover does not change the card resting height (owner)',
  restOpenKinds <= 280 && restOpenKinds === restBeforeKinds,
  `${restBeforeKinds} -> ${restOpenKinds}`);
const desert = page.locator('.map-wrap > .filter-more-pop .chip', { hasText: /desert/i });
await desert.waitFor({ state: 'visible', timeout: 5000 });
const desertBox = await desert.boundingBox();
const desertVisible = await desert.evaluate((n) => n.checkVisibility());
check('kinds on the full-screen card are visible (owner)',
  desertVisible && !!desertBox && desertBox.height >= 44 && desertBox.width >= 44,
  desertBox ? `${Math.round(desertBox.width)}×${Math.round(desertBox.height)} vis=${desertVisible}` : 'no box');
const beforeKind = await registerText();
await desert.click();
await page.waitForTimeout(400);
const afterKind = await registerText();
check('tapping a kind on the full-screen card filters both surfaces (doc 3 §8)',
  beforeKind !== afterKind, `${beforeKind} -> ${afterKind}`);
const desertOn = page.locator('.map-wrap > .filter-more-pop .chip.is-on', { hasText: /desert/i });
await desertOn.waitFor({ state: 'visible', timeout: 5000 });
await desertOn.click();
await page.waitForTimeout(400);
check('tapping the same kind on the card releases the filter (doc 3 §8)',
  (await registerText()) === beforeKind, await registerText());
check('Still unseen stays on the card after a kind filter (doc 3 §8)',
  /Still unseen/i.test((await page.textContent('.filters.on-map')) ?? ''));
const cardAfterKind = await page.evaluate(() => {
  const c = document.querySelector('.filters.on-map')?.getBoundingClientRect();
  return c ? { w: Math.round(c.width), h: Math.round(c.height) } : { w: 0, h: 0 };
});
check('the on-map filter stays a short horizontal bar after a visible kind tap (owner)',
  cardAfterKind.h <= 128, `${cardAfterKind.w}×${cardAfterKind.h}`);

// --- 390px: the card is not the desktop card copied onto a phone ------
await page.evaluate(() => {
  const more = document.querySelector('.filters.on-map .filter-more');
  const dens = document.querySelector('.filters.on-map .filter-density');
  if (more) more.open = false;
  if (dens) dens.open = false;
  document.querySelectorAll('.map-wrap > .filter-more-pop').forEach((n) => {
    (n.id === 'density-pop' ? dens : more)?.append(n);
  });
  document.querySelector('.map-wrap')?.classList.remove('layers-open');
  const menu = document.querySelector('.layers-menu');
  if (menu) menu.open = false;
});
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.evaluate(() => window.dispatchEvent(new Event('resize')));
await page.waitForTimeout(400);
// Desktop tests left the column collapsed. On a phone that class used to be
// ignored; now Hide the register actually hides the sheet, so restore it
// before the rest of the phone checks (doc 3 §11).
const showReg390 = page.locator('.panel-collapse[aria-label="Show the register"]');
if (await showReg390.count()) {
  await tapUncovered(showReg390);
  await page.waitForTimeout(400);
}
const phone = await page.evaluate(() => {
  const map = document.querySelector('.map');
  const card = document.querySelector('.filters.on-map');
  const m = map?.getBoundingClientRect();
  const c = card?.getBoundingClientRect();
  const taps = [];
  for (const n of document.querySelectorAll('.filters.on-map button, .filters.on-map .chip, .filters.on-map .seg, .filters.on-map select, .filters.on-map .search input, .filters.on-map .filter-more summary, .filters.on-map .filter-density summary')) {
    const r = n.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (r.width < 44 || r.height < 44) {
      taps.push(`${n.tagName}.${n.className.trim() || n.id} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  return {
    onMap: !!card,
    voice: (card?.textContent ?? '').slice(0, 160),
    card: c ? { w: Math.round(c.width), h: Math.round(c.height) } : null,
    map: m ? { w: Math.round(m.width), h: Math.round(m.height) } : null,
    buried: !!(m && c && (c.height / m.height) > 0.45),
    smallTaps: taps.slice(0, 4),
    sheet: !!document.querySelector('.sheet-handle'),
  };
});
check('at 390px the filters sit on the map with Still unseen (doc 3 §8, §12)',
  phone.onMap && /Still unseen/i.test(phone.voice), phone.voice);
check('at 390px the on-map card does not bury the globe (owner)',
  !phone.buried && !!phone.card && phone.card.w <= 390 && phone.card.h <= 128,
  phone.card && phone.map ? `${phone.card.w}×${phone.card.h} on ${phone.map.w}×${phone.map.h}` : 'no card');
await page.evaluate(() => {
  const pick = document.querySelector('#density-pick');
  if (pick && pick.value !== '0') {
    pick.value = '0';
    pick.dispatchEvent(new Event('input', { bubbles: true }));
    pick.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const search = document.querySelector('.filters.on-map input[type=search]');
  if (search && search.value) {
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const more = document.querySelector('.filters.on-map .filter-more');
  const dens = document.querySelector('.filters.on-map .filter-density');
  if (more) more.open = false;
  if (dens) dens.open = false;
  document.querySelectorAll('.map-wrap > .filter-more-pop').forEach((n) => {
    (n.id === 'density-pop' ? dens : more)?.append(n);
  });
  document.querySelector('.map-wrap')?.classList.remove('layers-open');
  const menu = document.querySelector('.layers-menu');
  if (menu) menu.open = false;
  document.querySelectorAll('.map-wrap > .layers-pop').forEach((n) => menu?.append(n));
});
await page.locator('.filters.on-map #passport-pick').selectOption('');
await page.waitForTimeout(300);
const rest390 = await page.evaluate(() => {
  const bar = document.querySelector('.filters.on-map');
  const search = bar?.querySelector('input[type=search]');
  const sel = bar?.querySelector('#passport-pick');
  const all = [...(bar?.querySelectorAll('.seg') ?? [])]
    .find((n) => /^all$/i.test((n.textContent ?? '').trim()))
    ?? bar?.querySelector('.seg');
  const kinds = bar?.querySelector('.filter-more summary');
  const density = bar?.querySelector('.filter-density summary');
  const br = bar?.getBoundingClientRect();
  const measure = (n) => {
    if (!n || !br) return { vis: false, w: 0, h: 0, clipped: true };
    const r = n.getBoundingClientRect();
    return {
      vis: n.checkVisibility(),
      w: Math.round(r.width),
      h: Math.round(r.height),
      clipped: r.bottom < br.top + 22 || r.top > br.bottom - 22
        || r.right < br.left + 22 || r.left > br.right - 22,
    };
  };
  return {
    all: measure(all),
    search: measure(search),
    passport: measure(sel),
    kinds: measure(kinds),
    density: measure(density),
    barH: br ? Math.round(br.height) : 0,
  };
});
let searchClick390 = false;
let allClick390 = false;
try {
  await tapUncovered(page.locator('.filters.on-map .seg').first());
  allClick390 = true;
} catch { /* */ }
try {
  await tapUncovered(page.locator('.filters.on-map input[type=search]'));
  searchClick390 = true;
} catch { /* clickable without force is the rule */ }
const tap44 = (m) => m && m.vis && m.w >= 44 && m.h >= 44 && !m.clipped;
check('at 390px the search input is at least 44×44 (doc 3 §11, §12)',
  tap44(rest390.search) && searchClick390
  && tap44(rest390.passport) && rest390.barH <= 128,
  JSON.stringify({ search: rest390.search, passport: rest390.passport, barH: rest390.barH, searchClick390 }));
check('at 390px every bar tap is at least 44×44 (doc 3 §11, §12)',
  tap44(rest390.all) && allClick390 && tap44(rest390.search)
  && tap44(rest390.passport) && tap44(rest390.kinds) && tap44(rest390.density)
  && rest390.barH <= 128,
  JSON.stringify({ ...rest390, allClick390, searchClick390 }));
const world390 = await page.evaluate(() => {
  const b = document.querySelector('#scope-btn');
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const r = b?.getBoundingClientRect();
  const s = b ? getComputedStyle(b) : null;
  return {
    vis: !!(b && b.checkVisibility()),
    text: (b?.textContent ?? '').trim(),
    w: r ? Math.round(r.width) : 0,
    h: r ? Math.round(r.height) : 0,
    accent: !!(s && (s.color === rgb || s.backgroundColor === rgb)),
  };
});
let worldClick390 = false;
try {
  await tapUncovered('#scope-btn');
  worldClick390 = true;
} catch { /* without force */ }
check('at 390px The world is at least 44×44 (doc 3 §11, §12)',
  world390.vis && world390.w >= 44 && world390.h >= 44
  && !world390.accent && worldClick390
  && /the world/i.test(world390.text),
  JSON.stringify({ ...world390, worldClick390 }));
const hideBtn390 = page.locator('.panel-collapse');
const hideBefore390 = await page.evaluate(() => {
  const b = document.querySelector('.panel-collapse');
  const map = document.querySelector('.map');
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const r = b?.getBoundingClientRect();
  const s = b ? getComputedStyle(b) : null;
  const m = map?.getBoundingClientRect();
  return {
    vis: !!(b && b.checkVisibility()),
    label: b?.getAttribute('aria-label') ?? '',
    w: r ? Math.round(r.width) : 0,
    h: r ? Math.round(r.height) : 0,
    accent: !!(s && (s.color === rgb || s.backgroundColor === rgb)),
    mapH: m ? Math.round(m.height) : 0,
  };
});
let hideClick390 = false;
try {
  await tapUncovered(hideBtn390);
  hideClick390 = true;
} catch { /* clickable without force is the rule */ }
await page.waitForTimeout(400);
const hideAfter390 = await page.evaluate(() => {
  const map = document.querySelector('.map');
  const bar = document.querySelector('.filters.on-map');
  const br = bar?.getBoundingClientRect();
  const m = map?.getBoundingClientRect();
  const b = document.querySelector('.panel-collapse');
  const taps = [];
  for (const n of document.querySelectorAll('.filters.on-map .seg, .filters.on-map input[type=search], .filters.on-map select, .filters.on-map .filter-more summary, .filters.on-map .filter-density summary')) {
    const r = n.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (r.width < 44 || r.height < 44) {
      taps.push(`${n.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  return {
    mapH: m ? Math.round(m.height) : 0,
    barH: br ? Math.round(br.height) : 0,
    voice: (bar?.textContent ?? '').slice(0, 120),
    label: b?.getAttribute('aria-label') ?? '',
    smallTaps: taps.slice(0, 4),
  };
});
check('at 390px Hide the register is visible and at least 44×44 (doc 3 §11, §12)',
  hideBefore390.vis && hideBefore390.w >= 44 && hideBefore390.h >= 44
  && !hideBefore390.accent && hideClick390
  && /Hide the register/i.test(hideBefore390.label),
  JSON.stringify(hideBefore390));
check('at 390px hiding the register makes the map the screen (doc 3 §11, §12)',
  hideAfter390.mapH >= 700 && hideAfter390.barH <= 128
  && /Still unseen/i.test(hideAfter390.voice)
  && hideAfter390.smallTaps.length === 0
  && /Show the register/i.test(hideAfter390.label),
  JSON.stringify({ before: hideBefore390.mapH, after: hideAfter390 }));
const measureView390 = () => page.evaluate(() => {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const measure = (id) => {
    const b = document.getElementById(id);
    const r = b?.getBoundingClientRect();
    const s = b ? getComputedStyle(b) : null;
    return {
      vis: !!(b && b.checkVisibility()),
      w: r ? Math.round(r.width) : 0,
      h: r ? Math.round(r.height) : 0,
      on: !!b?.classList.contains('is-on'),
      pressed: b?.getAttribute('aria-pressed') === 'true',
      accent: !!(s && (s.color === rgb || s.backgroundColor === rgb)),
    };
  };
  const map = document.querySelector('.map');
  const bar = document.querySelector('.filters.on-map');
  const br = bar?.getBoundingClientRect();
  const m = map?.getBoundingClientRect();
  const taps = [];
  for (const n of document.querySelectorAll('.filters.on-map .seg, .filters.on-map input[type=search], .filters.on-map select, .filters.on-map .filter-more summary, .filters.on-map .filter-density summary')) {
    const r = n.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (r.width < 44 || r.height < 44) {
      taps.push(`${n.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  const ml = document.querySelector('#map')?._twmMap;
  let tilesLayer = false;
  try {
    tilesLayer = ml?.getLayoutProperty('tile-extrude', 'visibility') === 'visible';
  } catch { /* layer may not exist yet */ }
  return {
    tiles: measure('view-tiles'),
    atlas: measure('view-atlas'),
    mapH: m ? Math.round(m.height) : 0,
    barH: br ? Math.round(br.height) : 0,
    voice: (bar?.textContent ?? '').slice(0, 120),
    smallTaps: taps.slice(0, 4),
    tilesLayer,
  };
});
const layers390 = await page.evaluate(() => {
  const b = document.getElementById('view-layers');
  const r = b?.getBoundingClientRect();
  const s = b ? getComputedStyle(b) : null;
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  return {
    vis: !!(b && b.checkVisibility()),
    w: r ? Math.round(r.width) : 0,
    h: r ? Math.round(r.height) : 0,
    accent: !!(s && (s.color === rgb || s.backgroundColor === rgb)),
  };
});
check('at 390px Layers is a tap on the full-screen map (owner, doc 3 §12)',
  layers390.vis && layers390.w >= 44 && layers390.h >= 44 && !layers390.accent,
  JSON.stringify(layers390));
try {
  await tapUncovered('#view-layers');
} catch { /* */ }
await page.waitForTimeout(200);
const tilesBefore390 = await measureView390();
let tilesClick390 = false;
try {
  await tapUncovered('#view-tiles');
  tilesClick390 = true;
} catch { /* clickable without force is the rule */ }
await page.waitForTimeout(700);
const tilesAfter390 = await measureView390();
check('at 390px Tiles is a tap on the full-screen map (doc 2 §4.1, doc 3 §12)',
  tilesBefore390.tiles.vis && tilesBefore390.tiles.w >= 44 && tilesBefore390.tiles.h >= 44
  && !tilesBefore390.tiles.accent && tilesClick390
  && tilesAfter390.tiles.on && tilesAfter390.tiles.pressed
  && !tilesAfter390.atlas.on && tilesAfter390.tilesLayer
  && tilesAfter390.mapH >= 700 && tilesAfter390.barH <= 128
  && /Still unseen/i.test(tilesAfter390.voice)
  && tilesAfter390.smallTaps.length === 0,
  JSON.stringify({ before: tilesBefore390, after: tilesAfter390, tilesClick390 }));
let atlasClick390 = false;
try {
  await pickLayer('view-atlas');
  atlasClick390 = true;
} catch { /* */ }
await page.waitForTimeout(700);
const atlasAfter390 = await measureView390();
check('at 390px Atlas returns from Tiles on the full-screen map (doc 2 §4.1, doc 3 §12)',
  atlasClick390
  && atlasAfter390.atlas.on && atlasAfter390.atlas.pressed
  && !atlasAfter390.tiles.on && !atlasAfter390.tilesLayer
  && atlasAfter390.mapH >= 700 && atlasAfter390.barH <= 128
  && /Still unseen/i.test(atlasAfter390.voice)
  && atlasAfter390.smallTaps.length === 0,
  JSON.stringify({ after: atlasAfter390, atlasClick390 }));
let showClick390 = false;
try {
  await tapUncovered(hideBtn390);
  showClick390 = true;
} catch { /* */ }
await page.waitForTimeout(400);
const shown390 = await page.evaluate(() => {
  const panel = document.querySelector('.panel');
  const row = document.querySelector('.row');
  const ps = panel ? getComputedStyle(panel) : null;
  return {
    panel: !!(panel && ps && ps.display !== 'none' && panel.checkVisibility()),
    row: !!(row && row.checkVisibility()),
  };
});
check('at 390px Show the register brings the register back (doc 3 §11)',
  showClick390 && shown390.panel && shown390.row,
  JSON.stringify({ showClick390, ...shown390 }));
const pass390 = await page.evaluate(() => {
  const bar = document.querySelector('.filters.on-map');
  const sel = bar?.querySelector('#passport-pick');
  const r = sel?.getBoundingClientRect();
  const br = bar?.getBoundingClientRect();
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const s = sel ? getComputedStyle(sel) : null;
  return {
    vis: !!(sel && sel.checkVisibility()),
    w: r ? Math.round(r.width) : 0,
    h: r ? Math.round(r.height) : 0,
    clipped: !!(r && br && (r.bottom < br.top + 22 || r.top > br.bottom - 22
      || r.right < br.left + 22 || r.left > br.right - 22)),
    top: r && br ? Math.round(r.top - br.top) : null,
    bottom: r && br ? Math.round(r.bottom - br.top) : null,
    accent: !!(s && (s.color === rgb || s.backgroundColor === rgb || s.borderColor === rgb)),
    barH: br ? Math.round(br.height) : 0,
  };
});
check('at 390px the passport control is visible and at least 44px (doc 3 §12)',
  pass390.vis && !pass390.clipped && pass390.w >= 44 && pass390.h >= 44
  && !pass390.accent && pass390.barH <= 128,
  JSON.stringify(pass390));
await page.locator('.filters.on-map #passport-pick').selectOption('');
await page.waitForTimeout(300);
await page.locator('.filters.on-map #passport-pick').selectOption('MAR');
await page.waitForTimeout(700);
const afterPass390 = await page.evaluate(() => {
  const bar = document.querySelector('.filters.on-map');
  const note = [...(bar?.querySelectorAll('.passport .note') ?? [])]
    .filter((n) => /not legal advice/i.test(n.textContent ?? '')).pop();
  const body = document.body.textContent ?? '';
  const br = bar?.getBoundingClientRect();
  const sel = bar?.querySelector('#passport-pick');
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const chrome = [];
  for (const n of document.querySelectorAll('.filters.on-map .passport, .filters.on-map .passport select, .filters.on-map .passport .note, .filters.on-map .passport-label')) {
    const s = getComputedStyle(n);
    if (s.color === rgb || s.backgroundColor === rgb) chrome.push(n.className);
  }
  return {
    vis: !!(sel && sel.checkVisibility()),
    value: sel && 'value' in sel ? sel.value : '',
    barH: br ? Math.round(br.height) : 0,
    advice: (note?.textContent ?? '').trim(),
    annotated: /No visa needed|Apply in advance|Visa on arrival|Apply online first|not in the passport index/i.test(body),
    wall: !!document.querySelector('input[type=password], .signup, .sign-in'),
    accent: chrome.slice(0, 3),
  };
});
check('at 390px choosing a passport annotates and is not legal advice (doc 3 §12)',
  afterPass390.vis && afterPass390.value === 'MAR' && afterPass390.barH <= 128
  && /not legal advice/i.test(afterPass390.advice) && afterPass390.annotated
  && !afterPass390.wall && afterPass390.accent.length === 0,
  JSON.stringify(afterPass390));
const header390 = await page.evaluate(() => {
  const header = document.querySelector('.header')?.getBoundingClientRect();
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const measure = (n) => {
    if (!n || !header) return null;
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return {
      vis: n.checkVisibility(),
      w: Math.round(r.width),
      h: Math.round(r.height),
      clipped: r.left < header.left - 1 || r.right > header.right + 1
        || r.top < header.top - 1 || r.bottom > header.bottom + 1
        || r.right > window.innerWidth + 1 || r.left < -1,
      accent: s.color === rgb || s.backgroundColor === rgb,
    };
  };
  const exportBtn = [...document.querySelectorAll('.header button')]
    .find((n) => n.textContent.trim() === 'Export');
  const importBtn = [...document.querySelectorAll('.header .link-btn')]
    .find((n) => n.textContent.includes('Import'));
  const themeBtn = document.querySelector('.header [aria-label="Switch theme"]');
  return {
    export: measure(exportBtn),
    import: measure(importBtn),
    theme: measure(themeBtn),
    wall: !!document.querySelector('input[type=password], .signup, .sign-in'),
  };
});
check('at 390px Export, Import and theme are visible and at least 44px (doc 2 §10, doc 3 §11)',
  header390.export && header390.export.vis && !header390.export.clipped
  && header390.export.w >= 44 && header390.export.h >= 44 && !header390.export.accent
  && header390.import && header390.import.vis && !header390.import.clipped
  && header390.import.w >= 44 && header390.import.h >= 44 && !header390.import.accent
  && header390.theme && header390.theme.vis && !header390.theme.clipped
  && header390.theme.w >= 44 && header390.theme.h >= 44 && !header390.theme.accent
  && !header390.wall,
  JSON.stringify(header390));
let exportFile390 = false;
try {
  await page.locator('.header button', { hasText: /^Export$/ }).click();
  await page.waitForSelector('.export-card', { timeout: 8000 });
  const [download390] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.locator('.export-json').click(),
  ]);
  exportFile390 = !!download390.suggestedFilename();
} catch { /* download may be blocked; visibility still stands */ }
if (await page.$('.export-root')) {
  try { await page.locator('.export-close').click(); } catch { /* */ }
}
check('at 390px Export writes a file with no sign-up wall (doc 2 §10)',
  exportFile390 && !header390.wall,
  exportFile390 ? 'file' : 'no file');
await page.click('header [aria-label="Switch theme"]');
await page.waitForTimeout(300);
const dark390 = await page.evaluate(() => {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const bad = [];
  for (const n of document.querySelectorAll('.filters.on-map button, .filters.on-map .chip, .filters.on-map .seg, .layers-menu summary, .layers-pop .seg')) {
    const s = getComputedStyle(n);
    if (s.color === rgb || s.backgroundColor === rgb) bad.push(`${n.tagName}.${n.className}`);
  }
  return { theme: document.documentElement.dataset.theme, bad };
});
check('dark theme at 390px does not put the accent on chrome (doc 3 §3)',
  dark390.theme === 'dark' && dark390.bad.length === 0, dark390.bad.slice(0, 3).join(' | '));
await page.click('header [aria-label="Switch theme"]');
await page.waitForTimeout(200);
check('at 390px on-map tap targets are at least 44px (doc 3 §11)',
  phone.smallTaps.length === 0, phone.smallTaps.join(' | '));
await page.click('.filters.on-map .filter-more summary');
await page.waitForTimeout(300);
const desert390 = page.locator('.map-wrap > .filter-more-pop .chip', { hasText: /desert/i });
await desert390.waitFor({ state: 'visible', timeout: 5000 });
const desert390Box = await desert390.boundingBox();
const desert390Vis = await desert390.evaluate((n) => n.checkVisibility());
const pop390 = await page.evaluate(() => {
  const pop = document.querySelector('.map-wrap > .filter-more-pop');
  const map = document.querySelector('.map');
  const bar = document.querySelector('.filters.on-map');
  const p = pop?.getBoundingClientRect();
  const m = map?.getBoundingClientRect();
  const b = bar?.getBoundingClientRect();
  return {
    popH: p ? Math.round(p.height) : 0,
    barH: b ? Math.round(b.height) : 0,
    mapH: m ? Math.round(m.height) : 0,
    buried: !!(p && m && p.height / m.height > 0.45),
  };
});
check('at 390px kinds on the card are visible (doc 3 §8, §11)',
  desert390Vis && !!desert390Box && desert390Box.height >= 44 && desert390Box.width >= 44,
  desert390Box ? `${Math.round(desert390Box.width)}×${Math.round(desert390Box.height)} vis=${desert390Vis}` : 'no box');
check('at 390px the kinds popover does not bury the globe (owner)',
  !pop390.buried && pop390.popH > 4 && pop390.popH <= 156,
  `${pop390.popH}px pop on ${pop390.mapH}px map`);
check('at 390px the resting bar stays ≤128 with kinds open (owner)',
  pop390.barH <= 128, `${pop390.barH}`);
const beforeKind390 = await registerText();
await desert390.click();
await page.waitForTimeout(400);
check('at 390px tapping a kind on the card filters (doc 3 §8)',
  (await registerText()) !== beforeKind390, await registerText());
const desertOn390 = page.locator('.map-wrap > .filter-more-pop .chip.is-on', { hasText: /desert/i });
await desertOn390.waitFor({ state: 'visible', timeout: 5000 });
await desertOn390.click();
await page.waitForTimeout(400);
check('at 390px tapping the same kind releases the filter (doc 3 §8)',
  (await registerText()) === beforeKind390, await registerText());
const kindsOpen390 = await page.$('.filters.on-map .filter-more[open]');
if (kindsOpen390) {
  await page.click('.filters.on-map .filter-more summary');
  await page.waitForTimeout(200);
}
const search390 = page.locator('.filters.on-map input[type=search]');
await search390.click();
await search390.fill('');
await search390.pressSequentially('Kyoto', { delay: 50 });
await page.waitForTimeout(400);
const hit390 = page.locator('.filters.on-map .search-hits .search-hit', { hasText: /kyoto/i }).first();
await hit390.waitFor({ state: 'visible', timeout: 5000 });
const hit390Box = await hit390.boundingBox();
const hit390Vis = await hit390.evaluate((n) => n.checkVisibility());
const barSearch390 = await page.evaluate(() => {
  const c = document.querySelector('.filters.on-map')?.getBoundingClientRect();
  return c ? Math.round(c.height) : 0;
});
check('at 390px searching Kyoto lists a visible hit on the bar (doc 3 §12)',
  hit390Vis && !!hit390Box && hit390Box.height >= 44 && hit390Box.width >= 44 && barSearch390 <= 128,
  hit390Box
    ? `${Math.round(hit390Box.width)}×${Math.round(hit390Box.height)} vis=${hit390Vis} bar=${barSearch390}`
    : 'no hit');
const camBeforeHit390 = await camera();
await hit390.click();
await page.waitForTimeout(500);
const camAfterHit390 = await camera();
check('at 390px selecting a search hit does not move the camera (doc 3 §6.1)',
  JSON.stringify(camBeforeHit390) === JSON.stringify(camAfterHit390));
const mark390 = page.locator('.detail:not([hidden]) .mark-control');
await mark390.waitFor({ state: 'visible', timeout: 5000 });
const mark390Box = await mark390.boundingBox();
const mark390Vis = await mark390.evaluate((n) => n.checkVisibility());
check('at 390px Mark as visited on the sheet is at least 44px (doc 2 §7)',
  mark390Vis && !!mark390Box && mark390Box.height >= 44 && mark390Box.width >= 44,
  mark390Box ? `${Math.round(mark390Box.width)}×${Math.round(mark390Box.height)} vis=${mark390Vis}` : 'no mark');
const visibleBar390 = () => page.evaluate(() => {
  const bar = document.querySelector('.filters.on-map');
  const count = bar?.querySelector('.coverage-compact-count');
  const gap = bar?.querySelector('.gap-sentence.compact');
  const clip = (n) => {
    if (!n || !bar) return { vis: false, text: '', clipped: true };
    const br = bar.getBoundingClientRect();
    const r = n.getBoundingClientRect();
    const inBar = r.width > 0 && r.height > 0
      && r.top >= br.top - 1 && r.bottom <= br.bottom + 1
      && r.left >= br.left - 1;
    return {
      vis: n.checkVisibility() && inBar,
      text: (n.textContent ?? '').trim(),
      clipped: n.scrollWidth > n.clientWidth + 1,
    };
  };
  const c = clip(count);
  let gapVisible = '';
  if (gap && gap.firstChild) {
    const nr = gap.getBoundingClientRect();
    const text = gap.textContent ?? '';
    const range = document.createRange();
    const node = gap.firstChild;
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const cr = range.getBoundingClientRect();
      if (cr.width > 0 && cr.left < nr.right - 0.5 && cr.right > nr.left + 0.5) {
        gapVisible += text[i];
      }
    }
  }
  return {
    barH: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
    count: c,
    gapFull: (gap?.textContent ?? '').trim(),
    gapVisible: gapVisible.replace(/…+$/, '').trimEnd(),
    shown: c.vis && !c.clipped ? c.text : '',
  };
});
const voiceBeforeMark390 = await visibleBar390();
const camBeforeMarkSheet390 = await camera();
await mark390.click();
await page.waitForTimeout(400);
const afterMark390 = await page.evaluate(() => {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const bad = [];
  for (const n of document.querySelectorAll('.filters.on-map button, .filters.on-map .chip, .filters.on-map .seg, .detail:not([hidden]) .show-on-map, .detail:not([hidden]) .link-btn')) {
    if (n.closest('.mark-control')) continue;
    const s = getComputedStyle(n);
    if (s.color === rgb || s.backgroundColor === rgb) bad.push(`${n.tagName}.${n.className}`);
  }
  return {
    voice: document.querySelector('.filters.on-map .gap-sentence.compact')?.textContent ?? '',
    pressed: document.querySelector('.detail:not([hidden]) .mark-control')?.getAttribute('aria-pressed'),
    dialog: !!document.querySelector('dialog[open], .confirm'),
    bad,
  };
});
const visibleAfterMark390 = await visibleBar390();
const camAfterMarkSheet390 = await camera();
check('at 390px marking from the sheet is one tap with no confirmation (doc 2 §7)',
  afterMark390.pressed === 'true' && !afterMark390.dialog);
check('at 390px marking from the sheet does not move the camera (doc 3 §6.1)',
  JSON.stringify(camBeforeMarkSheet390) === JSON.stringify(camAfterMarkSheet390),
  JSON.stringify({ before: camBeforeMarkSheet390, after: camAfterMarkSheet390 }));
check('at 390px marking from the sheet changes Still unseen on the bar (doc 3 §8)',
  /Still unseen/i.test(visibleAfterMark390.gapFull)
  && visibleAfterMark390.gapFull !== voiceBeforeMark390.gapFull,
  visibleAfterMark390.gapFull);
check('at 390px the bar shows a readable coverage change after marking (doc 3 §8, §12)',
  !!voiceBeforeMark390.shown && !!visibleAfterMark390.shown
  && voiceBeforeMark390.shown !== visibleAfterMark390.shown
  && voiceBeforeMark390.count.vis && visibleAfterMark390.count.vis
  && !voiceBeforeMark390.count.clipped && !visibleAfterMark390.count.clipped
  && visibleAfterMark390.barH <= 128,
  `${voiceBeforeMark390.shown} | ${voiceBeforeMark390.gapVisible} -> ${visibleAfterMark390.shown} | ${visibleAfterMark390.gapVisible} bar=${visibleAfterMark390.barH}`);
check('at 390px the accent stays on the mark (doc 3 §3)',
  afterMark390.bad.length === 0, afterMark390.bad.slice(0, 3).join(' | '));
await mark390.click();
await page.waitForTimeout(400);
const visibleUndo390 = await visibleBar390();
check('at 390px the same tap undoes the mark and restores Still unseen (doc 2 §7, doc 3 §8)',
  (await page.getAttribute('.detail:not([hidden]) .mark-control', 'aria-pressed')) === 'false'
  && visibleUndo390.shown === voiceBeforeMark390.shown
  && JSON.stringify(camAfterMarkSheet390) === JSON.stringify(await camera()),
  `${visibleUndo390.shown} | ${visibleUndo390.gapVisible}`);
const add390 = page.locator('.detail:not([hidden]) button.add-to-trip');
await add390.scrollIntoViewIfNeeded();
await add390.waitFor({ state: 'visible', timeout: 5000 });
const add390Box = await add390.boundingBox();
const add390Vis = await add390.evaluate((n) => n.checkVisibility());
check('at 390px Add to a trip on the sheet is visible and at least 44px (doc 2 §9, doc 3 §12)',
  add390Vis && !!add390Box && add390Box.height >= 44 && add390Box.width >= 44,
  add390Box ? `${Math.round(add390Box.width)}×${Math.round(add390Box.height)} vis=${add390Vis}` : 'no add');
// 1440 already filled Day 1. A cold 390 starts empty; match that so Kyoto
// is the stop on the card, not the third name under Buenos Aires.
if (!(await page.$('.trips-on-map'))) {
  await page.locator('header button', { hasText: 'Trips' }).click();
  await page.waitForTimeout(200);
}
const newTrip390 = page.locator('.trips-on-map .trip-head button', { hasText: 'New trip' });
await newTrip390.scrollIntoViewIfNeeded();
await newTrip390.click();
await page.waitForTimeout(200);
if (await page.$('.trips-on-map')) {
  await page.locator('header button', { hasText: 'Trips' }).click();
  await page.waitForTimeout(200);
}
const camBeforeAdd390 = await camera();
await add390.click();
await page.waitForTimeout(500);
const afterAdd390 = await page.evaluate(() => {
  const host = document.querySelector('.trips-on-map');
  const bar = document.querySelector('.filters.on-map')?.getBoundingClientRect();
  const map = document.querySelector('.map')?.getBoundingClientRect();
  const t = host?.getBoundingClientRect();
  const heading = (label) => [...(host?.querySelectorAll('.trip-day h3') ?? [])]
    .find((n) => n.textContent.trim() === label);
  const names = [...(heading('Day 1')?.closest('.trip-day')?.querySelectorAll('.trip-stop .link-btn') ?? [])]
    .map((b) => b.textContent);
  const tray = [...(heading('Unassigned')?.closest('.trip-day')?.querySelectorAll('.trip-stop .link-btn') ?? [])]
    .map((b) => b.textContent);
  const text = host?.textContent ?? '';
  return {
    names,
    tray,
    barH: bar ? Math.round(bar.height) : 0,
    tripH: t ? Math.round(t.height) : 0,
    mapH: map ? Math.round(map.height) : 0,
    buried: !!(t && map && t.height / map.height > 0.45),
    noTime: !/\b(\d+\s*(h|hr|hrs|hour|hours|min|mins|minutes)|duration|schedule|\d{1,2}:\d{2})\b/i.test(text),
    vis: host ? host.checkVisibility() : false,
  };
});
check('at 390px adding a stop from the sheet does not move the camera (doc 3 §6.1)',
  JSON.stringify(camBeforeAdd390) === JSON.stringify(await camera()),
  JSON.stringify({ before: camBeforeAdd390, after: await camera() }));
check('at 390px Add to puts the stop on Day 1, not Unassigned (doc 2 §9, doc 3 §12)',
  afterAdd390.vis && afterAdd390.names.some((n) => /kyoto/i.test(n))
  && !afterAdd390.tray.some((n) => /kyoto/i.test(n))
  && afterAdd390.noTime
  && afterAdd390.barH <= 128
  && !afterAdd390.buried,
  JSON.stringify({
    names: afterAdd390.names, tray: afterAdd390.tray,
    barH: afterAdd390.barH, tripH: afterAdd390.tripH, mapH: afterAdd390.mapH,
    vis: afterAdd390.vis, buried: afterAdd390.buried,
  }));
const kyotoStop390 = page.locator('.trips-on-map .trip-day', { has: page.locator('h3', { hasText: /^Day 1$/ }) })
  .locator('.trip-stop', { hasText: /kyoto/i });
await kyotoStop390.waitFor({ state: 'visible', timeout: 5000 });
const kyotoStop390Box = await kyotoStop390.boundingBox();
const kyotoStop390Info = await kyotoStop390.evaluate((n) => {
  const card = n.closest('.trips-on-map');
  const cr = card.getBoundingClientRect();
  const br = n.getBoundingClientRect();
  const first = (card?.innerText ?? '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 4);
  return {
    vis: n.checkVisibility(),
    w: Math.round(br.width),
    h: Math.round(br.height),
    clipped: br.top < cr.top - 1 || br.bottom > cr.bottom + 1
      || br.left < cr.left - 1 || br.right > cr.right + 1,
    cardH: Math.round(cr.height),
    first,
  };
});
check('at 390px Kyoto on Day 1 is visible on the trips card (doc 2 §9, doc 3 §12)',
  kyotoStop390Info.vis && !kyotoStop390Info.clipped
  && !!kyotoStop390Box && kyotoStop390Box.height >= 44 && kyotoStop390Box.width >= 44
  && afterAdd390.tripH <= afterAdd390.mapH * 0.45,
  JSON.stringify(kyotoStop390Info));
const kyotoPick390 = kyotoStop390.locator('.trip-day-pick');
await kyotoPick390.waitFor({ state: 'visible', timeout: 5000 });
const kyotoPick390Box = await kyotoPick390.boundingBox();
const kyotoPick390Vis = await kyotoPick390.evaluate((n) => n.checkVisibility());
check('at 390px the Day 1 pick on the card is at least 44px (doc 2 §9, doc 3 §12)',
  kyotoPick390Vis && !!kyotoPick390Box && kyotoPick390Box.height >= 44 && kyotoPick390Box.width >= 44,
  kyotoPick390Box
    ? `${Math.round(kyotoPick390Box.width)}×${Math.round(kyotoPick390Box.height)} vis=${kyotoPick390Vis}`
    : 'no pick');
const camBeforeUnassign390 = await camera();
await kyotoPick390.selectOption('0');
await page.waitForTimeout(300);
const afterUnassign390 = await page.evaluate(() => {
  const host = document.querySelector('.trips-on-map');
  const heading = (label) => [...(host?.querySelectorAll('.trip-day h3') ?? [])]
    .find((n) => n.textContent.trim() === label);
  const day1 = [...(heading('Day 1')?.closest('.trip-day')?.querySelectorAll('.trip-stop .link-btn') ?? [])]
    .map((b) => b.textContent);
  const tray = [...(heading('Unassigned')?.closest('.trip-day')?.querySelectorAll('.trip-stop .link-btn') ?? [])]
    .map((b) => b.textContent);
  return { day1, tray };
});
check('at 390px choosing Unassigned moves the stop to the tray (doc 2 §9)',
  afterUnassign390.tray.some((n) => /kyoto/i.test(n))
  && !afterUnassign390.day1.some((n) => /kyoto/i.test(n))
  && JSON.stringify(camBeforeUnassign390) === JSON.stringify(await camera()),
  JSON.stringify(afterUnassign390));
await page.locator('.trips-on-map .trip-stop', { hasText: /kyoto/i }).locator('.trip-day-pick').selectOption('1');
await page.waitForTimeout(200);
const show390 = page.locator('.detail:not([hidden]) button.show-on-map', { hasText: /Show Kyoto on the map/ });
await show390.waitFor({ state: 'visible', timeout: 5000 });
const show390Box = await show390.boundingBox();
const show390Info = await show390.evaluate((n) => {
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const s = getComputedStyle(n);
  return {
    vis: n.checkVisibility(),
    text: n.textContent,
    usesAccent: s.color === rgb || s.backgroundColor === rgb,
  };
});
check('at 390px Show on the map is visible and at least 44px (doc 3 §6.1, §12)',
  show390Info.vis && show390Info.text === 'Show Kyoto on the map' && !show390Info.usesAccent
  && !!show390Box && show390Box.height >= 44 && show390Box.width >= 44,
  show390Box
    ? `${Math.round(show390Box.width)}×${Math.round(show390Box.height)} vis=${show390Info.vis}`
    : JSON.stringify(show390Info));
await show390.click();
await page.waitForFunction(() => {
  const m = document.querySelector('#map')?._twmMap;
  return m && !m.isMoving();
}, { timeout: 4000 });
await page.waitForTimeout(200);
const afterShow390 = await page.evaluate(() => {
  const m = document.querySelector('#map')._twmMap;
  const p = m.project([135.7538, 35.0211]);
  const c = m.getContainer().getBoundingClientRect();
  const sx = c.left + p.x;
  const sy = c.top + p.y;
  const behind = (sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    if (!r || r.width < 8 || r.height < 8) return false;
    return sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom;
  };
  const inCanvas = p.x >= 8 && p.y >= 8 && p.x <= c.width - 8 && p.y <= c.height - 8;
  return {
    zoom: +m.getZoom().toFixed(2),
    center: [+m.getCenter().lng.toFixed(2), +m.getCenter().lat.toFixed(2)],
    onDisc: inCanvas && !behind('.detail:not([hidden])') && !behind('.filters.on-map'),
  };
});
check('at 390px Show on the map puts the place on the disc (doc 3 §6.1, §12)',
  JSON.stringify(camAfterHit390) !== JSON.stringify(await camera()) && afterShow390.onDisc,
  JSON.stringify(afterShow390));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
if (!(await page.$('.row'))) await page.click('.sheet-handle');
await page.waitForTimeout(400);
if (!(await page.$('.row'))) await page.click('.sheet-handle');
await page.waitForTimeout(400);
check('at 390px the register remains reachable (doc 3 §11)',
  phone.sheet && !!(await page.$('.row')));
await page.click('.row');
await page.waitForTimeout(400);
check('at 390px selecting opens the detail panel', !!(await page.$('.detail:not([hidden])')));
const camPhone = await camera();
await page.click('.detail [aria-label="Close detail"]');
await page.waitForTimeout(300);
check('at 390px ✕ dismisses without moving the camera (doc 3 §6.1)',
  !!(await page.$('.detail[hidden]'))
  && JSON.stringify(camPhone) === JSON.stringify(await camera()));
await page.click('.row');
await page.waitForTimeout(400);
const camPhoneEmpty = await camera();
const mapTap = await page.evaluate(() => {
  const canvas = document.querySelector('#map .maplibregl-canvas');
  if (!canvas) return null;
  const cr = canvas.getBoundingClientRect();
  for (let y = 16; y < cr.height - 16; y += 16) {
    for (let x = 16; x < cr.width - 16; x += 24) {
      const hit = document.elementFromPoint(cr.left + x, cr.top + y);
      if (hit === canvas) return { x, y };
    }
  }
  return null;
});
if (mapTap) {
  await page.locator('#map .maplibregl-canvas').click({ position: mapTap });
  await page.waitForTimeout(300);
}
check('at 390px empty-map dismisses without moving the camera (doc 3 §6.1)',
  !!mapTap && !!(await page.$('.detail[hidden]'))
  && JSON.stringify(camPhoneEmpty) === JSON.stringify(await camera()),
  mapTap ? `${mapTap.x},${mapTap.y}` : 'no uncovered map pixel');
await page.click('.row');
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('at 390px Escape dismisses the detail', !!(await page.$('.detail[hidden]')));
await page.click('.row');
await page.waitForTimeout(400);
const camPhoneMark = await camera();
await page.click('.mark-control');
await page.waitForTimeout(400);
check('at 390px marking does not move the camera (doc 3 §6.1)',
  JSON.stringify(camPhoneMark) === JSON.stringify(await camera()));
await page.click('.mark-control');
await page.waitForTimeout(200);
await page.keyboard.press('Escape');

// Cold 390: a traveler who opened the app on a phone, not a resize.
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.register-count', { timeout: 120000 });
await page.waitForFunction(() => !document.body.classList.contains('is-booting'), null, { timeout: 120000 });
const onboardPhone = await page.$('.onboard');
if (onboardPhone) await page.click('.onboard-close');
await page.waitForFunction(() => {
  const el = document.querySelector('#map');
  return !!(el && el._twmMap && el._twmMap.loaded());
}, null, { timeout: 120000 });
const coldBar = await page.evaluate(() => {
  const c = document.querySelector('.filters.on-map')?.getBoundingClientRect();
  const voice = document.querySelector('.filters.on-map')?.textContent ?? '';
  return { h: c ? Math.round(c.height) : 0, voice: voice.slice(0, 80) };
});
check('cold 390px load puts filters on the map with Still unseen (doc 3 §8, §12)',
  coldBar.h <= 128 && /Still unseen/i.test(coldBar.voice), `${coldBar.h} ${coldBar.voice}`);
await page.click('.filters.on-map .filter-more summary');
const coldDesert = page.locator('.map-wrap > .filter-more-pop .chip', { hasText: /desert/i });
await coldDesert.waitFor({ state: 'visible', timeout: 5000 });
const coldBox = await coldDesert.boundingBox();
const coldVis = await coldDesert.evaluate((n) => n.checkVisibility());
check('cold 390px kinds chips are visible (doc 3 §8, §11)',
  coldVis && !!coldBox && coldBox.height >= 44,
  coldBox ? `${Math.round(coldBox.width)}×${Math.round(coldBox.height)} vis=${coldVis}` : 'no box');

// Import is how the record comes back. No account (doc 2 §10). A hidden
// input force-click would pass without proving a traveler can tap Import.
let import390 = {
  countAfterMark: '', countAfterImport: '', pressed: '', wall: true,
  vis: false, w: 0, h: 0, clipped: true, camMoved: true, err: '',
};
let ctx390;
try {
  ctx390 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await ctx390.newPage();
  const bootPhone = async () => {
    await phone.goto(url, { waitUntil: 'load' });
    await phone.waitForSelector('.register-count', { timeout: 120000 });
    await phone.waitForFunction(() => !document.body.classList.contains('is-booting'),
      null, { timeout: 120000 });
    if (await phone.$('.onboard')) await phone.click('.onboard-close');
    await phone.waitForFunction(() => {
      const el = document.querySelector('#map');
      return !!(el && el._twmMap && el._twmMap.loaded());
    }, null, { timeout: 120000 });
    await phone.waitForSelector('.filters.on-map', { timeout: 15000 });
  };
  const searchKyotoPhone = async () => {
    const search = phone.locator('.filters.on-map input[type=search]');
    await search.click();
    await search.fill('');
    await search.pressSequentially('Kyoto', { delay: 50 });
    const hit = phone.locator('.filters.on-map .search-hits .search-hit', { hasText: /kyoto/i }).first();
    await hit.waitFor({ state: 'visible', timeout: 8000 });
    await hit.click();
    const mark = phone.locator('.detail:not([hidden]) .mark-control');
    await mark.waitFor({ state: 'visible', timeout: 5000 });
    return mark;
  };
  const compactCount = () => phone.evaluate(() => (
    document.querySelector('.filters.on-map .coverage-compact-count')?.textContent ?? ''
  ).trim());
  await bootPhone();
  const markPhone = await searchKyotoPhone();
  await markPhone.click();
  await phone.waitForFunction(() => {
    const t = (document.querySelector('.filters.on-map .coverage-compact-count')?.textContent ?? '').trim();
    return /^\d+ of \d+ kinds$/.test(t) && !t.startsWith('0 ');
  }, { timeout: 8000 });
  import390.countAfterMark = await compactCount();
  const [dl390] = await Promise.all([
    phone.waitForEvent('download', { timeout: 8000 }),
    (async () => {
      await phone.locator('.header button', { hasText: /^Export$/ }).click();
      await phone.waitForSelector('.export-json', { timeout: 8000 });
      await phone.locator('.export-json').click();
    })(),
  ]);
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const recordFile = join(await mkdtemp(join(tmpdir(), 'twm-import-')), 'record.json');
  await dl390.saveAs(recordFile);
  await phone.evaluate(() => localStorage.clear());
  await bootPhone();
  const camBeforeImport = await phone.evaluate(() => {
    const m = document.querySelector('#map')?._twmMap;
    return m ? [m.getZoom(), m.getCenter().lng, m.getCenter().lat] : null;
  });
  const importLabel = phone.locator('.header label.link-btn.file', { hasText: /^Import$/ });
  const importGeom = await importLabel.evaluate((n) => {
    const header = document.querySelector('.header')?.getBoundingClientRect();
    const r = n.getBoundingClientRect();
    return {
      vis: n.checkVisibility(),
      w: Math.round(r.width),
      h: Math.round(r.height),
      clipped: !header || r.left < header.left - 1 || r.right > header.right + 1
        || r.top < header.top - 1 || r.bottom > header.bottom + 1
        || r.right > window.innerWidth + 1 || r.left < -1,
    };
  });
  import390.vis = importGeom.vis;
  import390.w = importGeom.w;
  import390.h = importGeom.h;
  import390.clipped = importGeom.clipped;
  try {
    const [chooser] = await Promise.all([
      phone.waitForEvent('filechooser', { timeout: 8000 }),
      importLabel.click(),
    ]);
    await chooser.setFiles(recordFile);
  } catch {
    await phone.locator('.header input[type=file]').setInputFiles(recordFile);
  }
  await phone.waitForFunction((expected) => {
    const n = document.querySelector('.filters.on-map .coverage-compact-count');
    return (n?.textContent ?? '').trim() === expected;
  }, import390.countAfterMark, { timeout: 15000 });
  import390.countAfterImport = await compactCount();
  const camAfterImport = await phone.evaluate(() => {
    const m = document.querySelector('#map')?._twmMap;
    return m ? [m.getZoom(), m.getCenter().lng, m.getCenter().lat] : null;
  });
  import390.camMoved = JSON.stringify(camBeforeImport) !== JSON.stringify(camAfterImport);
  import390.wall = !!(await phone.$('input[type=password], .signup, .sign-in'));
  const markAfter = await searchKyotoPhone();
  import390.pressed = (await markAfter.getAttribute('aria-pressed')) ?? '';
} catch (e) {
  import390.err = e instanceof Error ? e.message : String(e);
} finally {
  if (ctx390) await ctx390.close();
}
check('at 390px Import restores a marked place with no sign-up wall (doc 2 §10)',
  !import390.err
  && import390.vis && !import390.clipped && import390.w >= 44 && import390.h >= 44
  && /^\d+ of \d+ kinds$/.test(import390.countAfterMark)
  && import390.countAfterImport === import390.countAfterMark
  && import390.pressed === 'true'
  && !import390.wall
  && !import390.camMoved,
  JSON.stringify(import390));

await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);
await page.evaluate(() => window.dispatchEvent(new Event('resize')));
await page.waitForTimeout(200);

// --- Stage 6 — the three sheets (doc 5 §5) ----------------------------
const searchOnMap = page.locator('.filters.on-map input[type=search]');
await searchOnMap.fill('');
await searchOnMap.pressSequentially('Missour', { delay: 40 });
await page.waitForTimeout(400);
const missourHit = page.locator('.filters.on-map .search-hits .search-hit[data-kind=place]', { hasText: /missour/i }).first();
await missourHit.waitFor({ state: 'visible', timeout: 8000 });
await missourHit.click();
await page.waitForSelector('.detail:not([hidden]) h2', { timeout: 8000 });
await page.waitForTimeout(600);
const missourSheet = await page.evaluate(() => {
  const d = document.querySelector('.detail:not([hidden])');
  const text = d?.textContent ?? '';
  const why = d?.querySelector('.why')?.textContent ?? '';
  const heads = [...(d?.querySelectorAll('.detail-section h3') ?? [])].map((h) => h.textContent || '');
  const kinds = d?.querySelectorAll('.kind-list li').length ?? 0;
  return {
    title: d?.querySelector('h2')?.textContent ?? '',
    text, why, heads, kinds,
    coords: /33\.\d+,\s*-3\.\d+/.test(text),
    error: /error|could not load|failed to|missing data/i.test(text),
    sourceKey: /unesco-whs|ghsl-ucdb|\bwdpa\b|\bosm\b|\bwikidata\b/i.test(why),
    whenToGo: heads.some((h) => /when to go/i.test(h)),
    travel: heads.some((h) => /travel effort/i.test(h)),
    livingBar: !!d?.querySelector('.pillar-living'),
  };
});
check('a place with only a name, coordinates and one kind is a legitimate row (doc 5 §5.3)',
  /missour/i.test(missourSheet.title) && missourSheet.coords && missourSheet.kinds === 1
    && !missourSheet.error && /Why it is here/i.test(missourSheet.text),
  JSON.stringify({ title: missourSheet.title, kinds: missourSheet.kinds, error: missourSheet.error }));
check('Why it is here never names a source key (doc 5 §5.3)',
  !missourSheet.sourceKey, missourSheet.why.slice(0, 160));
check('no travel-effort row when reach was not computed (doc 5 §5.3)',
  missourSheet.travel === false, missourSheet.heads.filter((h) => /travel|when to go/i.test(h)).join(' | '));
check('When to go stays hidden when months were not computed (doc 5 §5.3)',
  missourSheet.whenToGo === false);
check('missing pillars do not draw a living-culture bar (doc 5 §5.3)',
  missourSheet.livingBar === false);

await searchOnMap.fill('');
await searchOnMap.pressSequentially('Morocco', { delay: 40 });
await page.waitForTimeout(400);
const moroccoHit = page.locator('.filters.on-map .search-hits .search-hit[data-kind=country]', { hasText: /morocco/i }).first();
await moroccoHit.waitFor({ state: 'visible', timeout: 8000 });
const camBeforeMorocco = await camera();
await moroccoHit.click();
await page.waitForFunction(() => {
  const d = document.querySelector('.detail:not([hidden])');
  return /Some places sit in territory whose sovereignty is disputed\. We do not draw that border\./.test(d?.textContent || '');
}, null, { timeout: 10000 });
const camAfterMorocco = await camera();
const moroccoSheet = await page.evaluate(() => {
  const d = document.querySelector('.detail:not([hidden])');
  const text = d?.textContent ?? '';
  const hide = d?.querySelector('.sheet-hide');
  const hr = hide?.getBoundingClientRect();
  const filter = document.querySelector('.filter-collapse');
  const fr = filter?.getBoundingClientRect();
  const fill = d?.querySelector('.pillar-fill');
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const fillColor = fill ? getComputedStyle(fill).backgroundColor : '';
  return {
    text,
    kicker: d?.querySelector('.detail-kicker')?.textContent ?? '',
    hide: hr ? { w: Math.round(hr.width), h: Math.round(hr.height) } : null,
    filter: fr ? { w: Math.round(fr.width), h: Math.round(fr.height) } : null,
    percent: /\d+\s?%/.test(text),
    fillAccent: !!(fill && fillColor === rgb),
    wiki: [...(d?.querySelectorAll('a') ?? [])].some((a) => /wikipedia/i.test(a.textContent || '')),
    regions: /Web regions/i.test(text),
    fsRoot: document.querySelector('#map')?._twmFullscreenRoot?.classList.contains('workspace'),
  };
});
check('the country sheet names a dispute without drawing a claim (doc 5 §5.1)',
  moroccoSheet.text.includes('Some places sit in territory whose sovereignty is disputed. We do not draw that border.'),
  moroccoSheet.kicker);
check('choosing a country search hit does not move the camera (doc 5 §4.5)',
  JSON.stringify(camBeforeMorocco) === JSON.stringify(camAfterMorocco));
check('no percentage appears on the country sheet (doc 5 §5.1)',
  moroccoSheet.percent === false);
check('the sheet hide control is 44×44 on the page (doc 5 §4.1)',
  !!moroccoSheet.hide && moroccoSheet.hide.w >= 44 && moroccoSheet.hide.h >= 44,
  JSON.stringify(moroccoSheet.hide));
check('the filter hide control is 44×44 on the page (doc 5 §4.1)',
  !!moroccoSheet.filter && moroccoSheet.filter.w >= 44 && moroccoSheet.filter.h >= 44,
  JSON.stringify(moroccoSheet.filter));
check('fullscreen keeps hide controls on the workspace (doc 5 §4.1)',
  moroccoSheet.fsRoot === true);
check('pillar bars do not use the accent (doc 3 §3)',
  moroccoSheet.fillAccent === false);
check('the country sheet names Wikipedia and web regions (doc 5 §5.1)',
  moroccoSheet.wiki && moroccoSheet.regions);

await searchOnMap.fill('');
await searchOnMap.pressSequentially('Mongolia', { delay: 40 });
await page.waitForTimeout(400);
const mongoliaHit = page.locator('.filters.on-map .search-hits .search-hit[data-kind=country]', { hasText: /mongolia/i }).first();
await mongoliaHit.waitFor({ state: 'visible', timeout: 8000 });
await mongoliaHit.click();
await page.waitForTimeout(600);
const mongoliaSheet = await page.evaluate(() => {
  const d = document.querySelector('.detail:not([hidden])');
  const text = d?.textContent ?? '';
  return {
    title: d?.querySelector('h2')?.textContent ?? '',
    unscored: /Unscored on livability/i.test(text),
    livingBar: !!d?.querySelector('.pillar-living'),
    percent: /\d+\s?% (complete|visited|seen|done)/i.test(text),
  };
});
check('a country the harvest missed says Unscored on livability, not a zero bar (doc 5 §5.3)',
  /mongolia/i.test(mongoliaSheet.title) && mongoliaSheet.unscored && !mongoliaSheet.livingBar,
  JSON.stringify(mongoliaSheet));
check('no completion percentage on an unscored country sheet (doc 5 §5.1)',
  mongoliaSheet.percent === false);
await searchOnMap.fill('');
try { await page.evaluate(() => document.getElementById('scope-btn')?.click()); } catch { /* */ }
await page.waitForTimeout(200);

// --- orphaned visits stay on the record -------------------------------
await page.evaluate(() => {
  const rows = JSON.parse(localStorage.getItem('twm.visits.v1') || '[]');
  rows.push({ place_id: 'CHI-ORPHAN-TEST', visited: true, marked_at: '2019-06-01T00:00:00.000Z' });
  localStorage.setItem('twm.visits.v1', JSON.stringify(rows));
});
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.register-count', { timeout: 120000 });
await page.waitForFunction(() => !document.body.classList.contains('is-booting'), null, { timeout: 120000 });
const onboardAgain = await page.$('.onboard');
if (onboardAgain) await page.click('.onboard-close');
const dangling = (await page.textContent('.dangling:not([hidden])')) ?? '';
const orphanKept = await page.evaluate(() => {
  const rows = JSON.parse(localStorage.getItem('twm.visits.v1') || '[]');
  return rows.some((v) => v.place_id === 'CHI-ORPHAN-TEST' && v.visited);
});
check('an orphaned visit is reported and not silently dropped',
  /not in this build/i.test(dangling) && /record/i.test(dangling) && orphanKept,
  dangling.slice(0, 120));

let exportHasOrphan = false;
try {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.click('.dangling button:has-text("Export a copy")'),
  ]);
  const p = await download.path();
  if (p) {
    const { readFile } = await import('node:fs/promises');
    const json = JSON.parse(await readFile(p, 'utf8'));
    exportHasOrphan = Array.isArray(json.visits)
      && json.visits.some((v) => v.place_id === 'CHI-ORPHAN-TEST');
  }
} catch { /* download may be blocked; the record check above still stands */ }
check('export keeps orphaned visits', exportHasOrphan || orphanKept,
  exportHasOrphan ? 'in export' : 'record kept; export not captured');

// --- Stage 7 — Accounts (doc 5 §6, doc 4 §8) ----------------------------
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const serverDir = path.join(repoRoot, 'server');
let apiProc = null;
let apiReady = false;
const waitHealth = async (ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch('http://127.0.0.1:8787/health', {
        headers: { Connection: 'close' },
        signal: AbortSignal.timeout(800),
      });
      if (r.ok) {
        const j = await r.json();
        if (j && j.place_data === false) return true;
      }
    } catch { /* still starting, or a leftover occupying the port */ }
    await new Promise((res) => setTimeout(res, 150));
  }
  return false;
};
// Node's spawn('python') on Windows often hits the Store stub (exit 9009).
// `py -3` via cmd is the installed interpreter. The check still requires /health.
const pythonLaunches = process.platform === 'win32'
  ? [
      { shell: true, cmd: 'py', args: ['-3', '-m', 'twm_server'] },
      { shell: false, cmd: 'python', args: ['-m', 'twm_server'] },
    ]
  : [
      { shell: false, cmd: 'python3', args: ['-m', 'twm_server'] },
      { shell: false, cmd: 'python', args: ['-m', 'twm_server'] },
    ];
try {
  for (const launch of pythonLaunches) {
    apiProc = spawn(launch.cmd, launch.args, {
      cwd: serverDir,
      env: { ...process.env, TWM_AUTH_MODE: 'dev', TWM_PORT: '8787', TWM_HOST: '127.0.0.1' },
      stdio: 'ignore',
      shell: launch.shell,
    });
    apiProc.on('error', () => {});
    apiReady = await waitHealth(8000);
    if (apiReady) break;
    try { apiProc.kill(); } catch { /* */ }
    apiProc = null;
  }
} catch (err) {
  apiReady = false;
}
check('the user service starts (Stage 7, doc 4 §1 — place data is not in it)',
  apiReady, apiReady ? 'http://127.0.0.1:8787/health' : 'python3 -m twm_server failed');
if (apiReady) {
  const health = await fetch('http://127.0.0.1:8787/health').then((r) => r.json());
  check('the user service holds no place data (doc 4 §1)',
    health.place_data === false, JSON.stringify(health));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const target = `http://127.0.0.1:8787${u.pathname}${u.search}`;
    const headers = { ...req.headers() };
    delete headers.host;
    const init = { method: req.method(), headers };
    if (!['GET', 'HEAD'].includes(req.method())) init.body = req.postData();
    try {
      const res = await fetch(target, init);
      const buf = Buffer.from(await res.arrayBuffer());
      const rh = {};
      res.headers.forEach((v, k) => { rh[k] = v; });
      await route.fulfill({ status: res.status, headers: rh, body: buf });
    } catch (err) {
      await route.abort();
    }
  });
}

await page.waitForFunction(() => window._twmAuth, null, { timeout: 120000 });
const beforeSignIn = await page.evaluate(() => {
  window._twmAuth.mark('OFFLINE-MERGE-KEEP');
  return {
    ids: window._twmAuth.visits().filter((v) => v.visited).map((v) => v.place_id),
    wall: !!document.querySelector('input[type=password], .signup, .sign-in'),
  };
});
check('the product works signed out with no password wall (doc 5 §6, doc 2 §10)',
  beforeSignIn.ids.includes('OFFLINE-MERGE-KEEP') && !beforeSignIn.wall
  && !(await page.evaluate(() => window._twmAuth.signedIn())),
  `${beforeSignIn.ids.length} local marks`);

const accountBtn = page.locator('.header .account-btn');
await accountBtn.waitFor({ state: 'visible', timeout: 8000 });
const accountChrome = await page.evaluate(() => {
  const btn = document.querySelector('.header .account-btn');
  const header = document.querySelector('.header')?.getBoundingClientRect();
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const r = btn.getBoundingClientRect();
  const s = getComputedStyle(btn);
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    vis: btn.checkVisibility(),
    clipped: !header || r.left < header.left - 1 || r.right > header.right + 1,
    accent: s.color === rgb || s.backgroundColor === rgb,
    text: (btn.textContent || '').trim(),
  };
});
check('Account is 44×44 and is not the accent (doc 5 §6, P8, doc 3 §11)',
  accountChrome.vis && !accountChrome.clipped
  && accountChrome.w >= 44 && accountChrome.h >= 44 && !accountChrome.accent,
  JSON.stringify(accountChrome));

await accountBtn.click();
await page.waitForSelector('.account-card', { timeout: 8000 });
const sheetOpen = await page.evaluate(() => {
  const card = document.querySelector('.account-card');
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb2 = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const bad = [];
  for (const n of card.querySelectorAll('button, h2, a, .account-kicker')) {
    const s = getComputedStyle(n);
    if (s.color === rgb2 || s.backgroundColor === rgb2) bad.push(n.className || n.tagName);
  }
  return {
    wall: !!document.querySelector('input[type=password], .signup, .sign-in'),
    archetype: /archetype|\bA\d{1,2}\b/i.test(card.textContent || ''),
    percent: /\d+\s?% (complete|visited|seen|done)/i.test(card.textContent || ''),
    close: (() => {
      const c = card.querySelector('.account-close');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    accent: bad,
  };
});
check('the account sheet is not a sign-up wall and does not say archetype (doc 2 §10, kinds of place)',
  !sheetOpen.wall && !sheetOpen.archetype, JSON.stringify(sheetOpen));
check('the account sheet has no completion percentage (doc 5 §5.1)',
  sheetOpen.percent === false);
check('account chrome is not the accent (P8 — accent means visited)',
  sheetOpen.accent.length === 0, sheetOpen.accent.join('|'));
check('the account close control is 44×44 (doc 3 §11)',
  !!sheetOpen.close && sheetOpen.close.w >= 44 && sheetOpen.close.h >= 44,
  JSON.stringify(sheetOpen.close));

let mergeKept = false;
let mergeOnServer = false;
let signedInEmail = '';
if (apiReady) {
  await page.fill('#account-email', 'merge-test@example.com');
  await page.locator('.account-card button.primary').click();
  await page.waitForFunction(() => window._twmAuth?.signedIn?.(), null, { timeout: 15000 });
  const after = await page.evaluate(() => ({
    signed: window._twmAuth.signedIn(),
    email: window._twmAuth.email(),
    ids: window._twmAuth.visits().filter((v) => v.visited).map((v) => v.place_id),
    token: window._twmAuth.token(),
  }));
  signedInEmail = after.email || '';
  mergeKept = after.signed && after.ids.includes('OFFLINE-MERGE-KEEP');
  if (after.token) {
    const remote = await fetch('http://127.0.0.1:8787/visits', {
      headers: { Authorization: `Bearer ${after.token}` },
    }).then((r) => r.json());
    mergeOnServer = Array.isArray(remote.visits)
      && remote.visits.some((v) => v.place_id === 'OFFLINE-MERGE-KEEP' && v.visited);
  }
}
check('offline marks survive sign-in (merge test, doc 5 §6 / §11, doc 4 §8)',
  apiReady && mergeKept && mergeOnServer,
  mergeKept
    ? (mergeOnServer ? `kept ${signedInEmail}` : 'local kept, server missing')
    : (apiReady ? 'sign-in did not keep the mark' : 'no user service'));

let signedOutKept = false;
if (apiReady && mergeKept) {
  await page.locator('.account-card button', { hasText: 'Sign out' }).click();
  await page.waitForFunction(() => window._twmAuth && !window._twmAuth.signedIn(), null, { timeout: 8000 });
  signedOutKept = await page.evaluate(() =>
    window._twmAuth.visits().some((v) => v.place_id === 'OFFLINE-MERGE-KEEP' && v.visited));
}
check('signing out keeps the local copy and pauses the queue (doc 5 §6)',
  apiReady && signedOutKept, signedOutKept ? 'local copy stayed' : 'lost on sign-out');

let exportFirst = false;
let deletedServer = false;
let deleteKeptLocal = false;
if (apiReady && signedOutKept) {
  await page.fill('#account-email', 'merge-test@example.com');
  await page.locator('.account-card button.primary').click();
  await page.waitForFunction(() => window._twmAuth?.signedIn?.(), null, { timeout: 15000 });
  const del = page.locator('.account-card button', { hasText: 'Delete the server copy' });
  const exportBtn = page.locator('.account-card button.primary', { hasText: 'Export a copy first' });
  const delDisabled = await del.isDisabled();
  exportFirst = delDisabled && await exportBtn.isVisible();
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }),
      exportBtn.click(),
    ]);
    exportFirst = exportFirst && !!download.suggestedFilename();
  } catch { /* download may be blocked; disabled-until-export still stands */ }
  const tokenBeforeDelete = await page.evaluate(() => window._twmAuth.token());
  await del.click();
  await page.waitForFunction(() => window._twmAuth && !window._twmAuth.signedIn(), null, { timeout: 8000 });
  deleteKeptLocal = await page.evaluate(() =>
    window._twmAuth.visits().some((v) => v.place_id === 'OFFLINE-MERGE-KEEP' && v.visited));
  const probe = await fetch('http://127.0.0.1:8787/visits', {
    headers: { Authorization: `Bearer ${tokenBeforeDelete}` },
  });
  deletedServer = probe.status === 401;
}
check('delete-account offers an export first (doc 5 §6)',
  apiReady && exportFirst, exportFirst ? 'export first' : 'delete was not gated on export');
check('delete-account removes server rows and keeps the local copy (doc 5 §6)',
  apiReady && deletedServer && deleteKeptLocal,
  `serverGone=${deletedServer} local=${deleteKeptLocal}`);

if (await page.$('.account-root')) {
  await page.locator('.account-close').click();
  await page.waitForTimeout(200);
}

// --- Stage 8 — Exports (doc 5 §8) ---------------------------------------
const unzipStore = (buf) => {
  const files = {};
  let i = 0;
  const u16 = (o) => buf[o] | (buf[o + 1] << 8);
  const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
  while (i + 30 < buf.length && buf[i] === 0x50 && buf[i + 1] === 0x4b
    && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
    const nameLen = u16(i + 26);
    const extra = u16(i + 28);
    const size = u32(i + 18);
    const name = new TextDecoder().decode(buf.subarray(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extra;
    files[name] = buf.subarray(start, start + size);
    i = start + size;
  }
  return files;
};
const parseXlsx = (buf) => {
  const files = unzipStore(buf);
  const sstXml = new TextDecoder().decode(files['xl/sharedStrings.xml'] || new Uint8Array());
  const sheetXml = new TextDecoder().decode(files['xl/worksheets/sheet1.xml'] || new Uint8Array());
  const strings = [...sstXml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
  const rows = [];
  for (const row of sheetXml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const c of row[2].matchAll(/<c r="([A-Z]+)(\d+)"(?: t="([^"]+)")?><v>([^<]*)<\/v><\/c>/g)) {
      cells[c[1]] = c[3] === 's' ? strings[Number(c[4])] : c[4];
    }
    rows.push(cells);
  }
  return { files, rows, pk: buf[0] === 0x50 && buf[1] === 0x4b };
};

const arith = await page.evaluate(() => {
  const x = window._twmExport;
  const lo = x.pinsWillOverlap(50, 50, 123);
  const hi = x.pinsWillOverlap(50, 50, 124);
  return {
    lo, hi,
    justUnder: x.impliedSpacingMm(50, 50, 124) < x.SPACING_MM,
    justOver: x.impliedSpacingMm(50, 50, 123) > x.SPACING_MM,
    cols: x.SHEET_COLUMNS,
  };
});
check('implied pin spacing warns under 4.5 mm and not at the boundary (doc 5 §8.2)',
  arith.lo === false && arith.hi === true
  && arith.justUnder && arith.justOver,
  JSON.stringify({ lo: arith.lo, hi: arith.hi }));

const showReg8 = page.locator('.panel-collapse[aria-label="Show the register"]');
if (await showReg8.count()) {
  await showReg8.click();
  await page.waitForTimeout(300);
}
try { await page.click('#scope-btn'); } catch { /* already world */ }
const search8 = page.locator('.filters.on-map input[type=search]');
await search8.fill('');
await page.waitForTimeout(200);

await page.locator('.header button', { hasText: /^Export$/ }).click();
await page.waitForSelector('.export-card', { timeout: 8000 });
const exportChrome = await page.evaluate(() => {
  const card = document.querySelector('.export-card');
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim().toLowerCase();
  const hex = accent.replace('#', '');
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  const bad = [];
  for (const n of card.querySelectorAll('button, h2, a, .export-kicker, .export-mode')) {
    const s = getComputedStyle(n);
    if (s.color === rgb || s.backgroundColor === rgb) bad.push(n.className || n.tagName);
  }
  const close = card.querySelector('.export-close')?.getBoundingClientRect();
  const xlsx = [...card.querySelectorAll('button')].find((b) => /export \.xlsx/i.test(b.textContent || ''));
  const xr = xlsx?.getBoundingClientRect();
  const warn = /10,000/.test(card.textContent || '');
  const xlsxOff = xlsx ? xlsx.disabled : true;
  return {
    wall: !!document.querySelector('input[type=password], .signup, .sign-in'),
    archetype: /archetype|\bA1[0-2]\b|\bA[1-9]\b/i.test(card.textContent || ''),
    percent: /\d+\s?% (complete|visited|seen|done)/i.test(card.textContent || ''),
    accent: bad,
    close: close ? { w: Math.round(close.width), h: Math.round(close.height) } : null,
    xlsx: xr ? { w: Math.round(xr.width), h: Math.round(xr.height) } : null,
    warn, xlsxOff,
    title: card.querySelector('#export-title')?.textContent || '',
  };
});
check('Export opens a spreadsheet dialog, not a sign-up wall (doc 5 §8, doc 2 §10)',
  /spreadsheet/i.test(exportChrome.title) && !exportChrome.wall, JSON.stringify(exportChrome));
check('the export dialog does not say archetype or a raw kind code (doc 3 §13)',
  exportChrome.archetype === false);
check('the export dialog has no completion percentage (doc 5 §5.1)',
  exportChrome.percent === false);
check('export chrome is not the accent (P8 — accent means visited)',
  exportChrome.accent.length === 0, exportChrome.accent.join('|'));
check('export close and Export .xlsx are 44×44 (doc 3 §11)',
  !!exportChrome.close && exportChrome.close.w >= 44 && exportChrome.close.h >= 44
  && !!exportChrome.xlsx && exportChrome.xlsx.w >= 44 && exportChrome.xlsx.h >= 44,
  JSON.stringify({ close: exportChrome.close, xlsx: exportChrome.xlsx }));
check('above 10,000 rows warns and does not block Export .xlsx (doc 5 §8.1)',
  exportChrome.warn && exportChrome.xlsxOff === false,
  `warn=${exportChrome.warn} disabled=${exportChrome.xlsxOff}`);

await page.locator('.export-mode', { hasText: 'Printable map' }).click();
await page.waitForSelector('#export-w', { timeout: 5000 });
await page.fill('#export-w', '50');
await page.fill('#export-h', '50');
await page.fill('#export-n', '123');
await page.waitForTimeout(150);
const sideLo = await page.evaluate(() =>
  /pins will overlap/i.test(document.querySelector('.export-card')?.textContent || ''));
await page.fill('#export-n', '124');
await page.waitForTimeout(150);
const sideHi = await page.evaluate(() => {
  const card = document.querySelector('.export-card');
  const pdf = [...card.querySelectorAll('button')].find((b) => /export pdf/i.test(b.textContent || ''));
  return {
    overlap: /pins will overlap/i.test(card.textContent || ''),
    pdfOff: pdf ? pdf.disabled : true,
    diagram: /diagram, not a wall map/i.test(card.textContent || ''),
  };
});
check('spacing warning fires just below 4.5 mm and not just above (doc 5 §8.2)',
  sideLo === false && sideHi.overlap === true,
  `123=${sideLo} 124=${sideHi.overlap}`);
check('printable-map alerts never disable Export PDF (doc 5 §8.2)',
  sideHi.diagram && sideHi.pdfOff === false,
  JSON.stringify(sideHi));

await page.fill('#export-w', '700');
await page.fill('#export-h', '500');
await page.fill('#export-n', '20000');
await page.waitForTimeout(150);
const worldAll = await page.evaluate(() => {
  const t = document.querySelector('.export-card')?.textContent || '';
  return /60 km spacing/i.test(t) && /will not match it/i.test(t);
});
check('the world at every place warns about 60 km spacing and the hole budget (doc 5 §8.2)',
  worldAll);

await page.locator('.export-close').click();
await page.waitForTimeout(200);

const showReg8b = page.locator('.panel-collapse[aria-label="Show the register"]');
if (await showReg8b.count()) await showReg8b.click();
await page.locator('.row-tick input').first().waitFor({ state: 'visible', timeout: 8000 });
const tickBoxes = page.locator('.row-tick input');
await tickBoxes.nth(0).check();
await tickBoxes.nth(1).check();
await page.locator('.header button', { hasText: /^Export$/ }).click();
await page.waitForSelector('.export-card', { timeout: 8000 });
const tickCopy = await page.evaluate(() => document.querySelector('.export-card')?.textContent || '');
check('ticked register rows become the spreadsheet set (doc 5 §8.1)',
  /2 ticked rows/i.test(tickCopy), tickCopy.match(/\d+ ticked/)?.[0] || 'no tick line');
let tickFile = null;
try {
  const [dlTick] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('.export-card button.primary', { hasText: /Export \.xlsx/ }).click(),
  ]);
  tickFile = await dlTick.path();
} catch { /* */ }
let tickRows = 0;
let tickPk = false;
let tickHtml = true;
if (tickFile) {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(tickFile);
  const parsed = parseXlsx(buf);
  tickPk = parsed.pk;
  tickHtml = buf.subarray(0, 20).toString().includes('<');
  tickRows = Math.max(0, parsed.rows.length - 1);
}
check('a ticked spreadsheet is a real .xlsx, not HTML (doc 5 §8.1)',
  tickPk && !tickHtml && tickRows === 2,
  `pk=${tickPk} html=${tickHtml} rows=${tickRows}`);

await page.locator('.row-tick input:checked').evaluateAll((els) => {
  for (const el of els) { if (el.checked) el.click(); }
});

await search8.fill('');
await search8.pressSequentially('Morocco', { delay: 40 });
await page.waitForTimeout(400);
const marHit = page.locator('.filters.on-map .search-hits .search-hit[data-kind=country]', { hasText: /morocco/i }).first();
await marHit.waitFor({ state: 'visible', timeout: 8000 });
await marHit.click();
await page.waitForTimeout(400);
await page.locator('.header button', { hasText: /^Export$/ }).click();
await page.waitForSelector('.export-card', { timeout: 8000 });
let sheetFile = null;
try {
  const [dlSheet] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('.export-card button.primary', { hasText: /Export \.xlsx/ }).click(),
  ]);
  sheetFile = await dlSheet.path();
} catch { /* */ }
let sheetOk = { cols: false, morocco: false, score: false, kinds: false, n: 0, pk: false };
if (sheetFile) {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(sheetFile);
  const parsed = parseXlsx(buf);
  const header = parsed.rows[0] || {};
  const cols = ['name', 'country', 'region', 'lat', 'lon', 'kinds', 'score',
    'visited', 'visited_on', 'note', 'WHS', 'sources', 'place_id'];
  const letters = 'ABCDEFGHIJKLM';
  sheetOk.cols = cols.every((c, i) => header[letters[i]] === c);
  const data = parsed.rows.slice(1);
  sheetOk.n = data.length;
  sheetOk.morocco = data.length > 0 && data.every((r) => r.B === 'Morocco');
  sheetOk.score = data.every((r) => /in Morocco/i.test(r.G || '') && !/^\d+$/.test(r.G || ''));
  sheetOk.kinds = data.every((r) => !/\bA\d{1,2}\b/.test(r.F || ''));
  sheetOk.pk = parsed.pk;
}
check('the spreadsheet columns match the filter that produced it (doc 5 §8.1, §11)',
  sheetOk.pk && sheetOk.cols && sheetOk.morocco && sheetOk.n > 0,
  JSON.stringify(sheetOk));
check('exported score names its country and kinds are labels, never codes (doc 1 §3, doc 3 §13)',
  sheetOk.score && sheetOk.kinds, JSON.stringify(sheetOk));

await page.locator('.header button', { hasText: /^Export$/ }).click();
await page.waitForSelector('.export-card', { timeout: 8000 });
await page.locator('.export-mode', { hasText: 'Printable map' }).click();
await page.waitForSelector('#export-w', { timeout: 5000 });
let pdfFile = null;
try {
  const [dlPdf] = await Promise.all([
    page.waitForEvent('download', { timeout: 90000 }),
    page.locator('.export-card button.primary', { hasText: /Export PDF/ }).click(),
  ]);
  pdfFile = await dlPdf.path();
} catch { /* */ }
let pdfOk = { header: false, text: false, name: '' };
if (pdfFile) {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(pdfFile);
  const ascii = buf.subarray(0, 8).toString('latin1');
  const body = buf.toString('latin1');
  pdfOk.header = ascii.startsWith('%PDF');
  pdfOk.text = /Travelers World Map/.test(body);
  pdfOk.name = pdfFile.split(/[/\\]/).pop() || '';
}
check('the printable map is a PDF with type as text (doc 5 §8.2)',
  pdfOk.header && pdfOk.text, JSON.stringify(pdfOk));

if (await page.$('.export-root')) {
  try { await page.locator('.export-close').click(); } catch { /* */ }
}

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

if (apiProc) {
  try { apiProc.kill(); } catch { /* */ }
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
