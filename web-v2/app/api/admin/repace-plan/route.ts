/**
 * POST /api/admin/repace-plan?token=<ADMIN_OPERATIONAL_TOKEN>
 *
 * One-shot P2 re-pace for the active HM plan (pln_ca91f252bba50c74).
 * Applies the VDOT-47.9 → 1:30-goal T-pace ramp to weeks 0-4.
 * Weeks 5+ are already at goal-T paces (no-op via ELSE branches).
 *
 * Gated by ADMIN_OPERATIONAL_TOKEN env var.
 * Add ?dry=1 to preview without writing.
 * DELETE THIS FILE after use.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const expected = process.env.ADMIN_OPERATIONAL_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dry = req.nextUrl.searchParams.get('dry') === '1';

  // Preview: show current paces before writing
  const before = (await pool.query(
    `SELECT pw.id, pw.date_iso, pw.type, pw.pace_target_s_per_mi,
            wk.week_idx
       FROM plan_workouts pw
       JOIN plan_weeks wk ON wk.id = pw.week_id
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'
        AND tp.archived_iso IS NULL
        AND pw.type IN ('intervals','tempo','threshold')
      ORDER BY wk.week_idx, pw.date_iso`,
  )).rows;

  if (dry) {
    return NextResponse.json({ dry: true, rows: before });
  }

  // STATEMENT 1: intervals
  const r1 = await pool.query(
    `UPDATE plan_workouts pw
        SET pace_target_s_per_mi = CASE wk.week_idx
              WHEN 0 THEN 412 WHEN 1 THEN 407 WHEN 2 THEN 403
              WHEN 3 THEN 398 WHEN 4 THEN 394 ELSE 389
            END,
            workout_spec = jsonb_set(
              pw.workout_spec, '{rep_pace_s_per_mi}',
              CASE wk.week_idx
                WHEN 0 THEN '412'::jsonb WHEN 1 THEN '407'::jsonb
                WHEN 2 THEN '403'::jsonb WHEN 3 THEN '398'::jsonb
                WHEN 4 THEN '394'::jsonb ELSE '389'::jsonb
              END
            )
       FROM plan_weeks wk, training_plans tp
      WHERE pw.week_id = wk.id AND pw.plan_id = tp.id
        AND tp.user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'
        AND tp.archived_iso IS NULL
        AND pw.type = 'intervals'`,
  );

  // STATEMENT 2: tempo
  const r2 = await pool.query(
    `UPDATE plan_workouts pw
        SET pace_target_s_per_mi = CASE wk.week_idx
              WHEN 0 THEN 442 WHEN 1 THEN 437 WHEN 2 THEN 433
              WHEN 3 THEN 428 WHEN 4 THEN 424 ELSE 419
            END,
            workout_spec = jsonb_set(
              pw.workout_spec, '{tempo_pace_s_per_mi}',
              CASE wk.week_idx
                WHEN 0 THEN '442'::jsonb WHEN 1 THEN '437'::jsonb
                WHEN 2 THEN '433'::jsonb WHEN 3 THEN '428'::jsonb
                WHEN 4 THEN '424'::jsonb ELSE '419'::jsonb
              END
            )
       FROM plan_weeks wk, training_plans tp
      WHERE pw.week_id = wk.id AND pw.plan_id = tp.id
        AND tp.user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'
        AND tp.archived_iso IS NULL
        AND pw.type = 'tempo'`,
  );

  // Verify: read back the updated rows
  const after = (await pool.query(
    `SELECT pw.id, pw.date_iso, pw.type, pw.pace_target_s_per_mi,
            wk.week_idx
       FROM plan_workouts pw
       JOIN plan_weeks wk ON wk.id = pw.week_id
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'
        AND tp.archived_iso IS NULL
        AND pw.type IN ('intervals','tempo','threshold')
      ORDER BY wk.week_idx, pw.date_iso`,
  )).rows;

  return NextResponse.json({
    intervals_updated: r1.rowCount,
    tempos_updated: r2.rowCount,
    after,
  });
}
