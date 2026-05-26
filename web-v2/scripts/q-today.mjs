import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
// First inspect schema
const cols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='strava_activities' ORDER BY ordinal_position`);
console.log('SCHEMA:');
for (const c of cols.rows) console.log(' ', c.column_name, c.data_type);
console.log('---');
const r = await pool.query(`
  SELECT id, user_uuid,
         data->>'startLocal' AS start_local,
         data->>'date' AS date,
         data->>'distanceMi' AS dist_mi,
         data->>'movingTimeS' AS moving_s,
         data->>'elapsedTimeS' AS elapsed_s,
         data->>'avgHr' AS avg_hr,
         data->>'name' AS name,
         data->>'mergedIntoId' AS merged_into,
         data->>'type' AS type,
         data->>'source' AS data_source,
         jsonb_object_keys(data) AS k
    FROM strava_activities
   WHERE (data->>'date' = '2026-05-26' OR data->>'startLocal' LIKE '2026-05-26%' OR data->>'startLocal' LIKE '2026-05-25%')
   ORDER BY data->>'startLocal' DESC NULLS LAST`);
const byId = new Map();
for (const row of r.rows) {
  if (!byId.has(row.id)) byId.set(row.id, { ...row, keys: [row.k] });
  else byId.get(row.id).keys.push(row.k);
}
for (const v of byId.values()) {
  delete v.k;
  v.keys = [...new Set(v.keys)].sort();
  console.log(JSON.stringify(v, null, 2));
  console.log('---');
}
console.log('rowcount:', byId.size);
await pool.end();
