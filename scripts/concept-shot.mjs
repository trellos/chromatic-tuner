// Screenshot the app for design concepting.
// Usage: node scripts/concept-shot.mjs <outfile.png> [mode]
import { chromium } from 'playwright';

const out = process.argv[2] || 'concepts/shot.png';
const mode = process.argv[3] || '';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
// Wait for the seigaiha background to finish its first render.
await page.waitForSelector('body[data-seigaiha-render-ready="1"]', { timeout: 15000 }).catch(() => {});
if (mode) {
  await page.evaluate((m) => { document.body.setAttribute('data-active-mode', m); }, mode);
}
await page.waitForTimeout(1200);
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log('wrote', out);
