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

// Time points to sample (seconds into the animation)
const SAMPLE_TIMES = [0.25, 0.5, 1.0, 1.5, 2.0];

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
const browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox'] });

const AFRAME_URL  = `http://localhost:${PORT}/animate.html?model=models/AIAN/AIAN_F_1_Casual_CLEANED.vrm#vrma/13_29.vrma`;
const BABYLON_URL = `http://localhost:${PORT}/babvrm.html#vrma/13_29.vrma`;

const [afPage, babPage] = await Promise.all([
  browser.newPage(),
  browser.newPage(),
]);

await Promise.all([
  afPage.setViewport(VIEWPORT),
  babPage.setViewport(VIEWPORT),
]);

console.log('Opening pages…');
await Promise.all([
  afPage.goto(AFRAME_URL,  { waitUntil: 'domcontentloaded' }),
  babPage.goto(BABYLON_URL, { waitUntil: 'domcontentloaded' }),
]);

// ─── Wait for animations ────────────────────────────────────────────────────
console.log('Waiting for animations to load (up to 60s)…');
await Promise.all([
  afPage.waitForFunction(() => window.animationReady === true, { timeout: 60_000 })
        .then(() => console.log('  ✓ A-Frame ready')),
  babPage.waitForFunction(() => window.animationReady === true, { timeout: 60_000 })
         .then(() => console.log('  ✓ Babylon.js ready')),
]);
console.log();

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
for (const t of SAMPLE_TIMES) {
  const tag = `t${t.toFixed(2).replace('.', '_')}`;
  console.log(`📸 Sampling t=${t}s…`);

  // Seek both to time t
  await Promise.all([
    afPage.evaluate( t => window.getBoneQuats(t), t),
    babPage.evaluate(t => window.getBoneQuats(t), t),
  ]);

  // Extra frame to let WebGL flush
  await Promise.all([
    afPage.evaluate( () => new Promise(r => requestAnimationFrame(r))),
    babPage.evaluate(() => new Promise(r => requestAnimationFrame(r))),
  ]);

  // Screenshot
  const [afBuf, babBuf] = await Promise.all([
    afPage.screenshot({ type: 'png' }),
    babPage.screenshot({ type: 'png' }),
  ]);

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
console.log('Browser stays open for inspection. Ctrl+C to quit.\n');

process.on('SIGINT', async () => {
  await browser.close();
  server.close();
  process.exit(0);
});
