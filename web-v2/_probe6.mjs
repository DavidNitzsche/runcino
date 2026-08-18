import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}});
const uid = "0645f40c-951d-4ccc-b86e-9979cd26c795";

// David's profile
console.log("[david's profile row]");
const p = await pool.query(`SELECT * FROM profile WHERE user_uuid=$1::uuid`, [uid]);
const r = p.rows[0];
if (r) {
  for (const k of Object.keys(r)) {
    const v = r[k];
    if (typeof v === 'object' && v !== null) {
      console.log(`  ${k}: ${JSON.stringify(v).slice(0, 200)}`);
    } else {
      console.log(`  ${k}: ${v}`);
    }
  }
}

// readiness_snapshots correct cols
console.log("\n[readiness_snapshots last 14d]");
const r2 = await pool.query(`SELECT snapshot_date::text, score, band FROM readiness_snapshots WHERE user_uuid::text=$1 ORDER BY snapshot_date DESC LIMIT 14`, [uid]);
for (const row of r2.rows) {
  console.log(`  ${row.snapshot_date}  score=${row.score}  band=${row.band}`);
}

// active_energy investigation
console.log("\n[active_energy daily SUMs last 7d]");
const r3 = await pool.query(`
  SELECT sample_date::date AS d, SUM(value::numeric) AS total, COUNT(*) AS cnt
    FROM health_samples
   WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'active_energy'
     AND sample_date >= ($2::date - interval '14 days')
   GROUP BY sample_date::date
   ORDER BY d DESC
`, [uid, '2026-06-05']);
for (const row of r3.rows) console.log(`  ${row.d?.toISOString?.()?.slice(0,10) ?? row.d}  total=${row.total}  rows=${row.cnt}`);

// runs.avgCadence last week
console.log("\n[runs last 7d with cadence]");
const r4 = await pool.query(`
  SELECT (data->>'date')::date AS d, data->>'avgCadence' AS cad
    FROM runs
   WHERE user_uuid = $1::uuid
     AND NOT (data ? 'mergedIntoId')
     AND (data->>'date')::date >= '2026-05-25'
   ORDER BY d DESC LIMIT 15
`, [uid]);
for (const row of r4.rows) console.log(`  ${row.d?.toISOString?.()?.slice(0,10) ?? row.d}  cad=${row.cad}`);

await pool.end();
