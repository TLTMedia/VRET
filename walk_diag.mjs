/**
 * walk_diag.mjs — diagnose retargeting in walk_and_talk.html vs walk_and_talk_v9.html
 * Reads raw VRMA keyframe values BEFORE any manual flip, and reads bone world rotations
 * AFTER the animation plays, for both versions.
 */
import puppeteer        from 'puppeteer';
import { createServer } from 'http';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname }       from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = 3494;
const OUT  = join(ROOT, 'screenshots/walk_diag');

const MIME = {
  '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
  '.json':'application/json','.vrm':'model/gltf-binary',
  '.vrma':'model/gltf-binary','.glb':'model/gltf-binary',
  '.png':'image/png','.wav':'audio/wav','.aiff':'audio/aiff',
};
const server = createServer(async (req, res) => {
  const url  = req.url.split('?')[0].split('#')[0];
  const path = join(ROOT, decodeURIComponent(url === '/' ? '/index.html' : url));
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

// ── Inject a diagnostic page that loads VRMA + VRM independently ─────────────
// This reads raw keyframe[0] quaternions from the VRMA BEFORE any retargeting,
// then shows what each version's bodyGroup/remapped group targets look like.

const DIAG_HTML = `
<!doctype html><html><head>
<script src="https://preview.babylonjs.com/babylon.js"></script>
<script src="https://preview.babylonjs.com/loaders/babylonjs.loaders.js"></script>
</head><body><canvas id="c" style="width:1px;height:1px"></canvas>
<script type="module">
window.diagReady = false;
window.diagData  = {};

await new Promise((res,rej)=>{
  const s=document.createElement('script');
  s.src='https://xuhuisheng.github.io/babylonjs-vrm/babylon-vrm-loader.js';
  s.onload=res;s.onerror=rej;document.head.appendChild(s);
});

const engine = new BABYLON.Engine(document.getElementById('c'),true);
const scene  = new BABYLON.Scene(engine);
new BABYLON.HemisphericLight('h',new BABYLON.Vector3(0,1,0),scene);

await BABYLON.ImportMeshAsync('models/AIAN/AIAN_F_1_Casual.vrm', scene);
const vrmMgr = scene.metadata?.vrmManagers?.[0];
const getBone = n => vrmMgr?.humanoidBone?.[n] ?? vrmMgr?.humanoidBone?.nodeMap?.[n];

const ac = await BABYLON.LoadAssetContainerAsync('vrma/02_01.vrma', scene);
const vrmAnimMgr = scene.metadata?.vrmAnimationManagers?.at(-1);
const animGroup  = ac.animationGroups[0];

// --- Raw keyframes from VRMA loader (frame 0 of each targeted animation) ---
const rawKF = {};
animGroup.targetedAnimations.forEach((ta, i) => {
  const boneName = vrmAnimMgr?.animationMap?.get(i);
  if (!boneName) return;
  const keys = ta.animation.getKeys();
  if (!keys.length) return;
  const k0 = keys[0].value;
  if (ta.animation.targetProperty === 'rotationQuaternion') {
    rawKF[boneName] = { x: +k0.x.toFixed(4), y: +k0.y.toFixed(4), z: +k0.z.toFixed(4), w: +k0.w.toFixed(4) };
  }
});

// --- After manual flip (-x,y,-z,w) ---
const flippedKF = {};
for (const [b, q] of Object.entries(rawKF)) {
  flippedKF[b] = { x: +(-q.x).toFixed(4), y: +q.y.toFixed(4), z: +(-q.z).toFixed(4), w: +q.w.toFixed(4) };
}

// --- Bone lookup: which bones are found? ---
const KEY_BONES = ['hips','spine','chest','neck','head',
                   'leftUpperArm','rightUpperArm','leftUpperLeg','rightUpperLeg'];
const boneFound = {};
KEY_BONES.forEach(b => { boneFound[b] = !!getBone(b); });

// --- AnimatorAvatar approach: what does retargetAnimationGroup produce for frame 0? ---
// Build mapNodeNames like walk_and_talk.html
const mapNodeNames = new Map();
animGroup.targetedAnimations.forEach((ta, i) => {
  const boneName = vrmAnimMgr?.animationMap?.get(i);
  const bone = vrmMgr?.humanoidBone?.[boneName];
  if (bone && ta.target?.name) mapNodeNames.set(ta.target.name, bone.name);
});
const vrmRootMesh = scene.rootNodes?.find(n=>n.name==='__root__') ?? scene.meshes?.[0];
const vrmAvatar = new BABYLON.AnimatorAvatar('vrm-avatar', vrmRootMesh);
const remapped = vrmAvatar.retargetAnimationGroup(animGroup, {
  animationGroupName: 'vrma-remapped', fixRootPosition: true,
  rootNodeName: getBone('hips')?.name,
  groundReferenceNodeName: getBone('leftFoot')?.name,
  mapNodeNames,
});
const retargetedKF = {};
remapped.targetedAnimations.forEach(ta => {
  const keys = ta.animation.getKeys();
  if (!keys.length) return;
  const k0 = keys[0].value;
  if (ta.animation.targetProperty === 'rotationQuaternion') {
    retargetedKF[ta.target?.name ?? '?'] = { x: +k0.x.toFixed(4), y: +k0.y.toFixed(4), z: +k0.z.toFixed(4), w: +k0.w.toFixed(4) };
  }
});

window.diagData = { rawKF, flippedKF, boneFound, retargetedKF,
                    babylonVersion: BABYLON.Engine.Version };
window.diagReady = true;
engine.runRenderLoop(()=>scene.render());
</script></body></html>`;

// Serve the diagnostic page inline
const diagServer = createServer((req, res) => {
  const url  = req.url.split('?')[0].split('#')[0];
  const path = join(ROOT, decodeURIComponent(url === '/' ? '/index.html' : url));
  if (url === '/diag') { res.writeHead(200,{'Content-Type':'text/html'}); res.end(DIAG_HTML); return; }
  readFile(path).then(d => { res.writeHead(200,{'Content-Type':MIME[extname(path)]??'application/octet-stream'}); res.end(d); })
    .catch(() => { res.writeHead(404); res.end('Not found'); });
});
await new Promise(r => diagServer.listen(PORT+1, r));

const page = await browser.newPage();
await page.setViewport({width:800,height:600});
page.on('console', m => console.log(`  [${m.type()}] ${m.text()}`));
page.on('pageerror', e => console.error(`  [PAGEERR] ${e.message}`));

console.log('\n── Loading diagnostic page…');
await page.goto(`http://localhost:${PORT+1}/diag`, {waitUntil:'domcontentloaded'});
await page.bringToFront();
await page.waitForFunction(()=>window.diagReady===true, {timeout:60_000});

const d = await page.evaluate(()=>window.diagData);

console.log(`\nBabylon.js version: ${d.babylonVersion}`);

console.log('\n── Bone lookup (which getBone() calls return non-null?):');
for (const [b,found] of Object.entries(d.boneFound)) {
  console.log(`  ${b.padEnd(18)} ${found ? '✓ found' : '✗ MISSING'}`);
}

const KEY = ['hips','spine','neck','head','leftUpperArm','rightUpperArm','leftUpperLeg','rightUpperLeg'];
console.log('\n── Raw VRMA keyframe[0] quaternions (from animGroup BEFORE any flip):');
for (const b of KEY) {
  const q = d.rawKF[b];
  if (q) console.log(`  ${b.padEnd(18)} x=${q.x} y=${q.y} z=${q.z} w=${q.w}`);
  else    console.log(`  ${b.padEnd(18)} (not in animation)`);
}

console.log('\n── After manual (-x,y,-z,w) flip (what v9 applies):');
for (const b of KEY) {
  const q = d.flippedKF[b];
  if (q) console.log(`  ${b.padEnd(18)} x=${q.x} y=${q.y} z=${q.z} w=${q.w}`);
  else    console.log(`  ${b.padEnd(18)} (not in animation)`);
}

console.log('\n── AnimatorAvatar retargetedKF frame[0] (what v1 applies):');
for (const [name, q] of Object.entries(d.retargetedKF)) {
  console.log(`  ${name.padEnd(30)} x=${q.x} y=${q.y} z=${q.z} w=${q.w}`);
}

const shot = await page.screenshot({type:'png'});
await writeFile(join(OUT,'diag.png'), shot);
console.log('\n── Screenshot → screenshots/walk_diag/diag.png');

await browser.close();
server.close(); diagServer.close();
process.exit(0);
