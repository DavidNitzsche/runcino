/**
 * _backfill_user_uuid.mjs · 2026-05-30
 *
 * Idempotent backfill that populates `user_uuid` from the legacy `user_id`
 * column on every table touched by migration 126. Two flavors:
 *
 *  1) `user_id` is already uuid-typed → straight copy: SET user_uuid = user_id
 *  2) `user_id` is text-typed         → map 'me' to David's uuid; cast others
 *
 * Re-runnable. Each UPDATE has a WHERE user_uuid IS NULL guard so we never
 * overwrite a row that already has a user_uuid. Per-table counts are
 * reported.
 *
 * Run with: node scripts/_backfill_user_uuid.mjs
 */
import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// 15 tables where user_id is already uuid-typed — straight copy.
const UUID_TABLES = [
  'briefings','check_ins','coach_intents','coach_usage',
  'connector_tokens','day_actions','device_tokens','health_samples',
  'niggles','notifications_log','notifications_pending','sessions',
  'sick_episodes','workout_completions','workout_routes',
];

// 1 table where user_id is text — map 'me' to David, cast everything else.
const TEXT_TABLES = ['coach_intent'];

console.log('Backfilling user_uuid from user_id …\n');
const totals = {};

for (const t of UUID_TABLES) {
  try {
    const r = await pool.query(
      `UPDATE "${t}" SET user_uuid = user_id WHERE user_uuid IS NULL AND user_id IS NOT NULL`
    );
    totals[t] = r.rowCount;
    console.log(`  ${t.padEnd(28)} rows backfilled: ${r.rowCount}`);
  } catch (e) {
    console.log(`  ${t.padEnd(28)} ERR: ${e.message}`);
    totals[t] = `ERR ${e.message}`;
  }
}

for (const t of TEXT_TABLES) {
  try {
    // Step 1: 'me' → David
    const meRes = await pool.query(
      `UPDATE "${t}" SET user_uuid = $1::uuid WHERE user_uuid IS NULL AND user_id = 'me'`,
      [DAVID]
    );
    // Step 2: anything else that looks like a uuid → cast
    const castRes = await pool.query(
      `UPDATE "${t}" SET user_uuid = user_id::uuid
        WHERE user_uuid IS NULL
          AND user_id IS NOT NULL
          AND user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`
    );
    totals[t] = `${meRes.rowCount}+${castRes.rowCount}`;
    console.log(`  ${t.padEnd(28)} rows backfilled: me→${meRes.rowCount} · uuid-cast→${castRes.rowCount}`);
  } catch (e) {
    console.log(`  ${t.padEnd(28)} ERR: ${e.message}`);
    totals[t] = `ERR ${e.message}`;
  }
}

console.log('\n=== Post-backfill: any rows still missing user_uuid? ===');
for (const t of [...UUID_TABLES, ...TEXT_TABLES]) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "${t}" WHERE user_uuid IS NULL AND user_id IS NOT NULL`
    );
    const n = r.rows[0].n;
    const tag = n === 0 ? 'OK' : `STILL MISSING (${n})`;
    console.log(`  ${t.padEnd(28)} ${tag}`);
  } catch (e) {
    console.log(`  ${t.padEnd(28)} ERR: ${e.message}`);
  }
}

await pool.end();
console.log('\nDone.');
