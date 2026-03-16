/**
 * sample_seed_debug.mjs — Puppeteer PNG screenshot comparison for Seed-san robot arm
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
const PORT      = 3478;
const OUT_DIR   = join(ROOT, 'screenshots_seed');

// Time points to sample — keep within a short walk cycle (~1s)
const SAMPLE_TIMES = [0.1, 0.3, 0.5];

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
console.log(`\n🌐 http://localhost:${PORT}   →   screenshots in ./screenshots_seed/\n`);

// ─── Puppeteer ──────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 120_000,
  args: [
    '--no-sandbox',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});

const VRMA        = 'vrma/02_01.vrma';
const MODEL       = 'models/Seed-san.vrm';
const AFRAME_URL  = `http://localhost:${PORT}/animate.html?model=${MODEL}#${VRMA}`;
const BABYLON_URL = `http://localhost:${PORT}/babvrm.html?model=${MODEL}#${VRMA}`;

const afPage  = await browser.newPage();
const babPage = await browser.newPage();
await afPage.setViewport(VIEWPORT);
await babPage.setViewport(VIEWPORT);

// Pipe browser console to Node
afPage.on('console',   m => console.log(`  [AF]  ${m.type().toUpperCase()} ${m.text()}`));
afPage.on('pageerror', e => console.error('  [AF]  PAGE ERROR', e.message));
babPage.on('console',  m => console.log(`  [BAB] ${m.type().toUpperCase()} ${m.text()}`));
babPage.on('pageerror',e => console.error('  [BAB] PAGE ERROR', e.message));

console.log('Opening A-Frame…');
await afPage.goto(AFRAME_URL, { waitUntil: 'domcontentloaded' });
await afPage.bringToFront();
await afPage.waitForFunction(() => window.animationReady === true, { timeout: 120_000 });
console.log('  ✓ A-Frame ready');

console.log('Opening Babylon.js…');
await babPage.goto(BABYLON_URL, { waitUntil: 'domcontentloaded' });
await babPage.bringToFront();
await babPage.waitForFunction(() => window.animationReady === true, { timeout: 120_000 });
console.log('  ✓ Babylon.js ready');

console.log();

const EXTRA_BONES = ['robo_shoulder.L', 'shoulder.L', 'robo_upper_arm.L', 'upper_arm.L', 'robo_forearm.L', 'forearm.L'];

for (const t of SAMPLE_TIMES) {
  const tag = `t${t.toFixed(2).replace('.', '_')}`;
  console.log(`📸 Sampling t=${t}s…`);

  await afPage.bringToFront();
  const afQuats = await afPage.evaluate((t, extra) => window.getBoneQuats(t, extra), t, EXTRA_BONES);
  const afBuf  = await afPage.screenshot({ type: 'png' });

  await babPage.bringToFront();
  const babQuats = await babPage.evaluate((t, extra) => window.getBoneQuats(t, extra), t, EXTRA_BONES);
  const babBuf = await babPage.screenshot({ type: 'png' });

  console.log(`  Timestamp: ${t}`);
  for (const bone of EXTRA_BONES) {
    const af  = afQuats  && afQuats[bone];
    const bab = babQuats && babQuats[bone];
    if (af)  console.log(`    [AF]  ${bone.padEnd(20)}: x=${af.x.toFixed(4)}, y=${af.y.toFixed(4)}, z=${af.z.toFixed(4)}, w=${af.w.toFixed(4)}`);
    if (bab) console.log(`    [BAB] ${bone.padEnd(20)}: x=${bab.x.toFixed(4)}, y=${bab.y.toFixed(4)}, z=${bab.z.toFixed(4)}, w=${bab.w.toFixed(4)}`);
  }

  const afPath   = join(OUT_DIR, `${tag}_aframe.png`);
  const babPath  = join(OUT_DIR, `${tag}_babylon.png`);
  await readFile(afPath).catch(() => {}); // dummy to check if exists? No, write it.
  
  const fs = await import('fs');
  fs.writeFileSync(afPath, afBuf);
  fs.writeFileSync(babPath, babBuf);
}

await browser.close();
server.close();
process.exit(0);
