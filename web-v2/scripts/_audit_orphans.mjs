import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// 2026-08-24 · trimmed to tables that actually exist. Seven names in this
// list had been dropped from production, so a third of the audit's output
// was `skip (42P01)` noise — which is exactly how a real missing table would
// have looked. Dropped and NOT re-pointed (no successor): briefings,
// runs_processed, race_workouts, predictions, shoe_events, notifications
// (notifications_log is the live one), user_settings (now a jsonb field on
// profile). Added subjective_checkins, which replaced daily_checkin.
const TABLES = [
  'training_plans', 'plan_workouts', 'plan_weeks', 'plan_phases',
  'strava_activities', 'runs',
  'races',
  'health_samples', 'check_ins', 'niggles', 'runner_injuries', 'sick_episodes',
  'shoes',
  'post_run_rpe',
  'notifications_log', 'notifications_pending',
  'personal_goals', 'strength_sessions', 'cross_training_sessions',
  'profile', 'user_prefs',
  'sessions', 'device_tokens', 'connector_tokens',
  'coach_proposals', 'coach_actions', 'coach_intents',
  'subjective_checkins',
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
