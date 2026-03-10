/**
 * vrmaAll_trans_test.mjs — Transition analysis for vrmaAll.html
 *
 * Waits for the first transition (phase = 'blending'), then freezes time at
 * t = 0, 0.25, 0.5, 0.75, 1.0 across the 1-second blend.
 *
 * At each sample it records:
 *   - hips WORLD position  (should be constant → world continuity check)
 *   - hips LOCAL position  (should lerp from exit to entry)
 *   - root node position   (should track to maintain world invariant)
 *   - selected bone quaternions
 *   - screenshot
 *
 * Then lets the new animation play for one frame and records the live
 * frame-0 state to verify start() produces the expected pose.
 *
 * Usage:
 *   node vrmaAll_trans_test.mjs [--port 3482] [--blend 1000] [--out screenshots/trans]
 */

import puppeteer from 'puppeteer';
import http      from 'http';
import fs        from 'fs';
import path      from 'path';
import { fileURLToPath } from 'url';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const argVal = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i+1] : def; };
const PORT     = +argVal('--port', 3482);
const BLEND_MS = +argVal('--blend', 1000);
const OUT_DIR  = argVal('--out', 'screenshots/trans');
const SAMPLES  = [0, 0.25, 0.5, 0.75, 1.0];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Static server ─────────────────────────────────────────────────────────────
const MIME = { '.html':'text/html', '.js':'application/javascript',
  '.mjs':'application/javascript', '.json':'application/json',
  '.vrm':'model/gltf-binary', '.vrma':'model/gltf-binary',
  '.glb':'model/gltf-binary', '.png':'image/png', '.css':'text/css' };
const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0].split('#')[0];
  if (url === '/') url = '/index.html';
  const file = path.join(__dirname, url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(res => server.listen(PORT, res));
console.log(`[server] http://localhost:${PORT}/`);

// ── Browser ───────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  headless: false,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl'],
  protocolTimeout: 120_000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('console', m => console.log(`  [page] ${m.text()}`));
page.on('pageerror', e => console.error(`  [page-err] ${e.message}`));

const URL = `http://localhost:${PORT}/vrmaAll.html?blend=${BLEND_MS}`;
console.log(`[open] ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90_000 });
await page.bringToFront();

// ── Wait for first playing phase ──────────────────────────────────────────────
console.log('[wait] waiting for phase = playing…');
await page.waitForFunction(() => window.vrmaCtrl?.phase === 'playing',
  { timeout: 60_000, polling: 200 });
const anim0 = await page.evaluate(() => window.vrmaCtrl.getAnimLabel());
console.log(`[anim-A] "${anim0}"`);

// Skip the first animation after 3s so we don't wait for long animations to end.
console.log('[skip] clicking Skip to force transition after 3 s…');
await new Promise(r => setTimeout(r, 3000));
await page.click('#skip-btn');

// ── Wait for blend phase ──────────────────────────────────────────────────────
console.log('[wait] waiting for phase = blending…');
await page.waitForFunction(() => window.vrmaCtrl?.phase === 'blending',
  { timeout: 30_000, polling: 100 });
await page.bringToFront();
console.log('[blend] transition detected — freezing…');

// ── Sample blend at each t ────────────────────────────────────────────────────
const samples = [];

for (const t of SAMPLES) {
  await page.evaluate(t => window.vrmaCtrl.seekBlend(t), t);
  await new Promise(r => setTimeout(r, 60)); // GPU flush
  await page.bringToFront();

  const tag  = String(t).replace('.', 'p');
  const img  = path.join(OUT_DIR, `t${tag}.png`);
  await page.screenshot({ path: img });

  const data = await page.evaluate(() => ({
    bones:    window.vrmaCtrl.getBones(),
    pos:      window.vrmaCtrl.getPositions(),
    label:    window.vrmaCtrl.getAnimLabel(),
  }));
  samples.push({ t, img, ...data });
  console.log(`  t=${t}  hipsWorld=${JSON.stringify(data.pos.hipsWorld)}  hipsLocal=${JSON.stringify(data.pos.hipsLocal)}  root=${JSON.stringify(data.pos.rootPos)}`);
}

// ── Resume and wait for new animation to start ────────────────────────────────
await page.evaluate(() => window.vrmaCtrl.relBlend());
console.log('[resume] auto-play resumed, waiting for next playing phase…');

await page.waitForFunction(() => window.vrmaCtrl?.phase === 'playing',
  { timeout: 30_000, polling: 50 });
await new Promise(r => setTimeout(r, 20)); // one render frame — sample actual frame-0
await page.bringToFront();

const liveImg  = path.join(OUT_DIR, 'live_frame0.png');
await page.screenshot({ path: liveImg });
const liveData = await page.evaluate(() => ({
  bones: window.vrmaCtrl.getBones(),
  pos:   window.vrmaCtrl.getPositions(),
  label: window.vrmaCtrl.getAnimLabel(),
}));
console.log(`[live]  hipsWorld=${JSON.stringify(liveData.pos.hipsWorld)}  label="${liveData.label}"`);

// Sample again after 200ms to check animation is actually progressing.
await new Promise(r => setTimeout(r, 200));
await page.bringToFront();
const liveImg2  = path.join(OUT_DIR, 'live_frame200ms.png');
await page.screenshot({ path: liveImg2 });
const liveData2 = await page.evaluate(() => ({
  bones: window.vrmaCtrl.getBones(),
  pos:   window.vrmaCtrl.getPositions(),
}));
console.log(`[live2] hipsWorld=${JSON.stringify(liveData2.pos.hipsWorld)}`);

// ── Analysis ──────────────────────────────────────────────────────────────────
const s0 = samples[0];   // t=0  — exit pose
const s1 = samples[samples.length - 1];  // t=1 — entry pose

console.log('\n══ World-position continuity (hipsWorld should be constant) ══════');
console.log(`${'t'.padStart(5)}  ${'hipsWorld.x'.padStart(12)}  ${'hipsWorld.y'.padStart(12)}  ${'hipsWorld.z'.padStart(12)}`);
console.log('─'.repeat(50));
for (const s of [...samples, { t:'live', pos: liveData.pos }]) {
  const p = s.pos?.hipsWorld;
  if (!p) continue;
  const xDiff = p.x - s0.pos.hipsWorld.x;
  const zDiff = p.z - s0.pos.hipsWorld.z;
  const flag  = (Math.abs(xDiff) > 0.01 || Math.abs(zDiff) > 0.01) ? ' ← DRIFT' : '';
  console.log(`${String(s.t).padStart(5)}  ${String(p.x).padStart(12)}  ${String(p.y).padStart(12)}  ${String(p.z).padStart(12)}${flag}`);
}

console.log('\n══ Hips LOCAL position (should lerp from t=0 to t=1) ═════════════');
console.log(`${'t'.padStart(5)}  ${'local.x'.padStart(10)}  ${'local.y'.padStart(10)}  ${'local.z'.padStart(10)}`);
console.log('─'.repeat(44));
for (const s of samples) {
  const p = s.pos?.hipsLocal;
  if (!p) continue;
  console.log(`${String(s.t).padStart(5)}  ${String(p.x).padStart(10)}  ${String(p.y).padStart(10)}  ${String(p.z).padStart(10)}`);
}

console.log('\n══ Root node position (moves to compensate hips local change) ════');
console.log(`${'t'.padStart(5)}  ${'root.x'.padStart(10)}  ${'root.y'.padStart(10)}  ${'root.z'.padStart(10)}`);
console.log('─'.repeat(44));
for (const s of samples) {
  const p = s.pos?.rootPos;
  if (!p) continue;
  console.log(`${String(s.t).padStart(5)}  ${String(p.x).padStart(10)}  ${String(p.y).padStart(10)}  ${String(p.z).padStart(10)}`);
}

console.log('\n══ Bone-rotation diff: t=0 (exit) vs t=1 (entry) ════════════════');
const allBones = new Set([...Object.keys(s0.bones), ...Object.keys(s1.bones)]);
const diffs = [];
for (const name of allBones) {
  const q0 = s0.bones[name], q1 = s1.bones[name];
  if (!q0 || !q1) continue;
  const dot = Math.abs(q0.x*q1.x + q0.y*q1.y + q0.z*q1.z + q0.w*q1.w);
  diffs.push({ name, dot: dot.toFixed(4), deg: (Math.acos(Math.min(1,dot))*2*180/Math.PI).toFixed(1) });
}
diffs.sort((a,b) => parseFloat(b.deg)-parseFloat(a.deg));
console.log(`${'bone'.padEnd(30)} ${'dot'.padStart(6)}  ${'angle°'.padStart(7)}`);
console.log('─'.repeat(48));
for (const d of diffs) {
  console.log(`${d.name.padEnd(30)} ${d.dot.padStart(6)}  ${d.deg.padStart(7)}°`);
}
const avgDeg = (diffs.reduce((s,d)=>s+parseFloat(d.deg),0)/diffs.length).toFixed(2);
console.log('─'.repeat(48));
console.log(`avg: ${avgDeg}°   max: ${diffs[0]?.deg}°  across ${diffs.length} bones`);

// ── T-pose / identity-pose detection ─────────────────────────────────────────
// Score = Σ(1 − |q.w|) across all bones.  T-pose (identity quats) → ~0.
// A real motion pose with several 90°+ rotations should score >> 1.
const tPoseScore = bones => Object.values(bones).reduce((s, q) => s + (1 - Math.abs(q.w)), 0);
const exitScore  = tPoseScore(s0.bones);
const entryScore = tPoseScore(s1.bones);
const liveScore  = tPoseScore(liveData.bones);
const T_THRESH   = 0.05;  // anything below is effectively identity / T-pose
console.log('\n══ T-pose score (Σ(1−|q.w|) — near 0 = identity/T-pose) ═══════');
console.log(`  exit  (t=0): ${exitScore.toFixed(4)}  ${exitScore  < T_THRESH ? '⚠ T-POSE!' : '✓'}`);
console.log(`  entry (t=1): ${entryScore.toFixed(4)}  ${entryScore < T_THRESH ? '⚠ T-POSE!' : '✓'}`);
console.log(`  live  frame: ${liveScore.toFixed(4)}  ${liveScore  < T_THRESH ? '⚠ T-POSE!' : '✓'}`);
const tPoseFail = exitScore < T_THRESH && entryScore < T_THRESH;
if (tPoseFail) {
  console.log('  ✗ FAIL: both poses are near T-pose — animation capture / goToFrame is broken.');
  process.exitCode = 1;
}

// ── Trivial blend check ───────────────────────────────────────────────────────
// If exit pose ≈ entry pose, findMotionFrame returned the same frame as the
// previous exit (e.g. T-pose or standing-pose reference at frame 0).
// The blend would have no visual effect regardless of XZ continuity.
console.log('\n══ Trivial blend check (exit vs entry pose diff) ═════════════════');
const maxBlendDiff = parseFloat(diffs[0]?.deg ?? 0);
const avgBlendDiff = parseFloat(avgDeg);
if (maxBlendDiff < 5) {
  console.log(`  ✗ FAIL: max diff = ${maxBlendDiff}°, avg = ${avgBlendDiff}° — exit ≈ entry, blend is trivial`);
  console.log('         findMotionFrame may be returning a reference/T-pose frame.');
  process.exitCode = 1;
} else {
  console.log(`  ✓ max diff = ${maxBlendDiff}°, avg = ${avgBlendDiff}° — poses are meaningfully different`);
}

// ── Static animation check ────────────────────────────────────────────────────
// If the live animation has not moved at all after 200ms, it is likely stuck.
// We check BOTH bone rotations AND hips world position: a slow seated animation
// may show <2° bone change but still have measurable position drift.
// Threshold: max bone > 0.5° OR hips world pos changes > 0.001 units.
console.log('\n══ Animation progress check (frame-0 vs frame+200ms) ═════════════');
const allBonesP = new Set([...Object.keys(liveData.bones), ...Object.keys(liveData2.bones)]);
const progressDiffs = [];
for (const name of allBonesP) {
  const q0 = liveData.bones[name], q1 = liveData2.bones[name];
  if (!q0 || !q1) continue;
  const dot = Math.abs(q0.x*q1.x + q0.y*q1.y + q0.z*q1.z + q0.w*q1.w);
  const deg = (Math.acos(Math.min(1, dot))*2*180/Math.PI).toFixed(1);
  if (parseFloat(deg) > 0.3) progressDiffs.push({ name, deg });
}
progressDiffs.sort((a,b) => parseFloat(b.deg)-parseFloat(a.deg));
const maxProgress = parseFloat(progressDiffs[0]?.deg ?? 0);
const p0 = liveData.pos?.hipsWorld, p1 = liveData2.pos?.hipsWorld;
const hipsDelta = p0 && p1 ? Math.sqrt((p1.x-p0.x)**2 + (p1.y-p0.y)**2 + (p1.z-p0.z)**2) : 0;
const animMoving = maxProgress > 0.5 || hipsDelta > 0.001;
if (!animMoving) {
  console.log(`  ✗ FAIL: max bone change = ${maxProgress}°, hips delta = ${hipsDelta.toFixed(4)} — animation appears static`);
  console.log('         May be stuck at a reference frame (findMotionFrame or start() issue).');
  process.exitCode = 1;
} else {
  console.log(`  ✓ animation progressing — max bone = ${maxProgress}°, hips delta = ${hipsDelta.toFixed(4)} in 200ms`);
  if (progressDiffs.length > 0 && progressDiffs.length <= 5) {
    for (const d of progressDiffs) console.log(`    ${d.name.padEnd(30)} ${d.deg}°`);
  }
}

console.log('\n══ Blend-end (t=1) vs live frame-0 comparison ═══════════════════');
const allBones2 = new Set([...Object.keys(s1.bones), ...Object.keys(liveData.bones)]);
const liveDiffs = [];
for (const name of allBones2) {
  const qBlend = s1.bones[name], qLive = liveData.bones[name];
  if (!qBlend || !qLive) continue;
  const dot = Math.abs(qBlend.x*qLive.x + qBlend.y*qLive.y + qBlend.z*qLive.z + qBlend.w*qLive.w);
  const deg = (Math.acos(Math.min(1,dot))*2*180/Math.PI).toFixed(1);
  if (parseFloat(deg) > 1) liveDiffs.push({ name, dot: dot.toFixed(4), deg });
}
liveDiffs.sort((a,b)=>parseFloat(b.deg)-parseFloat(a.deg));
if (liveDiffs.length === 0) {
  console.log('  ✓ blend t=1 matches live frame-0 (no bones > 1° off)');
} else {
  console.log(`  ${liveDiffs.length} bones differ > 1° between blend-end and live:`);
  for (const d of liveDiffs.slice(0, 10)) {
    console.log(`    ${d.name.padEnd(30)} ${d.deg}°`);
  }
}

// ── Contact sheet ─────────────────────────────────────────────────────────────
const contact = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#111;display:flex;flex-wrap:wrap;gap:4px;padding:4px}
img{width:240px;height:135px;object-fit:cover}p{color:#fff;font:10px monospace;margin:2px 0;text-align:center}
</style></head><body>
${samples.map(s=>`<div><img src="${path.basename(s.img)}">
<p>t=${s.t} | ${JSON.stringify(s.pos?.hipsWorld)}</p></div>`).join('\n')}
<div><img src="live_frame0.png"><p>live frame-0 | ${JSON.stringify(liveData.pos?.hipsWorld)}</p></div>
<div><img src="live_frame200ms.png"><p>live +200ms | ${JSON.stringify(liveData2.pos?.hipsWorld)}</p></div>
</body></html>`;
fs.writeFileSync(path.join(OUT_DIR, 'contact.html'), contact);

// ── JSON report ───────────────────────────────────────────────────────────────
const report = { url: URL, blendMs: BLEND_MS, animA: anim0, animB: liveData.label,
  samples: samples.map(s=>({t:s.t, pos:s.pos, img:s.img})),
  liveFrame0: { pos: liveData.pos, img: liveImg },
  live200ms:  { pos: liveData2.pos, img: liveImg2 },
  boneDiffs: diffs, liveDiffs, progressDiffs };
fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n[done] ${OUT_DIR}/contact.html`);

await browser.close();
server.close();
