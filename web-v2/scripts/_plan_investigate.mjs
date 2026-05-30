import { Pool } from 'pg';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function q(sql, params=[]) { return (await pool.query(sql, params)).rows; }

try {
  // What plan owns today's workout?
  console.log('=== ALL training_plans for David (any state) ===');
  const all = await q(`SELECT id, mode, race_id, goal_iso, authored_iso, archived_iso, user_uuid::text FROM training_plans WHERE user_uuid = $1 ORDER BY authored_iso DESC`, [DAVID]);
  console.log('Count:', all.length);
  for (const r of all.slice(0, 5)) console.log(JSON.stringify(r));

  console.log('\n=== training_plans where archived_iso IS NULL (any user) ===');
  const active = await q(`SELECT id, user_uuid::text AS user_uuid, mode, race_id, goal_iso, authored_iso, archived_iso FROM training_plans WHERE archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 10`);
  console.log(JSON.stringify(active, null, 2));

  console.log('\n=== Most recent training_plans regardless of user_uuid (top 5) ===');
  const recent = await q(`SELECT id, user_uuid::text AS user_uuid, mode, race_id, goal_iso, authored_iso, archived_iso FROM training_plans ORDER BY authored_iso DESC LIMIT 5`);
  console.log(JSON.stringify(recent, null, 2));

  console.log('\n=== plan_workouts that include TODAY (2026-05-30) ===');
  const todayWorkouts = await q(`SELECT plan_id, date_iso, dow, type, distance_mi, pace_target_s_per_mi, is_quality, is_long FROM plan_workouts WHERE date_iso = '2026-05-30' ORDER BY plan_id LIMIT 20`);
  console.log(JSON.stringify(todayWorkouts, null, 2));

  console.log('\n=== plan_workouts THIS WEEK (2026-05-25 to 2026-05-31) ===');
  const thisWeek = await q(`SELECT plan_id, date_iso, type, distance_mi FROM plan_workouts WHERE date_iso BETWEEN '2026-05-25' AND '2026-05-31' ORDER BY date_iso ASC, plan_id ASC`);
  console.log(JSON.stringify(thisWeek, null, 2));

  // If we find plan_ids for this week, look them up
  if (thisWeek.length > 0) {
    const planIds = [...new Set(thisWeek.map(r => r.plan_id))];
    console.log('\n=== Plans referenced THIS WEEK ===');
    for (const pid of planIds) {
      const p = await q(`SELECT id, user_uuid::text AS user_uuid, mode, race_id, goal_iso, authored_iso, archived_iso FROM training_plans WHERE id=$1`, [pid]);
      console.log(JSON.stringify(p[0]));
    }
  }

  console.log('\n=== David recent plans, weeks/workouts/mutations counts ===');
  for (const p of all.slice(0,3)) {
    const wc = (await q(`SELECT COUNT(*)::int AS c FROM plan_weeks WHERE plan_id=$1`, [p.id]))[0].c;
    const woc = (await q(`SELECT COUNT(*)::int AS c FROM plan_workouts WHERE plan_id=$1`, [p.id]))[0].c;
    const last = await q(`SELECT MAX(date_iso) AS last_date, MIN(date_iso) AS first_date FROM plan_workouts WHERE plan_id=$1`, [p.id]);
    console.log(`Plan ${p.id}  mode=${p.mode}  race=${p.race_id}  goal=${p.goal_iso}  authored=${p.authored_iso}  archived=${p.archived_iso}  weeks=${wc}  workouts=${woc}  span=${last[0].first_date}..${last[0].last_date}`);
  }
} catch (e) {
  console.error(e);
} finally { await pool.end(); }
