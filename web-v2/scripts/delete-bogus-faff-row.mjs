// One-off: delete the 40-sec Faff-watch row from 2026-05-26 (id -46270221304433).
// Bogus data — distance 0, both splits marked completed:false, no HR. The real
// run lives in HK on the phone and will land via the new HK importer.
import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const target = await pool.query(
  `SELECT id, data->>'date' AS date, data->>'durationSec' AS dur, data->>'distanceMi' AS dist, data->>'name' AS name
     FROM strava_activities
    WHERE data->>'date' = '2026-05-26'
      AND data->>'source' = 'watch'
      AND (data->>'distanceMi')::numeric < 0.5
      AND (data->>'durationSec')::int < 120`
);
console.log('Candidates for delete:');
for (const r of target.rows) console.log(' ', r);
if (target.rows.length === 0) {
  console.log('Nothing to delete. Exiting.');
  await pool.end();
  process.exit(0);
}
if (target.rows.length > 1) {
  console.log('Multiple candidates — refusing to delete. Inspect manually.');
  await pool.end();
  process.exit(1);
}
const id = target.rows[0].id;
console.log(`\nDeleting id=${id} …`);
const del = await pool.query(`DELETE FROM strava_activities WHERE id = $1`, [id]);
console.log(`Deleted ${del.rowCount} row(s).`);

// Also bust briefing cache for David so /today re-generates next open.
const userId = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const cb = await pool.query(`DELETE FROM briefings WHERE user_id::text = $1`, [userId]);
console.log(`Busted ${cb.rowCount} briefing rows.`);

await pool.end();
