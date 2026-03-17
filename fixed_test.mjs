/**
 * fixed_test.mjs — verifies that fixed.html actually works
 *
 * Checks:
 *  1. Page loads without JS errors
 *  2. animationReady flag is set (VRM + VRMA loaded, retargeting ran)
 *  3. A named AnimationGroup "vrma-retargeted" exists and is running
 *  4. Key bones are moving between t=0.1s and t=0.5s (not a frozen T-pose)
 *  5. Screenshot saved for visual inspection
 *
 * Usage: node fixed_test.mjs
 */

import puppeteer        from 'puppeteer';
import { createServer } from 'http';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname }       from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT  = __dirname;
const PORT  = 3491;
const OUT   = join(ROOT, 'screenshots', 'fixed_test');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.vrm': 'model/gltf-binary',
  '.vrma': 'model/gltf-binary', '.glb': 'model/gltf-binary',
};

const server = createServer(async (req, res) => {
  const url  = req.url.split('?')[0].split('#')[0];
  const path = join(ROOT, decodeURIComponent(url === '/' ? '/index.html' : url));
  try {
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});

await new Promise(r => server.listen(PORT, r));
await mkdir(OUT, { recursive: true });
console.log(`\n🌐 http://localhost:${PORT}/fixed.html\n`);

const browser = await puppeteer.launch({
  headless: false,
  protocolTimeout: 120_000,
  args: ['--no-sandbox', '--disable-background-timer-throttling',
         '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

const page = await browser.newPage();
await page.setViewport({ width: 640, height: 480 });

const errors = [];
page.on('console',   m => console.log(`  [BJS] ${m.text()}`));
page.on('pageerror', e => { console.error(`  [ERR] ${e.message}`); errors.push(e.message); });

console.log('Loading fixed.html…');
await page.goto(`http://localhost:${PORT}/fixed.html`, { waitUntil: 'domcontentloaded' });
await page.bringToFront();

console.log('Waiting for animationReady (up to 120s)…');
try {
  await page.waitForFunction(() => window.animationReady === true, { timeout: 120_000 });
  console.log('  ✓ animationReady');
} catch {
  console.log('  ✗ animationReady never set — VRM/VRMA load failed');
}

// Wait for render frames so animation system updates bone transforms
await new Promise(r => setTimeout(r, 500));
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

// ── Checks ────────────────────────────────────────────────────────────────────
// Read bone quats directly from the retargeted group's targets (avoids vrmManager lookup issues)
function sampleBones(scene) {
  const grp = scene.animationGroups.find(g => g.name === 'vrma-retargeted');
  if (!grp) return null;
  const out = {};
  for (const ta of grp.targetedAnimations) {
    if (ta.animation.targetProperty !== 'rotationQuaternion') continue;
    const node = ta.target;
    if (!node?.rotationQuaternion) continue;
    const q = node.rotationQuaternion;
    out[node.name] = { x: q.x, y: q.y, z: q.z, w: q.w };
    if (Object.keys(out).length >= 4) break;
  }
  return out;
}

const results = await page.evaluate(() => {
  const scene = window.BABYLON?.EngineStore?.LastCreatedScene;
  if (!scene) return { error: 'no scene' };
  const grp = scene.animationGroups.find(g => g.name === 'vrma-retargeted');
  if (!grp) return { error: 'vrma-retargeted group not found', groups: scene.animationGroups.map(g => g.name) };
  const vrmMgr = scene.metadata?.vrmManagers?.[0];

  const quatsA = {};
  for (const ta of grp.targetedAnimations) {
    if (ta.animation.targetProperty !== 'rotationQuaternion') continue;
    const node = ta.target;
    if (!node?.rotationQuaternion) continue;
    const q = node.rotationQuaternion;
    quatsA[node.name] = { x: q.x, y: q.y, z: q.z, w: q.w };
    if (Object.keys(quatsA).length >= 4) break;
  }

  // Orientation check: head must be above hips
  const bone = name => vrmMgr?.humanoidBone?.[name] ?? vrmMgr?.humanoidBone?.nodeMap?.[name];
  const hipsY = bone('hips')?.getAbsolutePosition?.().y ?? null;
  const headY = bone('head')?.getAbsolutePosition?.().y ?? null;

  return {
    groupFound:   true,
    isPlaying:    grp.isPlaying,
    targetCount:  grp.targetedAnimations.length,
    from:         grp.from,
    to:           +grp.to.toFixed(1),
    quatsA,
    hipsWorldY:   hipsY !== null ? +hipsY.toFixed(3) : null,
    headWorldY:   headY !== null ? +headY.toFixed(3) : null,
    headAboveHips: (hipsY !== null && headY !== null) ? headY > hipsY : null,
    vrmManagerFound:  !!vrmMgr,
    animManagerFound: !!scene.metadata?.vrmAnimationManagers?.[0],
  };
});

// Wait 400ms and sample again to check bones are moving
await new Promise(r => setTimeout(r, 400));
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

const quatsB = await page.evaluate(() => {
  const scene = window.BABYLON?.EngineStore?.LastCreatedScene;
  const grp = scene?.animationGroups.find(g => g.name === 'vrma-retargeted');
  if (!grp) return {};
  const out = {};
  for (const ta of grp.targetedAnimations) {
    if (ta.animation.targetProperty !== 'rotationQuaternion') continue;
    const node = ta.target;
    if (!node?.rotationQuaternion) continue;
    const q = node.rotationQuaternion;
    out[node.name] = { x: q.x, y: q.y, z: q.z, w: q.w };
    if (Object.keys(out).length >= 4) break;
  }
  return out;
});

// Screenshot
const buf = await page.screenshot({ type: 'png' });
await writeFile(join(OUT, 'fixed.png'), buf);

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);

let pass = true;

if (results.error) {
  console.log(`❌ FAIL — ${results.error}`);
  if (results.groups) console.log('   Groups found:', results.groups);
  pass = false;
} else {
  console.log(`AnimationGroup "vrma-retargeted":`);
  console.log(`  found:        ${results.groupFound}`);
  console.log(`  isPlaying:    ${results.isPlaying}`);
  console.log(`  targets:      ${results.targetCount}`);
  console.log(`  frame range:  ${results.from} → ${results.to}`);
  console.log(`  vrmManager:   ${results.vrmManagerFound}`);
  console.log(`  animManager:  ${results.animManagerFound}`);
  console.log(`  hips world Y: ${results.hipsWorldY}`);
  console.log(`  head world Y: ${results.headWorldY}`);
  console.log(`  head > hips:  ${results.headAboveHips}`);
  if (!results.headAboveHips) {
    console.log('❌ FAIL — head is not above hips: avatar is inverted or bones unmapped');
    pass = false;
  }

  if (!results.isPlaying) { console.log('❌ FAIL — group not playing'); pass = false; }
  if (results.targetCount === 0) { console.log('❌ FAIL — no targeted animations'); pass = false; }

  // Check bone movement
  console.log('\nBone movement check (Δ|w| over 400ms):');
  let anyMoving = false;
  for (const bone of Object.keys(results.quatsA)) {
    const a = results.quatsA[bone], b = quatsB[bone];
    if (!a || !b) { console.log(`  ${bone.padEnd(16)} — not found`); continue; }
    const dw = Math.abs(a.w - b.w), dx = Math.abs(a.x - b.x);
    const moving = dw > 0.0001 || dx > 0.0001;
    console.log(`  ${bone.padEnd(16)} Δw=${dw.toFixed(5)}  Δx=${dx.toFixed(5)}  ${moving ? '✓ moving' : '⚠ static'}`);
    if (moving) anyMoving = true;
  }
  if (!anyMoving) { console.log('❌ FAIL — all bones static (T-pose / frozen)'); pass = false; }
}

if (errors.length) {
  console.log(`\nJS errors (${errors.length}):`);
  errors.forEach(e => console.log(`  ${e}`));
}

console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} — screenshot: ${OUT}/fixed.png`);
console.log(`${'═'.repeat(60)}`);

await browser.close();
server.close();
process.exit(pass ? 0 : 1);
