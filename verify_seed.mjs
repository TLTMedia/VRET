/**
 * verify_seed.mjs
 * Captures A-Frame (three-vrm) and Babylon side-by-side for Seed-san VRM 1.0.
 * Saves screenshots_verify/seed_af_t{T}.png and seed_bab_t{T}.png at each sample time.
 * Analyse the PNGs to judge correctness.
 */
import puppeteer       from 'puppeteer';
import { createServer } from 'http';
import { readFile, mkdir } from 'fs/promises';
import { extname, join }  from 'path';
import { fileURLToPath }  from 'url';
import { dirname }        from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;
const PORT      = 3477;
const OUT_DIR   = join(ROOT, 'screenshots_verify');

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

const VRMA  = process.argv[2] || 'vrma/13_29.vrma'; // Jumping Jacks by default
const MODEL = 'models/Seed-san.vrm';
const TIMES = [0.5, 1.0, 1.5, 2.0];

const AFRAME_URL  = `http://localhost:${PORT}/animate.html?model=${MODEL}#${VRMA}`;
const BABYLON_URL = `http://localhost:${PORT}/babvrm.html?model=${MODEL}#${VRMA}`;
const CLIP = { x: 100, y: 20, width: 440, height: 440 };

console.log(`\nmodel: ${MODEL}\nvrma:  ${VRMA}\n`);

const browser = await puppeteer.launch({
  headless: false,
  protocolTimeout: 120_000,
  args: ['--no-sandbox', '--disable-background-timer-throttling',
         '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

const afPage  = await browser.newPage();
const babPage = await browser.newPage();
await afPage.setViewport({ width: 640, height: 480 });
await babPage.setViewport({ width: 640, height: 480 });

afPage.on('console',   m => console.log(`  [AF]  ${m.text()}`));
afPage.on('pageerror', e => console.error(`  [AF]  ERR ${e.message}`));
babPage.on('console',  m => console.log(`  [BAB] ${m.text()}`));
babPage.on('pageerror',e => console.error(`  [BAB] ERR ${e.message}`));

console.log('Loading A-Frame…');
await afPage.goto(AFRAME_URL, { waitUntil: 'domcontentloaded' });
await afPage.bringToFront();
await afPage.waitForFunction(() => window.animationReady === true, { timeout: 120_000 });
console.log('  ✓ A-Frame ready');

console.log('Loading Babylon…');
await babPage.goto(BABYLON_URL, { waitUntil: 'domcontentloaded' });
await babPage.bringToFront();
await babPage.waitForFunction(() => window.animationReady === true, { timeout: 120_000 });
console.log('  ✓ Babylon ready\n');

// ── Diagnostics: scene accessed via BABYLON engine global ──────────────────
const diag = await babPage.evaluate(() => {
  const scene  = BABYLON?.EngineStore?.LastCreatedEngine?.scenes?.[0];
  const meta   = scene?.metadata;

  // Which raw VRM bones exist?
  const rawBoneNames = Object.keys(meta?.vrmManagers?.[0]?.humanoidBone?.nodeMap ?? {});

  // Which bones does the VRMA animMap know about?
  const animMap = meta?.vrmAnimationManagers?.[0]?.animationMap;
  const animMapEntries = animMap
    ? [...animMap.entries()].map(([k,v]) => `nodeIdx${k}→${v}`)
    : ['(empty — vrmAnimationManagers not found)'];

  // For the first VRMA load, look at what animation targets are in the container
  // The remappedGroup has proxy targets already, so look at original animGroup
  // via stored targets in remapped group (they ARE the proxy nodes now — expected)
  const BONE_ORDER = ['hips','spine','chest','upperChest','neck','head',
    'leftUpperLeg','leftLowerLeg','leftFoot','rightUpperLeg','rightLowerLeg','rightFoot',
    'leftShoulder','leftUpperArm','leftLowerArm','leftHand',
    'rightShoulder','rightUpperArm','rightLowerArm','rightHand'];
  const proxyExists = {};
  for (const b of BONE_ORDER) {
    const proxy = scene?.getTransformNodeByName?.(`proxy_${b}`);
    proxyExists[b] = !!proxy;
  }

  return { rawBoneNames, animMapEntries, proxyExists };
});

console.log('\nRaw VRM bones present:', diag.rawBoneNames.length, 'bones:');
console.log(' ', diag.rawBoneNames.join(', '));
console.log('\nVRMA animMap entries:', diag.animMapEntries.join(', '));
console.log('\nProxy nodes created per bone:');
for (const [bone, exists] of Object.entries(diag.proxyExists)) {
  console.log(`  ${bone.padEnd(22)} proxy=${exists ? '✓' : '✗  ← MISSING'}`);
}

for (const t of TIMES) {
  console.log(`── t = ${t}s ──────────────────`);

  await afPage.bringToFront();
  await afPage.evaluate(t => {
    window.getBoneQuats(t);
  }, t);
  await afPage.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const afBuf = await afPage.screenshot({ type: 'png', clip: CLIP });
  const afFile = join(OUT_DIR, `seed_af_t${String(t).replace('.', '_')}.png`);
  fs.writeFileSync(afFile, afBuf);
  console.log(`  AF  → ${afFile}`);

  await babPage.bringToFront();
  await babPage.evaluate(t => {
    window.getBoneQuats(t);
  }, t);
  await babPage.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const babBuf = await babPage.screenshot({ type: 'png', clip: CLIP });
  const babFile = join(OUT_DIR, `seed_bab_t${String(t).replace('.', '_')}.png`);
  fs.writeFileSync(babFile, babBuf);
  console.log(`  BAB → ${babFile}`);
}

console.log('\nDone — check screenshots_verify/ for side-by-side comparison.');
await browser.close();
server.close();
process.exit(0);
