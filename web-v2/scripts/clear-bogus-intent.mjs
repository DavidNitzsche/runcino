import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Find any 'watch_completion' intents for today that reference the bogus
// 40-sec abandoned shell. The real Apple Watch run came via HK (no watch
// completion intent), so any abandoned intent on today's date is stale.
const r = await pool.query(
  `SELECT id, value FROM coach_intents
    WHERE reason='watch_completion'
      AND ts::date = '2026-05-26'
      AND (value::jsonb->>'status') IN ('abandoned', 'aborted')`
);
console.log('Stale watch_completion intents:', r.rowCount);
for (const row of r.rows) {
  console.log('  id=' + row.id, String(row.value).slice(0, 120));
}
if (r.rowCount > 0) {
  const ids = r.rows.map(x => x.id);
  await pool.query(`DELETE FROM coach_intents WHERE id = ANY($1::int[])`, [ids]);
  console.log(`Deleted ${ids.length}.`);
}
// Bust briefing cache too.
const cb = await pool.query(`DELETE FROM briefings WHERE user_id::text='0645f40c-951d-4ccc-b86e-9979cd26c795'`);
console.log(`Cache busted: ${cb.rowCount} rows.`);
await pool.end();
