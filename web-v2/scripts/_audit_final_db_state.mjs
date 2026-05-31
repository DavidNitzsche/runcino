/**
 * Audit final · production DB state snapshot.
 * Read-only. Dumps the numbers needed for the final audit report.
 */
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

async function q(sql, params = []) { return (await pool.query(sql, params)).rows; }
async function one(sql, params = []) { return (await pool.query(sql, params)).rows[0]; }

function box(title) { console.log(`\n=== ${title} ===`); }

try {
  // ────────── L2 shared library tables ──────────
  box('L2 library tables');
  const learn = await one(`SELECT COUNT(*)::int n FROM learn_articles`);
  console.log(`learn_articles: ${learn.n}`);

  const courseBySource = await q(`SELECT source, COUNT(*)::int n FROM course_library GROUP BY source ORDER BY source`);
  console.log(`course_library by source:`);
  for (const r of courseBySource) console.log(`  ${r.source ?? '(null)'}: ${r.n}`);
  const courseTotal = await one(`SELECT COUNT(*)::int n FROM course_library`);
  console.log(`course_library TOTAL: ${courseTotal.n}`);

  const workoutByFamily = await q(`SELECT family, COUNT(*)::int n FROM workout_library GROUP BY family ORDER BY family`);
  console.log(`workout_library by family:`);
  for (const r of workoutByFamily) console.log(`  ${r.family}: ${r.n}`);
  const workoutTotal = await one(`SELECT COUNT(*)::int n FROM workout_library`);
  const families = await one(`SELECT COUNT(DISTINCT family)::int n FROM workout_library`);
  console.log(`workout_library TOTAL: ${workoutTotal.n} · families: ${families.n}`);

  const wxCache = await one(`SELECT COUNT(*)::int n FROM workout_weather_cache`);
  console.log(`workout_weather_cache: ${wxCache.n}`);

  // ────────── David's data ──────────
  box(`David (${DAVID})`);
  const planSplit = await q(`SELECT
    COUNT(*) FILTER (WHERE archived_iso IS NULL)::int active,
    COUNT(*) FILTER (WHERE archived_iso IS NOT NULL)::int archived,
    COUNT(*)::int total
    FROM training_plans WHERE user_uuid = $1`, [DAVID]);
  console.log(`plans: active=${planSplit[0].active} archived=${planSplit[0].archived} total=${planSplit[0].total}`);

  // List strava_activities columns to find the right weather column
  const wxCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'strava_activities'
      AND (column_name ILIKE '%weather%' OR column_name ILIKE '%temp%')
    ORDER BY column_name
  `);
  console.log(`strava_activities weather-ish columns: ${wxCols.map(r => r.column_name).join(', ') || '(none)'}`);

  const stravaCount = await one(`SELECT COUNT(*)::int n FROM runs WHERE user_uuid = $1`, [DAVID]);
  console.log(`strava_activities: ${stravaCount.n}`);

  // Weather coverage — pull most common weather-ish column
  for (const col of wxCols.map(r => r.column_name)) {
    try {
      const cov = await one(
        `SELECT COUNT(*)::int n FROM runs WHERE user_uuid = $1 AND ${col} IS NOT NULL`,
        [DAVID]
      );
      console.log(`  strava_activities.${col} non-null: ${cov.n}`);
    } catch (e) {
      console.log(`  ${col}: ERR ${e.code}`);
    }
  }

  const races = await one(`SELECT COUNT(*)::int n FROM races WHERE user_uuid = $1`, [DAVID]);
  console.log(`races: ${races.n}`);

  const shoes = await one(`SELECT COUNT(*)::int n FROM shoes WHERE user_uuid = $1`, [DAVID]);
  console.log(`shoes: ${shoes.n}`);

  const profile = await one(`SELECT COUNT(*)::int n FROM profile WHERE user_uuid = $1`, [DAVID]);
  console.log(`profile: ${profile.n}`);

  const rpe = await one(`SELECT COUNT(*)::int n FROM post_run_rpe WHERE user_uuid = $1`, [DAVID]);
  console.log(`post_run_rpe: ${rpe.n}`);

  const niggles = await one(`SELECT COUNT(*)::int n FROM niggles WHERE user_uuid = $1`, [DAVID]);
  console.log(`niggles: ${niggles.n}`);

  // ────────── coach_intents ──────────
  // FRAMING NOTE: assistant said column is `ts`, not `created_iso`
  box('coach_intents (column = ts)');
  // First confirm column name
  const ciCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'coach_intents' ORDER BY ordinal_position
  `);
  console.log(`columns: ${ciCols.map(r => r.column_name).join(', ')}`);

  const coachIntents = await q(`SELECT reason, COUNT(*)::int n, MAX(ts) AS most_recent FROM coach_intents GROUP BY reason ORDER BY reason`);
  for (const r of coachIntents) console.log(`  ${r.reason}: ${r.n} · last=${r.most_recent}`);
  if (coachIntents.length === 0) console.log('  (no rows)');

  // ────────── coach_proposals ──────────
  box('coach_proposals');
  const cpCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'coach_proposals' ORDER BY ordinal_position
  `);
  console.log(`columns: ${cpCols.map(r => r.column_name).join(', ')}`);

  const proposalsByStatus = await q(`
    SELECT status, COUNT(*)::int n,
      MIN(created_at) AS first_created,
      MAX(created_at) AS last_created,
      MAX(responded_at) AS last_responded
    FROM coach_proposals GROUP BY status ORDER BY status
  `);
  for (const r of proposalsByStatus) {
    console.log(`  ${r.status}: ${r.n} · first=${r.first_created} last=${r.last_created} last_responded=${r.last_responded}`);
  }
  const proposalsByType = await q(`
    SELECT proposal_type, COUNT(*)::int n FROM coach_proposals GROUP BY proposal_type ORDER BY proposal_type
  `);
  console.log('by proposal_type:');
  for (const r of proposalsByType) console.log(`  ${r.proposal_type}: ${r.n}`);

  // ────────── training_plans by mode + last_adapted_at ──────────
  box('training_plans by mode');
  const tpCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'training_plans' ORDER BY ordinal_position
  `);
  console.log(`columns: ${tpCols.map(r => r.column_name).join(', ')}`);

  const planByMode = await q(`SELECT mode, COUNT(*)::int n FROM training_plans GROUP BY mode ORDER BY mode`);
  for (const r of planByMode) console.log(`  mode=${r.mode ?? '(null)'}: ${r.n}`);

  const davidActive = await q(`
    SELECT id, mode, last_adapted_at, authored_iso, archived_iso, race_id
    FROM training_plans
    WHERE user_uuid = $1 AND archived_iso IS NULL
    ORDER BY authored_iso DESC
  `, [DAVID]);
  box('David active plan(s)');
  for (const r of davidActive) console.log(JSON.stringify(r));

  box('David training plans last_adapted_at summary');
  const lastAdapt = await q(`
    SELECT
      COUNT(*) FILTER (WHERE last_adapted_at IS NULL)::int never_adapted,
      COUNT(*) FILTER (WHERE last_adapted_at IS NOT NULL)::int adapted_at_least_once,
      MAX(last_adapted_at) AS most_recent_adapt
    FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NULL
  `, [DAVID]);
  console.log(JSON.stringify(lastAdapt[0]));

  // ────────── projection_snapshots ──────────
  box('projection_snapshots by source');
  const psCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'projection_snapshots' ORDER BY ordinal_position
  `);
  console.log(`columns: ${psCols.map(r => r.column_name).join(', ')}`);

  const snapBySrc = await q(`
    SELECT source, COUNT(*)::int n,
      MIN(created_at) AS earliest,
      MAX(created_at) AS most_recent
    FROM projection_snapshots GROUP BY source ORDER BY source
  `);
  for (const r of snapBySrc) console.log(`  ${r.source}: ${r.n} · earliest=${r.earliest} latest=${r.most_recent}`);

  // ────────── notifications_pending ──────────
  box('notifications_pending');
  const npCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'notifications_pending' ORDER BY ordinal_position
  `);
  console.log(`columns: ${npCols.map(r => r.column_name).join(', ')}`);

  // No "status" column — pending = processed_at IS NULL
  const notifPending = await one(`SELECT
    COUNT(*) FILTER (WHERE processed_at IS NULL)::int pending,
    COUNT(*) FILTER (WHERE processed_at IS NOT NULL)::int processed,
    COUNT(*)::int total,
    MIN(fire_at) AS earliest_fire,
    MAX(fire_at) AS latest_fire
    FROM notifications_pending`);
  console.log(JSON.stringify(notifPending));
  // Stuck pending past fire_at by > 1h?
  const stuck = await q(`
    SELECT id, user_uuid, category, fire_at, created_at FROM notifications_pending
    WHERE processed_at IS NULL AND fire_at < NOW() - INTERVAL '1 hour'
    ORDER BY fire_at LIMIT 5
  `);
  console.log(`stuck (pending > 1h overdue): ${stuck.length}`);
  for (const r of stuck) console.log(`  ${JSON.stringify(r)}`);

  // ────────── coach proposals for David ──────────
  box('David coach proposals (last 10)');
  const davidProp = await q(`
    SELECT id, proposal_type, status, created_at, responded_at, payload
    FROM coach_proposals WHERE user_uuid = $1
    ORDER BY created_at DESC LIMIT 10
  `, [DAVID]);
  for (const r of davidProp) console.log(JSON.stringify(r));

  // ────────── David adaptation_log ──────────
  box('David adaptation_log (raw)');
  const adaptLog = await one(`SELECT adaptation_log FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NULL`, [DAVID]);
  console.log(JSON.stringify(adaptLog?.adaptation_log)?.slice(0, 500));

  // ────────── Orphan deep-check ──────────
  box('Orphan deep-check (16 migration-126 tables)');
  const migration126Tables = [
    'briefings', 'check_ins', 'coach_intent', 'coach_intents', 'coach_usage',
    'connector_tokens', 'day_actions', 'device_tokens', 'health_samples',
    'niggles', 'notifications_log', 'notifications_pending', 'sessions',
    'sick_episodes', 'workout_completions', 'workout_routes',
  ];
  for (const t of migration126Tables) {
    try {
      const orph = await one(`SELECT COUNT(*)::int n FROM ${t} WHERE user_uuid IS NULL`);
      console.log(`  ${t}: ${orph.n} null-user_uuid rows`);
    } catch (e) {
      console.log(`  ${t}: ERR ${e.code} ${e.message.slice(0, 60)}`);
    }
  }

  // ────────── How many rows total across all users vs David ──────────
  box('Spread (David vs total)');
  for (const t of ['strava_activities', 'training_plans', 'races', 'niggles', 'post_run_rpe']) {
    try {
      const total = await one(`SELECT COUNT(*)::int n FROM ${t}`);
      const david = await one(`SELECT COUNT(*)::int n FROM ${t} WHERE user_uuid = $1`, [DAVID]);
      console.log(`  ${t}: total=${total.n} david=${david.n}`);
    } catch (e) {
      console.log(`  ${t}: ERR ${e.code} ${e.message.slice(0, 60)}`);
    }
  }

  // ────────── How many distinct users exist? ──────────
  box('User population');
  const allUsers = await one(`SELECT COUNT(*)::int n FROM users`);
  const usersWithPlans = await one(`SELECT COUNT(DISTINCT user_uuid)::int n FROM training_plans WHERE user_uuid IS NOT NULL`);
  const usersWithStrava = await one(`SELECT COUNT(DISTINCT user_uuid)::int n FROM runs WHERE user_uuid IS NOT NULL`);
  console.log(`users total: ${allUsers.n}`);
  console.log(`distinct user_uuid in training_plans: ${usersWithPlans.n}`);
  console.log(`distinct user_uuid in strava_activities: ${usersWithStrava.n}`);
} catch (e) {
  console.error('FATAL', e);
} finally { await pool.end(); }
