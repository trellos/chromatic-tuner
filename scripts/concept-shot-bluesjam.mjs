// Screenshot the Blues Jam screen for design concepting.
// Usage: node scripts/concept-shot-bluesjam.mjs <outfile.png>
import { chromium } from 'playwright';

const out = process.argv[2] || 'concepts/bluesjam.png';
const base = process.env.BASE_URL || 'http://localhost:3000';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('body[data-seigaiha-render-ready="1"]', { timeout: 15000 }).catch(() => {});

// Open the mode picker and switch to Blues Jam.
await page.click('#mode-chip');
await page.click('.mode-picker-item[data-mode="blues-jam"]');

// Wait for the Blues Jam screen to become the active mode + its layout to render.
await page.waitForSelector('body[data-active-mode="blues-jam"]', { timeout: 10000 }).catch(() => {});
await page.waitForSelector('.blues-jam-layout', { state: 'visible', timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1200);

await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log('wrote', out);
