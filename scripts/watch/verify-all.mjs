// One go/no-go for the whole watch. Pairs every approved reference face with
// the agent's built screenshot and prints a pass/fail table. Exits non-zero
// if ANY face is missing a build or fails the diff — so "complete AND correct"
// is a single command, not a vibe.
//
// Usage:
//   1. Build every face and drop its simulator screenshot in scripts/watch/build/<face>.png
//      (same base name as the ref, e.g. build/work-interval.png).
//   2. node scripts/watch/verify-all.mjs [thresholdPct=4]
//
// Output: a table + "N/M faces passing". Non-zero exit until it's M/M.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REFS = path.join(DIR, 'refs');
const BUILD = path.join(DIR, 'build');
const DIFFS = path.join(DIR, 'diffs');
const THRESHOLD = Number(process.argv[2] ?? 4);
const W = 396, H = 484;

fs.mkdirSync(DIFFS, { recursive: true });
const norm = async p => PNG.sync.read(await sharp(p).resize(W, H, { fit: 'fill' }).png().toBuffer());

const refs = fs.readdirSync(REFS).filter(f => f.endsWith('.png')).sort();
const rows = [];
let pass = 0;

for (const f of refs) {
  const buildPath = path.join(BUILD, f);
  if (!fs.existsSync(buildPath)) { rows.push([f, 'NO BUILD', '—']); continue; }
  const a = await norm(path.join(REFS, f));
  const b = await norm(buildPath);
  const diff = new PNG({ width: W, height: H });
  const n = pixelmatch(a.data, b.data, diff.data, W, H, { threshold: 0.12 });
  const pct = 100 * n / (W * H);
  fs.writeFileSync(path.join(DIFFS, f.replace(/\.png$/, '.diff.png')), PNG.sync.write(diff));
  const ok = pct <= THRESHOLD;
  if (ok) pass++;
  rows.push([f.replace(/\.png$/, ''), ok ? 'PASS' : 'FAIL', pct.toFixed(2) + '%']);
}

const w = Math.max(...rows.map(r => r[0].length), 5);
console.log('\nFACE'.padEnd(w + 2) + 'STATUS'.padEnd(10) + 'DIFF');
console.log('-'.repeat(w + 2 + 10 + 8));
for (const [face, status, pct] of rows) console.log(face.padEnd(w + 2) + status.padEnd(10) + pct);
console.log('-'.repeat(w + 2 + 10 + 8));
console.log(`${pass}/${refs.length} faces passing  (threshold ${THRESHOLD}%, overlays in scripts/watch/diffs/)\n`);

process.exit(pass === refs.length ? 0 : 1);
