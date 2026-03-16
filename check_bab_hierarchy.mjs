
import puppeteer       from 'puppeteer';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join }  from 'path';
import { fileURLToPath }  from 'url';
import { dirname }        from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;
const PORT      = 3480;

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
const BAB_URL = `http://localhost:${PORT}/babvrm.html?model=${VRM}#${VRMA}`;

async function check_babylon_hierarchy() {
  const page = await browser.newPage();
  console.log('Opening Babylon');
  await page.goto(BAB_URL);
  await page.waitForFunction(() => window.animationReady === true, { timeout: 60000 });
  
  const hierarchy = await page.evaluate(() => {
    const bones = [];
    const walk = (node, indent = 0) => {
      bones.push('  '.repeat(indent) + node.name + ' (' + node.getClassName() + ')');
      if (node.getChildren) {
        node.getChildren().forEach(c => walk(c, indent + 1));
      }
    };
    
    // Find the chest bone
    const vrm = window.scene.metadata.vrmManagers[0];
    const chest = vrm.humanoidBone['chest'];
    if (chest) walk(chest);
    return bones;
  });
  
  console.log('Babylon Hierarchy from Chest:');
  hierarchy.forEach(line => console.log(line));
  
  await page.close();
}

await check_babylon_hierarchy();
await browser.close();
server.close();
process.exit(0);
