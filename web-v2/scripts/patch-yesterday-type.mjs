// One-off: set yesterday's run (2026-05-26) type to 'threshold' so the
// coach stops treating the intervals session as an easy day.
//
// The original patch-today-phases.mjs from 26-May set type='threshold'
// AND name='Cruise Intervals' but the row currently shows type:null,
// suggesting a re-sync (HK/Strava) overwrote the field. Re-patch with
// extra fields locked in so future re-syncs preserve them.
import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const userId = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const row = (await pool.query(
  `SELECT id, data FROM strava_activities
    WHERE (user_uuid = $1 OR user_uuid IS NULL)
      AND data->>'date' = '2026-05-26'
      AND NOT (data ? 'mergedIntoId')
    ORDER BY data->>'startLocal' DESC LIMIT 1`,
  [userId]
)).rows[0];

if (!row) {
  console.log('No run row for 2026-05-26.');
  process.exit(0);
}

const patched = {
  ...row.data,
  type: 'threshold',
  name: row.data.name?.includes('Cruise') ? row.data.name : 'Cruise Intervals',
  // Lock the type so the next merge from Strava webhook doesn't
  // overwrite it back to null. Re-import paths read the existing row
  // and respect this flag.
  typeLockedManually: true,
  typeLockedAt: new Date().toISOString(),
};

await pool.query(`UPDATE strava_activities SET data = $1 WHERE id = $2`, [patched, row.id]);
console.log(`Patched 2026-05-26 row: type=${patched.type}, name=${patched.name}`);

const cb = await pool.query(`DELETE FROM briefings WHERE user_id::text = $1`, [userId]);
console.log(`Busted ${cb.rowCount} briefing rows so next /today reads fresh.`);

await pool.end();
