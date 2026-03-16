import puppeteer       from 'puppeteer';
import { createServer } from 'http';
import { readFile, mkdir } from 'fs/promises';
import { extname, join }  from 'path';
import { fileURLToPath }  from 'url';
import { dirname }        from 'path';
import { PNG }            from 'pngjs';
import pixelmatch         from 'pixelmatch';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;
const PORT      = 3478;
const OUT_DIR   = join(ROOT, 'screenshots_seed');

const SAMPLE_TIMES = [0.1, 0.3, 0.5, 0.7, 0.9];
const VIEWPORT = { width: 640, height: 480 };

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
console.log('Server-Running-on-Port-' + PORT);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox'],
});

const VRM         = 'models/Seed-san.vrm';
const VRMA        = 'vrma/13_29.vrma';
const AFRAME_URL  = `http://localhost:${PORT}/animate.html?model=${VRM}#${VRMA}`;
const BABYLON_URL = `http://localhost:${PORT}/babvrm.html?model=${VRM}#${VRMA}`;

const afPage  = await browser.newPage();
const babPage = await browser.newPage();
await afPage.setViewport(VIEWPORT);
await babPage.setViewport(VIEWPORT);

afPage.on('console', m => console.log('AF:', m.text()));
babPage.on('console', m => console.log('BAB:', m.text()));

console.log('Opening-Pages');
await afPage.goto(AFRAME_URL);
await babPage.goto(BABYLON_URL);

console.log('Waiting-for-Ready');
await afPage.waitForFunction(() => window.animationReady === true, { timeout: 120000 });
await babPage.waitForFunction(() => window.animationReady === true, { timeout: 120000 });

const EXTRA_BONES = ['robo_wire', 'robo_wire.001', 'robo_wire.002', 'robo_wire.003'];

console.log('Sampling');
for (const t of SAMPLE_TIMES) {
  const tag = `t${t.toFixed(2).replace('.', '_')}`;
  console.log(`📸 Sampling t=${t}s…`);
  
  await afPage.bringToFront();
  const afQuats = await afPage.evaluate((t, bones) => window.getBoneQuats(t, bones), t, EXTRA_BONES);
  const afBuf = await afPage.screenshot();

  await babPage.bringToFront();
  const babQuats = await babPage.evaluate((t, bones) => window.getBoneQuats(t, bones), t, EXTRA_BONES);
  const babBuf = await babPage.screenshot();

  // Log robo_wire rotations for first sample
  if (t === SAMPLE_TIMES[0]) {
    console.log('--- RoboWire Rotations ---');
    for (const b of EXTRA_BONES) {
      const aq = afQuats[b] || {x:0,y:0,z:0,w:1};
      const bq = babQuats[b] || {x:0,y:0,z:0,w:1};
      console.log(`  ${b.padEnd(15)} AF: x=${aq.x},y=${aq.y} | BAB: x=${bq.x},y=${bq.y}`);
    }
  }

  const afPath = join(OUT_DIR, `${tag}_aframe.png`);
  const babPath = join(OUT_DIR, `${tag}_babylon.png`);
  const diffPath = join(OUT_DIR, `${tag}_diff.png`);

  await readFile(afPath).catch(() => {}).then(() => {}); // dummy
  const fs = await import('fs');
  await fs.promises.writeFile(afPath, afBuf);
  await fs.promises.writeFile(babPath, babBuf);

  const afImg = PNG.sync.read(afBuf);
  const babImg = PNG.sync.read(babBuf);
  const diffImg = new PNG({ width: VIEWPORT.width, height: VIEWPORT.height });
  const numDiff = pixelmatch(afImg.data, babImg.img ? babImg.img.data : babImg.data, diffImg.data, VIEWPORT.width, VIEWPORT.height, { threshold: 0.1 });
  
  await fs.promises.writeFile(diffPath, PNG.sync.write(diffImg));
  console.log(`Diff-${tag}: ${numDiff}`);
}

console.log('Done');
await browser.close();
server.close();
process.exit(0);
