import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const userId = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const r = (await pool.query(
  `SELECT id, data FROM strava_activities
    WHERE user_uuid = $1
      AND data->>'date' = '2026-05-26'
      AND (data->>'warmupAddedManually')::boolean = true
    LIMIT 1`, [userId]
)).rows[0];

if (!r) { console.log('no patched row'); await pool.end(); process.exit(0); }

const dur = Number(r.data.durationSec ?? 0);
const mov = Number(r.data.movingSec ?? r.data.movingTimeS ?? dur);

function mmss(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const patch = {
  ...r.data,
  timeMoving: mmss(mov),
  movingTimeS: mov,        // legacy alias some readers use
  durationSec: dur,
  movingSec: mov,
};
await pool.query(`UPDATE strava_activities SET data = $1 WHERE id = $2`, [patch, r.id]);
console.log(`Patched timeMoving=${patch.timeMoving} movingTimeS=${mov}`);

const cb = await pool.query(`DELETE FROM briefings WHERE user_id::text = $1`, [userId]);
console.log(`Busted ${cb.rowCount} briefing rows.`);
await pool.end();
