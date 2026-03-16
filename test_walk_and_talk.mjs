/**
 * test_walk_and_talk.mjs
 * 
 * Simple Puppeteer script to capture console logs and errors from walk_and_talk.html
 */

import puppeteer       from 'puppeteer';
import { createServer } from 'http';
import { readFile }     from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname }      from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;
const PORT      = 3488;

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
console.log(`\n🌐 Server running at http://localhost:${PORT}\n`);

// ─── Puppeteer ──────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox']
});

const page = await browser.newPage();

// Capture console logs
page.on('console', msg => {
  const type = msg.type().toUpperCase();
  console.log(`[BROWSER ${type}] ${msg.text()}`);
});

// Capture page errors (crashes, unhandled exceptions)
page.on('pageerror', err => {
  console.error(`[BROWSER ERROR] ${err.toString()}`);
});

// Capture all requests to find 404s
page.on('response', response => {
  if (response.status() >= 400) {
    console.error(`[BROWSER HTTP ${response.status()}] ${response.url()}`);
  }
});

// Capture failed requests (404s etc)
page.on('requestfailed', request => {
  const failure = request.failure();
  console.error(`[BROWSER NETWORK ERROR] ${failure ? failure.errorText : 'Unknown'} | URL: ${request.url()}`);
});

console.log('Opening walk_and_talk.html...');
try {
  await page.goto(`http://localhost:${PORT}/walk_and_talk.html`, {
    waitUntil: 'networkidle0',
    timeout: 60000
  });
  
  console.log('\nPage loaded. Waiting 10s for any async errors or logs...');
  await new Promise(r => setTimeout(r, 10000));

} catch (e) {
  console.error(`Puppeteer error: ${e.message}`);
}

console.log('\nClosing browser...');
await browser.close();
server.close();
process.exit(0);
