/**
 * sample.mjs — Puppeteer PNG screenshot comparison
 *
 * Starts a local HTTP server, opens A-Frame and Babylon.js,
 * seeks both to the same timestamps, screenshots each frame,
 * and writes a pixel-diff image for each sample point.
 *
 * Usage:
 *   node sample.mjs
 *
 * Output:  ./screenshots/
 *   t0.25_aframe.png   t0.25_babylon.png   t0.25_diff.png
 *   t0.50_aframe.png   ...
 */

import puppeteer       from 'puppeteer';
import { createServer } from 'http';
import { readFile, mkdir } from 'fs/promises';
import { extname, join }  from 'path';
import { fileURLToPath }  from 'url';
import { dirname }        from 'path';
import { PNG }            from 'pngjs';
import pixelmatch         from 'pixelmatch';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;
const PORT      = 3477;
const OUT_DIR   = join(ROOT, 'screenshots');

// Time points to sample — keep within a short walk cycle (~1s)
const SAMPLE_TIMES = [0.1, 0.2, 0.4, 0.6, 0.8];

const VIEWPORT = { width: 640, height: 480 };

// ─── MIME / static server ───────────────────────────────────────────────────
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
console.log(`\n🌐 http://localhost:${PORT}   →   screenshots in ./screenshots/\n`);

// ─── Puppeteer ──────────────────────────────────────────────────────────────
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

const VRMA        = 'vrma/02_01.vrma';
const AFRAME_URL  = `http://localhost:${PORT}/animate.html?model=models/AIAN/AIAN_F_1_Casual_CLEANED.vrm#${VRMA}`;
const BABYLON_URL = `http://localhost:${PORT}/babvrm.html#${VRMA}`;

const afPage  = await browser.newPage();
const babPage = await browser.newPage();
await afPage.setViewport(VIEWPORT);
await babPage.setViewport(VIEWPORT);

// Pipe browser console to Node
afPage.on('console',   m => console.log(`  [AF]  ${m.type().toUpperCase()} ${m.text()}`));
afPage.on('pageerror', e => console.error('  [AF]  PAGE ERROR', e.message));
babPage.on('console',  m => console.log(`  [BAB] ${m.type().toUpperCase()} ${m.text()}`));
babPage.on('pageerror',e => console.error('  [BAB] PAGE ERROR', e.message));

// Load A-Frame first and bring it to front so its render loop isn't throttled
console.log('Opening A-Frame…');
await afPage.goto(AFRAME_URL, { waitUntil: 'domcontentloaded' });
await afPage.bringToFront();

// ─── Wait for animations ────────────────────────────────────────────────────
console.log('Waiting for A-Frame to load (up to 120s)…');
await afPage.waitForFunction(() => window.animationReady === true, { timeout: 120_000 });
console.log('  ✓ A-Frame ready');

console.log('Opening Babylon.js…');
await babPage.goto(BABYLON_URL, { waitUntil: 'domcontentloaded' });
await babPage.bringToFront();
console.log('Waiting for Babylon.js to load (up to 120s)…');
await babPage.waitForFunction(() => window.animationReady === true, { timeout: 120_000 });
console.log('  ✓ Babylon.js ready');

// (Babylon UI is hidden by default in babvrm.html CSS)

console.log();

// ─── Brief pause so animations are visibly running before we sample ──────────
console.log('⏳ Waiting 3s for animations to settle…');
await new Promise(r => setTimeout(r, 3000));

// ─── Pixel diff helper ──────────────────────────────────────────────────────
async function diffScreenshots(afBuf, babBuf, outPath) {
  const af  = PNG.sync.read(afBuf);
  const bab = PNG.sync.read(babBuf);

  const { width, height } = af;
  const diff = new PNG({ width, height });

  const numDiff = pixelmatch(af.data, bab.data, diff.data, width, height, {
    threshold: 0.1,
    includeAA: false,
  });

  const pct = ((numDiff / (width * height)) * 100).toFixed(1);
  const buf = PNG.sync.write(diff);
  await import('fs').then(fs => fs.promises.writeFile(outPath, buf));
  return { numDiff, pct };
}

// ─── Sample loop ─────────────────────────────────────────────────────────────
let loggedQuats = false; // only log bone quats for first sample
for (const t of SAMPLE_TIMES) {
  const tag = `t${t.toFixed(2).replace('.', '_')}`;
  console.log(`📸 Sampling t=${t}s…`);

  // Bring each page to front before seeking/rendering to avoid background throttling
  await afPage.bringToFront();
  const afQuats = await afPage.evaluate(t => window.getBoneQuats(t), t);
  await afPage.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  const afBuf  = await afPage.screenshot({ type: 'png' });

  await babPage.bringToFront();
  const babQuats = await babPage.evaluate(t => window.getBoneQuats(t), t);
  await babPage.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  const babBuf = await babPage.screenshot({ type: 'png' });

  // Log bone quats for the first sample only
  if (!loggedQuats) {
    loggedQuats = true;
    const KEY_BONES = ['leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg', 'hips', 'spine'];
    for (const bone of KEY_BONES) {
      const af  = afQuats  && afQuats[bone];
      const bab = babQuats && babQuats[bone];
      const afStr  = af  ? `x=${af.x}  y=${af.y}  z=${af.z}  w=${af.w}` : 'N/A';
      const babStr = bab ? `x=${bab.x} y=${bab.y} z=${bab.z} w=${bab.w}` : 'N/A';
      console.log(`  ${bone.padEnd(18)} AF:  ${afStr}`);
      console.log(`  ${''.padEnd(18)} BAB: ${babStr}`);
    }
  }

  const afPath   = join(OUT_DIR, `${tag}_aframe.png`);
  const babPath  = join(OUT_DIR, `${tag}_babylon.png`);
  const diffPath = join(OUT_DIR, `${tag}_diff.png`);

  await Promise.all([
    import('fs').then(fs => fs.promises.writeFile(afPath,  afBuf)),
    import('fs').then(fs => fs.promises.writeFile(babPath, babBuf)),
  ]);

  const { pct } = await diffScreenshots(afBuf, babBuf, diffPath);
  console.log(`   ${tag}_aframe.png  |  ${tag}_babylon.png  |  diff: ${pct}% pixels differ`);
}

console.log(`\n✅ Done — screenshots in ${OUT_DIR}`);
await browser.close();
server.close();
process.exit(0);
