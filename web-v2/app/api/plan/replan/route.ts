/**
 * POST /api/plan/replan · Phase 2 (3.5) · bad-week re-planning.
 *
 * The audit's Part-5 #3 gap: adaptation can downgrade a day, shave a
 * week, reschedule ±2d — but a LOST week (illness, travel, life) left
 * the plan prescribing as if it had happened, diverging permanently.
 * This endpoint re-sequences the remaining block instead.
 *
 * Body: { reason: 'sick' | 'travel' | 'life', fromISO: string, toISO: string }
 *
 * Flow:
 *   1. Rebuild the plan via the SAME generatePlan the auto-rebuild path
 *      uses (archives the current plan, re-derives volume from current
 *      inputs, preserves race + taper shape, seals completed days).
 *   2. reason='sick' → apply the Research/05 return-to-run ladder to the
 *      new plan's first three weeks: 50% / 60% / 75% volume, week-1
 *      quality downgraded to easy. Travel/life skip the ladder — the
 *      re-flow alone is the fix (no illness to respect).
 *   3. Audit row in plan_proposals (kind 'replan', auto_applied — the
 *      runner asked for this explicitly; the diff page shows the result
 *      and a further rebuild can always re-cut it).
 *
 * Known approximation (minimum cut · documented): generatePlan derives
 * baseline volume from the last 28 days, which for an ONGOING gap still
 * includes pre-gap fitness — the week-1-3 ladder is what makes the
 * re-entry honest. Race-week rows are never touched by the ladder.
 *
 * Cite: Research/05 §return-to-run gates · Research/22 §compressed
 * timelines · docs/design/race-readiness-product-designs.md §3.5.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { generatePlan } from '@/lib/plan/generate';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const LADDER: Array<{ scale: number; dropQuality: boolean }> = [
  { scale: 0.5, dropQuality: true },   // week 1 · 50% + no quality
  { scale: 0.6, dropQuality: false },  // week 2 · 60%
  { scale: 0.75, dropQuality: false }, // week 3 · 75%
];

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json().catch(() => null) as
    { reason?: string; fromISO?: string; toISO?: string } | null;
  const reason = String(body?.reason ?? '');
  const fromISO = String(body?.fromISO ?? '');
  const toISO = String(body?.toISO ?? '');
  if (!['sick', 'travel', 'life'].includes(reason)
      || !/^\d{4}-\d{2}-\d{2}$/.test(fromISO) || !/^\d{4}-\d{2}-\d{2}$/.test(toISO)
      || toISO < fromISO) {
    return NextResponse.json(
      { error: 'reason (sick|travel|life) + fromISO ≤ toISO required' },
      { status: 400 },
    );
  }

  // Active plan → the race we're still building toward.
  const plan = (await pool.query<{ id: string; race_id: string | null }>(
    `SELECT id, race_id FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  )).rows[0];
  if (!plan?.race_id) {
    return NextResponse.json({ error: 'no active race-prep plan to replan' }, { status: 404 });
  }

  try {
    // 1 · regenerate (archives the old plan internally · same path as
    // auto-rebuild race_date_changed).
    const result = await generatePlan({ userId, raceSlug: String(plan.race_id) });
    const newPlanId = result.ok ? (result.plan_id ?? null) : null;
    if (!newPlanId) {
      return NextResponse.json(
        { error: `rebuild produced no plan${result.reason ? ` · ${result.reason}` : ''}` },
        { status: 500 },
      );
    }

    // 2 · sick ladder on the first three weeks of the NEW plan.
    let ladderApplied = 0;
    if (reason === 'sick') {
      const weeks = (await pool.query<{ id: string; week_start_iso: string; is_race_week: boolean }>(
        `SELECT id, week_start_iso, is_race_week FROM plan_weeks
          WHERE plan_id = $1 ORDER BY week_idx ASC LIMIT ${LADDER.length}`,
        [newPlanId],
      )).rows;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < weeks.length; i++) {
          const wk = weeks[i];
          if (wk.is_race_week) continue; // never ladder race week
          const { scale, dropQuality } = LADDER[i];
          // Volume scale on every run-type row (rest rows are 0 anyway).
          await client.query(
            `UPDATE plan_workouts
                SET distance_mi = ROUND(distance_mi * $2, 1)
              WHERE plan_id = $1 AND week_id = $3
                AND type NOT IN ('rest', 'race')`,
            [newPlanId, scale, wk.id],
          );
          if (dropQuality) {
            await client.query(
              `UPDATE plan_workouts
                  SET type = 'easy', is_quality = false, is_long = false,
                      sub_label = 'EASY',
                      pace_target_s_per_mi = NULL,
                      workout_spec = NULL,
                      notes = 'Return-to-run week 1 · easy only, stop if symptoms return. (Research/05)'
                WHERE plan_id = $1 AND week_id = $2
                  AND type IN ('tempo','threshold','intervals','long','race_week_tuneup')`,
              [newPlanId, wk.id],
            );
          }
          ladderApplied++;
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    // 3 · audit row (auto_applied · the runner explicitly asked).
    await pool.query(
      `INSERT INTO plan_proposals
         (user_uuid, plan_id, proposal_kind, reasons, status, source, new_plan_id, created_at, resolved_at)
       VALUES ($1, $2, 'replan', $3::jsonb, 'auto_applied', 'plan-replan', $4, NOW(), NOW())`,
      [userId, plan.id, JSON.stringify({ reason, fromISO, toISO, ladderWeeks: ladderApplied }), newPlanId],
    ).catch((e) => console.warn('[plan/replan] audit row failed:', e?.message));

    return NextResponse.json({
      ok: true,
      reason,
      oldPlanId: plan.id,
      planId: newPlanId,
      ladderWeeks: ladderApplied,
      diffUrl: `/training/plans/${newPlanId}/diff`,
    });
  } catch (e: unknown) {
    console.error('[plan/replan]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'replan failed' }, { status: 500 });
  }
}
