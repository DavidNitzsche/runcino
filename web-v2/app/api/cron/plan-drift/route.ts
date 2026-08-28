// POST /api/cron/plan-drift
//
// Nightly scan of every active plan for drift signals and lifecycle
// transitions. Two tiers (2026-08-28):
//
//   · DRIFT observations (soft drift, goal-gap) persist a pending
//     plan_proposals row — a card, never a silent rebuild (David
//     2026-08-26).
//   · LIFECYCLE transitions (race_graduate, maintenance→race-prep,
//     recovery_complete, plan_elapsed) auto-apply through
//     fireAutoRebuild — auto_applied row, undo on the notice card —
//     unless the runner undid that exact block or is compromised, in
//     which case they get a pending card instead.
//
// Idempotent · we check hasPendingProposal before writing so the
// nightly run doesn't pile up identical "volume drift" rows.
//
// Same auth pattern as the other cron routes.

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { logReadFailure, rowOrNull } from '@/lib/db/read';
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
    /** 2026-08-28 · RACEROLE-1 · tune-up race-role recommendation cards
     *  written this tick (a pending card is the WHOLE action — the plan only
     *  moves if the runner accepts). */
    race_role_cards?: number;
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
      // 2026-08-28 · intent hygiene, same pass. plan_proposals pointing at
      // archived plans get superseded at each archive site; coach_intents rows
      // had NO symmetric supersede anywhere, so plan_adapt_* intents kept
      // pointing at archived-plan workouts (dangling provenance, stale
      // pending banners). This nightly per-user sweep marks them
      // (superseded_at, migration 157) whichever writer did the archiving —
      // generate, result-chain, injury-builder, seed, this cron. Best-effort:
      // an audit stamp must never fail the drift pass.
      try {
        const { supersedeIntentsForArchivedPlans } = await import('@/lib/plan/proposals-state');
        await supersedeIntentsForArchivedPlans(pool, u);
      } catch (e) {
        console.error('[plan-drift] intent supersede sweep failed:', e);
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
            // 2026-08-24 · swallowed-failure sweep · this guard fails CLOSED now.
    // `rowCount: 0` means "not already done", so `.catch(() => ({ rowCount: 0 }))`
    // made a failed read say "go ahead" — the one answer that turns a de-dupe
    // check into a duplicate-action generator. A guard that cannot see must
    // assume the thing it guards against has already happened.
  ).catch((e) => { logReadFailure('cron/plan-drift · dedupe guard', e); return { rowCount: 1 }; })).rowCount;
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
        authored_mode: string | null; mode_label: string | null;
      }>(
        `SELECT tp.id::text AS plan_id, tp.race_id::text AS race_id,
                (rc.meta->>'date')::text AS race_date,
                tp.authored_state->>'goal_mode' AS goal_mode,
                tp.mode::text AS mode,
                tp.authored_state->>'mode' AS authored_mode,
                tp.authored_state->>'mode_label' AS mode_label,
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
      // 2026-08-28 · a successful graduate replaces the active plan, so
      // `activePlanRow` is stale from that point on. The elapsed branch below
      // now also handles race-anchored rows, which makes overlap with the
      // graduate branch possible for the first time; this flag is the guard.
      let graduatedThisTick = false;

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
            // 2026-08-24 · swallowed-failure sweep · this guard fails CLOSED now.
    // `rowCount: 0` means "not already done", so `.catch(() => ({ rowCount: 0 }))`
    // made a failed read say "go ahead" — the one answer that turns a de-dupe
    // check into a duplicate-action generator. A guard that cannot see must
    // assume the thing it guards against has already happened.
  ).catch((e) => { logReadFailure('cron/plan-drift · dedupe guard', e); return { rowCount: 1 }; })).rowCount;

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
              graduatedThisTick = result.ok && !result.unchanged;
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
      //
      // 2026-08-28 · RACE-ANCHORED ROWS TOO. The `!race_id` gate meant a
      // race-anchored maintenance hold block (or a recovery block whose race
      // date went missing) that ran out of days was re-authored by NOTHING:
      // graduateDue watches the race date, openBlockDue requires no future
      // target, and this branch skipped the row. That is the strand the
      // doctrine registry's `no-ceiling-on-a-long-hold` exemption argues from.
      // Race still ahead → re-author toward it (pickPlanMode chooses
      // maintenance vs race-prep by build window); race date null or past →
      // the plan is anchored to nothing real, so it takes the same
      // goal-target / open-block handoff an un-anchored plan does. A
      // recovery-mode plan with its race still ahead is EXCLUDED here — the
      // recovery-complete block below owns that transition (its own kind, its
      // own coach note). Race day itself is also excluded: the runner is
      // racing, and graduate fires tomorrow.
      let elapsedHandled = false;
      const elapsedRaceDate = activePlanRow?.race_date ? activePlanRow.race_date.slice(0, 10) : null;
      const elapsedRaceAhead = elapsedRaceDate != null && elapsedRaceDate > userToday;
      const elapsedIsRecovery = activePlanRow?.mode === 'recovery'
        || activePlanRow?.authored_mode === 'recovery';
      if (
        activePlanRow
        && planElapsed(activePlanRow.last_workout_iso, userToday)
        && !graduatedThisTick
        && !(activePlanRow.race_id && elapsedRaceAhead && elapsedIsRecovery)
        && !(activePlanRow.race_id && elapsedRaceDate === userToday)
      ) {
        const alreadyRebuilt = (await pool.query(
          // A standing PENDING row blocks too, not just 24h — the compromised
          // path below writes one, and re-writing it nightly once the 24h
          // window lapses would stack identical cards.
          `SELECT 1 FROM plan_proposals
            WHERE user_uuid = $1
              AND proposal_kind = 'plan_elapsed'
              AND (created_at >= NOW() - interval '24 hours' OR status = 'pending')`,
          [u],
          // 2026-08-24 · swallowed-failure sweep · this guard fails CLOSED now.
    // `rowCount: 0` means "not already done", so `.catch(() => ({ rowCount: 0 }))`
    // made a failed read say "go ahead" — the one answer that turns a de-dupe
    // check into a duplicate-action generator. A guard that cannot see must
    // assume the thing it guards against has already happened.
  ).catch((e) => { logReadFailure('cron/plan-drift · dedupe guard', e); return { rowCount: 1 }; })).rowCount;
        if (!alreadyRebuilt) {
          try {
            // 2026-08-28 · THE INJURY GUARD. Injury-return plans are written
            // with mode='maintenance', race_id=NULL (injury-builder), so when
            // one elapsed this branch auto-authored a goal build over an
            // injured runner. A compromised runner (open injury, active sick
            // episode, override niggle, gap re-entry — the same predicate the
            // goal-gap rebuild consults) gets a pending card instead of an
            // auto-authored block; `mode_label='injury-return'` on the plan
            // itself is the belt-and-braces signal for a cleared injury row.
            // FAILS CLOSED: this guard stands in front of AUTHORING, so an
            // unreadable state must propose, not prescribe.
            const { runnerIsCompromised } = await import('@/lib/plan/adapt');
            const compromised = await runnerIsCompromised(u)
              .catch(() => ({ compromised: true, reason: 'injury' } as const));
            const injuryReturn = activePlanRow.mode_label === 'injury-return';
            const { fireAutoRebuild, resolveGoalTarget } = await import('@/lib/plan/auto-rebuild');
            if (compromised.compromised || injuryReturn) {
              await pool.query(
                `INSERT INTO plan_proposals
                   (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at)
                 VALUES ($1, $2, 'plan_elapsed', $3::jsonb, 'pending', 'plan_elapsed_cron_pending', NOW())`,
                [
                  u, activePlanRow.plan_id,
                  JSON.stringify({
                    transition: 'plan_elapsed',
                    last_workout_iso: activePlanRow.last_workout_iso,
                    plan_mode: activePlanRow.mode,
                    mode_label: activePlanRow.mode_label,
                    compromised_reason: compromised.compromised ? compromised.reason : null,
                    injury_return_plan: injuryReturn,
                    message: 'Your block ran out of prescribed days. You are not cleared for an automatic build · say when you are ready.',
                  }),
                ],
              );
              r.proposals_written++;
              r.plans_elapsed = (r.plans_elapsed ?? 0) + 1;
              elapsedHandled = true;
            } else if (activePlanRow.race_id && elapsedRaceAhead) {
              const result = await fireAutoRebuild({
                userUuid: u,
                raceSlug: activePlanRow.race_id,
                kind: 'plan_elapsed',
                reasons: {
                  transition: 'plan_elapsed',
                  last_workout_iso: activePlanRow.last_workout_iso,
                  plan_mode: activePlanRow.mode,
                  race_slug: activePlanRow.race_id,
                  message: `Plan ran out of prescribed days · rebuilding toward ${activePlanRow.race_id}.`,
                },
                source: 'plan_elapsed_cron',
              });
              if (result.ok) r.proposals_written++;
              elapsedHandled = result.ok;
              r.plans_elapsed = (r.plans_elapsed ?? 0) + 1;
            } else {
              // Un-anchored, or anchored to a race date that is null or past
              // — a dead anchor is no anchor. Rebuild toward the goal.
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
                    // Present when the plan was race-anchored but the race
                    // date is null or past — the dead-anchor shape this
                    // branch now covers instead of skipping.
                    stale_race_id: activePlanRow.race_id,
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
                const { supersedeProposalsForArchivedPlans } = await import('@/lib/plan/proposals-state');
                await supersedeProposalsForArchivedPlans(pool, u).catch(() => 0);
                r.plans_elapsed = (r.plans_elapsed ?? 0) + 1;
              }
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
          // A standing PENDING row blocks too, not just 24h — the fallback
          // paths below write one, and re-writing it nightly once the 24h
          // window lapses would stack identical cards.
          `SELECT 1 FROM plan_proposals
            WHERE user_uuid = $1
              AND proposal_kind = 'recovery_complete'
              AND (created_at >= NOW() - interval '24 hours' OR status = 'pending')`,
          [u],
          // 2026-08-24 · swallowed-failure sweep · this guard fails CLOSED now.
    // `rowCount: 0` means "not already done", so `.catch(() => ({ rowCount: 0 }))`
    // made a failed read say "go ahead" — the one answer that turns a de-dupe
    // check into a duplicate-action generator. A guard that cannot see must
    // assume the thing it guards against has already happened.
  ).catch((e) => { logReadFailure('cron/plan-drift · dedupe guard', e); return { rowCount: 1 }; })).rowCount;
        if (!alreadyTransitioned) {
          // TURNED BACK ON for THIS kind only · David 2026-08-28. The
          // 2026-08-26 ruling (soft drift proposes, never silently rebuilds)
          // STANDS for every drift kind below — that was two detectors
          // re-authoring the block on back-to-back mornings off observations.
          // Recovery→next-block is different in kind: the doctrine window
          // closed, the block has no days left, and the runner has answered
          // 0 of 40 engine-raised cards ever (39 expired — the evidence the
          // undo route is built on). A pending card here is a runner parked
          // in a dead plan for a fortnight. So it auto-applies through
          // fireAutoRebuild — auto_applied row, undo on the notice card —
          // and enqueues a coach note for the morning. Two fallbacks keep
          // the card path alive: a runner who UNDID this exact block
          // (RebuildRefused 'undone_by_runner') is asked, not overridden,
          // and a compromised runner (open injury / illness / override
          // niggle / gap re-entry) is never auto-built over.
          try {
            const { runnerIsCompromised } = await import('@/lib/plan/adapt');
            // FAILS CLOSED: this guard stands in front of AUTHORING, so an
            // unreadable state must propose, not prescribe.
            const compromised = await runnerIsCompromised(u)
              .catch(() => ({ compromised: true, reason: 'injury' } as const));
            let pendingCardReason: string | null = null;
            if (compromised.compromised) {
              pendingCardReason = `compromised:${compromised.reason}`;
            } else {
              const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
              const result = await fireAutoRebuild({
                userUuid: u,
                raceSlug: recoveryRow.race_id,
                kind: 'recovery_complete',
                reasons: {
                  transition: 'recovery_to_next_block',
                  race_slug: recoveryRow.race_id,
                  recovery_last_workout: recoveryRow.last_workout_iso,
                  message: `Recovery block finished · rebuilt toward ${recoveryRow.race_id}.`,
                },
                source: 'recovery_complete_cron',
              });
              if (result.ok && !result.unchanged) {
                r.proposals_written++;
                if (result.newPlanId) {
                  const { notifyBlockStarted } = await import('@/lib/notifications/block-started');
                  await notifyBlockStarted({
                    userUuid: u,
                    raceSlug: recoveryRow.race_id,
                    newPlanId: result.newPlanId,
                  });
                }
              } else if (result.unchanged && result.refusedReason === 'undone_by_runner') {
                pendingCardReason = 'undone_by_runner';
              }
              // Other outcomes need nothing more: a 'no_change' refusal means
              // the block the runner has IS the next block, and a failed
              // rebuild already wrote its own 'pending' audit row inside
              // fireAutoRebuild (the accept route can retry it; the dedupe
              // above stops a nightly re-fire from spamming).
            }
            if (pendingCardReason != null) {
              await pool.query(
                `INSERT INTO plan_proposals
                   (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at)
                 VALUES ($1, $2, 'recovery_complete', $3::jsonb, 'pending', 'recovery_complete_cron', NOW())`,
                [
                  u, recoveryRow.plan_id,
                  JSON.stringify({
                    transition: 'recovery_to_next_block',
                    race_slug: recoveryRow.race_id,
                    recovery_last_workout: recoveryRow.last_workout_iso,
                    card_fallback_reason: pendingCardReason,
                    message: `Recovery block finished · rebuild toward ${recoveryRow.race_id}?`,
                  }),
                ],
              );
              r.proposals_written++;
            }
          } catch (e) {
            console.error('[plan-drift] recovery-complete transition failed:', e);
          }
        }
      }

      // 2026-08-28 · RACEROLE-1 · tune-up race-role recommendation (David
      // 2026-08-28: when a tune-up race approaches inside a goal build, the
      // coach RECOMMENDS how to run it and the runner answers — a genuine
      // decision, never an auto-mutation, so this block writes a PENDING
      // card and nothing else). Doctrine: Research/REVIEW_NOTES.md A2 — a
      // half at exactly 4 weeks pre-marathon must be a B-effort race or be
      // converted into the week −3 MP-specific session; an A-effort half is
      // only sanctioned at 5–6 weeks out (Research/02:355 §12.3 · Research/
      // 00b:201/215 · Research/08:386 §9.2). The matrix lives in
      // lib/race/race-role.ts (pure, tested, doctrine-gated).
      //
      // Fires when a B-priority hm/10k/5k race inside the active build sits
      // ~14 days out — a [12..15]-day band so one missed cron night cannot
      // skip it — and EXACTLY ONCE per race: the dedupe is any prior
      // race_role proposal for that slug, ANY status (fail-closed), plus a
      // race already carrying an answered meta.plannedRole. C races never
      // fire (00b prices a C at 0–3 easy days · nothing to renegotiate). On
      // expiry (14d unanswered, the standing proposal-expiry sweep above):
      // no plan change — the authored composition stands, and the card copy
      // says so.
      try {
        const buildPlan = (await pool.query<{
          plan_id: string; race_id: string; race_date: string | null; race_meta: any;
        }>(
          `SELECT tp.id::text AS plan_id, tp.race_id::text AS race_id,
                  (rc.meta->>'date')::text AS race_date, rc.meta AS race_meta
             FROM training_plans tp
             JOIN races rc ON rc.slug = tp.race_id AND rc.user_uuid = tp.user_uuid
            WHERE tp.user_uuid = $1
              AND tp.archived_iso IS NULL
              AND (tp.mode = 'race-prep' OR tp.mode IS NULL)
              AND (rc.meta->>'date')::date > $2::date
            ORDER BY tp.authored_iso DESC LIMIT 1`,
          [u, userToday],
        ).catch(() => ({ rows: [] }))).rows[0];

        if (buildPlan?.race_date) {
          const {
            recommendRaceRole, raceRoleCard, RACE_ROLE_FIRE_WINDOW_DAYS,
          } = await import('@/lib/race/race-role');
          const { distanceCategoryOrNull } = await import('@/lib/plan/goal-tiers');
          const { distanceMiOf } = await import('@/lib/plan/generate');
          const dayDiff = (a: string, b: string) =>
            Math.round((Date.parse(b.slice(0, 10) + 'T12:00:00Z') - Date.parse(a.slice(0, 10) + 'T12:00:00Z')) / 86400000);
          const aMi = distanceMiOf(buildPlan.race_meta);
          const aRaceIsMarathon = aMi != null && aMi >= 25;
          const aRaceName = String(buildPlan.race_meta?.name || buildPlan.race_id);

          const tuneUps = (await pool.query<{ slug: string; meta: any }>(
            `SELECT slug, meta
               FROM races
              WHERE user_uuid = $1
                AND meta->>'priority' = 'B'
                AND meta->>'plannedRole' IS NULL
                AND (meta->>'date')::date > $2::date
                AND (meta->>'date')::date < $3::date
                AND (meta->>'date')::date - $2::date BETWEEN $4 AND $5
              ORDER BY (meta->>'date')::date ASC`,
            [u, userToday, buildPlan.race_date,
             RACE_ROLE_FIRE_WINDOW_DAYS[0], RACE_ROLE_FIRE_WINDOW_DAYS[1]],
          ).catch(() => ({ rows: [] }))).rows;

          for (const tu of tuneUps) {
            const m = tu.meta || {};
            // Belt and braces beside the SQL filters: the pure matrix makes
            // the same calls (C → null, answered role → skipped upstream).
            const dMi = distanceMiOf(m);
            const cat = dMi != null ? distanceCategoryOrNull(dMi) : null;
            const gapToADays = m.date ? dayDiff(String(m.date), buildPlan.race_date) : null;
            const rec = recommendRaceRole({
              category: cat,
              priority: typeof m.priority === 'string' ? m.priority : null,
              gapToADays,
              aRaceIsMarathon,
            });
            if (!rec) continue;
            if (cat !== 'hm' && cat !== '10k' && cat !== '5k') continue;

            // EXACTLY ONCE per race · any prior race_role row for this slug
            // (pending, accepted, dismissed OR expired) blocks a re-fire.
            const alreadyAsked = (await pool.query(
              `SELECT 1 FROM plan_proposals
                WHERE user_uuid = $1
                  AND proposal_kind = 'race_role'
                  AND reasons->>'race_slug' = $2`,
              [u, tu.slug],
              // Fails CLOSED · a guard that cannot see must assume the thing
              // it guards against has already happened (2026-08-24 sweep).
            ).catch((e) => { logReadFailure('cron/plan-drift · race-role dedupe guard', e); return { rowCount: 1 }; })).rowCount;
            if (alreadyAsked) continue;

            const card = raceRoleCard({
              raceName: String(m.name || tu.slug),
              aRaceName,
              gapToADays: gapToADays ?? 0,
              recommendation: rec,
              category: cat,
            });
            await pool.query(
              // plan_id is deliberately NULL: the question is about the RACE,
              // not the block it currently sits in. A mid-window rebuild
              // archives the plan and supersedeProposalsForArchivedPlans
              // sweeps every pending proposal pointing at it — a race_role
              // card tied to the plan would die there and the per-slug
              // exactly-once dedupe would stop it ever re-firing. The accept
              // path resolves the ACTIVE plan fresh (race-role-apply), so the
              // card needs no plan pointer to act. The plan the card was
              // computed against is still recorded in reasons.a_race_slug +
              // the audit trail.
              `INSERT INTO plan_proposals
                 (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at)
               VALUES ($1, $2, 'race_role', $3::jsonb, 'pending', 'race_role_cron', NOW())`,
              [
                u, null,
                JSON.stringify({
                  race_slug: tu.slug,
                  race_name: String(m.name || tu.slug),
                  race_date: String(m.date),
                  race_distance_mi: dMi,
                  race_category: cat,
                  a_race_slug: buildPlan.race_id,
                  a_race_date: buildPlan.race_date,
                  gap_to_a_days: gapToADays,
                  days_to_race: m.date ? dayDiff(userToday, String(m.date)) : null,
                  recommended_role: rec.role,
                  why: rec.why,
                  citation: rec.citation,
                  card_title: card.title,
                  accept_verb: card.acceptVerb,
                  message: card.body,
                }),
              ],
            );
            r.proposals_written++;
            r.race_role_cards = (r.race_role_cards ?? 0) + 1;
          }
        }
      } catch (e) {
        console.error('[plan-drift] race-role card failed:', e);
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
          // 2026-08-25 · PUSH BEFORE CONTINUE. `results.push(r)` is the last
          // statement of the loop body, so this `continue` skipped it: the
          // runner vanished from the cron's own report, taking the
          // `goal_gap_suppressed_compromised` count that was just set with
          // them. The report then read the same as if the runner had never
          // been iterated at all — the exact confusion this whole audit is
          // about, one level up. A suppression is a decision and has to be
          // legible as one.
          results.push(r);
          continue;
        }
        // Auto-rebuild if no recent goal-gap rebuild. '' planId = any
        // plan for this user (the strict plan_id='' match could never
        // hit a real row, so this dedupe was dead before 2026-08-17).
        // 2026-08-25 · FAILS CLOSED. `false` here means "nothing standing, go
        // ahead and re-author the block", so a thrown guard used to license the
        // very action it guards. `hasPendingProposal` now fails closed on its
        // own; this outer catch must agree with it, not undo it.
        const recentGapRebuild = await hasPendingProposal(u, '', 'goal_gap_widening')
          .catch((e) => { logReadFailure('cron/plan-drift · goal-gap rebuild guard', e); return true; });
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
          // TURNED OFF · David 2026-08-26 (same ruling as the recovery-
          // complete and soft-drift blocks — no rebuild fires without a
          // card to approve first).
          try {
            const activePlanRow = await rowOrNull(
              'cron/plan-drift · goal-gap active plan lookup',
              pool.query<{ id: string }>(
                `SELECT id FROM training_plans
                  WHERE user_uuid = $1 AND archived_iso IS NULL
                  ORDER BY authored_iso DESC LIMIT 1`,
                [u],
              ),
            );
            const activePlanId = activePlanRow?.id ?? null;
            await pool.query(
              `INSERT INTO plan_proposals
                 (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at)
               VALUES ($1, $2, 'goal_gap_widening', $3::jsonb, 'pending', 'goal_gap_cron_pending', NOW())`,
              [
                u, activePlanId,
                JSON.stringify({
                  drift_kind: 'goal_gap_widening',
                  message: `Projection drifting away from goal for ${goalGap.consecutiveWideningDays} days · rebuild to close the gap?`,
                  trajectory_sec: goalGap.trajectorySec,
                  goal_sec: goalGap.goalSec,
                  gap_sec: goalGap.gapSec,
                  weeks_remaining: goalGap.weeksRemaining,
                  what_closes_it: goalGap.whatClosesIt,
                  citation: goalGap.citation,
                }),
              ],
            );
            r.proposals_written++;
          } catch (e) {
            console.error('[plan-drift] goal-gap pending write failed:', e);
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
            const activePlanRow = await rowOrNull(
              'cron/plan-drift · goal-renegotiation active plan lookup',
              pool.query<{ id: string }>(
                `SELECT id FROM training_plans
                  WHERE user_uuid = $1 AND archived_iso IS NULL
                  ORDER BY authored_iso DESC LIMIT 1`,
                [u],
              ),
            );
            const activePlanId = activePlanRow?.id ?? null;
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
        // 2026-08-25 · FAILS CLOSED, same argument as the goal-gap guard above.
        // This is the guard that stands in front of `fireAutoRebuild` for every
        // soft-drift kind — the path that re-authored this runner's block on
        // 2026-08-25 — so `false` on a failed read is the one answer it must
        // never give.
        if (await hasPendingProposal(u, report.planId, k)
          .catch((e) => { logReadFailure('cron/plan-drift · soft-drift rebuild guard', e); return true; })) {
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
          // TURNED OFF · David 2026-08-26, reversing the 2026-06-01
          // "zero-gaps" directive after living under it: two of these six
          // kinds rebuilt his plan on back-to-back mornings (long_drift
          // 8/25 bumped the easy-day target 4→7 as a side effect of a
          // long-run correction; easy_drift 8/26 reacted to THAT number
          // the very next night and cut it to 5.5) — one detector's
          // rebuild created the exact condition that fired the other,
          // with nothing surfaced either time. "A real coach would never
          // rebuild a plan mid-week... something needs to surface asking
          // if I want to approve." So: every soft-drift signal writes a
          // pending proposal now, same shape `CoachDecisionCard` already
          // renders for `easy_drift`/etc (see decision-cards.ts) — it was
          // built for exactly this, just never reached because this path
          // auto-applied instead. No more silent rebuild; fireAutoRebuild
          // is not called here at all now.
          await pool.query(
            `INSERT INTO plan_proposals
               (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at)
             VALUES ($1, $2, $3, $4::jsonb, 'pending', 'drift_cron_pending', NOW())`,
            [
              u, report.planId, driftProposalKind(signal.kind),
              JSON.stringify({
                drift_kind: signal.kind,
                message: signal.message,
                severity: signal.severity,
                ...signal.details,
              }),
            ],
          );
          r.proposals_written++;
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
      'recovery_complete · recovery plan out of prescribed days, target race still ahead → auto-rebuild with undo + coach note (pending card only when the runner undid this block or is compromised)',
      'plan_elapsed · ANY plan out of prescribed days · race still ahead → auto-rebuild toward it; race date null/past or no race → goal target / open-block handoff; compromised or injury-return runner → pending card, never an auto-authored build',
      'race_role · a B-priority hm/10k/5k tune-up inside the active build is 12-15 days out → pending recommendation card (never auto-applies; once per race; C races never fire; expiry = the authored composition stands)',
      'volume_drift · current 28d avg deviates >40% from authored 4wk avg',
      'vdot_drift · current VDOT deviates >2 from plan anchor (inferred from T-pace)',
      'staleness · plan authored >8 weeks ago',
    ],
    note: 'Idempotent · checks for an existing pending proposal of the same kind before writing (proposals carry their TRUE kind since 2026-08-17). Staleness/drift proposals are suppressed inside 14 days of the target race (the generator refuses to rebuild there). Soft-drift only, and soft drift PROPOSES (David 2026-08-26 · no drift rebuild without a card); lifecycle transitions (race_graduate / recovery_complete / plan_elapsed / maintenance→race-prep) auto-apply with undo. Hard-drift (race date / goal time / A-race add-or-remove) is handled by immediate-fire hooks at the route level.',
  });
}
