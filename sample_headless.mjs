
import puppeteer        from 'puppeteer';
import { createServer } from 'http';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname }       from 'path';
import { PNG }           from 'pngjs';
import pixelmatch        from 'pixelmatch';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;
const PORT      = 3477;
const OUT_DIR   = join(ROOT, 'screenshots_test');

// Sample only 3 points for speed
const SAMPLE_TIMES = [0.2, 0.8, 1.4];

const VIEWPORT  = { width: 640, height: 480 };
const CROP_CLIP = { x: 120, y: 40, width: 400, height: 400 };

const KEY_BONES = [
  'hips', 'spine',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

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

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const VRMA        = 'vrma/02_01.vrma';
const MODEL       = 'models/Seed-san.vrm';
const AFRAME_URL  = `http://localhost:${PORT}/animate.html?model=${MODEL}#${VRMA}`;
const BABYLON_URL = `http://localhost:${PORT}/babvrm.html?model=${MODEL}#${VRMA}`;

const afPage  = await browser.newPage();
const babPage = await browser.newPage();
await afPage.setViewport(VIEWPORT);
await babPage.setViewport(VIEWPORT);

// Quietly wait for ready
afPage.on('console', m => console.log(`  [AF]  ${m.text()}`));
afPage.on('pageerror', e => console.error('  [AF]  PAGE ERROR', e.message));
babPage.on('console', m => console.log(`  [BAB] ${m.text()}`));
babPage.on('pageerror',e => console.error('  [BAB] PAGE ERROR', e.message));

console.log('Opening Babylon.js…');
await babPage.goto(BABYLON_URL, { waitUntil: 'load' });
console.log('  ✓ Babylon.js page loaded');
await babPage.waitForFunction(() => window.animationReady === true, { timeout: 120000 });
console.log('  ✓ Babylon.js animation ready');

console.log('Opening A-Frame…');
await afPage.goto(AFRAME_URL, { waitUntil: 'load' });
console.log('  ✓ A-Frame page loaded');
try {
    await afPage.waitForFunction(() => window.animationReady === true, { timeout: 60000 });
    console.log('  ✓ A-Frame animation ready');
} catch (e) {
    console.warn('  ⚠ A-Frame animationReady timeout, continuing anyway...');
}

// Give a bit more time to settle
await new Promise(r => setTimeout(r, 2000));

function dot4(a, b)   { return a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w; }
function conj180Y(q)  { return { x: -q.x, y: q.y, z: -q.z, w: q.w }; }
function angDeg(a, b) {
  return (Math.acos(Math.min(1, Math.abs(dot4(a, b)))) * 2 * 180 / Math.PI).toFixed(1);
}

for (const t of SAMPLE_TIMES) {
  console.log(`
📸 t=${t}s`);
  const afQuats = await afPage.evaluate(t => window.getBoneQuats(t), t);
  const babQuats = await babPage.evaluate(t => window.getBoneQuats(t), t);

  if (afQuats && babQuats) {
    if (t === SAMPLE_TIMES[0]) {
        const bone = 'leftUpperLeg';
        const afQ  = afQuats[bone]?.q ?? afQuats[bone];
        const babQ = babQuats[bone]?.q ?? babQuats[bone];
        console.log(`[DIAG] ${bone} at t=${t}:`);
        console.log(`       AF:  (${afQ.x.toFixed(4)}, ${afQ.y.toFixed(4)}, ${afQ.z.toFixed(4)}, ${afQ.w.toFixed(4)})`);
        console.log(`       BAB: (${babQ.x.toFixed(4)}, ${babQ.y.toFixed(4)}, ${babQ.z.toFixed(4)}, ${babQ.w.toFixed(4)})`);
    }
    for (const bone of KEY_BONES) {
      const afQ  = afQuats[bone]?.q ?? afQuats[bone];
      const babQ = babQuats[bone]?.q ?? babQuats[bone];
      if (!afQ || !babQ) continue;

      const dDir  = Math.abs(dot4(babQ, afQ));
      const dConj = Math.abs(dot4(babQ, conj180Y(afQ)));
      const ang   = dConj > dDir ? angDeg(babQ, conj180Y(afQ)) : angDeg(babQ, afQ);
      const match = dConj > dDir ? 'conj' : 'direct';
      
      let posNote = '';
      const afPos = afQuats[bone]?.pos;
      const babPos = babQuats[bone]?.pos;
      if (afPos && babPos) {
          const dx = Math.abs(babPos.x - afPos.x);
          const dy = Math.abs(babPos.y - afPos.y);
          const dz = Math.abs(babPos.z - afPos.z);
          if (dx > 0.01 || dy > 0.01 || dz > 0.01) {
              posNote = ` posErr:(${dx.toFixed(3)},${dy.toFixed(3)},${dz.toFixed(3)})`;
          }
      }

      if (parseFloat(ang) > 1.0 || posNote) {
          console.log(`   ${bone.padEnd(15)} error: ${ang}° (${match})${posNote}`);
      }
    }
  }
}

await browser.close();
server.close();
process.exit(0);
