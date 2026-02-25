
import puppeteer       from 'puppeteer';
import { createServer } from 'http';
import { readFile }      from 'fs/promises';
import { extname, join }  from 'path';
import { fileURLToPath }  from 'url';
import { dirname }        from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;
const PORT      = 3479;

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

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();

page.on('console', msg => console.log('BABYLON:', msg.text()));
page.on('pageerror', err => console.log('BABYLON ERROR:', err.toString()));

await page.goto(`http://localhost:${PORT}/babvrm.html`, { waitUntil: 'domcontentloaded' });

console.log('Waiting for VRM to load in Babylon...');
await page.waitForFunction(() => window.animationReady === true, { timeout: 60_000 });

const bones = await page.evaluate(() => {
    const mgr = window.scene.metadata?.vrmManagers?.[0];
    if (!mgr) return null;
    return Object.keys(mgr.humanoidBone);
});

console.log('Humanoid bones found:', bones);

await browser.close();
server.close();
process.exit(0);
