// Screenshot an arbitrary mode by navigating through the mode picker.
// Usage: node scripts/concept-shot-mode.mjs <mode-id> <outfile.png>
import { chromium } from 'playwright';

const mode = process.argv[2];
const out = process.argv[3] || `concepts/mode-${mode}.png`;
const base = process.env.BASE_URL || 'http://localhost:3000';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('body[data-seigaiha-render-ready="1"]', { timeout: 15000 }).catch(() => {});
await page.click('#mode-chip');
await page.click(`.mode-picker-item[data-mode="${mode}"]`);
await page.waitForSelector(`body[data-active-mode="${mode}"]`, { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1400);
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log('wrote', out);
