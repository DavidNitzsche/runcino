// Vertical content profile: how much bright text sits at each height, for
// ref vs build, side by side. Makes "the bottom half is smaller/lower" a
// measurement, not a guess. Flattens onto black so transparent/bezel areas
// don't register; counts only bright (text) pixels.
import sharp from 'sharp';
import { PNG } from 'pngjs';

const W = 396, H = 484, BUCK = 12;
const load = async p =>
  PNG.sync.read(await sharp(p).flatten({ background: '#000' }).resize(W, H, { fit: 'fill' }).png().toBuffer());

function profile(png) {
  const rows = new Array(H).fill(0);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (png.data[i] + png.data[i + 1] + png.data[i + 2] > 230) rows[y]++;
    }
  const buckets = [];
  for (let y = 0; y < H; y += BUCK) {
    let s = 0; for (let k = 0; k < BUCK && y + k < H; k++) s += rows[y + k];
    buckets.push(Math.round(100 * s / (BUCK * W)));   // avg lit % in bucket
  }
  return buckets;
}

const [, , refP, buildP] = process.argv;
const a = profile(await load(refP));
const b = profile(await load(buildP));
const bar = n => '█'.repeat(Math.round(n / 2));
console.log(`y%     REF ${refP.split('/').pop().padEnd(20)} | BUILD ${buildP.split('/').pop()}`);
for (let i = 0; i < a.length; i++) {
  const y = i * BUCK;
  console.log(`${String(y).padStart(3)}  ${String(a[i]).padStart(3)} ${bar(a[i]).padEnd(26)} | ${String(b[i]).padStart(3)} ${bar(b[i])}`);
}
