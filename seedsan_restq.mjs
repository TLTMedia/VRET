/**
 * seedsan_restq.mjs
 * Dumps Seed-san bone rest quaternions from Babylon (before any animation)
 * and compares against three-vrm (which normalizes to identity).
 * Port 3502
 */
import puppeteer from 'puppeteer';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = 3502;

const MIME = {
  '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
  '.json':'application/json','.vrm':'model/gltf-binary',
  '.vrma':'model/gltf-binary','.glb':'model/gltf-binary',
};
const server = createServer(async (req, res) => {
  const url  = req.url.split('?')[0].split('#')[0];
  const path = join(ROOT, decodeURIComponent(url === '/' ? '/index.html' : url));
  try { const d = await readFile(path); res.writeHead(200,{'Content-Type':MIME[extname(path)]??'application/octet-stream'}); res.end(d); }
  catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(r => server.listen(PORT, r));

const browser = await puppeteer.launch({
  headless: false, protocolTimeout: 120_000,
  args: ['--no-sandbox','--disable-background-timer-throttling',
         '--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],
});

const MODEL = 'models/Seed-san.vrm';
const BONES = ['hips','spine','chest','upperChest','neck','head',
               'leftShoulder','rightShoulder',
               'leftUpperArm','rightUpperArm',
               'leftUpperLeg','rightUpperLeg',
               'leftLowerLeg','rightLowerLeg'];

// ── Babylon rest poses (no animation loaded) ─────────────────────────────────
console.log('\n── Loading Seed-san in Babylon (babvrm.html, no animation)…');
const babPage = await browser.newPage();
await babPage.setViewport({ width: 480, height: 360 });
babPage.on('console', m => { if (m.type()==='error') console.log(`  [BAB ERR] ${m.text()}`); });

await babPage.goto(`http://localhost:${PORT}/babvrm.html?model=${MODEL}`, { waitUntil: 'domcontentloaded' });
await babPage.bringToFront();
await babPage.waitForFunction(() => window.animationReady === true, { timeout: 60_000 });

const babRestQ = await babPage.evaluate((bones) => {
  const scene  = BABYLON.Engine.Instances[0].scenes[0];
  const vrmMgr = scene.metadata?.vrmManagers?.[0];
  const getBone = n => vrmMgr?.humanoidBone?.[n] ?? vrmMgr?.humanoidBone?.nodeMap?.[n];
  const result = {};
  for (const name of bones) {
    const bone = getBone(name);
    if (!bone?.rotationQuaternion) { result[name] = null; continue; }
    const q = bone.rotationQuaternion;
    result[name] = { x: +q.x.toFixed(4), y: +q.y.toFixed(4), z: +q.z.toFixed(4), w: +q.w.toFixed(4) };
  }
  return result;
}, BONES);

// ── three-vrm rest poses (normalized — should all be identity) ───────────────
console.log('── Loading Seed-san in A-Frame (animate.html, no animation)…');
const afPage = await browser.newPage();
await afPage.setViewport({ width: 480, height: 360 });
afPage.on('console', m => { if (m.type()==='error') console.log(`  [AF ERR] ${m.text()}`); });

await afPage.goto(`http://localhost:${PORT}/animate.html?model=${MODEL}`, { waitUntil: 'domcontentloaded' });
await afPage.bringToFront();
await afPage.waitForFunction(() => window.animationReady === true, { timeout: 60_000 });

// three-vrm getNormalizedBoneNode gives the normalized (identity-rest) node
const afRestQ = await afPage.evaluate((bones) => {
  const comp = window._vrmComp;
  if (!comp?.vrm) return {};
  const result = {};
  for (const name of bones) {
    const node = comp.vrm.humanoid.getNormalizedBoneNode(name);
    if (!node) { result[name] = null; continue; }
    const q = node.quaternion;
    result[name] = { x: +q.x.toFixed(4), y: +q.y.toFixed(4), z: +q.z.toFixed(4), w: +q.w.toFixed(4) };
  }
  return result;
}, BONES);

// Also get RAW (non-normalized) bone rests from three-vrm
const afRawQ = await afPage.evaluate((bones) => {
  const comp = window._vrmComp;
  if (!comp?.vrm) return {};
  const result = {};
  for (const name of bones) {
    const node = comp.vrm.humanoid.getBoneNode(name);
    if (!node) { result[name] = null; continue; }
    const q = node.quaternion;
    result[name] = { x: +q.x.toFixed(4), y: +q.y.toFixed(4), z: +q.z.toFixed(4), w: +q.w.toFixed(4) };
  }
  return result;
}, BONES);

console.log('\n── Seed-san bone rest quaternions (T-pose, no animation):');
console.log('  Bone               Babylon (raw)                          three-vrm normalized      three-vrm raw');
for (const name of BONES) {
  const b = babRestQ[name];
  const n = afRestQ[name];
  const r = afRawQ[name];
  const bs = b ? `x=${b.x} y=${b.y} z=${b.z} w=${b.w}` : '(null)              ';
  const ns = n ? `x=${n.x} y=${n.y} z=${n.z} w=${n.w}` : '(null)';
  const rs = r ? `x=${r.x} y=${r.y} z=${r.z} w=${r.w}` : '(null)';
  const nonId = b && Math.abs(b.w) < 0.999 ? ' ← NON-IDENTITY' : '';
  console.log(`  ${name.padEnd(18)} ${bs.padEnd(40)} ${ns.padEnd(30)} ${rs}${nonId}`);
}

await browser.close();
server.close();
process.exit(0);
