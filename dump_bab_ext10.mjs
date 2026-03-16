
import puppeteer       from 'puppeteer';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join }  from 'path';
import { fileURLToPath }  from 'url';
import { dirname }        from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = __dirname;
const PORT      = 3481;

const server = createServer(async (req, res) => {
  const url  = req.url.split('?')[0].split('#')[0];
  const path = join(ROOT, decodeURIComponent(url === '/' ? '/index.html' : url));
  try {
    const data = await readFile(path);
    res.writeHead(200); res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

await new Promise(r => server.listen(PORT, r));
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

const VRM = 'models/Seed-san.vrm';
const BAB_URL = `http://localhost:${PORT}/babvrm.html?model=${VRM}`;

async function dump_ext10() {
  const page = await browser.newPage();
  await page.goto(BAB_URL);
  await page.waitForFunction(() => !!(window.scene?.metadata?.vrmManagers?.[0]?.ext10), { timeout: 60000 });
  
  const keys = await page.evaluate(() => {
    const vrm = window.scene.metadata.vrmManagers[0];
    const ext10 = vrm.ext10;
    return {
        ext10Keys: Object.keys(ext10),
        vrm1Keys: ext10.vrm ? Object.keys(ext10.vrm) : [],
        expressionManager: !!ext10.expressionManager,
        lookAtManager: !!ext10.lookAtManager,
        firstPersonManager: !!ext10.firstPersonManager
    };
  });
  
  console.log('Babylon ext10 Dump:');
  console.log(JSON.stringify(keys, null, 2));
  
  await page.close();
}

await dump_ext10();
await browser.close();
server.close();
process.exit(0);
