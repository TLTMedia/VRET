/**
 * sample.mjs — Puppeteer PNG screenshot comparison
 *
 * Starts a local HTTP server, opens A-Frame and Babylon.js,
 * seeks both to the same timestamps across the FULL walk cycle (2.87 s),
 * screenshots each frame, writes a composite AF|BAB|DIFF panel per frame,
 * logs per-frame bone angular errors, and generates contact.html for review.
 *
 * Usage:
 *   node sample.mjs
 *
 * Output:  ./screenshots/
 *   t0_20_aframe.png  t0_20_babylon.png  t0_20_diff.png  t0_20_composite.png
 *   ...  (14 time points, 0.2 s apart, full 2.87 s walk cycle)
 *   contact.html
 */

import puppeteer        from 'puppeteer';
import { createServer } from 'http';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname }       from 'path';
import { PNG }           from 'pngjs';
import pixelmatch        from 'pixelmatch';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;
const PORT      = 3477;
const OUT_DIR   = join(ROOT, 'screenshots');

// Full walk cycle (2.87 s) — 15 samples every 0.2 s starting from 0: [0, 0.2, ..., 2.8]
const SAMPLE_TIMES = Array.from({ length: 15 }, (_, i) =>
  parseFloat((i * 0.2).toFixed(2))
);

const VIEWPORT  = { width: 640, height: 480 };
// CROP AREA: Centered on the character (x, y, width, height)
const CROP_CLIP = { x: 120, y: 40, width: 400, height: 400 };

// Bones to compare at every frame
const KEY_BONES = [
  'hips', 'spine',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

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
const MODEL       = 'models/Seed-san.vrm';
const AFRAME_URL  = `http://localhost:${PORT}/animate.html?model=${MODEL}#${VRMA}`;
const BABYLON_URL = `http://localhost:${PORT}/babvrm.html?model=${MODEL}#${VRMA}`;

const afPage  = await browser.newPage();
const babPage = await browser.newPage();
await afPage.setViewport(VIEWPORT);
await babPage.setViewport(VIEWPORT);

// Pipe browser console to Node
let criticalError = null;
const handleError = (origin, e) => {
  criticalError = `[${origin}] ${e.message || e}`;
  console.error(`\n❌ CRITICAL ERROR ${criticalError}`);
};

afPage.on('console',   m => console.log(`  [AF]  ${m.type().toUpperCase()} ${m.text()}`));
afPage.on('pageerror', e => handleError('AF', e));
babPage.on('console',  m => console.log(`  [BAB] ${m.type().toUpperCase()} ${m.text()}`));
babPage.on('pageerror',e => handleError('BAB', e));

// Load A-Frame first
console.log('Opening A-Frame…');
await afPage.goto(AFRAME_URL, { waitUntil: 'domcontentloaded' });
await afPage.bringToFront();

console.log('Waiting for A-Frame to load (up to 120s)…');
await Promise.race([
  afPage.waitForFunction(() => window.animationReady === true, { timeout: 120_000 }),
  new Promise((_, reject) => {
    const check = setInterval(() => { if (criticalError) { clearInterval(check); reject(new Error(criticalError)); } }, 500);
  })
]);
console.log('  ✓ A-Frame ready');

console.log('Opening Babylon.js…');
await babPage.goto(BABYLON_URL, { waitUntil: 'domcontentloaded' });
await babPage.bringToFront();
console.log('Waiting for Babylon.js to load (up to 120s)…');
await Promise.race([
  babPage.waitForFunction(() => window.animationReady === true, { timeout: 120_000 }),
  new Promise((_, reject) => {
    const check = setInterval(() => { if (criticalError) { clearInterval(check); reject(new Error(criticalError)); } }, 500);
  })
]);
console.log('  ✓ Babylon.js ready');

console.log('\n⏳ Waiting 3s for animations to settle…');
await new Promise(r => setTimeout(r, 3000));

// ─── Quaternion helpers ──────────────────────────────────────────────────────
// A-Frame getBoneQuats returns { bone: { q:{x,y,z,w}, pos:{x,y,z} } }
// Babylon getBoneQuats also returns { bone: { q:{x,y,z,w}, pos:{x,y,z} } }  (after fix)
// These helpers tolerate either format for safety.
function extractQ(v)   { return v?.q   ?? v; }
function extractPos(v) { return v?.pos  ?? null; }

function dot4(a, b)   { return a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w; }
function conj180Y(q)  { return { x: -q.x, y: q.y, z: -q.z, w: q.w }; }
function angDeg(a, b) {
  return (Math.acos(Math.min(1, Math.abs(dot4(a, b)))) * 2 * 180 / Math.PI).toFixed(1);
}

// ─── Pixel analysis helper ──────────────────────────────────────────────────
function getVisualMetrics(png) {
  let minX = png.width, maxX = 0, minY = png.height, maxY = 0;
  let count = 0, sumX = 0, sumY = 0;

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2;
      const r = png.data[idx], g = png.data[idx + 1], b = png.data[idx + 2];
      const isBg = (r === 0 && g === 26 && b === 51) || (r <= 20 && g <= 20 && b <= 20);
      if (!isBg) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        sumX += x; sumY += y; count++;
      }
    }
  }
  if (count === 0) return null;
  return { centerX: sumX/count, centerY: sumY/count, height: maxY-minY, width: maxX-minX, count };
}

// ─── Pixel diff helper ──────────────────────────────────────────────────────
async function diffScreenshots(afBuf, babBuf, diffPath) {
  const af  = PNG.sync.read(afBuf);
  const bab = PNG.sync.read(babBuf);

  const { width, height } = af;
  const diff = new PNG({ width, height });

  const numDiff = pixelmatch(af.data, bab.data, diff.data, width, height, {
    threshold: 0.1,
    includeAA: false,
  });

  // Count character (non-background) pixels across both images
  let charPixels = 0;
  for (let i = 0; i < af.data.length; i += 4) {
    const r = af.data[i],  g = af.data[i+1],  b = af.data[i+2];
    const R = bab.data[i], G = bab.data[i+1], B = bab.data[i+2];
    const afBg  = (r===0 && g===26 && b===51) || (r<=20 && g<=20 && b<=20);
    const babBg = (R===0 && G===26 && B===51) || (R<=20 && G<=20 && B<=20);
    if (!afBg || !babBg) charPixels++;
  }

  const afMetrics  = getVisualMetrics(af);
  const babMetrics = getVisualMetrics(bab);

  const pct     = ((numDiff / (width * height)) * 100).toFixed(1);
  const charPct = charPixels > 0 ? ((numDiff / charPixels) * 100).toFixed(1) : '---';

  const diffPngBuf = PNG.sync.write(diff);
  await writeFile(diffPath, diffPngBuf);

  let visual = '';
  if (afMetrics && babMetrics) {
    const dx = (babMetrics.centerX - afMetrics.centerX).toFixed(1);
    const dy = (babMetrics.centerY - afMetrics.centerY).toFixed(1);
    const dh = (babMetrics.height  - afMetrics.height ).toFixed(1);
    visual = `shift:(${dx},${dy}px) h-diff:${dh}px`;
  }

  return { pct, charPct, visual, diffPngBuf };
}

// ─── Composite PNG (A-Frame | Babylon | Diff) side-by-side ──────────────────
function makeComposite(afBuf, babBuf, diffPngBuf) {
  const af   = PNG.sync.read(afBuf);
  const bab  = PNG.sync.read(babBuf);
  const diff = PNG.sync.read(diffPngBuf);
  const w = af.width, h = af.height;
  const out = new PNG({ width: w * 3, height: h });
  out.data.fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si   = (y * w + x) * 4;
      const dAF  = (y * w*3 + x)       * 4;
      const dBAB = (y * w*3 + w   + x) * 4;
      const dDIF = (y * w*3 + w*2 + x) * 4;
      for (let c = 0; c < 4; c++) {
        out.data[dAF  + c] = af.data[si + c];
        out.data[dBAB + c] = bab.data[si + c];
        out.data[dDIF + c] = diff.data[si + c];
      }
    }
  }
  return PNG.sync.write(out);
}

// ─── Sample loop ─────────────────────────────────────────────────────────────
const summary = [];
const afHipsPos = [];
const babHipsPos = [];

for (const t of SAMPLE_TIMES) {
  const tag = `t${t.toFixed(2).replace('.', '_')}`;
  console.log(`\n📸 t=${t}s  [${tag}]`);

  await afPage.bringToFront();
  const afQuats = await afPage.evaluate(t => window.getBoneQuats(t), t);
  if (afQuats?.hips?.pos) afHipsPos.push(afQuats.hips.pos);
  await afPage.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  const afBuf   = await afPage.screenshot({ type: 'png', clip: CROP_CLIP });

  await babPage.bringToFront();
  const babQuats = await babPage.evaluate(t => window.getBoneQuats(t), t);
  if (babQuats?.hips?.pos) babHipsPos.push(babQuats.hips.pos);
  await babPage.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  const babBuf   = await babPage.screenshot({ type: 'png', clip: CROP_CLIP });

  const afPath        = join(OUT_DIR, `${tag}_aframe.png`);
  const babPath       = join(OUT_DIR, `${tag}_babylon.png`);
  const diffPath      = join(OUT_DIR, `${tag}_diff.png`);
  const compositePath = join(OUT_DIR, `${tag}_composite.png`);

  await Promise.all([writeFile(afPath, afBuf), writeFile(babPath, babBuf)]);

  const { pct, charPct, visual, diffPngBuf } = await diffScreenshots(afBuf, babBuf, diffPath);
  const compositeBuf = makeComposite(afBuf, babBuf, diffPngBuf);
  await writeFile(compositePath, compositeBuf);

  console.log(`   diff: ${pct}% total | char: ${charPct}%  ${visual}`);

  // ── Per-frame bone angular error ──────────────────────────────────────────
  let maxAngErr = 0;
  if (afQuats && babQuats) {
    const rows = [];
    for (const bone of KEY_BONES) {
      const afRaw  = afQuats[bone];
      const babRaw = babQuats[bone];
      if (!afRaw || !babRaw) { rows.push(`     ${bone.padEnd(20)} (missing)`); continue; }

      const afQ  = extractQ(afRaw);
      const babQ = extractQ(babRaw);

      const dDir  = Math.abs(dot4(babQ, afQ));
      const dConj = Math.abs(dot4(babQ, conj180Y(afQ)));
      const ang   = parseFloat(angDeg(babQ, dConj > dDir ? conj180Y(afQ) : afQ));
      const match = dConj > dDir ? 'conj' : 'direct';
      const flag  = ang > 10 ? ' ⚠' : ang > 5 ? ' ~' : '';
      if (ang > maxAngErr) maxAngErr = ang;

      // Also compare world positions if available
      const afPos  = extractPos(afRaw);
      const babPos = extractPos(babRaw);
      let posNote = '';
      if (afPos && babPos) {
        const dy = (babPos.y - afPos.y).toFixed(3);
        if (Math.abs(babPos.y - afPos.y) > 0.05) posNote = `  posY-diff:${dy}`;
      }

      rows.push(`     ${bone.padEnd(20)} ${ang.toFixed(1).padStart(5)}°  ${match}${flag}${posNote}`);
    }
    console.log('   Bone angular errors (AF vs BAB):');
    rows.forEach(r => console.log(r));
  } else {
    console.log('   (bone quats unavailable)');
  }

  summary.push({ tag, t, pct, charPct, visual, maxAngErr });
}

// ─── Visual travel analysis ──────────────────────────────────────────────────
async function analyzeTravel(afHips, babHips) {
  if (afHips.length < 2 || babHips.length < 2) return;
  
  const afStart  = afHips[0],  afEnd  = afHips[afHips.length-1];
  const babStart = babHips[0], babEnd = babHips[babHips.length-1];
  
  const afD  = { x: afEnd.x - afStart.x, z: afEnd.z - afStart.z };
  const babD = { x: babEnd.x - babStart.x, z: babEnd.z - babStart.z };
  
  console.log('\n🏃 Travel Analysis (meters):');
  console.log(`   A-Frame:  dX:${afD.x.toFixed(3).padStart(6)}  dZ:${afD.z.toFixed(3).padStart(6)}  (Forward is -Z in AF setup)`);
  console.log(`   Babylon:  dX:${babD.x.toFixed(3).padStart(6)}  dZ:${babD.z.toFixed(3).padStart(6)}  (Forward is -Z in BAB setup)`);
  
  const afSway  = Math.abs(afD.x) > Math.abs(afD.z)  ? '⚠ SIDE-WALKING' : '✓ OK';
  const babSway = Math.abs(babD.x) > Math.abs(babD.z) ? '⚠ SIDE-WALKING' : '✓ OK';
  console.log(`   Status:   AF:${afSway}  BAB:${babSway}`);
}

// ─── Summary table ────────────────────────────────────────────────────────────
console.log('\n\n' + '═'.repeat(72));
console.log('  SUMMARY — full walk cycle');
console.log('═'.repeat(72));
console.log(`  ${'Time'.padEnd(6)} ${'Total%'.padEnd(8)} ${'Char%'.padEnd(8)} ${'MaxBone°'.padEnd(10)} Visual`);
console.log('  ' + '─'.repeat(70));
for (const s of summary) {
  const warn = s.maxAngErr > 10 ? ' ⚠' : '';
  console.log(
    `  ${(s.t+'s').padEnd(6)} ${(s.pct+'%').padEnd(8)} ${(s.charPct+'%').padEnd(8)}` +
    ` ${(s.maxAngErr.toFixed(1)+'°').padEnd(10)} ${s.visual}${warn}`
  );
}
console.log('═'.repeat(72));

// ─── HTML contact sheet ───────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>VRM Contact Sheet</title>
<style>
  body { background:#0a0a0a; color:#ccc; font-family:monospace; margin:0; padding:10px; }
  h1   { font-size:13px; color:#0ff; margin:0 0 8px; }
  .fr  { margin:4px 0; }
  .fr img  { width:100%; display:block; }
  .lbl { font-size:11px; padding:2px 4px; background:#111; color:#8f8; display:flex; justify-content:space-between; }
  .lbl.warn { color:#f84; }
  .cols { display:flex; gap:4px; font-size:10px; color:#555; padding:1px 4px; background:#0d0d0d; }
</style></head><body>
<h1>[ A-Frame ] | [ Babylon ] | [ Diff ]  —  ${MODEL} + ${VRMA}</h1>
${summary.map(s => {
  const warnCls = s.maxAngErr > 10 ? ' warn' : '';
  return `<div class="fr">
  <div class="lbl${warnCls}">
    <span>t=${s.t}s</span>
    <span>diff: ${s.pct}% total | char: ${s.charPct}%</span>
    <span>maxBone: ${s.maxAngErr.toFixed(1)}°</span>
    <span>${s.visual}</span>
  </div>
  <div class="cols"><span style="flex:1;text-align:center">A-Frame (ref)</span><span style="flex:1;text-align:center">Babylon.js</span><span style="flex:1;text-align:center">Diff</span></div>
  <img src="${s.tag}_composite.png" title="${s.tag}">
</div>`;
}).join('\n')}
</body></html>`;

await writeFile(join(OUT_DIR, 'contact.html'), html);
console.log(`\n📋 Contact sheet: ${join(OUT_DIR, 'contact.html')}`);
console.log(`✅ Done — ${SAMPLE_TIMES.length} frames in ${OUT_DIR}`);
await browser.close();
server.close();
process.exit(0);
