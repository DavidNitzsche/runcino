import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}});
const uid = "0645f40c-951d-4ccc-b86e-9979cd26c795";

// readiness_snapshots schema
console.log("[readiness_snapshots cols]");
const t = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='readiness_snapshots' ORDER BY ordinal_position`);
for (const r of t.rows) console.log("  " + r.column_name);

// readiness_snapshots
console.log("\n[readiness_snapshots last 14d for david]");
const r2 = await pool.query(`SELECT * FROM readiness_snapshots WHERE COALESCE(user_uuid::text, user_id::text)=$1 ORDER BY snapshot_date DESC LIMIT 14`, [uid]);
for (const row of r2.rows) {
  const d = row.snapshot_date?.toISOString?.()?.slice(0,10) ?? row.snapshot_date;
  console.log(`  ${d}  score=${row.score}  band=${row.band}`);
}

// profile schema
console.log("\n[profile cols]");
const tt = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='profile' ORDER BY ordinal_position`);
for (const r of tt.rows) console.log("  " + r.column_name);

console.log("\n[runner_profile cols]");
const tt2 = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='runner_profile' ORDER BY ordinal_position`);
for (const r of tt2.rows) console.log("  " + r.column_name);

// David's profile
console.log("\n[david's profile row]");
const p = await pool.query(`SELECT * FROM profile WHERE user_uuid=$1::uuid OR user_id=$1`, [uid]);
console.log(JSON.stringify(p.rows[0], null, 2));

await pool.end();
