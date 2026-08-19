// POST /api/cron/plan-drift
//
// Nightly scan of every active plan for drift signals. For each
// runner: load the active plan, compute DriftReport, and persist a
// pending plan_proposals row when one or more signals fire.
//
// Idempotent · we check hasPendingProposal before writing so the
// nightly run doesn't pile up identical "volume drift" rows.
//
// Same auth pattern as the other cron routes.

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { detectDrift, hasPendingProposal } from '@/lib/plan/drift-monitor';
import { computeGoalGap } from '@/lib/plan/goal-gap';
import {
  SOFT_DRIFT_PROPOSAL_KINDS,
  driftProposalKind,
  suppressDriftNearRace,
} from '@/lib/plan/drift-proposal-policy';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({
      error: 'CRON_SECRET not configured.',
    }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2026-08-19 · race-shape audit · THE POPULATION WAS THE BUG'S ACCOMPLICE.
  //
  // This was "every user with an active plan", which by construction excludes
  // the runner this cron most needs to reach: the one who finished a race,
  // had their plan archived by the result chain, and now has none. They were
  // not merely unfixed, they were never iterated — so the nightly retry that
  // makes the open-block handoff a safety net rather than a one-shot could not
  // have existed under the old query.
  //
  // Widened by UNION to every runner who has a race row and NO active plan.
  // That is exactly the planless population, bounded by the users table, and
  // the loop body short-circuits for them within a few cheap queries
  // (detectDrift returns null with no plan, and the open-block handoff is
  // idempotent on a standing pending row).
  const userIds = (await pool.query<{ user_uuid: string }>(
    `SELECT DISTINCT user_uuid FROM training_plans
      WHERE archived_iso IS NULL AND user_uuid IS NOT NULL
     UNION
     SELECT DISTINCT r.user_uuid FROM races r
      WHERE r.user_uuid IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM training_plans tp
           WHERE tp.user_uuid = r.user_uuid AND tp.archived_iso IS NULL
        )`,
  ).catch(() => ({ rows: [] }))).rows.map((r) => r.user_uuid);

  // 2026-06-10 · multi-user: the SELECT above IS the population — no
  // hardcoded-user append (was a legacy-row safety net for David).

  type UserResult = {
    user_uuid: string;
    plan_id: string | null;
    signals_found: number;
    proposals_written: number;
    signals_skipped: number;        // pending row already exists
    auto_results: number;           // provisional race results logged this tick
    proposals_expired: number;      // 2026-08-17 · >14d pending rows expired this tick
    /** 2026-08-17 · goal-gap rebuilds suppressed because the runner is ill,
     *  injured, or re-entering after a gap — the states that widen the
     *  projection in the first place. */
    goal_gap_suppressed_compromised?: number;
    /** 2026-08-18 · goal-gap now covers no-race goal mode, which has no race
     *  slug for the auto-rebuild path to key off. Counted so the skip is
     *  visible in the cron report rather than silent. */
    goal_gap_skipped_goal_mode?: number;
    /** 2026-08-19 · plans that ran out of prescribed days this tick. Before
     *  this, a plan with no race had no end at all — the lookup INNER JOINed
     *  `races` and dropped every goal-mode and open-block row. */
    plans_elapsed?: number;
    /** 2026-08-19 · outcome of the open-block handoff for a runner with no
     *  active plan and nothing booked. Reason string, not a count: the useful
     *  thing is WHY ('authored' / 'coached_externally' / 'already_pending' /
     *  'no_target_entry_missing'), and there is at most one per runner. */
    open_block?: string;
    error?: string;
  };
  const results: UserResult[] = [];

  for (const u of userIds) {
    const r: UserResult = {
      user_uuid: u,
      plan_id: null,
      signals_found: 0,
      proposals_written: 0,
      signals_skipped: 0,
      auto_results: 0,
      proposals_expired: 0,
    };
    try {
      // 2026-08-17 · stale-proposal hygiene FIRST. Pending rows older
      // than 14 days go to 'expired' — proposals-state stopped surfacing
      // them at 14d anyway, and as invisible zombies they defeated every
      // pending-row dedupe check (the audit found 19 identical staleness
      // proposals accumulated on one runner).
      try {
        const { expireStalePendingProposals } = await import('@/lib/plan/goal-renegotiation');
        r.proposals_expired = await expireStalePendingProposals(u);
      } catch (e) {
        console.error('[plan-drift] proposal expiry failed:', e);
      }
      // 2026-08-17 · race-lifecycle · auto-provisional race results FIRST.
      // Before any graduate/transition decision, log a provisional
      // watch-time result for any recent race the runner finished but
      // never manually resulted (David's direction after AFC Half: the
      // watch time IS the result until a chip time overrides it). The
      // detector runs the full post-result chain for A/B races — VDOT
      // recalc snapshots, plan archived race_completed, next-block plan
      // generated — so the graduate block below sees a fresh VDOT and,
      // in the common case, has nothing left to do (the chain already
      // built the next plan). Idempotent: the detector's UPDATE is
      // guarded on "still no finishS".
      try {
        const { detectAndLogProvisionalResults } = await import('@/lib/race/auto-result');
        const auto = await detectAndLogProvisionalResults(u);
        r.auto_results = auto.length;
        if (auto.length > 0) {
          console.log('[plan-drift] auto-provisional results logged:',
            auto.map((a) => `${a.slug}=${a.finishDisplay}`).join(', '));
        }
      } catch (e) {
        console.error('[plan-drift] auto-result detector failed:', e);
      }

      // 2026-06-03 · Rule 12 · maintenance → race-prep transition.
      // When an active MAINTENANCE plan's target race comes within
      // its build window (BUILD_WINDOW_WEEKS[distance]), fire a
      // rebuild that picks race-prep mode. The runner has been in
      // maintenance possibly for months; now it's time to build.
      // 2026-08-19 · race-shape audit · LEFT JOIN, not INNER.
      // `tp.race_id` is NULL for a goal-mode plan and for every open
      // maintenance/recovery block, and an INNER JOIN on NULL drops the row —
      // so this lookup returned undefined for exactly the runners with no race
      // and the whole maintenance→race-prep transition never saw them. The
      // JOIN is now outer and the transition itself gates on `race_id` being
      // present, which is the condition it actually needs.
      const maintenancePlan = (await pool.query<{
        plan_id: string; race_id: string | null; race_date: string | null; race_meta: any;
      }>(
        `SELECT tp.id::text AS plan_id, tp.race_id::text AS race_id,
                (rc.meta->>'date')::text AS race_date,
                rc.meta AS race_meta
           FROM training_plans tp
           LEFT JOIN races rc ON rc.slug = tp.race_id AND rc.user_uuid = tp.user_uuid
          WHERE tp.user_uuid = $1
            AND tp.archived_iso IS NULL
            AND tp.mode = 'maintenance'
          ORDER BY tp.authored_iso DESC LIMIT 1`,
        [u],
      ).catch(() => ({ rows: [] }))).rows[0];

      if (maintenancePlan?.race_id && maintenancePlan.race_date) {
        const { BUILD_WINDOW_WEEKS, distanceCategoryOrNull } = await import('@/lib/plan/goal-tiers');
        const { distanceMiOf } = await import('@/lib/plan/generate');
        // 2026-08-18 · this read `Number(meta->>'distanceMi')`, and a legacy
        // race row carrying only a distanceLabel gave `Number(null) === 0`,
        // which the old categorizer bucketed as '5k' — a marathoner got a
        // 10-week build window instead of 18 and lost eight weeks of build
        // with no signal. Resolve through the same label-aware parser the
        // generator uses, and when the distance still cannot be resolved,
        // skip the transition rather than transition on a guess. The runner
        // stays in maintenance and the race's own distance gets fixed.
        const dMi = distanceMiOf(maintenancePlan.race_meta);
        const cat = distanceCategoryOrNull(dMi);
        const buildWindowDays = cat == null ? null : BUILD_WINDOW_WEEKS[cat] * 7;
        if (buildWindowDays == null) {
          console.warn('[plan-drift] maintenance→race-prep skipped · unresolvable race distance:',
            maintenancePlan.race_id);
        }
        const raceMs = new Date(maintenancePlan.race_date + 'T12:00:00Z').getTime();
        const nowMs = Date.now();
        const daysToRace = (raceMs - nowMs) / 86400000;
        if (buildWindowDays != null && daysToRace > 0 && daysToRace <= buildWindowDays) {
          // De-dupe within 24h
          const alreadyTransitioned = (await pool.query(
            `SELECT 1 FROM plan_proposals
              WHERE user_uuid = $1
                AND proposal_kind = 'maintenance_to_raceprep'
                AND created_at >= NOW() - interval '24 hours'`,
            [u],
          ).catch(() => ({ rowCount: 0 }))).rowCount;
          if (!alreadyTransitioned) {
            try {
              const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
              const result = await fireAutoRebuild({
                userUuid: u,
                raceSlug: maintenancePlan.race_id,
                kind: 'race_graduate', // reuses graduate path · same semantics
                reasons: {
                  transition: 'maintenance_to_raceprep',
                  race_slug: maintenancePlan.race_id,
                  weeks_to_race: Math.round(daysToRace / 7),
                  build_window_weeks: buildWindowDays / 7,
                  message: `Race within build window · transitioning from maintenance to race-prep.`,
                },
                source: 'maintenance_transition_cron',
              });
              if (result.ok) r.proposals_written++;
            } catch (e) {
              console.error('[plan-drift] maintenance→race-prep failed:', e);
            }
          }
        }
      }

      // 2026-06-03 · post-race auto-graduate (Rule 11 follow-on).
      // If the runner's active plan target's race date is in the past
      // (race day finished), find the next A-priority race in their
      // schedule and fire a rebuild with kind='race_graduate'. The new
      // plan inherits all training history via composePlan's readers
      // (recentLong, recentQuality, bestRecentVdot, tsbAtStart, etc.)
      // so it's a continuous progression, not a cold-start.
      // Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 11 follow-on.
      // 2026-06-03 · runner TZ for the race-date boundary.
      // 2026-08-17 · race-lifecycle · boundary moved from race+2
      // (`< today - 1 day`) to the FIRST cron after race day
      // (graduateDue: race date < today). The +2 lag left the runner
      // in a dead plan for two mornings after a goal race. The boundary
      // itself lives in lib/plan/race-lifecycle.ts (unit-tested);
      // idempotence is unchanged — the 24h (old race, new race) dedupe
      // below plus the fact that a successful graduate re-points the
      // active plan's race_id at a future race.
      const { runnerToday } = await import('@/lib/runtime/runner-tz');
      const { graduateDue, recoveryCompleteDue, planElapsed } =
        await import('@/lib/plan/race-lifecycle');
      const userToday = await runnerToday(u);
      // 2026-08-19 · race-shape audit · LEFT JOIN + the plan's own last day.
      //
      // This was an INNER JOIN to `races`, so a goal-mode plan (race_id NULL,
      // authored_state.goal_mode — every no-race fitness-goal runner) never
      // produced a row here. `activePlanRow` was permanently undefined for
      // them, which meant nothing below it ran: no graduate, no archive, no
      // rebuild. Their 16-week plan elapsed and Today kept rendering a plan
      // whose last prescribed day receded further into the past every morning,
      // forever, with no signal anywhere.
      //
      // `last_workout_iso` is what gives a plan with no race an END. A
      // race-prep plan ends at its race (graduateDue); everything else ends
      // when it runs out of prescribed days (planElapsed).
      const activePlanRow = (await pool.query<{
        plan_id: string; race_id: string | null; race_date: string | null;
        goal_mode: string | null; last_workout_iso: string | null; mode: string | null;
      }>(
        `SELECT tp.id::text AS plan_id, tp.race_id::text AS race_id,
                (rc.meta->>'date')::text AS race_date,
                tp.authored_state->>'goal_mode' AS goal_mode,
                tp.mode::text AS mode,
                (SELECT MAX(pw.date_iso) FROM plan_workouts pw
                  WHERE pw.plan_id = tp.id) AS last_workout_iso
           FROM training_plans tp
           LEFT JOIN races rc ON rc.slug = tp.race_id AND rc.user_uuid = tp.user_uuid
          WHERE tp.user_uuid = $1
            AND tp.archived_iso IS NULL
          ORDER BY tp.authored_iso DESC LIMIT 1`,
        [u],
      ).catch(() => ({ rows: [] }))).rows[0];
      const finishedRow = activePlanRow?.race_id && graduateDue(activePlanRow.race_date, userToday)
        ? activePlanRow
        : undefined;

      if (finishedRow) {
        // Pick the next A-race AFTER today
        const nextRow = (await pool.query<{ slug: string; race_date: string }>(
          `SELECT slug, (meta->>'date')::text AS race_date
             FROM races
            WHERE user_uuid = $1
              AND meta->>'priority' = 'A'
              AND (meta->>'date')::date >= $2::date
            ORDER BY (meta->>'date')::date ASC LIMIT 1`,
          [u, userToday],
        ).catch(() => ({ rows: [] }))).rows[0];

        if (nextRow) {
          // De-dupe · don't graduate twice for the same (old race, new race) pair
          // within 24h. After the first successful graduate the active plan's
          // race_id matches nextRow.slug · so this only fires once per transition.
          const alreadyGraduated = (await pool.query(
            `SELECT 1 FROM plan_proposals
              WHERE user_uuid = $1
                AND proposal_kind = 'race_graduate'
                AND reasons->>'previous_race' = $2
                AND created_at >= NOW() - interval '24 hours'`,
            [u, finishedRow.race_id],
          ).catch(() => ({ rowCount: 0 }))).rowCount;

          if (!alreadyGraduated) {
            try {
              const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
              const result = await fireAutoRebuild({
                userUuid: u,
                raceSlug: nextRow.slug,
                kind: 'race_graduate',
                reasons: {
                  previous_race: finishedRow.race_id,
                  previous_race_date: finishedRow.race_date,
                  new_race_date: nextRow.race_date,
                  message: `${finishedRow.race_id} finished · graduating to ${nextRow.slug}.`,
                },
                source: 'graduate_cron',
              });
              if (result.ok) r.proposals_written++;
            } catch (e) {
              console.error('[plan-drift] race-graduate failed:', e);
            }
          }
        }
        // 2026-08-19 · race-shape audit · this comment used to end the block:
        // "No next A-race · leave plan as-is." The plan is NOT as-is — the
        // result chain archived it the moment the finish time landed, so
        // "leave it" left the runner with zero active plans. The open-block
        // handoff is below, outside this branch, so it also catches a runner
        // who reached this state by any other route.
      }

      // 2026-08-19 · race-shape audit · THE PLAN THAT RAN OUT.
      //
      // A race-prep plan ends at its race and `graduateDue` above owns that.
      // Nothing owned the end of any OTHER plan. A goal-mode plan's sixteen
      // weeks elapse; a maintenance block's rolling four weeks elapse; and
      // because the lookup above INNER JOINed `races`, the row was invisible
      // and no code even asked. Today kept rendering the last prescribed day
      // of a plan that finished months ago.
      //
      // Rebuild toward whatever the runner is actually working to: the goal
      // the plan itself recorded, or their profile goal. `fireAutoRebuild`
      // takes a goal target directly now, so this is the same audited path
      // the race-anchored transitions use — same proposal row, same dedupe.
      let elapsedHandled = false;
      if (
        activePlanRow && !activePlanRow.race_id
        && planElapsed(activePlanRow.last_workout_iso, userToday)
      ) {
        const alreadyRebuilt = (await pool.query(
          `SELECT 1 FROM plan_proposals
            WHERE user_uuid = $1
              AND proposal_kind = 'plan_elapsed'
              AND created_at >= NOW() - interval '24 hours'`,
          [u],
        ).catch(() => ({ rowCount: 0 }))).rowCount;
        if (!alreadyRebuilt) {
          try {
            const { fireAutoRebuild, resolveGoalTarget } = await import('@/lib/plan/auto-rebuild');
            const target = await resolveGoalTarget(u, userToday);
            if (target) {
              const result = await fireAutoRebuild({
                userUuid: u,
                goalTarget: target,
                kind: 'plan_elapsed',
                reasons: {
                  transition: 'plan_elapsed',
                  last_workout_iso: activePlanRow.last_workout_iso,
                  plan_mode: activePlanRow.mode,
                  goal_mode: activePlanRow.goal_mode === 'true',
                  message: 'Plan ran out of prescribed days · rebuilding toward the goal.',
                },
                source: 'plan_elapsed_cron',
              });
              if (result.ok) r.proposals_written++;
              elapsedHandled = result.ok;
              r.plans_elapsed = (r.plans_elapsed ?? 0) + 1;
            } else {
              // No goal to rebuild toward either. Archive the dead plan so the
              // open-block handoff below sees an honest "no active plan", then
              // let it decide what this runner should have. Leaving it active
              // is what produced the forever-stale plan in the first place.
              await pool.query(
                `UPDATE training_plans SET archived_iso = NOW(), archive_reason = 'plan_elapsed'
                  WHERE id = $1 AND archived_iso IS NULL`,
                [activePlanRow.plan_id],
              ).catch(() => pool.query(
                `UPDATE training_plans SET archived_iso = NOW()
                  WHERE id = $1 AND archived_iso IS NULL`,
                [activePlanRow.plan_id],
              ).catch(() => null));
              r.plans_elapsed = (r.plans_elapsed ?? 0) + 1;
            }
          } catch (e) {
            console.error('[plan-drift] elapsed-plan rebuild failed:', e);
          }
        }
      }

      // 2026-08-19 · race-shape audit · THE RUNNER WITH NOTHING BOOKED.
      //
      // Every entry into the generator needs a target, so a runner with no
      // race and no goal was invisible to the entire adaptation system — and
      // that is the ordinary end of a season, not an edge case. The result
      // chain fires this the moment a race is resulted with nothing next; this
      // is the nightly safety net for everyone who reached the same state by
      // another route (a race deleted, a plan expired above, a chain that
      // failed). `authorOpenBlock` is idempotent on a standing pending row, so
      // a runner who genuinely cannot be authored for yet is recorded once,
      // not once per morning.
      if (!elapsedHandled) {
        try {
          const { authorOpenBlock } = await import('@/lib/plan/open-block');
          const stillActive = (await pool.query<{ id: string }>(
            `SELECT id FROM training_plans
              WHERE user_uuid = $1 AND archived_iso IS NULL LIMIT 1`,
            [u],
          ).catch(() => ({ rows: [] as Array<{ id: string }> }))).rows[0];
          if (!stillActive) {
            const target = (await pool.query<{
              slug: string; date: string | null; dist: string | null; priority: string | null;
            }>(
              `SELECT slug, meta->>'date' AS date, meta->>'distanceMi' AS dist,
                      meta->>'priority' AS priority
                 FROM races
                WHERE user_uuid = $1
                  AND meta->>'priority' IN ('A','B')
                  AND (meta->>'date')::date >= $2::date
                ORDER BY (meta->>'date')::date ASC LIMIT 1`,
              [u, userToday],
            ).catch(() => ({ rows: [] }))).rows[0];
            const last = (await pool.query<{
              slug: string; date: string | null; meta: any; priority: string | null;
            }>(
              `SELECT slug, meta->>'date' AS date, meta, meta->>'priority' AS priority
                 FROM races
                WHERE user_uuid = $1
                  AND meta->>'priority' IN ('A','B')
                  AND (meta->>'date')::date < $2::date
                ORDER BY (meta->>'date')::date DESC LIMIT 1`,
              [u, userToday],
            ).catch(() => ({ rows: [] }))).rows[0];
            const { distanceMiOf } = await import('@/lib/plan/generate');
            const open = await authorOpenBlock({
              userUuid: u,
              todayISO: userToday,
              lastRace: last
                ? {
                    slug: last.slug,
                    dateISO: last.date,
                    distanceMi: distanceMiOf(last.meta),
                    priority: last.priority,
                  }
                : null,
              hasFutureTarget: Boolean(target),
              hasActivePlan: false,
              source: 'open_block_cron',
            });
            r.open_block = open.reason;
            if (open.ok) r.proposals_written++;
          }
        } catch (e) {
          console.error('[plan-drift] open-block handoff failed:', e);
        }
      }

      // 2026-08-17 · race-lifecycle · recovery → next-block transition.
      // composeRecoveryPlan's header always claimed "the graduate cron
      // re-enters when the recovery window closes" — that path never
      // existed (graduate only watches PAST race dates; a recovery
      // plan's race_id points at the NEXT race). This block is the
      // missing re-entry: when the active plan is recovery-mode, its
      // last prescribed day has passed, and its target race is still
      // ahead, rebuild toward that race. pickPlanMode inside
      // generatePlan decides what comes next (race-prep / maintenance /
      // a shorter recovery remainder if the doctrine window hasn't
      // fully elapsed — RECOVERY-2 offsets it, so no restart-at-week-1).
      // Loop guard is structural: the rebuild archives this plan and
      // authors one whose last workout is >= today, so the predicate
      // reads false on the next tick; a 24h proposal dedupe backstops it.
      // Queried FRESH (not reusing activePlanRow) because the graduate
      // block above may have just replaced the active plan.
      const recoveryRow = (await pool.query<{
        plan_id: string; race_id: string | null; race_date: string | null;
        last_workout_iso: string | null;
      }>(
        `SELECT tp.id::text AS plan_id, tp.race_id::text AS race_id,
                (rc.meta->>'date')::text AS race_date,
                (SELECT MAX(pw.date_iso) FROM plan_workouts pw
                  WHERE pw.plan_id = tp.id) AS last_workout_iso
           FROM training_plans tp
           LEFT JOIN races rc ON rc.slug = tp.race_id AND rc.user_uuid = tp.user_uuid
          WHERE tp.user_uuid = $1
            AND tp.archived_iso IS NULL
            AND (tp.mode = 'recovery' OR tp.authored_state->>'mode' = 'recovery')
          ORDER BY tp.authored_iso DESC LIMIT 1`,
        [u],
      ).catch(() => ({ rows: [] }))).rows[0];

      if (
        recoveryRow?.race_id &&
        recoveryCompleteDue(recoveryRow.last_workout_iso, recoveryRow.race_date, userToday)
      ) {
        const alreadyTransitioned = (await pool.query(
          `SELECT 1 FROM plan_proposals
            WHERE user_uuid = $1
              AND proposal_kind = 'recovery_complete'
              AND created_at >= NOW() - interval '24 hours'`,
          [u],
        ).catch(() => ({ rowCount: 0 }))).rowCount;
        if (!alreadyTransitioned) {
          try {
            const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
            const result = await fireAutoRebuild({
              userUuid: u,
              raceSlug: recoveryRow.race_id,
              kind: 'recovery_complete',
              reasons: {
                transition: 'recovery_to_next_block',
                race_slug: recoveryRow.race_id,
                recovery_last_workout: recoveryRow.last_workout_iso,
                message: `Recovery block finished · rebuilding toward ${recoveryRow.race_id}.`,
              },
              source: 'recovery_complete_cron',
            });
            if (result.ok) {
              r.proposals_written++;
              // generatePlan archives via clearActivePlansFor with the
              // generic 'regenerated'; restamp the recovery plan's
              // archive_reason so the lifecycle reads honestly.
              await pool.query(
                `UPDATE training_plans SET archive_reason = 'recovery_complete'
                  WHERE id = $1 AND archived_iso IS NOT NULL`,
                [recoveryRow.plan_id],
              ).catch(() => null);
            }
          } catch (e) {
            console.error('[plan-drift] recovery-complete transition failed:', e);
          }
        }
      }

      // 2026-06-01 · Phase 1.1 · goal-gap engine. Continuous projection-
      // vs-goal check · fires a rebuild when the gap is WIDENING for 3+
      // consecutive days. This is the closed-loop signal the architecture
      // doc calls the keystone · see docs/PLAN_ENGINE_ARCHITECTURE.md
      // §Phase 1.1. We check it BEFORE per-axis drift because a widening
      // goal-gap is the higher-order signal · drift detection is the
      // input-side anomaly check, goal-gap is the output-side check.
      const goalGap = await computeGoalGap(u);
      if (
        goalGap && goalGap.status === 'widening' && goalGap.consecutiveWideningDays >= 3
        // 2026-08-17 · truth-bug fix · inside 14 days of the race the
        // generator refuses to rebuild ('target < 2 weeks away'), so a
        // fire here can only produce a stuck pending row. Race week is
        // briefing territory · suppress entirely.
        && !suppressDriftNearRace(goalGap.raceDateISO, userToday)
      ) {
        /* 2026-08-17 · the projection widens BECAUSE of illness, injury and
         * training gaps — they crater executionQuality, which lowers projected
         * fitness, which is the thing this reads. Rebuilding here bakes a sick
         * week into the plan's assumptions about the runner.
         *
         * The field-test trigger already applied exactly this guard inline,
         * reasoning that "a compromised runner's test result would be noise".
         * This is the same reasoning about a much larger action: a field test
         * changes one session, a rebuild re-authors the block. It had no guard
         * at all beyond race proximity. */
        const { runnerIsCompromised } = await import('@/lib/plan/adapt');
        const compromised = await runnerIsCompromised(u).catch(() => ({ compromised: false } as const));
        if (compromised.compromised) {
          r.goal_gap_suppressed_compromised = (r.goal_gap_suppressed_compromised ?? 0) + 1;
          continue;
        }
        // Auto-rebuild if no recent goal-gap rebuild. '' planId = any
        // plan for this user (the strict plan_id='' match could never
        // hit a real row, so this dedupe was dead before 2026-08-17).
        const recentGapRebuild = await hasPendingProposal(u, '', 'goal_gap_widening').catch(() => false);
        // 2026-08-18 · goal-gap now covers no-race goal mode, where there is
        // no race slug for fireAutoRebuild to match the active plan against
        // (its race_id check would reject a null anyway). Those runners get
        // the widening SIGNAL and the goal assessment; the auto-rebuild path
        // stays race-anchored until the generator has a goal-mode rebuild
        // entry point. Skipping is the honest behaviour, not a silent no-op:
        // it is counted so the cron report shows it.
        if (goalGap.raceSlug == null) {
          r.goal_gap_skipped_goal_mode = (r.goal_gap_skipped_goal_mode ?? 0) + 1;
        } else if (!recentGapRebuild) {
          try {
            const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
            await fireAutoRebuild({
              userUuid: u,
              raceSlug: goalGap.raceSlug,
              // 2026-08-17 · TRUE kind. Was a synthetic
              // 'goal_time_changed', which rendered as "Goal time
              // updated" and never matched its own dedupe.
              kind: 'goal_gap_widening',
              reasons: {
                drift_kind: 'goal_gap_widening',
                message: `Projection drifting away from goal for ${goalGap.consecutiveWideningDays} days · rebuilding to close the gap.`,
                trajectory_sec: goalGap.trajectorySec,
                goal_sec: goalGap.goalSec,
                gap_sec: goalGap.gapSec,
                weeks_remaining: goalGap.weeksRemaining,
                what_closes_it: goalGap.whatClosesIt,
                citation: goalGap.citation,
              },
              source: 'goal_gap_cron_auto',
            });
            r.proposals_written++;
          } catch (e) {
            console.error('[plan-drift] goal-gap rebuild failed:', e);
          }
        }
      }

      // 2026-08-17 · coaching-loop reconciliation · UNCLOSABLE gap →
      // goal-renegotiation proposal. goal-gap has classified 'unclosable'
      // correctly since Phase 1.1 but nothing acted on it — the widening
      // branch above only fires on trend, so a goal parked out of
      // physiological reach just sat there. Sustained ≥5 consecutive
      // snapshot days → write a pending plan_proposals row carrying the
      // A/B/C alternative bands the gap report already computes. The
      // proposal proposes a REVISED TARGET BAND; the stated goal stays on
      // the board as the season ambition (David's framing). Accept seam:
      // the existing PATCH /api/race/[slug] goal edit → goal_renegotiated
      // rebuild. Dedupe/supersede/expiry live in goal-renegotiation.ts.
      if (goalGap && goalGap.status === 'unclosable') {
        try {
          const { shouldProposeRenegotiation, writeGoalRenegotiationProposal } =
            await import('@/lib/plan/goal-renegotiation');
          if (shouldProposeRenegotiation(goalGap)) {
            const { composeGapReport } = await import('@/lib/plan/gap-report');
            const gapReport = await composeGapReport(u).catch(() => null);
            const activePlanId = (await pool.query<{ id: string }>(
              `SELECT id FROM training_plans
                WHERE user_uuid = $1 AND archived_iso IS NULL
                ORDER BY authored_iso DESC LIMIT 1`,
              [u],
            ).catch(() => ({ rows: [] }))).rows[0]?.id ?? null;
            const wrote = await writeGoalRenegotiationProposal(u, activePlanId, goalGap, gapReport);
            if (wrote) r.proposals_written++;
          }
        } catch (e) {
          console.error('[plan-drift] goal-renegotiation failed:', e);
        }
      }

      const report = await detectDrift(u);
      if (!report) {
        results.push(r);
        continue;
      }
      r.plan_id = report.planId;
      r.signals_found = report.signals.length;

      // 2026-06-01 · soft drift now AUTO-APPLIES (David's zero-gaps
      // directive · "no opening the app required"). Generator gaps
      // that previously made auto-rebuild risky for mid-block runners
      // are fixed (spec-builder.ts + detectMidBlock) so the rebuilt
      // plan preserves quality + carries pace targets + workout specs
      // from row one.
      //
      // To avoid thrashing on borderline drift, take ONLY THE HIGHEST-
      // SEVERITY signal per run · multiple signals (e.g. volume_drift
      // + staleness simultaneously) collapse into one rebuild.
      // Idempotency · a pending (or recently dismissed) row of ANY kind
      // the writer can produce blocks a re-fire. 2026-08-17 · the guard
      // iterates SOFT_DRIFT_PROPOSAL_KINDS — the exact set the writer
      // stamps below — so guard and writer agree by construction (the
      // old three-kind check never matched the synthetic
      // 'goal_time_changed' rows the writer actually produced, which is
      // how one runner accumulated 19 daily duplicates).
      let recent = false;
      for (const k of SOFT_DRIFT_PROPOSAL_KINDS) {
        if (await hasPendingProposal(u, report.planId, k).catch(() => false)) {
          recent = true;
          break;
        }
      }
      if (recent) {
        r.signals_skipped = report.signals.length;
      } else if (report.primary) {
        const signal = report.primary;
        // Look up the goal race (slug + date) for the plan · the date
        // gates the race-proximity suppression below.
        const plan = (await pool.query<{ race_id: string | null; race_date: string | null }>(
          `SELECT tp.race_id, (rc.meta->>'date')::text AS race_date
             FROM training_plans tp
             LEFT JOIN races rc ON rc.slug = tp.race_id AND rc.user_uuid = tp.user_uuid
            WHERE tp.id = $1`,
          [report.planId],
        ).catch(() => ({ rows: [] }))).rows[0];
        // 2026-08-19 · the goal-mode target, resolved BEFORE the suppression
        // check so a goal deadline gets the same race-proximity guard a race
        // date does. Inside 14 days the generator refuses either way.
        const goalTarget = plan?.race_id
          ? null
          : await (await import('@/lib/plan/auto-rebuild')).resolveGoalTarget(u, userToday);
        const targetDateISO = plan?.race_id ? plan.race_date : (goalTarget?.raceDateISO ?? null);
        if (!plan?.race_id && !goalTarget) {
          // No race and no resolvable goal. Nothing to rebuild TOWARD, so
          // firing would only mint a pending row nothing can resolve. The
          // elapsed-plan / open-block handoff above owns this runner.
          r.signals_skipped = report.signals.length;
        } else if (suppressDriftNearRace(targetDateISO, userToday)) {
          // 2026-08-17 · truth-bug fix · target race within 14 days:
          // generatePlan refuses to rebuild in that window ('target <
          // 2 weeks away'), so firing can only mint a stuck pending
          // row. The surface must not ask what the engine will refuse.
          r.signals_skipped = report.signals.length;
        } else {
          // Run the rebuild via fireAutoRebuild · same path the hard-drift
          // hooks use · same audit shape · same dedupe window.
          //
          // 2026-08-19 · race-shape audit · this was `else if (plan?.race_id)`,
          // the ONLY call site for a drift rebuild. `detectDrift` has always
          // handled a NULL race_id (it reads the plan directly and never joins
          // `races`), so a goal-mode runner produced real drift signals, then
          // fell off the end of the if/else chain: `signals_found` reported
          // them every night and `proposals_written` never once incremented.
          // Nothing acted on a single one of them. A goal-mode plan now
          // rebuilds through the goal target — the same entry
          // `rebuildActivePlanForPrefs` has used since P1-16 — and a plan with
          // neither race nor resolvable goal falls through to the pending row.
          try {
            const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
            await fireAutoRebuild({
              userUuid: u,
              ...(plan?.race_id ? { raceSlug: plan.race_id } : { goalTarget: goalTarget! }),
              // 2026-08-17 · TRUE kind (staleness → 'staleness', volume
              // → 'volume_drift', …). Was a synthetic
              // 'goal_time_changed' "recalibrate" that rendered as
              // "Goal time updated" for a staleness observation and
              // never matched the dedupe guard above.
              kind: driftProposalKind(signal.kind),
              reasons: {
                drift_kind: signal.kind,
                message: signal.message,
                severity: signal.severity,
                ...signal.details,
              },
              source: 'drift_cron_auto',
            });
            r.proposals_written++;
          } catch (e: unknown) {
            // If auto-rebuild fails, fall back to writing a pending proposal
            // (the old behavior · runner sees a card to manually accept)
            await pool.query(
              `INSERT INTO plan_proposals
                 (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at)
               VALUES ($1, $2, $3, $4::jsonb, 'pending', 'drift_cron_fallback', NOW())`,
              [
                u, report.planId, signal.kind,
                JSON.stringify({
                  message: signal.message,
                  severity: signal.severity,
                  auto_rebuild_error: e instanceof Error ? e.message : String(e),
                  ...signal.details,
                }),
              ],
            );
            r.proposals_written++;
          }
        }
      }
    } catch (e: unknown) {
      r.error = e instanceof Error ? e.message : String(e);
    }
    results.push(r);
  }

  return NextResponse.json({
    ok: results.every((r) => !r.error),
    today: new Intl.DateTimeFormat('en-CA').format(new Date()),
    users: results.length,
    written: results.reduce((s, r) => s + r.proposals_written, 0),
    skipped: results.reduce((s, r) => s + r.signals_skipped, 0),
    errors: results.filter((r) => r.error).length,
    results,
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/plan-drift',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    recommended_schedule: '0 9 * * *  (daily at 02:00 PT = 09:00 UTC · runs AFTER snapshot-projections + readiness-snapshot)',
    triggers: [
      'auto_result · provisional watch-time result logged for recent unresulted races (full post-result chain for A/B)',
      'race_graduate · active plan race date passed (fires first cron AFTER race day)',
      'recovery_complete · recovery plan out of prescribed days, target race still ahead → rebuild',
      'volume_drift · current 28d avg deviates >40% from authored 4wk avg',
      'vdot_drift · current VDOT deviates >2 from plan anchor (inferred from T-pace)',
      'staleness · plan authored >8 weeks ago',
    ],
    note: 'Idempotent · checks for an existing pending proposal of the same kind before writing (proposals carry their TRUE kind since 2026-08-17). Staleness/drift proposals are suppressed inside 14 days of the target race (the generator refuses to rebuild there). Soft-drift only; hard-drift (race date / goal time / A-race add-or-remove) is handled by immediate-fire hooks at the route level.',
  });
}
