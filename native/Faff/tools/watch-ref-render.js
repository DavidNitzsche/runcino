// Render every .w-screen face from watch-app.html with the real bundled
// fonts, screenshot each to /tmp/watchref/screen-NN.png, and print a
// caption per index so we can map index → face.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const REPO = '/Volumes/WP/06 Claude Code/Runcino';
const HTML = `file://${REPO}/docs/design/watch-app.html`;
const FONTS = `${REPO}/native/Faff/FaffWatch Watch App/Fonts`;
const OUT = '/tmp/watchref';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function b64(p) { return fs.readFileSync(p).toString('base64'); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const bebas = b64(path.join(FONTS, 'BebasNeue-Regular.ttf'));
  const inter = b64(path.join(FONTS, 'Inter-Variable.ttf'));
  const oswald = b64(path.join(FONTS, 'Oswald-Variable.ttf'));

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 2000, deviceScaleFactor: 3 });
  await page.goto(HTML, { waitUntil: 'networkidle0' });

  // Inject the real fonts (data URLs — no network needed).
  await page.addStyleTag({ content: `
    @font-face { font-family:'Bebas Neue'; src:url(data:font/ttf;base64,${bebas}) format('truetype'); font-weight:400; }
    @font-face { font-family:'Inter'; src:url(data:font/ttf;base64,${inter}) format('truetype'); font-weight:100 900; }
    @font-face { font-family:'Oswald'; src:url(data:font/ttf;base64,${oswald}) format('truetype'); font-weight:200 700; }
  `});
  await page.evaluateHandle('document.fonts.ready');
  await new Promise(r => setTimeout(r, 400));

  // Screenshot each .w-screen + capture a caption (nearest unit/lbl text).
  const meta = await page.$$eval('.w-screen', (els) => els.map((el, i) => {
    // Walk up to the .unit/.split to find its label text.
    let n = el.closest('.unit') || el.closest('.split') || el.parentElement;
    let cap = '';
    if (n) {
      const lbl = n.querySelector('.lbl b, .w-cap b, .lbl, .w-cap');
      cap = (lbl ? lbl.textContent : n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    }
    // Also grab a hint from the screen's own eyebrow/hero text.
    const eye = el.querySelector('.w-eye, .w-logo, .w-pg-h, .w-trans-t, .w-count, .w-done .ttl, .w-glance .gh, .w-ready');
    const hint = eye ? eye.textContent.trim().replace(/\s+/g, ' ').slice(0, 24) : '';
    return { i, cap, hint };
  }));

  const screens = await page.$$('.w-screen');
  for (let i = 0; i < screens.length; i++) {
    const f = path.join(OUT, `screen-${String(i).padStart(2, '0')}.png`);
    await screens[i].screenshot({ path: f });
  }
  console.log(JSON.stringify(meta, null, 0));
  console.log(`\nRendered ${screens.length} faces → ${OUT}`);
  await browser.close();
})();
