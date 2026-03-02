import puppeteer from 'puppeteer';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = 3478;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.vrm': 'model/gltf-binary',
  '.vrma': 'model/gltf-binary', '.glb': 'model/gltf-binary',
};

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];
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

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

page.on('console', m => console.log(`[BROWSER] ${m.text()}`));

const MODEL = 'models/Seed-san.vrm';
const URL = `http://localhost:${PORT}/babvrm.html?model=${MODEL}`;

console.log(`Loading ${URL}...`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });

await page.waitForFunction(() => window.animationReady === true, { timeout: 60000 });

const nodeData = await page.evaluate(() => {
  const scene = window.scene;
  const mgr = scene.metadata.vrmManagers[0];
  const results = [];
  
  function dump(node, depth = 0) {
    const q = node.rotationQuaternion || { x:0, y:0, z:0, w:1 };
    results.push({
      name: node.name,
      depth,
      q: { x: q.x, y: q.y, z: q.z, w: q.w },
      pos: { x: node.position.x, y: node.position.y, z: node.position.z }
    });
    for (const child of node.getChildren()) {
      dump(child, depth + 1);
    }
  }
  
  const root = scene.getTransformNodeByName('__root__') || scene.meshes[0];
  dump(root);
  
  const humanoid = {};
  for (const [name, node] of Object.entries(mgr.humanoidBone.nodeMap)) {
    const q = node.rotationQuaternion || { x:0, y:0, z:0, w:1 };
    const parentName = node.parent ? node.parent.name : 'null';
    humanoid[name] = { nodeName: node.name, parentName, q: { x: q.x, y: q.y, z: q.z, w: q.w } };
  }
  
  return { nodes: results, humanoid };
});

console.log('\n--- Humanoid Bone Hierarchy & Mapping ---');
Object.entries(nodeData.humanoid).forEach(([name, data]) => {
  console.log(`  ${name.padEnd(20)} -> ${data.nodeName.padEnd(20)} (parent: ${data.parentName.padEnd(20)}) Q: ${data.q.x.toFixed(3)}, ${data.q.y.toFixed(3)}, ${data.q.z.toFixed(3)}, ${data.q.w.toFixed(3)}`);
});

await browser.close();
server.close();
process.exit(0);
