/**
 * walk_test.mjs — compare walk_and_talk.html vs walk_and_talk_v9.html
 * Opens both pages, clicks Play, captures console errors and screenshots.
 * Usage: node walk_test.mjs
 */
import puppeteer       from 'puppeteer';
import { createServer } from 'http';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname }       from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = 3493;
const OUT  = join(ROOT, 'screenshots/walk_test');

const MIME = {
  '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.json':'application/json', '.vrm':'model/gltf-binary',
  '.vrma':'model/gltf-binary', '.glb':'model/gltf-binary',
  '.png':'image/png', '.jpg':'image/jpeg', '.wav':'audio/wav',
  '.aiff':'audio/aiff',
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
console.log(`\n🌐 http://localhost:${PORT}\n`);

const browser = await puppeteer.launch({
  headless: false,
  protocolTimeout: 120_000,
  args: ['--no-sandbox','--disable-background-timer-throttling',
         '--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],
});

async function testPage(label, url) {
  console.log(`\n── ${label} ─────────────────────────────────`);
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });

  const errors = [];
  const warns  = [];
  const logs   = [];
  page.on('console', m => {
    const t = m.type(), txt = m.text();
    if (t === 'error') { errors.push(txt); console.log(`  [ERR] ${txt}`); }
    else if (t === 'warn') { warns.push(txt); console.log(`  [WRN] ${txt}`); }
    else { logs.push(txt); console.log(`  [LOG] ${txt}`); }
  });
  page.on('pageerror', e => { errors.push(e.message); console.error(`  [PAGE ERR] ${e.message}`); });

  await page.goto(`http://localhost:${PORT}/${url}`, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();

  // Wait up to 30s for status to show 'Ready' (or error)
  const statusText = await page.evaluate(() => new Promise(resolve => {
    const el = document.getElementById('status') || document.getElementById('statusEl');
    if (!el) return resolve('(no status element)');
    const check = () => {
      const t = el.textContent ?? '';
      if (t.includes('Ready') || t.includes('Error') || t.includes('error')) return resolve(t);
      setTimeout(check, 300);
    };
    check();
    setTimeout(() => resolve(el?.textContent ?? 'timeout'), 30_000);
  }));
  console.log(`  status: "${statusText}"`);

  // Click play if available
  const played = await page.evaluate(() => {
    const btn = document.getElementById('playBtn') || document.getElementById('play-btn');
    if (btn && !btn.disabled) { btn.click(); return true; }
    return false;
  });
  console.log(`  playBtn clicked: ${played}`);

  // Wait 3s for animation to run
  await new Promise(r => setTimeout(r, 3000));
  await page.bringToFront();

  // Grab status again after play
  const statusAfter = await page.evaluate(() => {
    const el = document.getElementById('status');
    return el?.textContent ?? '(none)';
  });
  console.log(`  status after play: "${statusAfter}"`);

  // Screenshot
  const shot = await page.screenshot({ type: 'png' });
  await writeFile(join(OUT, `${label.replace(/\s/g,'_')}.png`), shot);
  console.log(`  screenshot → ${label.replace(/\s/g,'_')}.png`);

  // Check for visible bones / animation (read desc element)
  const desc = await page.evaluate(() => document.getElementById('desc')?.textContent ?? '');
  console.log(`  desc: "${desc}"`);

  // Check for AnimationGroupMask / Babylon version
  const babInfo = await page.evaluate(() => {
    return {
      version: BABYLON?.Engine?.Version ?? '?',
      hasMask: typeof BABYLON?.AnimationGroupMask !== 'undefined',
      hasMaskMode: typeof BABYLON?.AnimationGroupMaskMode !== 'undefined',
      hasImportMesh: typeof BABYLON?.ImportMeshAsync === 'function',
      hasSceneLoaderImport: typeof BABYLON?.SceneLoader?.ImportMeshAsync === 'function',
    };
  }).catch(() => ({}));
  console.log(`  Babylon: v${babInfo.version}`);
  console.log(`  AnimationGroupMask available: ${babInfo.hasMask}`);
  console.log(`  AnimationGroupMaskMode available: ${babInfo.hasMaskMode}`);
  console.log(`  BABYLON.ImportMeshAsync: ${babInfo.hasImportMesh}`);
  console.log(`  BABYLON.SceneLoader.ImportMeshAsync: ${babInfo.hasSceneLoaderImport}`);

  console.log(`  errors: ${errors.length}  warns: ${warns.length}`);
  await page.close();
  return { errors, warns };
}

const r1 = await testPage('walk_v1', 'walk_and_talk.html');
const r2 = await testPage('walk_v9', 'walk_and_talk_v9.html');

console.log('\n── Summary ──────────────────────────────────────');
console.log(`walk_and_talk.html   errors: ${r1.errors.length}`);
console.log(`walk_and_talk_v9.html errors: ${r2.errors.length}`);
if (r2.errors.length) {
  console.log('\nv9 errors:');
  r2.errors.forEach(e => console.log(' ', e));
}

await browser.close();
server.close();
process.exit(0);
