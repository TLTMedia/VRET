import { readdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://tltmedia.github.io/VRE/';

function findVRMs(dir, root) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findVRMs(full, root));
    else if (entry.name.endsWith('.vrm'))
      results.push(full.replace(root + '\\', '').replace(root + '/', '').replaceAll('\\', '/'));
  }
  return results;
}

const vrm  = findVRMs(join(__dirname, 'models'), __dirname).sort();
const vrma = JSON.parse(readFileSync(join(__dirname, 'animations.json'), 'utf8')).map(a => a.url);

const manifest = {
  _comment: 'VRM/VRMA asset list for Babylon.js playground. Edit "default" to change the template starting point.',
  base: BASE,
  default: {
    vrm:  'models/Seed-san.vrm',
    vrma: 'vrma/02_01.vrma'
  },
  vrm,
  vrma
};

writeFileSync(join(__dirname, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`manifest.json written: ${vrm.length} VRM, ${vrma.length} VRMA`);
console.log(`Default VRM:  ${manifest.default.vrm}`);
console.log(`Default VRMA: ${manifest.default.vrma}`);
