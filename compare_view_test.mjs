/**
 * compare_view_test.mjs
 *
 * Tests that A-Frame (three-vrm) and Babylon.js show the same starting camera
 * viewpoint for the same VRM model. Both pages are loaded, setCameraOrbit is
 * called with identical parameters, and a screenshot crop of the avatar area
 * is pixel-compared between the two engines.
 *
 * Pass criteria: cropped diff < DIFF_THRESHOLD %
 *
 * Usage:  node compare_view_test.mjs
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
const PORT      = 3490;
const OUT_DIR   = join(ROOT, 'screenshots', 'view_test');

// Crop region — centre of the 640×480 frame, avatar body area
const CROP = { x: 160, y: 40, w: 320, h: 400 };

// Pass if cropped diff is below this percentage
const DIFF_THRESHOLD = 12; // % — engines differ in bg colour / lighting

const MODEL = 'models/Seed-san.vrm';
const VRMA  = 'vrma/02_01.vrma';

// Canonical starting orbit: front view, slight elevation, 5 units
const CAM = { theta: 0, phi: 0.12, radius: 5, targetY: 0.9 };

const VIEWPORT = { width: 640, height: 480 };

// ─── Static server ────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.vrm': 'model/gltf-binary',
  '.vrma': 'model/gltf-binary', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg',
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
console.log(`\n🌐 http://localhost:${PORT}   →   screenshots in ${OUT_DIR}\n`);

// ─── Puppeteer ────────────────────────────────────────────────────────────────
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

const AFRAME_URL  = `http://localhost:${PORT}/animate.html?model=${MODEL}#${VRMA}`;
const BABYLON_URL = `http://localhost:${PORT}/babvrm.html?model=${MODEL}#${VRMA}`;

const afPage  = await browser.newPage();
const babPage = await browser.newPage();
await afPage.setViewport(VIEWPORT);
await babPage.setViewport(VIEWPORT);

afPage.on('console',   m => console.log(`  [AF]  ${m.text()}`));
afPage.on('pageerror', e => console.error('  [AF]  ERROR', e.message));
babPage.on('console',  m => console.log(`  [BAB] ${m.text()}`));
babPage.on('pageerror',e => console.error('  [BAB] ERROR', e.message));

console.log('Loading A-Frame…');
await afPage.goto(AFRAME_URL, { waitUntil: 'domcontentloaded' });
await afPage.bringToFront();
await afPage.waitForFunction(() => window.animationReady === true, { timeout: 120_000 });
console.log('  ✓ A-Frame ready');

console.log('Loading Babylon.js…');
await babPage.goto(BABYLON_URL, { waitUntil: 'domcontentloaded' });
await babPage.bringToFront();
await babPage.waitForFunction(() => window.animationReady === true, { timeout: 120_000 });
console.log('  ✓ Babylon ready');

// ─── Apply identical camera orbit to both ────────────────────────────────────
const { theta, phi, radius, targetY } = CAM;
console.log(`\nSetting camera orbit: theta=${theta} phi=${phi} radius=${radius} targetY=${targetY}`);

await afPage.bringToFront();
const afCamResult = await afPage.evaluate((t, p, r, ty) => {
  if (typeof window.setCameraOrbit !== 'function') return 'setCameraOrbit missing';
  window.setCameraOrbit(t, p, r, ty);
  return 'ok';
}, theta, phi, radius, targetY);
console.log(`  A-Frame setCameraOrbit: ${afCamResult}`);

// Report back actual camera state for diagnostics
const afCamState = await afPage.evaluate(() =>
  typeof window.getCameraOrbit === 'function' ? window.getCameraOrbit() : null
);
console.log('  A-Frame camera state:', JSON.stringify(afCamState));

await babPage.bringToFront();
const babCamResult = await babPage.evaluate((t, p, r, ty) => {
  if (typeof window.setCameraOrbit !== 'function') return 'setCameraOrbit missing';
  window.setCameraOrbit(t, p, r, ty);
  return 'ok';
}, theta, phi, radius, targetY);
console.log(`  Babylon setCameraOrbit: ${babCamResult}`);

const babCamState = await babPage.evaluate(() =>
  typeof window.getCameraOrbit === 'function' ? window.getCameraOrbit() : null
);
console.log('  Babylon camera state:', JSON.stringify(babCamState));

// Diagnostics: actual world camera state after setCameraOrbit
await afPage.bringToFront();
const afDiag = await afPage.evaluate(() => {
  const THREE = window.AFRAME?.THREE;
  const sceneEl = document.querySelector('a-scene');
  const cam3 = sceneEl?.camera;
  if (!cam3 || !THREE) return 'no camera';
  const wp = new THREE.Vector3(); cam3.getWorldPosition(wp);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam3.getWorldQuaternion(new THREE.Quaternion()));
  const rig = document.getElementById('cameraRig');
  return {
    worldPos: { x: +wp.x.toFixed(3), y: +wp.y.toFixed(3), z: +wp.z.toFixed(3) },
    forward:  { x: +fwd.x.toFixed(3), y: +fwd.y.toFixed(3), z: +fwd.z.toFixed(3) },
    rigPos:   rig ? { x: +rig.object3D.position.x.toFixed(3), y: +rig.object3D.position.y.toFixed(3), z: +rig.object3D.position.z.toFixed(3) } : null,
    camLocalPos: { x: +cam3.position.x.toFixed(3), y: +cam3.position.y.toFixed(3), z: +cam3.position.z.toFixed(3) },
    lookControlsEnabled: document.querySelector('[camera]')?.components['look-controls']?.data?.enabled ?? 'removed',
    camFOV: cam3.fov,
    isCamera: cam3.isCamera,
  };
});
console.log('  A-Frame world camera:', JSON.stringify(afDiag));

// Wait two frames for cameras to settle
await afPage.bringToFront();
await afPage.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
await babPage.bringToFront();
await babPage.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

// ─── Screenshot ───────────────────────────────────────────────────────────────
await afPage.bringToFront();
const afBuf  = await afPage.screenshot({ type: 'png' });
await babPage.bringToFront();
const babBuf = await babPage.screenshot({ type: 'png' });

await writeFile(join(OUT_DIR, 'aframe.png'),  afBuf);
await writeFile(join(OUT_DIR, 'babylon.png'), babBuf);

// ─── Crop & diff ──────────────────────────────────────────────────────────────
function cropPNG(buf, { x, y, w, h }) {
  const src = PNG.sync.read(buf);
  const dst = new PNG({ width: w, height: h });
  for (let row = 0; row < h; row++) {
    const srcOff = ((y + row) * src.width + x) * 4;
    const dstOff = row * w * 4;
    src.data.copy(dst.data, dstOff, srcOff, srcOff + w * 4);
  }
  return dst;
}

const afCrop  = cropPNG(afBuf,  CROP);
const babCrop = cropPNG(babBuf, CROP);
const diff    = new PNG({ width: CROP.w, height: CROP.h });

const numDiff = pixelmatch(afCrop.data, babCrop.data, diff.data, CROP.w, CROP.h, {
  threshold: 0.1,
  includeAA: false,
});
const pct = ((numDiff / (CROP.w * CROP.h)) * 100).toFixed(1);

await writeFile(join(OUT_DIR, 'aframe_crop.png'),  PNG.sync.write(afCrop));
await writeFile(join(OUT_DIR, 'babylon_crop.png'), PNG.sync.write(babCrop));
await writeFile(join(OUT_DIR, 'diff_crop.png'),    PNG.sync.write(diff));

// ─── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`Crop region: x=${CROP.x} y=${CROP.y} ${CROP.w}×${CROP.h}`);
console.log(`Diff: ${pct}% pixels differ   (threshold: ${DIFF_THRESHOLD}%)`);
if (parseFloat(pct) <= DIFF_THRESHOLD) {
  console.log(`✅ PASS — cameras are aligned`);
} else {
  console.log(`❌ FAIL — viewpoints do not match`);
}
console.log(`${'═'.repeat(60)}`);
console.log(`\nScreenshots: ${OUT_DIR}`);

await browser.close();
server.close();
process.exit(parseFloat(pct) <= DIFF_THRESHOLD ? 0 : 1);
