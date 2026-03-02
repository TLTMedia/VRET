/**
 * vrm1_compare.mjs — VRM 1.0 bone quaternion comparison: A-Frame vs Babylon.js
 *
 * Loads Seed-san.vrm (VRM 1.0) + a VRMA animation in both renderers, then at
 * several time points compares bone quaternions to determine whether Babylon's
 * output matches A-Frame directly or via the (-x,y,-z,w) conjugation.
 *
 * Output tells us whether the `(-q.x, q.y, -q.z, q.w)` correction in babvrm.html
 * is correct, over-correcting, or under-correcting for VRM 1.0.
 *
 * Usage:
 *   node vrm1_compare.mjs [vrma]
 *   node vrm1_compare.mjs vrma/09_01.vrma
 */

import puppeteer       from 'puppeteer';
import { createServer } from 'http';
import { readFile }     from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname }      from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;
const PORT      = 3479;

const MODEL = 'models/Seed-san.vrm';
const VRMA  = process.argv[2] || 'vrma/02_01.vrma';

// Sample inside the first ~1.5 s of animation
const SAMPLE_TIMES = [0.1, 0.3, 0.6, 1.0];

// Bones to inspect in detail
const KEY_BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'rightUpperArm',
  'leftUpperLeg', 'rightUpperLeg',
  'leftLowerArm', 'rightLowerArm',
];

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
console.log(`\n🌐  http://localhost:${PORT}`);
console.log(`📄  model: ${MODEL}`);
console.log(`🎬  vrma:  ${VRMA}\n`);

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

afPage.on('console',   m => process.stdout.write(`  [AF]  ${m.text()}\n`));
afPage.on('pageerror', e => process.stderr.write(`  [AF]  PAGE ERROR: ${e.message}\n`));
babPage.on('console',  m => process.stdout.write(`  [BAB] ${m.text()}\n`));
babPage.on('pageerror',e => process.stderr.write(`  [BAB] PAGE ERROR: ${e.message}\n`));

console.log('Opening A-Frame…');
await afPage.goto(AFRAME_URL, { waitUntil: 'domcontentloaded' });
await afPage.bringToFront();
console.log('Waiting for A-Frame (up to 120s)…');
await afPage.waitForFunction(() => window.animationReady === true, { timeout: 120_000 });
console.log('  ✓ A-Frame ready');

console.log('Opening Babylon.js…');
await babPage.goto(BABYLON_URL, { waitUntil: 'domcontentloaded' });
await babPage.bringToFront();
console.log('Waiting for Babylon.js (up to 120s)…');
await babPage.waitForFunction(() => window.animationReady === true, { timeout: 120_000 });
console.log('  ✓ Babylon.js ready\n');

// Helper: dot product of two quaternions
function dot(a, b) { return a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w; }
// Quaternion conjugated by 180°Y: (x,y,z,w) → (-x,y,-z,w)
function conj180Y(q) { return { x: -q.x, y: q.y, z: -q.z, w: q.w }; }
// Angular distance between two unit quaternions (degrees)
function angDeg(a, b) { return (Math.acos(Math.min(1, Math.abs(dot(a, b)))) * 2 * 180 / Math.PI).toFixed(1); }

// ─── Relationship summary (computed once from first sample) ───────────────────
let firstSample = true;

for (const t of SAMPLE_TIMES) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  t = ${t}s`);
  console.log('─'.repeat(70));

  await afPage.bringToFront();
  const afQuats = await afPage.evaluate(t => window.getBoneQuats(t), t);
  await afPage.evaluate(() => new Promise(r => requestAnimationFrame(r)));

  await babPage.bringToFront();
  const babQuats = await babPage.evaluate(t => window.getBoneQuats(t), t);
  await babPage.evaluate(() => new Promise(r => requestAnimationFrame(r)));

  if (!afQuats || !babQuats) {
    console.log('  ERROR: could not get bone quats');
    continue;
  }

  // A-Frame returns { bone: { q: {x,y,z,w}, pos: {...} } } — unwrap the q field
  const afFlat = {};
  for (const [k, v] of Object.entries(afQuats)) {
    afFlat[k] = v?.q ?? v; // use .q if nested, else use directly
  }

  if (firstSample) {
    firstSample = false;

    console.log('\n  Relationship check — for each key bone:');
    console.log('    dot(BAB, AF)       → 1.0 means BAB == AF (raw quats match)');
    console.log('    dot(BAB, conj(AF)) → 1.0 means BAB == (-AF.x,AF.y,-AF.z,AF.w)');
    console.log('    ang° = angular error of "better" match\n');

    const header = '  Bone                 dot(BAB,AF)  dot(BAB,conj)  match       ang°';
    console.log(header);
    console.log('  ' + '─'.repeat(header.length - 2));

    let sumDirect = 0, sumConj = 0, n = 0;
    for (const bone of KEY_BONES) {
      const af  = afFlat[bone];
      const bab = babQuats[bone];
      if (!af || !bab) {
        console.log(`  ${bone.padEnd(20)} (missing)`);
        continue;
      }
      const dDirect = Math.abs(dot(bab, af));
      const dConj   = Math.abs(dot(bab, conj180Y(af)));
      const better  = dDirect >= dConj ? 'direct' : 'conj(-x,y,-z,w)';
      const ang     = angDeg(bab, dDirect >= dConj ? af : conj180Y(af));
      sumDirect += dDirect; sumConj += dConj; n++;
      console.log(
        `  ${bone.padEnd(20)} ${dDirect.toFixed(6).padEnd(12)} ${dConj.toFixed(6).padEnd(14)} ${better.padEnd(16)} ${ang}°`
      );
    }
    if (n > 0) {
      console.log();
      console.log(`  avg dot(BAB,AF):       ${(sumDirect/n).toFixed(6)}`);
      console.log(`  avg dot(BAB,conj(AF)): ${(sumConj/n).toFixed(6)}`);
      const verdict = sumConj > sumDirect ? 'conj(-x,y,-z,w) matches better' : 'direct matches better';
      console.log(`  → VERDICT: ${verdict}\n`);
    }
  }

  // Show worst-matching bones across all bones
  const diffs = [];
  for (const [bone, af] of Object.entries(afFlat)) {
    const bab = babQuats[bone];
    if (!bab) continue;
    const dDirect = Math.abs(dot(bab, af));
    const dConj   = Math.abs(dot(bab, conj180Y(af)));
    const best    = Math.max(dDirect, dConj);
    if (best < 0.995) diffs.push({ bone, dDirect, dConj, best, af, bab });
  }
  diffs.sort((a, b) => a.best - b.best);

  if (diffs.length === 0) {
    console.log('  ✓ All bones within 5.7° of best match (dot > 0.995)');
  } else {
    console.log(`  ⚠ ${diffs.length} bones with >5.7° error (best match dot < 0.995):`);
    for (const { bone, dDirect, dConj, af, bab } of diffs.slice(0, 10)) {
      const ang = angDeg(bab, dConj >= dDirect ? conj180Y(af) : af);
      console.log(`    ${bone.padEnd(22)} direct=${dDirect.toFixed(4)} conj=${dConj.toFixed(4)}  ang=${ang}°`);
      console.log(`      AF:  [${af.x}, ${af.y}, ${af.z}, ${af.w}]`);
      console.log(`      BAB: [${bab.x}, ${bab.y}, ${bab.z}, ${bab.w}]`);
    }
  }
}

console.log('\n' + '═'.repeat(70));
console.log('  Done. Close browser windows to exit.');
console.log('═'.repeat(70) + '\n');

await browser.close();
server.close();
process.exit(0);
