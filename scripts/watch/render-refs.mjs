// Render the APPROVED watch faces from docs/design/watch-app.html into a
// canonical reference image set. These PNGs are the ground truth the watch
// build is diffed against. Re-run whenever watch-app.html changes.
//
// Usage:
//   npm i && npx playwright install chromium
//   node scripts/watch/render-refs.mjs              # serves the repo, renders all faces
//   WATCH_URL=http://localhost:4060/docs/design/watch-app.html node scripts/watch/render-refs.mjs
//
// Output: scripts/watch/refs/<face>.png  (the .w-screen content only, no bezel)

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'scripts/watch/refs');
const FILE = path.join(ROOT, 'docs/design/watch-app.html');
const URL = process.env.WATCH_URL || ('file://' + FILE);

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 3 });   // crisp refs
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);                 // fonts MUST be loaded
await page.waitForTimeout(200);

// Each face = a .unit (or .watch-unit) holding a .w-screen and a caption <b>.
const units = await page.$$('.unit, .watch-unit');
const seen = {};
let count = 0;
for (const unit of units) {
  const screen = await unit.$('.w-screen');
  if (!screen) continue;
  let name = await unit.$eval('.w-cap b, .lbl b, .callouts h3', el => el.textContent.trim()).catch(() => null);
  let base = slug(name || `face-${count + 1}`);
  seen[base] = (seen[base] || 0) + 1;
  const file = seen[base] > 1 ? `${base}-${seen[base]}` : base;
  await screen.screenshot({ path: path.join(OUT, `${file}.png`) });
  console.log('ref →', `${file}.png`);
  count++;
}
await browser.close();
console.log(`\n${count} reference faces written to scripts/watch/refs/`);
console.log('These are the ground truth. Diff every built face against its ref (compare.mjs).');
