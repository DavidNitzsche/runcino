import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const TABLES = [
  'training_plans', 'plan_workouts', 'plan_weeks', 'plan_phases',
  'strava_activities', 'runs', 'runs_processed',
  'races', 'race_workouts', 'predictions',
  'health_samples', 'check_ins', 'niggles', 'runner_injuries', 'sick_episodes',
  'shoes', 'shoe_events',
  'post_run_rpe',
  'notifications', 'notifications_pending',
  'personal_goals', 'strength_sessions', 'cross_training_sessions',
  'profile', 'user_prefs', 'user_settings',
  'sessions', 'device_tokens', 'connector_tokens',
  'coach_proposals', 'coach_actions', 'coach_intents', 'briefings',
  'projection_snapshots', 'day_actions', 'plan_mutations',
];
console.log('Auditing orphan rows (user_uuid IS NULL) per table…\n');
let totalOrphans = 0;
for (const t of TABLES) {
  try {
    const r = await pool.query(`SELECT COUNT(*) AS n FROM ${t} WHERE user_uuid IS NULL`);
    const n = Number(r.rows[0].n);
    if (n > 0) {
      console.log(`  ${t.padEnd(28)} ${String(n).padStart(6)} orphan rows`);
      totalOrphans += n;
    }
  } catch (e) {
    console.log(`  ${t.padEnd(28)} skip (${e.code || e.message})`);
  }
}
console.log(`\nTOTAL orphan rows: ${totalOrphans}`);
await pool.end();
