
import puppeteer       from 'puppeteer';
import { createServer } from 'http';
import { readFile }      from 'fs/promises';
import { extname, join }  from 'path';
import { fileURLToPath }  from 'url';
import { dirname }        from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;
const PORT      = 3478;

const SAMPLE_TIMES = [0.0, 0.5, 1.0];

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
console.log(`
🌐 http://localhost:${PORT}
`);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

const AFRAME_URL  = `http://localhost:${PORT}/animate.html?model=models/AIAN/AIAN_F_1_Casual.vrm#vrma/40_11.vrma`;
const BABYLON_URL = `http://localhost:${PORT}/babvrm.html#vrma/40_11.vrma`;

const [afPage, babPage] = await Promise.all([
  browser.newPage(),
  browser.newPage(),
]);

afPage.on('console', msg => console.log('AFRAME:', msg.text()));
babPage.on('console', msg => console.log('BABYLON:', msg.text()));

afPage.on('pageerror', err => console.log('AFRAME ERROR:', err.toString()));
babPage.on('pageerror', err => console.log('BABYLON ERROR:', err.toString()));

console.log('Opening pages…');
await Promise.all([
  afPage.goto(AFRAME_URL,  { waitUntil: 'domcontentloaded' }),
  babPage.goto(BABYLON_URL, { waitUntil: 'domcontentloaded' }),
]);

console.log('Waiting for animations to load…');
await Promise.all([
  afPage.waitForFunction(() => window.animationReady === true, { timeout: 60_000 }),
  babPage.waitForFunction(() => window.animationReady === true, { timeout: 60_000 }),
]);

for (const t of SAMPLE_TIMES) {
  console.log(`
--- Time: ${t}s ---`);

  const [afQuats, babQuats] = await Promise.all([
    afPage.evaluate( t => window.getBoneQuats(t), t),
    babPage.evaluate(t => window.getBoneQuats(t), t),
  ]);

  if (!afQuats || !babQuats) {
    console.log('Error: Could not get bone quaternions');
    continue;
  }

  const bones = Object.keys(afQuats);
  for (const bone of bones) {
    const aq = afQuats[bone];
    const bq = babQuats[bone];
    if (!bq) {
        console.log(`Bone ${bone}: Missing in Babylon`);
        continue;
    }

    const dot = Math.abs(aq.x * bq.x + aq.y * bq.y + aq.z * bq.z + aq.w * bq.w);
    const diff = (1 - dot).toFixed(6);
    
    if (dot < 0.999) {
        console.log(`Bone ${bone.padEnd(15)}: DIFF=${diff} | AF: [${aq.x}, ${aq.y}, ${aq.z}, ${aq.w}] | BAB: [${bq.x}, ${bq.y}, ${bq.z}, ${bq.w}]`);
    } else {
        // console.log(`Bone ${bone.padEnd(15)}: OK`);
    }
  }
}

await browser.close();
server.close();
process.exit(0);
