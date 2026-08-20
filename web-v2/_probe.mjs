import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}});
const uid = "0645f40c-951d-4ccc-b86e-9979cd26c795";
const r = await pool.query(`
  SELECT sample_type, COUNT(*) AS cnt, MAX(sample_date) AS latest_date
    FROM health_samples
   WHERE COALESCE(user_uuid, user_id) = $1
     AND sample_date >= NOW() - interval '60 days'
   GROUP BY sample_type
   ORDER BY sample_type
`, [uid]);
console.log("[health_samples last 60d by type]");
for (const row of r.rows) {
  const d = row.latest_date?.toISOString?.()?.slice(0,10) ?? row.latest_date;
  console.log(`  ${row.sample_type.padEnd(28)} cnt=${String(row.cnt).padStart(4)} latest=${d}`);
}
await pool.end();
