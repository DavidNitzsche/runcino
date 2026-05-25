import sharp from 'sharp';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
const W=396,H=484;
const load = async p => PNG.sync.read(await sharp(p).flatten({background:'#000'}).resize(W,H,{fit:'fill'}).png().toBuffer());
const a = await load('refs/work-interval.png'), b = await load('build/work-interval.png');
const d = new PNG({width:W,height:H});
pixelmatch(a.data,b.data,d.data,W,H,{threshold:0.12});
fs_writeFileSync;
