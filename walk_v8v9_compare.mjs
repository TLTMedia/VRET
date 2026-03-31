/**
 * walk_v8v9_compare.mjs
 * Side-by-side bone targeting comparison: babvrm.html (v8/AnimatorAvatar) vs walk_and_talk_v9.html (v9/manual)
 *
 * Layout:
 *   [ v8 FRONT | v9 FRONT ]
 *   [ v8 SIDE  | v9 SIDE  ]
 *
 * Usage: node walk_v8v9_compare.mjs
 * Output: screenshots/v8v9/v8v9_compare.png
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
const PORT = 3498;
const OUT  = join(ROOT, 'screenshots/v8v9');
const W = 480, H = 360;
const PLAY_MS = 1000; // ms to play before pausing

const MODEL = 'models/AIAN/AIAN_F_1_Casual.vrm';
const VRMA  = 'vrma/02_01.vrma';

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

const NOISE = ['Undefined','unexists','skip bone','BJS -','[ARKitFaceDriver]',
               'morphMap','MORPH','TEETH','jawOpen','mouthFunnel','mouthClose',
               'jawLeft','jawRight','jawForward','console.groupEnd',
               'leftEye bone','rightEye bone','404','getTotalVertices'];

const browser = await puppeteer.launch({
  headless: false, protocolTimeout: 120_000,
  args: ['--no-sandbox','--disable-background-timer-throttling',
         '--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],
});

// ── Load both pages ───────────────────────────────────────────────────────
async function openPage(url, label) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  page.on('console', m => { if (!NOISE.some(s => m.text().includes(s))) console.log(`  [${label}] ${m.text()}`); });
  page.on('pageerror', e => console.error(`  [${label} ERR] ${e.message}`));
  await page.goto(`http://localhost:${PORT}/${url}`, { waitUntil: 'domcontentloaded' });
  return page;
}

console.log('\nLoading v8 (babvrm.html)…');
const p8 = await openPage(`babvrm.html?model=${MODEL}#${VRMA}`, 'v8');
console.log('Loading v9 (walk_and_talk_v9.html)…');
const p9 = await openPage('walk_and_talk_v9.html', 'v9');

// Wait for both ready — bring each to front while waiting to avoid throttle
console.log('Waiting for ready…');
await p8.bringToFront();
await p8.waitForFunction(() => window.animationReady === true, { timeout: 90_000 });
console.log('  v8 ready');

await p9.bringToFront();
await p9.waitForFunction(() => {
  const s = document.getElementById('status');
  return s && (s.textContent.includes('Ready') || s.textContent.includes('Error'));
}, { timeout: 90_000 });
const v9status = await p9.evaluate(() => document.getElementById('status')?.textContent ?? '');
if (v9status.includes('Error')) { console.error('v9 error:', v9status); await browser.close(); server.close(); process.exit(1); }
console.log('  v9 ready');

// ── Play each page in foreground sequentially for the same duration ──────
// Babylon's animation loop requires the page to be in front (render loop active).
// We play each for PLAY_MS ms while it's the active tab, then pause.
async function playThenPause(page, label) {
  await page.bringToFront();
  await page.evaluate(() => {
    const b = document.getElementById('playBtn');
    if (b && !b.disabled) b.click();
  });
  await new Promise(r => setTimeout(r, PLAY_MS));
  // Force a render so animations flush to bones
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => { BABYLON?.Engine?.Instances?.[0]?.scenes?.[0]?.render(); r(); })));
  await page.evaluate(() => {
    const b = document.getElementById('playBtn');
    if (b) b.click(); // pause/stop
  });
  await page.evaluate(() => { const u = document.getElementById('ui'); if (u) u.style.display='none'; });
  console.log(`  ${label} played ${PLAY_MS}ms, paused`);
}

console.log(`\nPlaying v8 in foreground for ${PLAY_MS}ms…`);
await playThenPause(p8, 'v8');
console.log(`Playing v9 in foreground for ${PLAY_MS}ms…`);
await playThenPause(p9, 'v9');
console.log('');

// ── Print bone quats for comparison ─────────────────────────────────────
const KEY_BONES = ['leftShoulder','leftUpperArm','rightUpperArm','leftUpperLeg','rightUpperLeg'];

async function getBabylonBoneQuats(page) {
  return page.evaluate(() => {
    const scene  = BABYLON.Engine.Instances[0]?.scenes[0];
    const vrmMgr = scene?.metadata?.vrmManagers?.[0];
    const getBone = n => vrmMgr?.humanoidBone?.[n] ?? vrmMgr?.humanoidBone?.nodeMap?.[n];
    const names = ['leftShoulder','leftUpperArm','rightUpperArm','leftUpperLeg','rightUpperLeg','hips'];
    const result = {};
    for (const name of names) {
      const bone = getBone(name);
      if (!bone?.rotationQuaternion) continue;
      const q = bone.rotationQuaternion;
      result[name] = { x: +q.x.toFixed(4), y: +q.y.toFixed(4), z: +q.z.toFixed(4), w: +q.w.toFixed(4) };
    }
    return result;
  });
}

const [q8, q9] = await Promise.all([getBabylonBoneQuats(p8), getBabylonBoneQuats(p9)]);
console.log('── Bone quats at paused frame:');
console.log('  Bone               v8 (AnimatorAvatar)                    v9 (manual)');
for (const b of KEY_BONES) {
  const a = q8?.[b], c = q9?.[b];
  const as = a ? `x=${a.x}  y=${a.y}  z=${a.z}  w=${a.w}` : '(null)       ';
  const cs = c ? `x=${c.x}  y=${c.y}  z=${c.z}  w=${c.w}` : '(null)       ';
  const dot = (a && c) ? Math.abs(a.x*c.x + a.y*c.y + a.z*c.z + a.w*c.w).toFixed(4) : 'N/A';
  console.log(`  ${b.padEnd(18)} ${as.padEnd(40)} ${cs}  dot=${dot}`);
}

// ── Capture orthogonal views ─────────────────────────────────────────────
const VIEWS = {
  front: { alpha: -Math.PI / 2, beta: Math.PI / 2.2 },
  side:  { alpha:  Math.PI,     beta: Math.PI / 2.2 },  // avatar's left side
};
const RADIUS = 2.5, TARGET_Y = 0.9;

async function captureView(page, viewName) {
  const pos = await page.evaluate(() => {
    const scene  = BABYLON.Engine.Instances[0]?.scenes[0];
    const vrmMgr = scene?.metadata?.vrmManagers?.[0];
    const getBone = n => vrmMgr?.humanoidBone?.[n] ?? vrmMgr?.humanoidBone?.nodeMap?.[n];
    const hips = getBone('hips');
    if (!hips) return { x:0, z:0 };
    const a = hips.getAbsolutePosition();
    return { x: a.x, z: a.z };
  });
  const v = VIEWS[viewName];
  await page.evaluate(({ alpha, beta, radius, targetY, mx, mz }) => {
    const scene = BABYLON.Engine.Instances[0].scenes[0];
    const cam   = scene.cameras[0];
    if (!cam) return;
    cam.alpha = alpha; cam.beta = beta; cam.radius = radius;
    cam.target = new BABYLON.Vector3(mx, targetY, mz);
    scene.render();
  }, { ...v, radius: RADIUS, targetY: TARGET_Y, mx: pos.x, mz: pos.z });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => { BABYLON.Engine.Instances[0].scenes[0].render(); r(); })));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  return page.screenshot({ type: 'png' });
}

console.log('\n── Capturing views…');
await p8.bringToFront();
const buf8f = await captureView(p8, 'front'); await writeFile(join(OUT,'v8_front.png'), buf8f); console.log('  v8 front');
const buf8s = await captureView(p8, 'side');  await writeFile(join(OUT,'v8_side.png'),  buf8s); console.log('  v8 side');

await p9.bringToFront();
const buf9f = await captureView(p9, 'front'); await writeFile(join(OUT,'v9_front.png'), buf9f); console.log('  v9 front');
const buf9s = await captureView(p9, 'side');  await writeFile(join(OUT,'v9_side.png'),  buf9s); console.log('  v9 side');

// ── Composite 2×2: [v8-front | v9-front] / [v8-side | v9-side] ─────────
const panels = [
  PNG.sync.read(buf8f), PNG.sync.read(buf9f),
  PNG.sync.read(buf8s), PNG.sync.read(buf9s),
];
const composite = new PNG({ width: W * 2, height: H * 2 });
composite.data.fill(0);
for (let pi = 0; pi < 4; pi++) {
  const col = pi % 2, row = Math.floor(pi / 2);
  const src = panels[pi];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const si = (y * src.width + x) * 4;
      const di = ((row * H + y) * (W * 2) + (col * W + x)) * 4;
      composite.data[di]   = src.data[si];
      composite.data[di+1] = src.data[si+1];
      composite.data[di+2] = src.data[si+2];
      composite.data[di+3] = src.data[si+3];
    }
}
const outPath = join(OUT, 'v8v9_compare.png');
await writeFile(outPath, PNG.sync.write(composite));
console.log('\nLayout: [v8-FRONT | v9-FRONT] / [v8-SIDE | v9-SIDE]');
console.log(`Composite → screenshots/v8v9/v8v9_compare.png`);

await browser.close(); server.close(); process.exit(0);
