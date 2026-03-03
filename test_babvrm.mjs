/**
 * test_babvrm.mjs — Puppeteer console analyser for babvrm.html
 * Usage: node test_babvrm.mjs [url]
 *   e.g. node test_babvrm.mjs http://127.0.0.1:5502/babvrm.html
 *        node test_babvrm.mjs http://127.0.0.1:5502/test_vrm1_break.html
 */
import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'screenshots');
await mkdir(OUT, { recursive: true });

const URL = process.argv[2] ?? 'http://127.0.0.1:5502/babvrm.html';
const TIMEOUT = 60_000;

const browser = await puppeteer.launch({
  headless: false,
  protocolTimeout: 120_000,
  args: [
    '--no-sandbox',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--use-angle=default',          // enable GPU/WebGL
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

// ── Collect all console messages ──────────────────────────────────────────────
const logs   = [];
const warns  = [];
const errors = [];

page.on('console', msg => {
  const type = msg.type();
  const text = msg.text();
  const entry = `[${type.toUpperCase()}] ${text}`;
  if (type === 'error')        errors.push(entry);
  else if (type === 'warning' || type === 'warn') warns.push(entry);
  else                         logs.push(entry);
  // Print everything live so you can watch in the terminal
  const prefix = type === 'error' ? '🔴' : type === 'warn' ? '🟡' : '   ';
  console.log(`${prefix} ${entry}`);
});

page.on('pageerror', e => {
  const entry = `[UNCAUGHT] ${e.message}`;
  errors.push(entry);
  console.error(`🔴 ${entry}`);
});

page.on('requestfailed', req => {
  const entry = `[NETFAIL] ${req.failure()?.errorText} — ${req.url()}`;
  errors.push(entry);
  console.error(`🔴 ${entry}`);
});

page.on('response', res => {
  if (res.status() >= 400) {
    const entry = `[HTTP ${res.status()}] ${res.url()}`;
    errors.push(entry);
    console.error(`🔴 ${entry}`);
  }
});

// ── Navigate ──────────────────────────────────────────────────────────────────
console.log(`\nOpening ${URL} …\n`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.bringToFront();

// ── Wait for animationReady or timeout ────────────────────────────────────────
let ready = false;
try {
  await page.waitForFunction(() => window.animationReady === true, { timeout: TIMEOUT });
  ready = true;
  console.log('\n✅ animationReady = true');
} catch {
  console.log(`\n⚠️  animationReady not set after ${TIMEOUT / 1000}s`);
}

// Give the render loop a moment
await new Promise(r => setTimeout(r, 1500));

// ── Screenshot ────────────────────────────────────────────────────────────────
const slug   = URL.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').slice(-40);
const outPng = join(OUT, `babvrm_${slug}.png`);
await page.screenshot({ path: outPng, type: 'png' });
console.log(`\n📸 Screenshot → ${outPng}`);

// ── Bone position snapshot (if scene is available) ────────────────────────────
const boneInfo = await page.evaluate(() => {
  const mgr = window.scene?.metadata?.vrmManagers?.[0];
  if (!mgr) return null;
  const hips  = mgr.humanoidBone?.['hips'];
  const lfoot = mgr.humanoidBone?.['leftFoot'];
  const hp = hips?.getAbsolutePosition?.()  ?? hips?.absolutePosition;
  const fp = lfoot?.getAbsolutePosition?.() ?? lfoot?.absolutePosition;
  return {
    hipsY:   hp  ? +hp.y.toFixed(3)  : null,
    lfootY:  fp  ? +fp.y.toFixed(3)  : null,
    tracks:  window.remappedGroup?.targetedAnimations?.length ?? null,
    animUrl: document.getElementById('status')?.textContent ?? null,
    vrmSpec: mgr?.meta?.specVersion ?? null,
  };
}).catch(() => null);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log('SUMMARY');
console.log('═'.repeat(60));
console.log(`URL:           ${URL}`);
console.log(`animationReady: ${ready}`);
if (boneInfo) {
  console.log(`VRM spec:      ${boneInfo.vrmSpec}`);
  console.log(`Current anim:  ${boneInfo.animUrl}`);
  console.log(`Tracks:        ${boneInfo.tracks}`);
  console.log(`Hips Y:        ${boneInfo.hipsY}`);
  console.log(`LeftFoot Y:    ${boneInfo.lfootY}`);
}
console.log(`\nErrors (${errors.length}):`);
errors.forEach(e => console.log('  ' + e));
console.log(`\nWarnings (${warns.length}):`);
warns.slice(0, 20).forEach(w => console.log('  ' + w));
if (warns.length > 20) console.log(`  … and ${warns.length - 20} more`);
console.log(`\nLogs: ${logs.length} messages`);
console.log('═'.repeat(60));

await browser.close();
