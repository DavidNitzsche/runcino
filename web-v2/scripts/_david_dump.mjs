import { Pool } from 'pg';
import { writeFileSync } from 'node:fs';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 4,
});

async function q(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

async function main() {
  const out = { david_uuid: DAVID, generated_at: new Date().toISOString() };

  out.users_row = await q(`SELECT * FROM users WHERE id=$1`, [DAVID]);
  out.profile_row = await q(`SELECT * FROM profile WHERE user_uuid=$1 OR user_id='me'`, [DAVID]);
  out.user_prefs_row = await q(`SELECT * FROM user_prefs WHERE user_uuid=$1 OR user_id='me'`, [DAVID]);
  out.runner_profile_all = await q(`SELECT * FROM runner_profile`);

  out.connectors = await q(`SELECT id, provider, scope, last_sync_at, last_sync_status, activities_count, connected_at, disconnected_at FROM connector_tokens WHERE user_id=$1`, [DAVID]);

  out.active_training_plans = await q(
    `SELECT id, mode, race_id, goal_iso, authored_iso, archived_iso
       FROM training_plans
      WHERE user_uuid=$1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC`,
    [DAVID]);
  out.archived_training_plan_count = (await q(
    `SELECT COUNT(*)::int AS c FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NOT NULL`,
    [DAVID]))[0].c;

  out.races = await q(`SELECT slug, meta, saved_at, (actual_result IS NOT NULL) AS has_result FROM races WHERE user_uuid=$1 ORDER BY (meta->>'date') ASC NULLS LAST`, [DAVID]);

  out.shoes = await q(`SELECT id, brand, model, color, run_types, mileage, mileage_cap, retired, preferred FROM shoes WHERE user_uuid=$1 ORDER BY retired, id`, [DAVID]);

  out.recent_strava = await q(`SELECT id, data->>'date' AS date, data->>'name' AS name, (data->>'distanceMi')::numeric AS mi, (data->>'movingTimeS')::numeric AS sec FROM strava_activities WHERE user_uuid=$1 ORDER BY (data->>'date') DESC LIMIT 5`, [DAVID]);
  out.strava_total = (await q(`SELECT COUNT(*)::int AS c FROM strava_activities WHERE user_uuid=$1`, [DAVID]))[0].c;

  out.recent_health_samples = await q(`SELECT sample_type, sample_date, value, source FROM health_samples WHERE user_id=$1 ORDER BY sample_date DESC, sample_type LIMIT 20`, [DAVID]);
  out.health_sample_types = await q(`SELECT sample_type, COUNT(*)::int AS n, MIN(sample_date) AS first, MAX(sample_date) AS last FROM health_samples WHERE user_id=$1 GROUP BY sample_type ORDER BY n DESC`, [DAVID]);

  out.daily_checkins = await q(`SELECT date, energy, soreness, stress FROM daily_checkin WHERE user_uuid=$1 ORDER BY date DESC LIMIT 14`, [DAVID]);
  out.check_ins = await q(`SELECT * FROM check_ins WHERE user_id=$1 ORDER BY ts DESC LIMIT 5`, [DAVID]);

  out.niggles = await q(`SELECT * FROM niggles WHERE user_id=$1 ORDER BY logged_at DESC`, [DAVID]);
  out.sick_episodes = await q(`SELECT * FROM sick_episodes WHERE user_id=$1 ORDER BY logged_at DESC`, [DAVID]);
  out.coach_actions = await q(`SELECT id, action_type, mode, trigger, rationale, created_at FROM coach_actions WHERE user_uuid=$1 ORDER BY created_at DESC LIMIT 5`, [DAVID]);
  out.coach_proposals = await q(`SELECT id, proposal_type, status, created_at FROM coach_proposals WHERE user_uuid=$1 ORDER BY created_at DESC LIMIT 5`, [DAVID]);
  out.coach_intents = await q(`SELECT * FROM coach_intents WHERE user_id=$1 ORDER BY ts DESC LIMIT 5`, [DAVID]);
  out.briefings = await q(`SELECT id, surface, mode, generated_at FROM briefings WHERE user_id=$1 ORDER BY generated_at DESC LIMIT 5`, [DAVID]);
  out.coach_usage_last5 = await q(`SELECT generated_at::date AS day, surface, mode, input_tokens, output_tokens FROM coach_usage WHERE user_id=$1 ORDER BY generated_at DESC LIMIT 5`, [DAVID]);

  out.device_tokens = await q(`SELECT id, platform, app_version, last_seen_at, registered_at FROM device_tokens WHERE user_id=$1`, [DAVID]);

  out.workout_completions = await q(`SELECT workout_id, status, started_at, total_distance_mi, total_duration_sec FROM workout_completions WHERE user_id=$1 ORDER BY started_at DESC LIMIT 5`, [DAVID]);
  out.workout_routes_count = (await q(`SELECT COUNT(*)::int AS c FROM workout_routes WHERE user_id=$1`, [DAVID]))[0].c;

  out.notifications_pending = await q(`SELECT * FROM notifications_pending WHERE user_id=$1`, [DAVID]);
  out.day_actions = await q(`SELECT * FROM day_actions WHERE user_id=$1 ORDER BY date_iso DESC LIMIT 5`, [DAVID]);

  // Active plan workouts (current week-ish)
  const activePlan = out.active_training_plans[0];
  if (activePlan) {
    out.active_plan_id = activePlan.id;
    out.active_plan_week_count = (await q(`SELECT COUNT(*)::int AS c FROM plan_weeks WHERE plan_id=$1`, [activePlan.id]))[0].c;
    out.active_plan_workout_count = (await q(`SELECT COUNT(*)::int AS c FROM plan_workouts WHERE plan_id=$1`, [activePlan.id]))[0].c;
    out.upcoming_workouts = await q(`SELECT date_iso, type, distance_mi, pace_target_s_per_mi, is_quality, is_long, sub_label FROM plan_workouts WHERE plan_id=$1 AND date_iso>=CURRENT_DATE::TEXT ORDER BY date_iso ASC LIMIT 10`, [activePlan.id]);
  }

  out.all_users = await q(`SELECT id, email, name, status, is_admin, created_at FROM users ORDER BY created_at`);

  writeFileSync(process.argv[2] || '/tmp/david_dump.json', JSON.stringify(out, null, 2));
  console.log('Wrote david dump');
}

try { await main(); } catch (e) { console.error(e); process.exit(1); }
finally { await pool.end(); }
