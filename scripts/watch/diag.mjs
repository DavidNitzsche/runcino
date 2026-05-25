import sharp from 'sharp';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
const W=396,H=484;
const load = async p => PNG.sync.read(await sharp(p).flatten({background:'#000'}).resize(W,H,{fit:'fill'}).png().toBuffer());
for (const f of ['work-interval','green-on-the-band','warmup','recovery','summary','glance']) {
  const a = await load(`refs/${f}.png`), b = await load(`build/${f}.png`);
  const d = new PNG({width:W,height:H});
  const n = pixelmatch(a.data,b.data,d.data,W,H,{threshold:0.12});
  console.log(f.padEnd(20), (100*n/(W*H)).toFixed(2)+'%  (flattened on black)');
}
