import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sql = fs.readFileSync('db/migrations/126_user_uuid_unification.sql','utf8');
console.log('Applying migration 126 (user_uuid_unification)…');
await pool.query(sql);
const tables = ['briefings','check_ins','coach_intent','coach_intents','coach_usage',
  'connector_tokens','day_actions','device_tokens','health_samples','niggles',
  'notifications_log','notifications_pending','sessions','sick_episodes',
  'workout_completions','workout_routes'];
console.log('OK · verifying user_uuid column on each affected table:');
for (const t of tables) {
  const r = await pool.query(
    `SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='user_uuid'`,
    [t]);
  const dt = r.rows[0]?.data_type ?? 'MISSING';
  console.log(`  ${t.padEnd(28)} user_uuid=${dt}`);
}
await pool.end();
