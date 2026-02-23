/**
 * test-vite.mjs — quick Puppeteer smoke test for the Vite/TypeScript VRM app.
 * Loads http://localhost:5173, waits for animationReady, screenshots it.
 */
import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'screenshots');
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: false,
  protocolTimeout: 120_000,
  args: ['--no-sandbox', '--disable-background-timer-throttling',
         '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

const page = await browser.newPage();
await page.setViewport({ width: 640, height: 480 });
page.on('console', m => console.log(`  [VITE] ${m.type().toUpperCase()} ${m.text()}`));
page.on('pageerror', e => console.error('  [VITE] ERROR', e.message));

console.log('Opening http://localhost:5173 …');
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.bringToFront();

console.log('Waiting for animationReady (up to 120s)…');
await page.waitForFunction(() => window.animationReady === true, { timeout: 120_000 });
console.log('✓ animationReady');

// Wait a beat then screenshot
await new Promise(r => setTimeout(r, 1000));
const buf = await page.screenshot({ type: 'png' });
const out = join(OUT, 'vite_vrm.png');
await writeFile(out, buf);
console.log(`📸 Screenshot saved → ${out}`);

await browser.close();
console.log('✅ Done');
