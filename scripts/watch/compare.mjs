// Diff a built watch face (simulator screenshot) against its approved
// reference. Writes an overlay PNG and prints a mismatch %. Exits non-zero
// if the mismatch exceeds the threshold — so it gates a build loop.
//
// Usage:
//   node scripts/watch/compare.mjs <ref.png> <build.png> [thresholdPct=4]
//   e.g. node scripts/watch/compare.mjs scripts/watch/refs/work-interval.png build/work.png
//
// Both images are normalized to a common watch canvas before comparing, so
// the CSS render and the SwiftUI render line up. The printed % is a tripwire;
// the written <build>.diff.png overlay is the real review (look at it: if the
// hero is a different size or things are shifted, it lights up).

import fs from 'node:fs';
import sharp from 'sharp';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const [, , refPath, buildPath, thrArg] = process.argv;
if (!refPath || !buildPath) {
  console.error('usage: node compare.mjs <ref.png> <build.png> [thresholdPct=4]');
  process.exit(2);
}
const THRESHOLD = Number(thrArg ?? 4);

// 45mm Apple Watch screen, @2x ≈ 396×484. Normalize both to this.
const W = 396, H = 484;
const norm = async p => PNG.sync.read(await sharp(p).resize(W, H, { fit: 'fill' }).png().toBuffer());

const ref = await norm(refPath);
const build = await norm(buildPath);
const diff = new PNG({ width: W, height: H });
const mismatched = pixelmatch(ref.data, build.data, diff.data, W, H, { threshold: 0.12 });
const pct = (100 * mismatched / (W * H));

const overlay = buildPath.replace(/\.png$/i, '.diff.png');
fs.writeFileSync(overlay, PNG.sync.write(diff));

const pass = pct <= THRESHOLD;
console.log(`${pass ? 'PASS' : 'FAIL'}  ${pct.toFixed(2)}% different (threshold ${THRESHOLD}%)`);
console.log(`overlay → ${overlay}  (open it; large lit-up regions = real layout/size drift)`);
process.exit(pass ? 0 : 1);
