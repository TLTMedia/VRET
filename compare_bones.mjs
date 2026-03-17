
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
console.log(`🌐 http://localhost:${PORT}`);

const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 120_000,
  args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});

const AFRAME_URL  = `http://localhost:${PORT}/animate.html?model=models/Seed-san.vrm#vrma/40_11.vrma`;
const BABYLON_URL = `http://localhost:${PORT}/babvrm_node_constraint.html?model=models/Seed-san.vrm#vrma/40_11.vrma`;

// Robo-arm constraint target bones — driven by VRMC_node_constraint, not animation
const ROBO_BONES = [
  'robo_shoulder.L', 'robo_upper_arm.L', 'robo_forearm.L', 'robo_hand.L',
  'robo_f_index.01.L', 'robo_f_index.02.L', 'robo_f_index.03.L',
  'robo_thumb.01.L',  'robo_thumb.02.L',   'robo_thumb.03.L',
];

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
await afPage.bringToFront();
await afPage.waitForFunction(() => window.animationReady === true, { timeout: 60_000 });
await babPage.bringToFront();
await babPage.waitForFunction(() => window.animationReady === true, { timeout: 60_000 });

for (const t of SAMPLE_TIMES) {
  console.log(`
--- Time: ${t}s ---`);

  const [afQuats, babQuats] = await Promise.all([
    afPage.evaluate( (t, rb) => window.getBoneQuats(t, rb), t, ROBO_BONES),
    babPage.evaluate((t, rb) => window.getBoneQuats(t, rb), t, ROBO_BONES),
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

    // Robo constraint bones are non-humanoid locals — apply LHS→RHS correction
    // (negate X and Z) before dotting, same as the VRMA quaternion conversion.
    const isRobo = ROBO_BONES.includes(bone);
    const bx = isRobo ? -bq.x : bq.x;
    const bz = isRobo ? -bq.z : bq.z;
    const dot = Math.abs(aq.x * bx + aq.y * bq.y + aq.z * bz + aq.w * bq.w);
    const diff = (1 - dot).toFixed(6);
    const tag  = isRobo ? ' [robo]' : '';

    if (dot < 0.999) {
        console.log(`Bone ${bone.padEnd(20)}${tag}: DIFF=${diff} | AF: [${aq.x}, ${aq.y}, ${aq.z}, ${aq.w}] | BAB: [${bq.x}, ${bq.y}, ${bq.z}, ${bq.w}]`);
    } else {
        // console.log(`Bone ${bone.padEnd(20)}${tag}: OK`);
    }
  }
}

await browser.close();
server.close();
process.exit(0);
