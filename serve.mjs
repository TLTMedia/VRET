// serve.mjs — minimal local dev server for vrm_playground.html
// Usage: node serve.mjs
// Then open: http://localhost:3500/vrm_playground.html
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 3500;
const MIME = {
  '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.json':'application/json', '.vrm':'model/gltf-binary',
  '.vrma':'model/gltf-binary', '.glb':'model/gltf-binary',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
};

createServer(async (req, res) => {
  const url  = req.url.split('?')[0].split('#')[0];
  const path = join(ROOT, decodeURIComponent(url === '/' ? '/vrm_playground.html' : url));
  try {
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(PORT, () => console.log(`\nServing at http://localhost:${PORT}/vrm_playground.html\n`));
