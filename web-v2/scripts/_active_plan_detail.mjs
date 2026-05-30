import { Pool } from 'pg';
const ACTIVE_PLAN = '8599e3a1-07ab-4610-9f77-eae6a6f80032';
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function q(sql, params=[]) { return (await pool.query(sql, params)).rows; }
try {
  const plan = await q(`SELECT * FROM training_plans WHERE id=$1`, [ACTIVE_PLAN]);
  console.log('PLAN ROW:');
  for (const [k, v] of Object.entries(plan[0])) {
    const display = typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 80) + '…' : v;
    console.log(`  ${k}: ${display}`);
  }
  const phases = await q(`SELECT label, start_week_idx, end_week_idx, citation FROM plan_phases WHERE plan_id=$1 ORDER BY start_week_idx`, [ACTIVE_PLAN]);
  console.log('\nPHASES:', JSON.stringify(phases, null, 2));
  const weeks = await q(`SELECT COUNT(*)::int AS c, MIN(week_start_iso) AS first, MAX(week_start_iso) AS last FROM plan_weeks WHERE plan_id=$1`, [ACTIVE_PLAN]);
  console.log('\nWEEKS:', weeks);
  const wo = await q(`SELECT COUNT(*)::int AS c, MIN(date_iso) AS first, MAX(date_iso) AS last FROM plan_workouts WHERE plan_id=$1`, [ACTIVE_PLAN]);
  console.log('WORKOUTS:', wo);
  const thisWeek = await q(`SELECT date_iso, dow, type, distance_mi, pace_target_s_per_mi, duration_min, is_quality, is_long, sub_label FROM plan_workouts WHERE plan_id=$1 AND date_iso BETWEEN '2026-05-25' AND '2026-05-31' ORDER BY date_iso`, [ACTIVE_PLAN]);
  console.log('\nTHIS WEEK ON THE ACTIVE PLAN:', JSON.stringify(thisWeek, null, 2));
} catch (e) { console.error(e); } finally { await pool.end(); }
