/**
 * POST /api/cron/run-adaptations  (P38)
 *
 * Daily adaptation pass — detects triggers (missed key workout, RHR
 * spike, sleep crater, volume overshoot) and applies actions to
 * plan_workouts. Idempotent.
 *
 * Auth: CRON_SECRET. Schedule: 07:15 UTC = 00:15 PT (between briefing
 * cron at 07:05 and weather cron at 07:30). Adaptation must happen
 * BEFORE the morning briefing reads the plan so the coach sees the
 * adapted state.
 *
 * Runs over all active users (training_plans with archived_iso IS NULL).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { detectAdaptations, applyAdaptations } from '@/lib/plan/adapt';
import { tryAdaptiveBump } from '@/lib/plan/adaptive-ramp';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { raiseAlert } from '@/lib/ops/alerts';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth.replace(/^Bearer\s+/i, '').trim() !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let userIds: string[] = [];
  try {
    userIds = (await pool.query(
      `SELECT DISTINCT user_uuid::text AS uid FROM training_plans
        WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`,
    )).rows.map((r: any) => r.uid);
  } catch (e: any) {
    return NextResponse.json({ error: 'failed to list users', detail: e.message }, { status: 500 });
  }

  const results: Array<{ user_id: string; triggers: number; applied: number; proposed: number; error?: string }> = [];
  for (const uid of userIds) {
    try {
      const { triggers, actions } = await detectAdaptations(uid);

      // 2026-06-04 · split actions into APPLY-NOW vs PROPOSE-FIRST.
      // David's complaint: "I dont want to wake up to change runs ·
      // that was annoying." Readiness-pullback adaptations now write
      // a plan_workout_proposals row instead of mutating plan_workouts
      // directly. The runner sees a banner with [LET IT HAPPEN] /
      // [KEEP ORIGINAL] before the change lands.
      //
      // Apply-now (immediate · reactive to event that already happened):
      //   · missed_key_workout · runner missed it, no point proposing
      //   · sick_episode_active · runner logged sick, plan should respond
      //   · injury_active · same
      //   · niggle_reported · same
      //   · pr_bank · runner ran a faster race, paces should update
      //   · goal_changed · runner edited their goal
      //   · volume_overshoot · safety net
      //
      // Propose-first (engine opinion · runner gates):
      //   · readiness_pullback · "we'd like to ease tomorrow because..."
      const triggerKinds = new Set(triggers.map((t) => t.kind));
      const isPullbackOnly = triggerKinds.size === 1 && triggerKinds.has('readiness_pullback');

      let applied = 0;
      let proposed = 0;
      if (isPullbackOnly) {
        // Pure readiness-pullback · write proposals, don't apply.
        const { writeWorkoutProposals } = await import('@/lib/plan/workout-proposals');
        proposed = await writeWorkoutProposals(uid, actions, triggers);
      } else {
        // Mixed or non-pullback triggers · apply immediately. (If
        // readiness_pullback is mixed in with something else, e.g.
        // niggle + pullback, we apply the niggle response now and
        // skip the pullback portion · the next evening cron picks
        // up the pullback as its own proposal.)
        const nonPullbackActions = actions.filter((_, i) => {
          // The actions array correlates 1:1 with triggers (per
          // detectAdaptations + actionsForTrigger contract). We
          // strip actions whose source trigger is readiness_pullback.
          // If indices don't align cleanly, default to apply (safer
          // than dropping a real signal).
          const trig = triggers[i];
          return trig?.kind !== 'readiness_pullback';
        });
        applied = await applyAdaptations(uid, nonPullbackActions);

        // The pullback portion (if any) still gets proposed.
        const pullbackActions = actions.filter((_, i) => triggers[i]?.kind === 'readiness_pullback');
        if (pullbackActions.length > 0) {
          const pullbackTriggers = triggers.filter((t) => t.kind === 'readiness_pullback');
          const { writeWorkoutProposals } = await import('@/lib/plan/workout-proposals');
          proposed = await writeWorkoutProposals(uid, pullbackActions, pullbackTriggers);
        }
      }

      // 2026-06-03 · adaptive upward ramp · after pull-back triggers
      // are handled, check whether the runner is handling load well
      // enough to push the next long run +1mi (gated to tier upper).
      // Skip the bump when pull-back actions fired this tick · we
      // don't push up the same day we pulled down.
      const bump = await tryAdaptiveBump(uid, applied > 0).catch(() => null);
      if (bump) await bustBriefingCacheForEvent(uid, 'plan_swap');
      if (applied > 0) await bustBriefingCacheForEvent(uid, 'plan_swap');
      // Stamp last_adapted_at even when 0 actions applied — this is the only
      // cron-fire proof we have. Without it we can't distinguish "cron never
      // fired" from "cron fired but found nothing to do". applyAdaptations
      // already stamps on the mutating path; this covers the no-op path.
      if (applied === 0) {
        await pool.query(
          `UPDATE training_plans SET last_adapted_at = NOW()
            WHERE user_uuid = $1 AND archived_iso IS NULL`,
          [uid],
        );
      }
      results.push({ user_id: uid, triggers: triggers.length, applied, proposed });
    } catch (e: any) {
      results.push({ user_id: uid, triggers: 0, applied: 0, proposed: 0, error: e?.message ?? String(e) });
      await raiseAlert({
        kind: 'regen_fail',
        severity: 'warn',
        message: `Adaptation failed for ${uid}: ${e?.message}`,
        source: 'cron/run-adaptations',
      }).catch(() => {});
    }
  }
  const totalApplied = results.reduce((a, r) => a + r.applied, 0);
  const totalProposed = results.reduce((a, r) => a + r.proposed, 0);
  return NextResponse.json({
    ok: true,
    users: userIds.length,
    total_applied: totalApplied,
    total_proposed: totalProposed,
    results,
    timestamp: new Date().toISOString(),
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/run-adaptations',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    schedule: '15 7 * * * UTC (00:15 PT)',
  });
}
