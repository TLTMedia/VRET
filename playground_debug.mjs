/**
 * playground_debug.mjs — diagnose vrm_playground.html via Puppeteer
 * Usage: node playground_debug.mjs
 */
import puppeteer from 'puppeteer';
import { createServer } from 'http';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = 3501;
const OUT  = join(ROOT, 'screenshots/playground_debug');

const MIME = {
  '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
  '.json':'application/json','.vrm':'model/gltf-binary',
  '.vrma':'model/gltf-binary','.glb':'model/gltf-binary',
  '.png':'image/png','.jpg':'image/jpeg',
};
const server = createServer(async (req, res) => {
  const url  = req.url.split('?')[0].split('#')[0];
  const path = join(ROOT, decodeURIComponent(url === '/' ? '/vrm_playground.html' : url));
  try { const d = await readFile(path); res.writeHead(200,{'Content-Type':MIME[extname(path)]??'application/octet-stream'}); res.end(d); }
  catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(r => server.listen(PORT, r));
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: false, protocolTimeout: 120_000,
  args: ['--no-sandbox','--disable-background-timer-throttling',
         '--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],
});

const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });

// Log everything — no noise filter for debugging
page.on('console', m => console.log(`  [${m.type()}] ${m.text()}`));
page.on('pageerror', e => console.error(`  [PAGEERROR] ${e.message}`));
page.on('requestfailed', r => console.error(`  [REQFAIL] ${r.url()} — ${r.failure()?.errorText}`));

console.log('\nLoading vrm_playground.html…');
await page.goto(`http://localhost:${PORT}/vrm_playground.html`, { waitUntil: 'domcontentloaded' });
await page.bringToFront();

// Wait up to 60s for status to leave "initializing" or "Loading"
console.log('Waiting for status to settle…');
try {
  await page.waitForFunction(() => {
    const s = document.getElementById('status');
    if (!s) return false;
    const t = s.textContent;
    return !t.includes('initializing') && !t.includes('Loading');
  }, { timeout: 60_000 });
} catch {
  console.log('  Timed out waiting for status');
}

const status = await page.evaluate(() => document.getElementById('status')?.textContent ?? '(no status)');
console.log(`\nFinal status: "${status}"`);

// Dump scene state
const sceneInfo = await page.evaluate(() => {
  try {
    const e = BABYLON.Engine.Instances[0];
    if (!e) return { error: 'No BABYLON engine' };
    const s = e.scenes[0];
    if (!s) return { error: 'No scene' };
    return {
      meshes:         s.meshes.map(m => m.name),
      transformNodes: s.transformNodes.map(n => n.name).slice(0, 20),
      animGroups:     s.animationGroups.map(g => g.name),
      vrmManagers:    s.metadata?.vrmManagers?.length ?? 0,
      vrmAnimManagers:s.metadata?.vrmAnimationManagers?.length ?? 0,
    };
  } catch(e) { return { error: e.message }; }
});
console.log('\nScene state:');
console.log(JSON.stringify(sceneInfo, null, 2));

// Screenshot
await new Promise(r => setTimeout(r, 2000));
const buf = await page.screenshot({ type: 'png' });
await writeFile(join(OUT, 'result.png'), buf);
console.log('\nScreenshot → screenshots/playground_debug/result.png');

await browser.close();
server.close();
process.exit(0);
