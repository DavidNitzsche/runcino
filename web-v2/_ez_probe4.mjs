import { Pool } from 'pg';
const U = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='user_settings'");
console.log('user_settings cols:', cols.rows.map(c=>c.column_name).join(', '));
const hrc = cols.rows.map(c=>c.column_name).filter(c=>/hr|max|thresh|rest/i.test(c));
if (hrc.length) {
  const r = await pool.query(`SELECT ${hrc.join(',')} FROM user_settings WHERE user_uuid=$1`, [U]);
  console.log('HR settings:', JSON.stringify(r.rows[0]));
}
const mx = await pool.query(
  `SELECT max((data->>'maxHr')::float) obs_max, percentile_cont(0.99) WITHIN GROUP (ORDER BY (data->>'maxHr')::float) p99
   FROM runs WHERE user_uuid=$1 AND (data->>'maxHr') IS NOT NULL
     AND substr(data->>'startLocal',1,10) >= to_char(now() - interval '365 days','YYYY-MM-DD')`, [U]);
console.log('observed maxHr (365d):', JSON.stringify(mx.rows[0]));

// pace vs HR on sub-quality runs, to read the HR the engine's band actually lands at
const r = await pool.query(
  `SELECT substr(data->>'startLocal',1,10) d, (data->>'paceSPerMi')::float pace, (data->>'avgHr')::float hr,
          (data->>'distanceMi')::float mi
   FROM runs WHERE user_uuid=$1 AND data->>'mergedIntoId' IS NULL AND absorbed_into_canonical_at IS NULL
     AND (data->>'paceSPerMi') IS NOT NULL AND (data->>'avgHr') IS NOT NULL
     AND (data->>'distanceMi')::float BETWEEN 4 AND 10
     AND substr(data->>'startLocal',1,10) >= to_char(now() - interval '120 days','YYYY-MM-DD')
   ORDER BY 2`, [U]);
console.log('\npace(s/mi) -> avgHr, 4-10mi runs, 120d:');
r.rows.forEach(x => console.log(`  ${Math.floor(x.pace/60)}:${String(Math.round(x.pace%60)).padStart(2,'0')}  hr=${Math.round(x.hr)}  ${x.mi.toFixed(1)}mi  ${x.d}`));
// least-squares hr = a + b*pace
const n=r.rows.length, sx=r.rows.reduce((a,v)=>a+v.pace,0), sy=r.rows.reduce((a,v)=>a+v.hr,0);
const sxy=r.rows.reduce((a,v)=>a+v.pace*v.hr,0), sxx=r.rows.reduce((a,v)=>a+v.pace*v.pace,0);
const b=(n*sxy-sx*sy)/(n*sxx-sx*sx), a=(sy-b*sx)/n;
console.log(`\n fit: avgHr = ${a.toFixed(1)} + ${b.toFixed(4)}*paceSec   (n=${n})`);
for (const p of [453+80, 453+120, 453+104, 453+156, 494]) console.log(`   pace ${Math.floor(p/60)}:${String(p%60).padStart(2,'0')}/mi -> predicted avgHr ${Math.round(a+b*p)}`);
await pool.end();
