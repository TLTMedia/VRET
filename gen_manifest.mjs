import { readdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// VRMs served from raw.githubusercontent.com (no Pages size limit)
const VRM_BASE  = 'https://raw.githubusercontent.com/TLTMedia/VRET/main/';
// VRMAs served from GitHub Pages (700MB, fits within limit)
const VRMA_BASE = 'https://tltmedia.github.io/VRET/';

function findVRMs(dir, root) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findVRMs(full, root));
    else if (entry.name.endsWith('.vrm') && !entry.name.includes('_CLEANED'))
      results.push(full.replace(root + '\\', '').replace(root + '/', '').replaceAll('\\', '/'));
  }
  return results;
}

const vrm  = findVRMs(join(__dirname, 'models'), __dirname).sort();
const vrma = JSON.parse(readFileSync(join(__dirname, 'animations.json'), 'utf8')).map(a => a.url);

const manifest = {
  _comment: 'VRM/VRMA asset list for Babylon.js playground. Edit "default" to change the template starting point.',
  vrmBase:  VRM_BASE,
  vrmaBase: VRMA_BASE,
  default: {
    vrm:  'models/AIAN/AIAN_F_1_Casual.vrm',
    vrma: 'vrma/02_01.vrma'
  },
  vrm,
  vrma
};

writeFileSync(join(__dirname, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`manifest.json written: ${vrm.length} VRM, ${vrma.length} VRMA`);
console.log(`VRM base:  ${VRM_BASE}`);
console.log(`VRMA base: ${VRMA_BASE}`);
