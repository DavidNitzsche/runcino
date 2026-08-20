import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
for (const t of ['runs', 'plan_workouts', 'projection_snapshots']) {
  const r = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position", [t]);
  console.log(`\n== ${t} ==`);
  console.log(r.rows.map(c => `${c.column_name}:${c.data_type}`).join(', '));
}
const s = await pool.query("SELECT data FROM runs WHERE user_uuid=$1 ORDER BY fetched_at DESC LIMIT 1", ['0645f40c-951d-4ccc-b86e-9979cd26c795']);
console.log('\n== runs.data keys ==\n', Object.keys(s.rows[0]?.data ?? {}).join(', '));
await pool.end();
