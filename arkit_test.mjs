/**
 * arkit_test.mjs — ARKit 52 shape visual regression test
 *
 * For each of the 52 ARKit blend shape names:
 *   1. Reset all shapes (neutral face)
 *   2. Screenshot → neutral
 *   3. Set shape to 1.0
 *   4. Screenshot → active
 *   5. Pixel diff neutral vs active
 *   6. PASS if diff > DIFF_THRESHOLD, SKIP if mechanism=none, else FAIL
 *
 * Usage:
 *   node arkit_test.mjs
 *
 * Output:  ./screenshots/arkit/
 *   {shape}_neutral.png   {shape}_active.png   {shape}_diff.png
 */

import puppeteer       from 'puppeteer';
import { createServer } from 'http';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { extname, join }  from 'path';
import { fileURLToPath }  from 'url';
import { dirname }        from 'path';
import { PNG }            from 'pngjs';
import pixelmatch         from 'pixelmatch';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;
const PORT      = 3478;   // separate port from sample.mjs so both can run together
const OUT_DIR   = join(ROOT, 'screenshots', 'arkit');

// A shape must change at least this fraction of pixels (of the FACE CROP) to PASS
const DIFF_THRESHOLD = 0.1; // 0.1% of face crop (~1 pixel in 70x80 crop = 0.9%)

const VIEWPORT = { width: 640, height: 480 };

// All 52 ARKit shapes in canonical order
const ARKIT_52 = [
  'eyeBlinkLeft','eyeBlinkRight','eyeLookDownLeft','eyeLookDownRight',
  'eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight',
  'eyeLookUpLeft','eyeLookUpRight','eyeSquintLeft','eyeSquintRight',
  'eyeWideLeft','eyeWideRight',
  'jawForward','jawLeft','jawRight','jawOpen',
  'mouthClose','mouthFunnel','mouthPucker','mouthLeft','mouthRight',
  'mouthSmileLeft','mouthSmileRight','mouthFrownLeft','mouthFrownRight',
  'mouthDimpleLeft','mouthDimpleRight','mouthStretchLeft','mouthStretchRight',
  'mouthRollLower','mouthRollUpper','mouthShrugLower','mouthShrugUpper',
  'mouthPressLeft','mouthPressRight','mouthLowerDownLeft','mouthLowerDownRight',
  'mouthUpperUpLeft','mouthUpperUpRight',
  'browDownLeft','browDownRight','browInnerUp','browOuterUpLeft','browOuterUpRight',
  'cheekPuff','cheekSquintLeft','cheekSquintRight',
  'noseSneerLeft','noseSneerRight',
  'tongueOut',
];

// ─── MIME / static server ────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.vrm': 'model/gltf-binary',
  '.vrma': 'model/gltf-binary', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
};

const server = createServer(async (req, res) => {
  const url  = req.url.split('?')[0].split('#')[0];
  const path = join(ROOT, decodeURIComponent(url === '/' ? '/index.html' : url));
  try {
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

await new Promise(r => server.listen(PORT, r));
await mkdir(OUT_DIR, { recursive: true });
console.log(`\n🌐 http://localhost:${PORT}   →   screenshots in ./screenshots/arkit/\n`);

// ─── Puppeteer ───────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  headless: false,
  protocolTimeout: 120_000,
  args: [
    '--no-sandbox',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});

const page = await browser.newPage();
await page.setViewport(VIEWPORT);
page.on('console',   m => console.log(`  [PAGE] ${m.type().toUpperCase()} ${m.text()}`));
page.on('pageerror', e => console.error('  [PAGE] ERROR', e.message));

const URL = `http://localhost:${PORT}/arkit_face.html`;
console.log('Opening arkit_face.html…');
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.bringToFront();

console.log('Waiting for faceReady (up to 120s)…');
await page.waitForFunction(() => window.faceReady === true, { timeout: 120_000 });
console.log('  ✓ Face ready\n');

// Fetch mechanism map from page
const MECHANISM = await page.evaluate(() => window.getShapeInfo());

// ─── Pixel diff helper ───────────────────────────────────────────────────────
async function diffScreenshots(bufA, bufB, outPath) {
  const imgA = PNG.sync.read(bufA);
  const imgB = PNG.sync.read(bufB);
  const { width, height } = imgA;
  const diff = new PNG({ width, height });
  const numDiff = pixelmatch(imgA.data, imgB.data, diff.data, width, height, {
    threshold: 0.0,   // count any pixel change at all
    includeAA: false,
  });
  const pct = (numDiff / (width * height)) * 100;
  await writeFile(outPath, PNG.sync.write(diff));
  return pct;
}

// ─── RAF helper ──────────────────────────────────────────────────────────────
const raf = () => page.evaluate(() => new Promise(r => requestAnimationFrame(r)));

// ─── Get face crop rect (computed once after load) ────────────────────────────
await page.evaluate(() => window.resetAll());
await raf();
const faceRect = await page.evaluate(() => window.getHeadScreenRect());
console.log(`Face crop rect: ${JSON.stringify(faceRect)}\n`);

// Clamp rect to viewport bounds
const clip = faceRect ? {
  x:      Math.max(0, faceRect.x),
  y:      Math.max(0, faceRect.y),
  width:  Math.min(VIEWPORT.width  - Math.max(0, faceRect.x), faceRect.width),
  height: Math.min(VIEWPORT.height - Math.max(0, faceRect.y), faceRect.height),
} : null;

if (!clip) console.warn('⚠ Could not compute face rect — using full viewport');

// ─── Test loop ───────────────────────────────────────────────────────────────
const results = [];

console.log(`Testing ${ARKIT_52.length} shapes…\n`);

for (const shape of ARKIT_52) {
  const mech = MECHANISM[shape] ?? 'unknown';

  // Reset to neutral
  await page.bringToFront();
  await page.evaluate(() => window.resetAll());
  await raf();
  const neutralBuf = await page.screenshot({ type: 'png', clip: clip ?? undefined });

  // Apply shape at full weight
  await page.evaluate((s) => window.setShape(s, 1.0), shape);
  await raf();
  const activeBuf = await page.screenshot({ type: 'png', clip: clip ?? undefined });

  // Save PNGs + diff
  const neutralPath = join(OUT_DIR, `${shape}_neutral.png`);
  const activePath  = join(OUT_DIR, `${shape}_active.png`);
  const diffPath    = join(OUT_DIR, `${shape}_diff.png`);

  await Promise.all([
    writeFile(neutralPath, neutralBuf),
    writeFile(activePath,  activeBuf),
  ]);
  const pct = await diffScreenshots(neutralBuf, activeBuf, diffPath);

  let status;
  if (mech === 'none') {
    status = 'SKIP';
  } else if (pct > DIFF_THRESHOLD) {
    status = 'PASS';
  } else {
    status = 'FAIL';
  }

  results.push({ shape, mech, pct, status });

  const icon = status === 'PASS' ? '✓' : status === 'SKIP' ? '–' : '✗';
  console.log(`  ${icon} ${shape.padEnd(22)} [${mech.padEnd(14)}]  ${pct.toFixed(2).padStart(6)}%  ${status}`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────
const passed  = results.filter(r => r.status === 'PASS').length;
const failed  = results.filter(r => r.status === 'FAIL').length;
const skipped = results.filter(r => r.status === 'SKIP').length;

console.log('\n' + '─'.repeat(65));
console.log(`RESULT: ${ARKIT_52.length} shapes tested`);
console.log(`  ✓ PASS: ${passed}`);
if (failed > 0) {
  console.log(`  ✗ FAIL: ${failed}`);
  const failList = results.filter(r => r.status === 'FAIL').map(r => r.shape);
  console.log(`    → ${failList.join(', ')}`);
}
console.log(`  – SKIP: ${skipped}  (tongueOut — no mesh)`);
console.log('─'.repeat(65));
console.log(`\n📁 Screenshots → ${OUT_DIR}\n`);
console.log('Tip: Review eye_bone diff PNGs to confirm look direction.');
console.log('     If inverted, flip MAX_EYE_PITCH / MAX_EYE_YAW signs in arkit-face-driver.js\n');

await browser.close();
server.close();
process.exit(failed > 0 ? 1 : 0);
