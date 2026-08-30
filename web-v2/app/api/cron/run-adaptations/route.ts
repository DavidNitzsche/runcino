/**
 * POST /api/cron/run-adaptations  (P38)
 *
 * Daily adaptation pass — detects triggers (training gap, missed key
 * workout, readiness pullback, volume overshoot, niggle/sick/injury,
 * PR bank, goal change) and applies actions to plan_workouts.
 * Idempotent.
 *
 * Auth: CRON_SECRET.
 *
 * Schedule: 03:00 UTC = 20:00 PT the previous evening, per
 * .github/workflows/run-adaptations.yml (`cron: '0 3 * * *'`). That file
 * is the only schedule that exists — this comment does not set it, and
 * for a while it disagreed with it.
 *
 * 2026-08-17 · this header used to claim 07:15 UTC "between briefing cron
 * at 07:05 and weather cron at 07:30". The cron was moved to 03:00 on
 * 2026-06-04 (David: "I dont want to wake up to change runs · that was
 * annoying") so proposals land on Today the evening BEFORE, and the
 * comment was never updated. Every ordering claim it made was false.
 *
 * The ordering INTENT still holds, and with more room than the stale
 * comment claimed. Adaptation must land before the morning briefing
 * reads the plan, so the coach sees the adapted state:
 *
 *   03:00 UTC  run-adaptations     (this route)
 *   07:05 UTC  refresh-briefings   (+4h05m — the constraint that matters)
 *   07:30 UTC  enrich-weather
 *   08:15 UTC  readiness-snapshot
 *
 * If this cron is ever rescheduled, check it against refresh-briefings
 * (`.github/workflows/refresh-briefings.yml`) — a briefing composed off
 * an un-adapted plan tells the runner to do a workout the engine has
 * already changed.
 *
 * Runs over all active users (training_plans with archived_iso IS NULL).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { detectAdaptations, applyAdaptations, partitionActionsForCron, reducesLoad, PROPOSE_FIRST_TRIGGERS } from '@/lib/plan/adapt';
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

  const results: Array<{
    user_id: string; triggers: number; applied: number; proposed: number;
    /** 2026-08-24 · a session-moved push was enqueued for this runner because
     *  the day they wake into genuinely reads differently after the pass. */
    session_moved?: boolean;
    error?: string;
  }> = [];
  for (const uid of userIds) {
    let sessionMoved = false;
    try {
      const { triggers, actions } = await detectAdaptations(uid);

      // 2026-06-04 · split actions into APPLY-NOW vs PROPOSE-FIRST.
      // David's complaint: "I dont want to wake up to change runs ·
      // that was annoying." Readiness-pullback adaptations now write
      // a plan_workout_proposals row instead of mutating plan_workouts
      // directly. The runner sees a banner with [LET IT HAPPEN] /
      // [KEEP ORIGINAL] before the change lands.
      //
      // Apply-now — only what RAISES or preserves load:
      //   · sick_episode_active / injury_active · emit no plan actions at all
      //     (they write coach_proposals); listed so the reader is not
      //     surprised to see them absent from the propose-first set
      //   · pr_bank · runner ran a faster race, paces should update
      //   · goal_changed · runner edited their goal
      //   · progression_gate · raises a dose on an unrun session
      //
      // Propose-first (the runner gates it):
      //   · readiness_pullback, field_test_due, volume_overshoot,
      //     niggle_reported, missed_key_workout
      //     (PROPOSE_FIRST_TRIGGERS is the single authority · DIRECTION-1)
      //
      // ── DIRECTION-1 (2026-08-29) · THE FAST PATH IS GONE ──────────────────
      //
      // This used to compute `isProposeOnly` from the TRIGGER KINDS and, when
      // every trigger was propose-first, hand the whole action list to
      // `writeWorkoutProposals` without ever consulting
      // `partitionActionsForCron`. Two things were wrong with that, and the
      // second one silently defeated the first:
      //
      //   1. It decided routing from the trigger, never from the action. An
      //      action's own `forceApplyNow` was invisible on this path — the
      //      field's entire purpose, unreachable on exactly the nights
      //      readiness fired alone, which is the modal case.
      //   2. `writeWorkoutProposals` drops any action with no `workoutIds`
      //      (workout-proposals.ts) — so the record-only notes were not
      //      proposed AND not applied. They simply vanished, taking the
      //      `coach_intents` audit row with them, which is the row
      //      `tryAdaptiveBump` reads before raising load.
      //
      // One path now: partition per action, apply what may apply, propose the
      // rest. Under DIRECTION-1 `partitionActionsForCron` will not let a
      // load-reducing action through regardless of its flag, so routing every
      // night through here cannot resurrect the auto-pull-back this rule
      // exists to prevent — it only lets the notes reach the intents table.
      //
      // 2026-07-06 · P1-37 · actions do NOT correlate 1:1 with triggers
      // (missed_key_workout emits 2+N actions, sick/injury emit 0, pullback
      // emits 1-2) — the old triggers[i] index walk misrouted anti-stacking
      // downgrades into mislabeled readiness proposals that expired unseen
      // (live twice: Jul 1 + Jul 6 on David's plan). Partition on each
      // action's OWN sourceTrigger tag instead.
      let applied = 0;
      let proposed = 0;
      {
        const { applyNow, proposeFirst } = partitionActionsForCron(actions);

        // 2026-08-24 · SESSION MOVED · the sender `renderSessionMoved` never
        // had. Photograph the day the runner wakes into, on BOTH sides of the
        // apply, and let the two labels decide. The owner's ruling is that it
        // fires "gated on the label genuinely differing, not on the adapter
        // merely having run", and a before/after diff is the only gate that
        // can honour that — `applyAdaptations` returns a row count, and
        // `AdaptationInfo.wasAdapted` compares against the plan AS AUTHORED
        // and so stays true long after the change stopped being news.
        //
        // Best-effort on both sides: a notification never fails an
        // adaptation pass, and a snapshot that could not be read simply
        // means no push (snapshotSession throws rather than reporting a
        // missing session, so a DB blip cannot masquerade as "it vanished").
        const moved = await import('@/lib/notifications/session-moved');
        const movedTarget = await moved.nextMorningTarget(uid).catch(() => null);
        const movedBefore = movedTarget
          ? await moved.snapshotSession(uid, movedTarget.dateIso).catch(() => undefined)
          : undefined;

        applied = await applyAdaptations(uid, applyNow);

        if (movedTarget && movedBefore !== undefined) {
          try {
            const movedAfter = await moved.snapshotSession(uid, movedTarget.dateIso);
            const res = await moved.notifySessionMoved({
              userId: uid, target: movedTarget, before: movedBefore, after: movedAfter,
            });
            if (res.sent) sessionMoved = true;
          } catch { /* non-blocking · see above */ }
        }

        // The propose-first portion (if any) still gets proposed.
        if (proposeFirst.length > 0) {
          const proposeTriggers = triggers.filter((t) => PROPOSE_FIRST_TRIGGERS.has(t.kind));
          const { writeWorkoutProposals } = await import('@/lib/plan/workout-proposals');
          proposed = await writeWorkoutProposals(uid, proposeFirst, proposeTriggers);
        }
      }

      // 2026-06-03 · adaptive upward ramp · after pull-back triggers
      // are handled, check whether the runner is handling load well
      // enough to push the next long run +1mi (gated to tier upper).
      // Skip the bump when pull-back actions fired this tick · we
      // don't push up the same day we pulled down.
      //
      // DIRECTION-1 (2026-08-29) · the tick gate can no longer be `applied >
      // 0` alone. Pull-backs PROPOSE now, so on the very nights this guard is
      // for, nothing is applied and `applied` is 0 — the engine would decide
      // the runner needs easing and then raise his long run in the same pass.
      // The question the guard is actually asking is "did we judge a pull-back
      // warranted today", not "did one land", so it reads the decision:
      // any load-reducing action in the pass, whichever way it routed.
      const pullbackDecided = actions.some(reducesLoad);
      const bump = await tryAdaptiveBump(uid, applied > 0 || pullbackDecided).catch(() => null);
      if (bump) await bustBriefingCacheForEvent(uid, 'plan_swap');

      // 2026-08-30 · LTHR re-anchor (lib/training/lthr-reanchor.ts).
      //
      // The race paths call this too, but they only fire when a result is
      // WRITTEN. An anchor can go stale between result writes — a race
      // imported through a path that didn't run the chain, a priority edited
      // from C to A after the fact, or (the case that made this necessary)
      // months of history that predate the fix. Running it daily means the
      // anchor is never more than one night behind the evidence.
      //
      // Ordered BEFORE updateCoachLog so a move made this tick is available
      // for the log entry written in the same pass. Idempotent — the decision
      // returns 'none' once the anchor agrees with the evidence, and the
      // ±3 bpm noise floor stops it churning on rounding.
      try {
        const { reanchorLthr } = await import('@/lib/training/lthr-reanchor-store');
        await reanchorLthr(uid);
      } catch { /* logged inside · non-fatal */ }

      // 2026-08-17 · coach's log daily check (lib/coach/coach-log.ts).
      // Week-close / phase-boundary entries fire only on the boundary
      // morning; the longest-run-ever check is one indexed query.
      // Idempotent + best-effort — never blocks the adaptation pass.
      try {
        const { updateCoachLog } = await import('@/lib/coach/coach-log');
        await updateCoachLog(uid);
      } catch { /* logged inside · non-fatal */ }
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
      results.push({ user_id: uid, triggers: triggers.length, applied, proposed, session_moved: sessionMoved });
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
    // Mirrors .github/workflows/run-adaptations.yml. Keep the two in step.
    schedule: '0 3 * * * UTC (20:00 PT, previous evening)',
  });
}
