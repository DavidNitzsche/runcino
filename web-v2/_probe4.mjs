import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}});
const uid = "0645f40c-951d-4ccc-b86e-9979cd26c795";

// Find profiles table
console.log("[tables matching profile/user]");
const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%profile%' OR table_name ILIKE '%user%') ORDER BY table_name`);
for (const r of tables.rows) console.log("  " + r.table_name);

// readiness_snapshots last 14d
console.log("\n[readiness_snapshots last 14d]");
const r2 = await pool.query(`
  SELECT sample_date, score, band, drivers
    FROM readiness_snapshots
   WHERE COALESCE(user_uuid::text, user_id::text) = $1
     AND sample_date >= NOW() - interval '14 days'
   ORDER BY sample_date DESC
`, [uid]);
for (const row of r2.rows) {
  const d = row.sample_date?.toISOString?.()?.slice(0,10) ?? row.sample_date;
  console.log(`  ${d}  score=${row.score}  band=${row.band}`);
}

await pool.end();
