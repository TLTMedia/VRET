
import puppeteer       from 'puppeteer';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
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

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

const VRM = 'models/Seed-san.vrm';
const VRMA = 'vrma/02_01.vrma';
const AF_URL = `http://localhost:${PORT}/animate.html?model=${VRM}#${VRMA}`;
const BAB_URL = `http://localhost:${PORT}/babvrm.html?model=${VRM}#${VRMA}`;

async function monitor(url, name) {
  const page = await browser.newPage();
  page.on('console', m => console.log(`[${name}] ${m.text()}`));
  console.log(`[${name}] Opening ${url}`);
  await page.goto(url);
  await page.waitForFunction(() => window.animationReady === true, { timeout: 60000 });
  console.log(`[${name}] Ready`);

  const bones = ['shoulder.L', 'robo_shoulder.L', 'robo_forearm.L'];
  for (let i = 0; i < 5; i++) {
    const t = i * 0.5;
    const quats = await page.evaluate((t, b) => window.getBoneQuats(t, b), t, bones);
    console.log(`[${name}] t=${t}s:`);
    bones.forEach(b => {
      const q = quats[b] || {x:0,y:0,z:0,w:1};
      console.log(`  ${b.padEnd(15)}: x=${q.x.toFixed(4)} y=${q.y.toFixed(4)} z=${q.z.toFixed(4)} w=${q.w.toFixed(4)}`);
    });
    await new Promise(r => setTimeout(r, 100));
  }
  await page.close();
}

await monitor(AF_URL, 'A-Frame');
await monitor(BAB_URL, 'Babylon');

await browser.close();
server.close();
process.exit(0);
