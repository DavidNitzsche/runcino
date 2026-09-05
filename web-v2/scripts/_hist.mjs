import pg from 'pg'; import fs from 'node:fs';
const env=Object.fromEntries(fs.readFileSync(new URL('../.env.local',import.meta.url),'utf8').split('\n').map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim()]));
const U='0645f40c-951d-4ccc-b86e-9979cd26c795';
const c=new pg.Client({connectionString:env.DATABASE_URL_RO,ssl:{rejectUnauthorized:false}});await c.connect();
const {rows}=await c.query(`SELECT (data->>'startLocal') s,(data->>'distanceMi')::numeric mi,(data->>'avgHr')::numeric hr
  FROM runs WHERE user_uuid=$1::uuid AND NOT (data ? 'mergedIntoId') AND (data->>'startLocal')>='2026-05-25' ORDER BY 1`,[U]);
// weekly totals, Mon-start
const wk={};
for(const r of rows){const d=new Date(String(r.s).slice(0,10)+'T12:00:00Z');const dow=(d.getUTCDay()+6)%7;const m=new Date(d);m.setUTCDate(d.getUTCDate()-dow);const k=m.toISOString().slice(0,10);
 wk[k]=wk[k]||{mi:0,n:0,hrsum:0,hrn:0};wk[k].mi+=Number(r.mi)||0;wk[k].n++;if(r.hr){wk[k].hrsum+=Number(r.hr);wk[k].hrn++;}}
console.log('WEEK       mi     runs  meanHr');
Object.entries(wk).sort().forEach(([k,v])=>console.log(`${k}  ${String(v.mi.toFixed(1)).padStart(5)}   ${String(v.n).padStart(2)}    ${v.hrn?Math.round(v.hrsum/v.hrn):'—'}`));
console.log('\nDAYS AFTER THE 18-MILER (2026-07-25) and AFTER THE HALF (2026-08-16):');
for(const anchor of ['2026-07-25','2026-08-16']){
  console.log(' anchor '+anchor);
  rows.filter(r=>{const d=String(r.s).slice(0,10);return d>anchor && d<=new Date(Date.parse(anchor)+9*864e5).toISOString().slice(0,10);})
      .forEach(r=>console.log('   +'+Math.round((Date.parse(String(r.s).slice(0,10))-Date.parse(anchor))/864e5)+'d  '+Number(r.mi).toFixed(2)+' mi  hr '+(r.hr??'—')));
}
await c.end();
