import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

console.log('Applying migration 129 (rename strava_activities → runs + back-compat view)…');

// Idempotency guard: if `runs` already exists, the migration ran. Skip.
const exists = await pool.query(
  `SELECT 1
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'runs' AND c.relkind = 'r'
    LIMIT 1`,
);
if (exists.rows.length > 0) {
  console.log('  · `runs` table already exists · migration already applied. Skipping.');
} else {
  const sql = fs.readFileSync('db/migrations/129_rename_strava_activities_to_runs.sql','utf8');
  await pool.query(sql);
}

// Sanity probes against the new state.
const counts = await pool.query(`
  SELECT
    (SELECT COUNT(*) FROM runs) AS runs_count,
    (SELECT COUNT(*) FROM strava_activities) AS view_count`);
console.log(`OK · runs: ${counts.rows[0].runs_count} rows · strava_activities (view): ${counts.rows[0].view_count} rows`);

// Quick write-path probe through the view: insert a probe row + roll back.
await pool.query(`
  BEGIN;
  INSERT INTO strava_activities (id, user_uuid, data)
  VALUES (-9999999999, '00000000-0000-0000-0000-000000000000', '{"_probe":true}'::jsonb);
  ROLLBACK`);
console.log('OK · view supports INSERT (auto-rewrite to runs verified)');

await pool.end();
