import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query(`
  SELECT id, user_uuid, fetched_at, detail_at, shoe_id, data, detail
    FROM strava_activities
   WHERE (data->>'date' = '2026-05-26' OR data->>'startLocal' LIKE '2026-05-26%')
   ORDER BY data->>'startLocal' DESC NULLS LAST`);
for (const row of r.rows) {
  console.log('--- ROW ---');
  console.log('id          ', row.id);
  console.log('user_uuid   ', row.user_uuid);
  console.log('fetched_at  ', row.fetched_at);
  console.log('detail_at   ', row.detail_at);
  console.log('shoe_id     ', row.shoe_id);
  console.log('data        ');
  console.log(JSON.stringify(row.data, null, 2));
  console.log('detail      ');
  console.log(JSON.stringify(row.detail, null, 2));
}
console.log('rowcount:', r.rows.length);
await pool.end();
