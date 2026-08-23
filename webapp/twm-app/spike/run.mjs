/**
 * Drive the spike in headless Chromium and print the numbers.
 *
 * Software rasterisation is slower than a real GPU, so treat the frame rates
 * here as a floor rather than a forecast — if it clears the budget under
 * SwiftShader it clears it on hardware. The marking numbers are mostly
 * JavaScript and translate more directly.
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/spike/';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.error('  page error:', m.text());
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__spike, null, { timeout: 180000 });
const r = await page.evaluate(() => window.__spike);
console.log(JSON.stringify(r, null, 2));

// Budgets are stated against a real GPU. SwiftShader paces a frame at roughly
// 100 ms, so the absolute wall-clock numbers here are meaningless and the
// deltas are not. These assertions test what this environment can actually
// answer: the JavaScript cost of marking, and whether a full feature-state
// table makes a single mark more expensive — the failure doc 4 §15 names.
const verdict = [
  ['bulk-mark all 11,918 < 250 ms of JS', r.bulkSetMs, r.bulkSetMs < 250],
  ['one mark adds < 16 ms over a repaint', r.markOverBaselineMs, r.markOverBaselineMs < 16],
  ['full state table costs no more (<1.2x)', r.fullStatePenalty, r.fullStatePenalty < 1.2],
  // Raw pins at world zoom are NOT the shipping configuration — doc 2 §4.2
  // clusters there, and this is the measurement that says why.
  ['clustering beats raw pins at world zoom', `${r.panFpsClustered} vs ${r.panFpsAllVisited} fps`,
    r.panFpsClustered > r.panFpsAllVisited * 1.4],
  ['cluster rebuild < 30 ms (whole world)', r.clusterBuildMs, r.clusterBuildMs < 30],
];
console.log('');
console.log(`  repaint baseline in this environment: ${r.repaintBaselineMs} ms `
  + `(${(1000 / r.repaintBaselineMs).toFixed(1)} fps ceiling, software rasteriser)`);
for (const [what, got, ok] of verdict) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}   got ${got}`);
}
await browser.close();
process.exit(verdict.every((v) => v[2]) ? 0 : 1);
