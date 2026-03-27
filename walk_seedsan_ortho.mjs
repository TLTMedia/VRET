/**
 * walk_seedsan_ortho.mjs
 * Loads animate.html (three-vrm reference) AND babvrm.html (Babylon) with Seed-san + 02_01.vrma,
 * seeks both to the same time, captures 4-orthogonal-view contact sheets for each,
 * and prints arm/shoulder bone quaternion comparison.
 *
 * Usage: node walk_seedsan_ortho.mjs
 * Output: screenshots/seedsan_ortho/  — {af,bab}_{front,back,left,right}.png + composite PNGs
 */
import puppeteer from 'puppeteer';
import { createServer } from 'http';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = 3497;
const OUT  = join(ROOT, 'screenshots/seedsan_ortho');
const W = 480, H = 360;
const SAMPLE_T = 0.5; // seconds into walk cycle

const MIME = {
  '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
  '.json':'application/json','.vrm':'model/gltf-binary',
  '.vrma':'model/gltf-binary','.glb':'model/gltf-binary',
  '.png':'image/png','.wav':'audio/wav','.aiff':'audio/aiff',
};
const server = createServer(async (req, res) => {
  const url  = req.url.split('?')[0].split('#')[0];
  const path = join(ROOT, decodeURIComponent(url === '/' ? '/index.html' : url));
  try { const d = await readFile(path); res.writeHead(200,{'Content-Type':MIME[extname(path)]??'application/octet-stream'}); res.end(d); }
  catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(r => server.listen(PORT, r));
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: false, protocolTimeout: 120_000,
  args: ['--no-sandbox','--disable-background-timer-throttling',
         '--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],
});

const MODEL = 'models/Seed-san.vrm';
const VRMA  = 'vrma/02_01.vrma';

// ── Helpers ──────────────────────────────────────────────────────────────────
const VIEWS = [
  { label: 'front', alpha: -Math.PI / 2, beta: Math.PI / 2.2 },
  { label: 'back',  alpha:  Math.PI / 2, beta: Math.PI / 2.2 },
  { label: 'left',  alpha:  Math.PI,     beta: Math.PI / 2.2 },
  { label: 'right', alpha:  0,           beta: Math.PI / 2.2 },
];
const RADIUS = 2.5, TARGET_Y = 0.9;

async function makeComposite(panels, outPath) {
  const out = new PNG({ width: W * 2, height: H * 2 });
  out.data.fill(0);
  for (let pi = 0; pi < 4; pi++) {
    const col = pi % 2, row = Math.floor(pi / 2);
    const src = panels[pi];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const si = (y * src.width + x) * 4;
        const di = ((row * H + y) * (W * 2) + (col * W + x)) * 4;
        out.data[di]   = src.data[si];
        out.data[di+1] = src.data[si+1];
        out.data[di+2] = src.data[si+2];
        out.data[di+3] = src.data[si+3];
      }
  }
  await writeFile(outPath, PNG.sync.write(out));
}

// ── A-Frame / three-vrm page ──────────────────────────────────────────────
console.log('\n── Loading animate.html (three-vrm reference)…');
const afPage = await browser.newPage();
await afPage.setViewport({ width: W, height: H });
afPage.on('console', m => { if (m.type() === 'error') console.log(`  [AF ERR] ${m.text()}`); });
afPage.on('pageerror', e => console.error(`  [AF PAGE ERR] ${e.message}`));

await afPage.goto(`http://localhost:${PORT}/animate.html?model=${MODEL}#${VRMA}`, { waitUntil: 'domcontentloaded' });
await afPage.bringToFront();
await afPage.waitForFunction(() => window.animationReady === true, { timeout: 60_000 });
console.log('  ✓ three-vrm ready');

// Seek to sample time and get bone quats
const afQuats = await afPage.evaluate(t => window.getBoneQuats(t), SAMPLE_T);
console.log(`\nthree-vrm bone quats at t=${SAMPLE_T}s:`);
const KEY_BONES = ['leftShoulder','leftUpperArm','rightShoulder','rightUpperArm','leftUpperLeg','rightUpperLeg','hips'];
for (const b of KEY_BONES) {
  const q = afQuats?.[b];
  if (q) console.log(`  ${b.padEnd(18)} x=${q.x}  y=${q.y}  z=${q.z}  w=${q.w}`);
  else   console.log(`  ${b.padEnd(18)} (null)`);
}

// A-Frame doesn't have ArcRotateCamera — use setCameraOrbit API for the 4 views
// theta=0 = front (avatar faces -Z in A-Frame, camera on +Z? per setCameraOrbit comment it's -Z side)
// Let's capture just a front view for now and compare bone quats
await afPage.evaluate(() => { if (window.setCameraOrbit) window.setCameraOrbit(0, 0.12, 2.5, 0.9); });
await afPage.evaluate(() => new Promise(r => setTimeout(r, 200)));
const afBuf = await afPage.screenshot({ type: 'png' });
await writeFile(join(OUT, 'af_front.png'), afBuf);
console.log('\n  ✓ A-Frame front screenshot');

// ── Babylon.js page ───────────────────────────────────────────────────────
console.log('\n── Loading babvrm.html (Babylon)…');
const babPage = await browser.newPage();
await babPage.setViewport({ width: W, height: H });
babPage.on('console', m => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('unexists') && !m.text().includes('BJS')) console.log(`  [BAB ERR] ${m.text()}`); });
babPage.on('pageerror', e => console.error(`  [BAB PAGE ERR] ${e.message}`));

await babPage.goto(`http://localhost:${PORT}/babvrm.html?model=${MODEL}#${VRMA}`, { waitUntil: 'domcontentloaded' });
await babPage.bringToFront();
await babPage.waitForFunction(() => window.animationReady === true, { timeout: 60_000 });
console.log('  ✓ Babylon ready');

// Get Babylon bone quats at same time
const babQuats = await babPage.evaluate(t => {
  if (window.getBoneQuats) return window.getBoneQuats(t);
  // fallback: query scene directly
  const scene  = BABYLON.Engine.Instances[0].scenes[0];
  const vrmMgr = scene.metadata?.vrmManagers?.[0];
  const getBone = n => vrmMgr?.humanoidBone?.[n] ?? vrmMgr?.humanoidBone?.nodeMap?.[n];
  const bones = ['hips','leftShoulder','leftUpperArm','rightShoulder','rightUpperArm','leftUpperLeg','rightUpperLeg'];
  const result = {};
  for (const name of bones) {
    const bone = getBone(name);
    if (!bone?.rotationQuaternion) continue;
    const q = bone.rotationQuaternion;
    result[name] = { x: +q.x.toFixed(4), y: +q.y.toFixed(4), z: +q.z.toFixed(4), w: +q.w.toFixed(4) };
  }
  return result;
}, SAMPLE_T);

console.log(`\nBabylon bone quats at t=${SAMPLE_T}s:`);
for (const b of KEY_BONES) {
  const q = babQuats?.[b];
  if (q) console.log(`  ${b.padEnd(18)} x=${q.x}  y=${q.y}  z=${q.z}  w=${q.w}`);
  else   console.log(`  ${b.padEnd(18)} (null)`);
}

// ── Bone quat comparison ──────────────────────────────────────────────────
console.log(`\n── Comparison (dot product, should be ≥ 0.95 for good match):`);
for (const b of KEY_BONES) {
  const af = afQuats?.[b], bab = babQuats?.[b];
  if (!af || !bab) { console.log(`  ${b.padEnd(18)} (one side missing)`); continue; }
  const dot = Math.abs(af.x*bab.x + af.y*bab.y + af.z*bab.z + af.w*bab.w);
  const ok  = dot >= 0.95 ? '✓' : '✗';
  console.log(`  ${b.padEnd(18)} dot=${dot.toFixed(4)}  ${ok}`);
}

// ── Babylon 4-panel ortho ────────────────────────────────────────────────
console.log('\n── Capturing Babylon 4-view ortho…');
await babPage.evaluate(() => {
  const ui = document.querySelector('#ui') || document.querySelector('#controls');
  if (ui) ui.style.display = 'none';
});

// Get model position
const babPos = await babPage.evaluate(() => {
  const scene  = BABYLON.Engine.Instances[0].scenes[0];
  const vrmMgr = scene.metadata?.vrmManagers?.[0];
  const getBone = n => vrmMgr?.humanoidBone?.[n] ?? vrmMgr?.humanoidBone?.nodeMap?.[n];
  const hips = getBone('hips');
  if (!hips) return { x:0, z:0 };
  const abs = hips.getAbsolutePosition();
  return { x: abs.x, z: abs.z };
});

const babPanels = [];
for (const v of VIEWS) {
  await babPage.evaluate(({ alpha, beta, radius, targetY, mx, mz }) => {
    const scene = BABYLON.Engine.Instances[0].scenes[0];
    const cam   = scene.cameras[0];
    if (!cam) return;
    cam.alpha = alpha; cam.beta = beta; cam.radius = radius;
    cam.target = new BABYLON.Vector3(mx, targetY, mz);
    scene.render();
  }, { ...v, radius: RADIUS, targetY: TARGET_Y, mx: babPos.x, mz: babPos.z });
  await babPage.evaluate(() => new Promise(r => requestAnimationFrame(() => { BABYLON.Engine.Instances[0].scenes[0].render(); r(); })));
  await babPage.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  const buf = await babPage.screenshot({ type: 'png' });
  await writeFile(join(OUT, `bab_${v.label}.png`), buf);
  babPanels.push(PNG.sync.read(buf));
  console.log(`  ✓ Babylon ${v.label}`);
}
await makeComposite(babPanels, join(OUT, 'bab_ortho.png'));

console.log('\nLayout: [FRONT | BACK] / [LEFT | RIGHT]');
console.log('Screenshots → screenshots/seedsan_ortho/');
console.log('  af_front.png   — A-Frame/three-vrm front view');
console.log('  bab_ortho.png  — Babylon 4-panel composite');

await browser.close(); server.close(); process.exit(0);
