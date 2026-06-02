/**
 * _scrub_subthreshold_runs.mjs · one-time scrub of tap-test rows from
 * the `runs` table.
 *
 * Drops rows where BOTH distanceMi < 0.25 AND durationSec < 180. The
 * AND keeps any row with a real distance OR a real duration. Mirrors
 * lib/runs/length-guard.ts which now blocks these at ingest going
 * forward.
 *
 * Default = DRY-RUN: prints count + sample of what would be deleted.
 * Pass --commit to actually DELETE.
 *
 * Run preview:  node web-v2/scripts/_scrub_subthreshold_runs.mjs
 * Run live:     node web-v2/scripts/_scrub_subthreshold_runs.mjs --commit
 *
 * DATABASE_URL is the Railway proxy · writes hit production immediately.
 */
import { Pool } from 'pg';

const COMMIT = process.argv.includes('--commit');
const MIN_DISTANCE_MI = 0.25;
const MIN_DURATION_SEC = 180;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set.');
  process.exit(1);
}
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const FILTER = `
  COALESCE(
    (data->>'distanceMi')::numeric,
    (data->>'distance_mi')::numeric,
    999
  ) < ${MIN_DISTANCE_MI}
  AND COALESCE(
    (data->>'durationSec')::numeric,
    (data->>'duration_sec')::numeric,
    (data->>'movingSec')::numeric,
    (data->>'moving_sec')::numeric,
    (data->>'elapsedTimeS')::numeric,
    (data->>'movingTimeS')::numeric,
    999999
  ) < ${MIN_DURATION_SEC}
`;

async function main() {
  console.log(`[scrub] ${COMMIT ? 'LIVE' : 'DRY-RUN'} · threshold = < ${MIN_DISTANCE_MI} mi AND < ${MIN_DURATION_SEC} s\n`);

  // Count + sample
  const count = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM runs WHERE ${FILTER}`,
  )).rows[0].n;
  console.log(`Total rows matching scrub filter: ${count}\n`);

  if (count === 0) {
    console.log('Nothing to do.');
    await pool.end();
    return;
  }

  const sample = (await pool.query(
    `SELECT
        id,
        user_uuid::text AS user_uuid,
        data->>'date' AS date,
        data->>'source' AS source,
        COALESCE((data->>'distanceMi')::numeric, (data->>'distance_mi')::numeric) AS distance_mi,
        COALESCE(
          (data->>'durationSec')::numeric,
          (data->>'duration_sec')::numeric,
          (data->>'movingSec')::numeric,
          (data->>'moving_sec')::numeric
        ) AS duration_sec,
        data->>'name' AS name
       FROM runs WHERE ${FILTER}
       ORDER BY (data->>'date')::date DESC NULLS LAST
       LIMIT 30`,
  )).rows;

  console.log('Sample (up to 30 rows, newest first):');
  for (const r of sample) {
    const d = r.distance_mi != null ? `${Number(r.distance_mi).toFixed(2)}mi` : '?mi';
    const s = r.duration_sec != null ? `${r.duration_sec}s` : '?s';
    console.log(`  ${r.date ?? '?'.padEnd(10)} · ${(r.source ?? '?').padEnd(15)} · ${d.padEnd(7)} · ${s.padEnd(6)} · ${r.name ?? ''} (id=${r.id})`);
  }
  console.log();

  if (!COMMIT) {
    console.log('Dry-run complete. Re-run with --commit to delete these rows.');
    await pool.end();
    return;
  }

  // Live delete
  const del = await pool.query(`DELETE FROM runs WHERE ${FILTER}`);
  console.log(`Deleted ${del.rowCount} sub-threshold rows from runs.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
