/**
 * POST /api/cron/silent-rebuild
 *
 * 2026-06-03 · one-shot silent plan rebuild · calls generatePlan
 * directly, bypassing fireAutoRebuild's plan_proposals audit + the
 * coach_intents pipeline. Used to land newly-shipped rules into a
 * runner's active plan without firing "your plan was adapted" banners
 * for what's essentially a backend code upgrade, not a coach decision.
 *
 * Caller:
 *   POST /api/cron/silent-rebuild
 *   Authorization: Bearer ${CRON_SECRET}
 *   Body: { userUuid: string, raceSlug?: string }
 *
 * When raceSlug is omitted, uses the active plan's race_id.
 *
 * Side effects:
 *   1. archives the current active plan (via persistPlan → clearActivePlansFor)
 *   2. inserts a fresh training_plans + plan_phases + plan_weeks + plan_workouts
 *   3. acks any plan_adapt_* coach_intents that point at the archived
 *      plan_workouts (those rows no longer exist · the banners are stale)
 *
 * What it does NOT do:
 *   · NO plan_proposals row
 *   · NO new coach_intents
 *   · NO "your plan was adapted" banner on Today
 *
 * Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md (the rules being landed)
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { generatePlan } from '@/lib/plan/generate';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { userUuid?: string; raceSlug?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const userUuid = body.userUuid;
  if (!userUuid) return NextResponse.json({ error: 'userUuid required' }, { status: 400 });

  // Resolve raceSlug from active plan if not provided
  let raceSlug = body.raceSlug;
  let priorPlanId: string | null = null;
  if (!raceSlug) {
    const prior = (await pool.query<{ id: string; race_id: string }>(
      `SELECT id, race_id FROM training_plans
        WHERE user_uuid = $1 AND archived_iso IS NULL
        ORDER BY authored_iso DESC LIMIT 1`,
      [userUuid],
    ).catch(() => ({ rows: [] }))).rows[0];
    if (!prior) {
      return NextResponse.json({ error: 'no active plan and no raceSlug provided' }, { status: 400 });
    }
    raceSlug = prior.race_id;
    priorPlanId = prior.id;
  } else {
    const prior = (await pool.query<{ id: string }>(
      `SELECT id FROM training_plans
        WHERE user_uuid = $1 AND archived_iso IS NULL
        ORDER BY authored_iso DESC LIMIT 1`,
      [userUuid],
    ).catch(() => ({ rows: [] }))).rows[0];
    priorPlanId = prior?.id ?? null;
  }

  // Run the rebuild · generatePlan handles archive + persist
  const result = await generatePlan({ userId: userUuid, raceSlug: raceSlug! });
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 500 });
  }

  // Ack stale plan_adapt_* coach_intents that pointed at the now-archived
  // plan_workouts · their field column held the old workout_id. The
  // banner-rendering UI uses acknowledged_at IS NULL to surface, so
  // stamping it makes them stop showing without deleting the audit log.
  let ackedIntents = 0;
  if (priorPlanId) {
    const ack = await pool.query(
      `UPDATE coach_intents ci
          SET acknowledged_at = NOW()
        WHERE COALESCE(ci.user_uuid::text, ci.user_id::text) = $1
          AND ci.acknowledged_at IS NULL
          AND ci.reason LIKE 'plan_adapt_%'
          AND ci.field IN (
            SELECT id FROM plan_workouts WHERE plan_id = $2
          )`,
      [userUuid, priorPlanId],
    ).catch(() => ({ rowCount: 0 }));
    ackedIntents = ack.rowCount ?? 0;
  }

  return NextResponse.json({
    ok: true,
    prior_plan_id: priorPlanId,
    new_plan_id: result.plan_id,
    weeks_generated: result.weeks_generated,
    acked_stale_intents: ackedIntents,
  });
}
