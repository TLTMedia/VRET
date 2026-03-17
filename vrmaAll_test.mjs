/**
 * vrmaAll_test.mjs — Puppeteer test for vrmaAll.html blend transitions
 *
 * Opens vrmaAll.html, waits for the first blend phase, then samples the
 * 1-second crossfade at t = 0, 0.25, 0.5, 0.75, 1.0.
 * At each sample it takes a screenshot and reads bone quaternions.
 * At the end it prints per-bone quaternion diffs (t=0 vs t=1) and
 * saves a 5-panel contact sheet PNG.
 *
 * Usage:
 *   node vrmaAll_test.mjs [--port 3481] [--blend 1000] [--out screenshots/vrmaAll]
 */

import puppeteer from 'puppeteer';
import http      from 'http';
import fs        from 'fs';
import path      from 'path';
import { fileURLToPath } from 'url';

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const argVal = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i+1] : def; };
const PORT      = +argVal('--port', 3481);
const BLEND_MS  = +argVal('--blend', 1000);   // must match vrmaAll.html param
const OUT_DIR   = argVal('--out', 'screenshots/vrmaAll');
const SAMPLES   = [0, 0.25, 0.5, 0.75, 1.0];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;

fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Static file server ────────────────────────────────────────────────────────
const MIME = {
  '.html':'.html', '.js':'application/javascript', '.mjs':'application/javascript',
  '.json':'application/json', '.vrm':'model/gltf-binary', '.vrma':'model/gltf-binary',
  '.glb':'model/gltf-binary', '.png':'image/png', '.jpg':'image/jpeg',
  '.css':'text/css', '.wasm':'application/wasm',
};
function mimeOf(p) {
  const ext = path.extname(p).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}
const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0].split('#')[0];
  if (url === '/') url = '/index.html';
  const file = path.join(ROOT, url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': mimeOf(file) });
    res.end(data);
  });
});
await new Promise(res => server.listen(PORT, res));
console.log(`[server] http://localhost:${PORT}/`);

// ── Puppeteer ─────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  headless: false,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  protocolTimeout: 120_000,
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const URL = `http://localhost:${PORT}/vrmaAll.html?blend=${BLEND_MS}`;
console.log(`[open] ${URL}`);

// Capture console from the page
page.on('console', msg => console.log(`  [page] ${msg.text()}`));
page.on('pageerror', err => console.error(`  [page-error] ${err.message}`));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 });
await page.bringToFront();

// ── Wait for first blend phase ─────────────────────────────────────────────────
console.log('[wait] waiting for phase = blending…');
await page.waitForFunction(
  () => window.vrmaCtrl?.phase === 'blending',
  { timeout: 60_000, polling: 100 }
);
console.log('[wait] blending phase detected');

// Read animation labels from the page for the report
const animLabel = await page.evaluate(() => document.getElementById('desc')?.textContent ?? '?');
console.log(`[anim] transitioning: ${animLabel}`);

// ── Sample the blend ──────────────────────────────────────────────────────────
const snapshots = [];   // { t, bones, imgPath }

for (const t of SAMPLES) {
  // Seek blend (also sets _blendHeld = true on first call)
  await page.evaluate(t => window.vrmaCtrl.seekBlend(t), t);

  // Give GPU a moment to flush
  await new Promise(r => setTimeout(r, 80));
  await page.bringToFront();

  const imgPath = path.join(OUT_DIR, `blend_t${String(t).replace('.','p')}.png`);
  await page.screenshot({ path: imgPath });
  console.log(`  [screenshot] t=${t} → ${imgPath}`);

  const bones = await page.evaluate(() => window.vrmaCtrl.getBones());
  snapshots.push({ t, bones, imgPath });
}

// ── Resume auto-play ──────────────────────────────────────────────────────────
await page.evaluate(() => window.vrmaCtrl.relBlend());
console.log('[resume] auto-play resumed');

// ── Compute bone diffs t=0 → t=1 ─────────────────────────────────────────────
const bonesAt0 = snapshots[0].bones;
const bonesAt1 = snapshots[snapshots.length - 1].bones;

const allBones = new Set([...Object.keys(bonesAt0), ...Object.keys(bonesAt1)]);
const diffs = [];

for (const name of allBones) {
  const q0 = bonesAt0[name];
  const q1 = bonesAt1[name];
  if (!q0 || !q1) continue;
  // dot product (clamped to [0,1] — quaternions can be antipodal)
  const dot = Math.abs(q0.x*q1.x + q0.y*q1.y + q0.z*q1.z + q0.w*q1.w);
  const angleDeg = (Math.acos(Math.min(1, dot)) * 2 * 180 / Math.PI).toFixed(1);
  diffs.push({ name, dot: dot.toFixed(4), angleDeg });
}

// Sort by largest angle diff first
diffs.sort((a, b) => parseFloat(b.angleDeg) - parseFloat(a.angleDeg));

console.log('\n── Bone diff: t=0 (exit pose) vs t=1 (entry pose) ──────────────────');
console.log(`${'bone'.padEnd(30)} ${'dot'.padStart(6)}  angle(deg)`);
console.log('─'.repeat(52));
for (const { name, dot, angleDeg } of diffs) {
  console.log(`${name.padEnd(30)} ${dot.padStart(6)}  ${angleDeg}°`);
}

const avgAngle = (diffs.reduce((s, d) => s + parseFloat(d.angleDeg), 0) / diffs.length).toFixed(2);
const maxAngle = diffs[0]?.angleDeg ?? '0';
console.log('─'.repeat(52));
console.log(`avg angle: ${avgAngle}°   max angle: ${maxAngle}°  (${diffs.length} bones)`);

// ── Build contact sheet with sharp (if available) or node-canvas ──────────────
// Attempt a simple HTML contact sheet (always works)
const contactHtml = `<!doctype html><html><head><meta charset="utf-8">
<title>vrmaAll blend contact sheet</title>
<style>body{margin:0;background:#111;display:flex;gap:4px;padding:4px}
img{width:256px;height:144px;object-fit:cover}
p{color:#fff;font:11px monospace;margin:2px 0;text-align:center}</style></head><body>
${snapshots.map(s => `<div><img src="${path.basename(s.imgPath)}"><p>t=${s.t}</p></div>`).join('\n')}
</body></html>`;
const contactPath = path.join(OUT_DIR, 'contact.html');
fs.writeFileSync(contactPath, contactHtml);
console.log(`\n[contact] ${contactPath}`);

// ── JSON report ────────────────────────────────────────────────────────────────
const report = {
  url: URL,
  blendMs: BLEND_MS,
  animLabel,
  samples: snapshots.map(s => ({ t: s.t, imgPath: s.imgPath, bones: s.bones })),
  diffs,
  avgAngleDeg: avgAngle,
  maxAngleDeg: maxAngle,
};
const reportPath = path.join(OUT_DIR, 'report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`[report] ${reportPath}`);

// ── Teardown ──────────────────────────────────────────────────────────────────
await browser.close();
server.close();
console.log('\n[done]');
