/**
 * SIM-08b · Cold-start audit for all major surfaces.
 *
 * After the P0 fix (removing OR user_id='me' from 14 query sites), we
 * verified that /today doesn't leak David's data. This expands the
 * check to every state-loader-style query a new user might hit:
 *   - /races (races scoped by user_uuid)
 *   - /plan (active plan + weeks + workouts)
 *   - /health (health_samples + check_ins + niggles + sick)
 *   - /log (strava_activities + workout_completions + skipped)
 *   - /me (profile + user_prefs + shoes + connector_tokens)
 *   - /api/learn/[slug] (shared — should NOT leak; that's intended)
 *
 * Every "0 rows" / "null" / shared-but-non-user-specific = ✓ pass.
 * Any David row leaking through = ⚠️ fail.
 */
import { Pool } from 'pg';
const SYNTH = '99999999-0000-0000-0000-000000000002';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function q(sql, params = []) { return (await pool.query(sql, params)).rows; }
function check(label, expected, actual) {
  const ok = expected === actual;
  console.log(`  ${ok ? '✓' : '⚠️'} ${label.padEnd(50)} expected=${expected} actual=${actual}`);
  return ok;
}

try {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, name, status, is_admin, timezone)
     VALUES ($1, 'sim-cold-start-2@example.test', 'NO_HASH', 'Cold Start 2', 'active', false, 'America/Los_Angeles')
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH]
  );

  console.log('=== /today + /me ===');
  check('plan lookup', 0, (await q(`SELECT id FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NULL`, [SYNTH])).length);
  check('next A-race', 0, (await q(`SELECT slug FROM races WHERE user_uuid = $1 AND meta->>'priority' = 'A' AND (meta->>'date')::date >= CURRENT_DATE`, [SYNTH])).length);
  check('profile row', 0, (await q(`SELECT user_uuid FROM profile WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')`, [SYNTH])).length);
  check('user_prefs row', 0, (await q(`SELECT user_uuid FROM user_prefs WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')`, [SYNTH])).length);
  check('shoes', 0, (await q(`SELECT id FROM shoes WHERE user_uuid = $1`, [SYNTH])).length);
  check('connector_tokens', 0, (await q(`SELECT provider FROM connector_tokens WHERE user_id = $1`, [SYNTH])).length);

  console.log('\n=== /races ===');
  check('races for user', 0, (await q(`SELECT slug FROM races WHERE user_uuid = $1`, [SYNTH])).length);
  check('races scoped strictly', 0, (await q(`SELECT slug FROM races WHERE user_uuid = $1 ORDER BY (meta->>'date')`, [SYNTH])).length);

  console.log('\n=== /plan ===');
  check('plan_workouts under any plan', 0, (await q(`SELECT pw.id FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id WHERE tp.user_uuid = $1`, [SYNTH])).length);
  check('plan_mutations', 0, (await q(`SELECT pm.id FROM plan_mutations pm JOIN plan_workouts pw ON pw.id = pm.workout_id JOIN training_plans tp ON tp.id = pw.plan_id WHERE tp.user_uuid = $1`, [SYNTH])).length);

  console.log('\n=== /health ===');
  check('health_samples', 0, (await q(`SELECT id FROM health_samples WHERE user_id = $1`, [SYNTH])).length);
  check('check_ins', 0, (await q(`SELECT id FROM check_ins WHERE user_id = $1`, [SYNTH])).length);
  check('niggles', 0, (await q(`SELECT id FROM niggles WHERE user_id = $1`, [SYNTH])).length);
  check('sick_episodes', 0, (await q(`SELECT id FROM sick_episodes WHERE user_id = $1`, [SYNTH])).length);
  check('runner_injuries', 0, (await q(`SELECT id FROM runner_injuries WHERE user_uuid = $1`, [SYNTH])).length);
  check('daily_checkin', 0, (await q(`SELECT id FROM daily_checkin WHERE user_uuid = $1`, [SYNTH])).length);

  console.log('\n=== /log ===');
  check('strava_activities', 0, (await q(`SELECT id FROM runs WHERE user_uuid = $1`, [SYNTH])).length);
  check('workout_completions', 0, (await q(`SELECT id FROM workout_completions WHERE user_id = $1`, [SYNTH])).length);
  check('workout_routes', 0, (await q(`SELECT id FROM workout_routes WHERE user_id = $1`, [SYNTH])).length);
  check('skipped_workouts', 0, (await q(`SELECT id FROM skipped_workouts WHERE user_uuid = $1`, [SYNTH])).length);

  console.log('\n=== goals + sessions (new APIs) ===');
  check('personal_goals (active)', 0, (await q(`SELECT id FROM personal_goals WHERE user_uuid = $1 AND (deadline IS NULL OR deadline >= CURRENT_DATE)`, [SYNTH])).length);
  check('strength_sessions', 0, (await q(`SELECT id FROM strength_sessions WHERE user_uuid = $1 AND date >= CURRENT_DATE - 14`, [SYNTH])).length);
  check('cross_training_sessions', 0, (await q(`SELECT id FROM cross_training_sessions WHERE user_uuid = $1 AND date >= CURRENT_DATE - 14`, [SYNTH])).length);

  console.log('\n=== shared L2 (these SHOULD return rows — they are global) ===');
  const learnArticles = (await q(`SELECT COUNT(*)::int AS n FROM learn_articles`))[0].n;
  console.log(`  ${learnArticles >= 41 ? '✓' : '⚠️'} learn_articles                                  expected≥41 actual=${learnArticles}`);
  const courseLibrary = (await q(`SELECT COUNT(*)::int AS n FROM course_library`))[0].n;
  console.log(`  ${courseLibrary >= 10 ? '✓' : '⚠️'} course_library                                  expected≥10 actual=${courseLibrary}`);

  console.log('\n=== Cleanup ===');
  await pool.query(`DELETE FROM users WHERE id = $1`, [SYNTH]);
  console.log('  synth user deleted');
} catch (e) { console.error(e); }
finally { await pool.end(); }
