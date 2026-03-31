/**
 * walk_ortho.mjs — 4-orthogonal-view bone targeting diagnostic for walk_and_talk_v9.html
 *
 * Loads v9, plays 2s, pauses, then captures front/back/left/right camera views.
 * Composites all four into a single 2×2 PNG contact sheet.
 *
 * Layout:
 *   [ FRONT | BACK  ]
 *   [ LEFT  | RIGHT ]
 *
 * Usage: node walk_ortho.mjs
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
const PORT = 3496;
const OUT  = join(ROOT, 'screenshots/walk_ortho');

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

// Panel dimensions — 2×2 composite = 1280×720
const W = 640, H = 360;

const browser = await puppeteer.launch({
  headless: false, protocolTimeout: 120_000,
  args: ['--no-sandbox','--disable-background-timer-throttling',
         '--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],
});

const NOISE = ['Undefined','unexists','skip bone','BJS -','[ARKitFaceDriver]',
               'morphMap','MORPH','TEETH','jawOpen','mouthFunnel','mouthClose',
               'jawLeft','jawRight','jawForward','console.groupEnd',
               'leftEye bone','rightEye bone'];

const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
page.on('console', m => { if (!NOISE.some(s => m.text().includes(s))) console.log(`  ${m.text()}`); });
page.on('pageerror', e => console.error(`  [ERR] ${e.message}`));

const TARGET_PAGE = process.argv[2] ?? 'walk_and_talk_v9.html';
console.log(`\nLoading ${TARGET_PAGE}…`);
await page.goto(`http://localhost:${PORT}/${TARGET_PAGE}`, { waitUntil: 'domcontentloaded' });
await page.bringToFront();
await page.waitForFunction(() => {
  const s = document.getElementById('status');
  return s && (s.textContent.includes('Ready') || s.textContent.includes('Error'));
}, { timeout: 60_000 });

const statusText = await page.evaluate(() => document.getElementById('status')?.textContent ?? '');
console.log(`Status: ${statusText}`);
if (statusText.includes('Error')) { console.error('Page errored — aborting'); await browser.close(); server.close(); process.exit(1); }

// ── Capture pre-animation bone rest quaternions ──────────────────────────────
const boneRestQs = await page.evaluate(() => {
  const scene  = BABYLON.Engine.Instances[0].scenes[0];
  const vrmMgr = scene.metadata?.vrmManagers?.[0];
  const getBone = n => vrmMgr?.humanoidBone?.[n] ?? vrmMgr?.humanoidBone?.nodeMap?.[n];
  const names = ['hips','spine','chest','upperChest','neck','head',
                 'leftShoulder','rightShoulder',
                 'leftUpperArm','rightUpperArm','leftUpperLeg','rightUpperLeg',
                 'leftLowerArm','rightLowerArm','leftLowerLeg','rightLowerLeg',
                 'leftHand','rightHand','leftFoot','rightFoot'];
  const result = {};
  for (const name of names) {
    const bone = getBone(name);
    if (!bone?.rotationQuaternion) { result[name] = null; continue; }
    const q = bone.rotationQuaternion;
    result[name] = { x: +q.x.toFixed(4), y: +q.y.toFixed(4), z: +q.z.toFixed(4), w: +q.w.toFixed(4) };
  }
  return result;
});

console.log('\n── Pre-animation bone restQ (AIAN model, before any keyframe applied):');
for (const [name, q] of Object.entries(boneRestQs)) {
  if (!q) { console.log(`  ${name.padEnd(18)} (null)`); continue; }
  const nearIdentity = Math.abs(q.w) > 0.999;
  console.log(`  ${name.padEnd(18)} x=${q.x}  y=${q.y}  z=${q.z}  w=${q.w}${nearIdentity ? '' : '  ← NON-IDENTITY'}`);
}
console.log('');

// Click play
await page.evaluate(() => { const b = document.getElementById('playBtn'); if (b && !b.disabled) b.click(); });
console.log('Playing — settling 0.25s for an early-cycle pose…');
await new Promise(r => setTimeout(r, 250));

// Pause (click play/pause toggle — button now reads ⏸ Pause)
await page.evaluate(() => { const b = document.getElementById('playBtn'); if (b) b.click(); });
await new Promise(r => setTimeout(r, 200));

// Hide UI overlay so it doesn't obscure the body
await page.evaluate(() => {
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';
});
console.log('Paused. UI hidden.\n');

// ── 4 orthogonal camera positions ───────────────────────────────────────────
// ArcRotateCamera: position = target + radius*(sin(β)cos(α), cos(β), sin(β)sin(α))
// VRM __root__ has 180°Y → avatar faces -Z in world space.
// "Front" camera (sees avatar face) must be at -Z → alpha = -π/2 (= 3π/2)
const VIEWS = [
  { label: 'front', alpha: -Math.PI / 2, beta: Math.PI / 2.2 },  // camera at -Z, sees face
  { label: 'back',  alpha:  Math.PI / 2, beta: Math.PI / 2.2 },  // camera at +Z, sees back
  { label: 'left',  alpha:  Math.PI,     beta: Math.PI / 2.2 },  // camera at -X, avatar left side
  { label: 'right', alpha:  0,           beta: Math.PI / 2.2 },  // camera at +X, avatar right side
];

// Full-body view — close enough to see limbs clearly
const RADIUS = 2.2;
const TARGET_Y = 0.9;  // aim at mid-torso

const panels = [];

// ── Check which bones bodyGroup actually animates ───────────────────────────
const animatedBones = await page.evaluate(() => {
  const scene = BABYLON.Engine.Instances[0].scenes[0];
  const bg = scene.animationGroups.find(g => g.name === 'vrma-body');
  if (!bg) return [];
  return bg.targetedAnimations
    .filter(ta => ta.animation.targetProperty === 'rotationQuaternion')
    .map(ta => ta.target?.name ?? '?');
});
console.log(`\n── Bones animated by bodyGroup (${animatedBones.length}):`);
console.log(' ', animatedBones.join(', '));
console.log('');

// ── Capture live animated bone rotations at paused frame ────────────────────
const boneAnimQs = await page.evaluate(() => {
  const scene  = BABYLON.Engine.Instances[0].scenes[0];
  const vrmMgr = scene.metadata?.vrmManagers?.[0];
  const getBone = n => vrmMgr?.humanoidBone?.[n] ?? vrmMgr?.humanoidBone?.nodeMap?.[n];
  const names = ['hips','spine','leftUpperArm','rightUpperArm','leftUpperLeg','rightUpperLeg'];
  const result = {};
  for (const name of names) {
    const bone = getBone(name);
    if (!bone?.rotationQuaternion) { result[name] = null; continue; }
    const q = bone.rotationQuaternion;
    result[name] = { x: +q.x.toFixed(4), y: +q.y.toFixed(4), z: +q.z.toFixed(4), w: +q.w.toFixed(4) };
  }
  return result;
});
console.log('── Live bone rotationQuaternion at paused frame:');
for (const [name, q] of Object.entries(boneAnimQs)) {
  if (!q) { console.log(`  ${name.padEnd(18)} (null)`); continue; }
  console.log(`  ${name.padEnd(18)} x=${q.x}  y=${q.y}  z=${q.z}  w=${q.w}`);
}
console.log('');

// Find model's actual world position (hips bone) to handle root motion drift
const modelPos = await page.evaluate(() => {
  const scene  = BABYLON.Engine.Instances[0].scenes[0];
  const vrmMgr = scene.metadata?.vrmManagers?.[0];
  const getBone = n => vrmMgr?.humanoidBone?.[n] ?? vrmMgr?.humanoidBone?.nodeMap?.[n];
  const hips = getBone('hips');
  if (!hips) return { x: 0, z: 0 };
  const abs = hips.getAbsolutePosition();
  return { x: abs.x, z: abs.z };
});
console.log(`  Model world pos: x=${modelPos.x.toFixed(3)} z=${modelPos.z.toFixed(3)}`);

for (const v of VIEWS) {
  // Move ArcRotateCamera to orthogonal position, centered on model's actual XZ
  await page.evaluate(({ alpha, beta, radius, targetY, mx, mz }) => {
    const engine = BABYLON.Engine.Instances[0];
    const scene  = engine.scenes[0];
    const cam    = scene.cameras[0];
    if (!cam) return;
    cam.alpha  = alpha;
    cam.beta   = beta;
    cam.radius = radius;
    cam.target = new BABYLON.Vector3(mx, targetY, mz);
    scene.render();
  }, { ...v, radius: RADIUS, targetY: TARGET_Y, mx: modelPos.x, mz: modelPos.z });

  // Two frames to let Babylon flush
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => { BABYLON.Engine.Instances[0].scenes[0].render(); r(); })));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));

  const buf = await page.screenshot({ type: 'png' });
  await writeFile(join(OUT, `${v.label}.png`), buf);
  panels.push(PNG.sync.read(buf));
  console.log(`  ✓ ${v.label}`);
}

// ── Composite 2×2 ────────────────────────────────────────────────────────────
// Layout: [front(0), back(1)] / [left(2), right(3)]
console.log('\nCompositing 2×2…');
const composite = new PNG({ width: W * 2, height: H * 2 });
composite.data.fill(0);

for (let pi = 0; pi < 4; pi++) {
  const col = pi % 2, row = Math.floor(pi / 2);
  const src = panels[pi];
  const srcW = src.width, srcH = src.height;
  for (let y = 0; y < srcH && y < H; y++) {
    for (let x = 0; x < srcW && x < W; x++) {
      const si = (y * srcW + x) * 4;
      const di = ((row * H + y) * (W * 2) + (col * W + x)) * 4;
      composite.data[di]   = src.data[si];
      composite.data[di+1] = src.data[si+1];
      composite.data[di+2] = src.data[si+2];
      composite.data[di+3] = src.data[si+3];
    }
  }
}

// Draw thin white dividers at center cross
const outBuf = PNG.sync.write(composite);
const outPath = join(OUT, 'ortho_4view.png');
await writeFile(outPath, outBuf);

console.log(`\nLayout: [FRONT | BACK] / [LEFT | RIGHT]`);
console.log(`Composite → screenshots/walk_ortho/ortho_4view.png`);
console.log(`Individual panels → screenshots/walk_ortho/{front,back,left,right}.png`);

await browser.close(); server.close(); process.exit(0);
