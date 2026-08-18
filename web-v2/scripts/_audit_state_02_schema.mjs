// STATE AUDIT · schema introspection for the tables Part 1 touches. RO.
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
const tables = ['profile','training_plans','plan_workouts','plan_weeks','plan_phases','races','projection_snapshots','strava_pushes','shoes','readiness_snapshots','runs','health_samples'];
for (const t of tables) {
  const r = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]);
  console.log(`\n${t}: ${r.rows.map(x => `${x.column_name}(${x.data_type.replace('character varying','varchar').replace('timestamp with time zone','tstz').replace('timestamp without time zone','ts')})`).join(', ')}`);
}
await pool.end();
