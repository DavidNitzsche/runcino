/**
 * lib/ops/reassessment-evaluators.ts · THE TWO PROMISES NOTHING KEPT.
 *
 * `reassessment-scheduler.ts`'s own Rule 22 note is explicit about what it
 * cannot fail on: "WHETHER THE EVALUATOR ACTUALLY RE-ASKS THE QUESTION...
 * that engine's contract, not this one's." This file is that contract, for
 * the two `ReassessmentKind`s that had a real `scheduleReassessment` call
 * site and NO consumer that ever read a due item back:
 *
 *   · POST_RACE_RECOVERY_CHECK — scheduled by `app/api/cron/plan-drift/
 *     route.ts` (POSTRACE-1) the moment a race graduates. Nothing anywhere
 *     resolved it; grepping the whole repo for `resolveReassessment` before
 *     this file turns up `workout-proposals.ts`, `rolling-boundary-
 *     evaluator.ts` and `v5/return/checkin/route.ts` — none of them touch
 *     this kind.
 *   · RETURN_TO_TRAINING_STAGE — scheduled AND partially resolved by
 *     `app/api/v5/return/checkin/route.ts` (RETURNSTAGE-1), but only on the
 *     PATH where the runner submits another check-in that advances the
 *     stage. A runner who stops checking in, or whose injury resolves by
 *     some other route (clinician clearance recorded elsewhere, a new
 *     injury superseding this one), leaves a promise standing that nothing
 *     ever revisits until the sweep's overdue alert fires on a fact that
 *     may no longer be true. This file is the BACKSTOP for that gap, not a
 *     second owner of the ladder itself — `return-ladder.ts` and
 *     `return-checkin-store.ts` stay the only place stage state is computed.
 *
 * Two kinds this file deliberately does NOT touch, and why:
 *
 *   · EARNING_GATE and CONDITIONAL_DOSE already have a real evaluator —
 *     `lib/plan/adjudication/rolling-boundary-evaluator.ts`
 *     (`evaluateDueRollingBoundariesForUser`, ROLLINGBOUNDARY-EVAL-1),
 *     wired into `app/api/cron/run-adaptations/route.ts` the same night this
 *     file was written. Building a second evaluator for either kind would be
 *     exactly the "second owner for one coaching decision"
 *     `docs/BRAIN_CONSTITUTION.md` forbids. Verified by reading both files in
 *     full before writing this one; see the handback report for the exact
 *     grep trail.
 *   · PROPOSAL_EXPIRATION is already fully kept: scheduled by
 *     `lib/plan/workout-proposals.ts` (PROPOSALEXPIRE-1), resolved on both
 *     accept and dismiss by `resolveProposalExpirationPromise` (the same
 *     file), and auto-EXPIRED by `sweepReassessments` itself when a card
 *     stands unanswered past its `overdue_after_iso`. There is no
 *     "re-ask the question" state left uncovered: the only two answers a
 *     card can ever have — answered or not — are both already wired.
 *
 * ── WHAT NEITHER EVALUATOR DOES, ON PURPOSE ─────────────────────────────────
 *
 * Neither creates a `plan_workout_proposals` row. `lib/brain/proposal/
 * facets.ts`'s own ledger (read in full before writing this file, not
 * touched — it is another workstream's file tonight) marks the ONE proposal
 * kind that could plausibly carry either finding — `RECOVERY_CHANGE` — as
 * having no generator, no evidence source and no writer, and states exactly
 * why: "post-race recovery is sized at authoring... and nothing re-reads the
 * runner to ask whether it was enough. The reading that would close this is
 * recovery-response evidence... which nobody aggregates across a window."
 * That evidence source does not exist anywhere in this app. Building a
 * generator against evidence that has to be fabricated to feed it would be
 * exactly the disallowed shape — a coaching decision reached without the
 * evidence engine that is supposed to gate it. So both evaluators below
 * follow `rolling-boundary-evaluator.ts`'s own precedent for its BOUNDARY 2
 * gap: record the resolution on the reassessment row itself (durable,
 * queryable, alertable) and stop there. Surfacing either as a runner-facing
 * card is real, follow-on work once `RECOVERY_CHANGE`'s generator exists —
 * named here rather than built blind against evidence that isn't gathered.
 *
 * ── WHAT EACH EVALUATOR ACTUALLY RE-ASKS ────────────────────────────────────
 *
 * POST_RACE_RECOVERY_CHECK's question is "is this runner ready to train
 * normally again after this race." Three answers, never a guess:
 *
 *   1 · An injury that started on or after the race date is now active for
 *       this runner (`loadActiveInjuryForReturn`, the app's own owner of
 *       "is this runner hurt right now" — not re-derived). Return-to-training
 *       is now governed by `RETURN_TO_TRAINING_STAGE`'s own ladder, which
 *       reads real check-in evidence this kind has none of. ABANDONED,
 *       `SUPERSEDED_BY_INJURY`.
 *   2 · A LATER race has already finished before this window closed — the
 *       runner raced again during what was meant to be recovery. Its own
 *       `POSTRACE-1` scheduling call already queued a fresh window off the
 *       later race's finish date; tracking both is the same fact asked
 *       twice (Rule 16). ABANDONED, `SUPERSEDED_BY_LATER_RACE`.
 *   3 · Neither holds: doctrine's window elapsed and nothing overrode it.
 *       RESOLVED, `RECOVERY_WINDOW_ELAPSED`.
 *
 * RETURN_TO_TRAINING_STAGE's question is "should this promise still stand."
 * It NEVER decides "the runner may now advance" — only a real check-in does
 * that, and always will, because the ladder is self-report by design (no
 * ambient evidence exists for "this niggle is gone"). Three answers:
 *
 *   1 · The injury this promise was queued against is no longer the active
 *       one (healed outside the 30-day grace window, or a different injury
 *       is now active). ABANDONED, `INJURY_NO_LONGER_ACTIVE`.
 *   2 · The injury is now clinician-gated (severity or protocol changed
 *       since scheduling) — self-report can no longer move this ladder at
 *       all, which is exactly what the check-in route itself refuses on.
 *       ABANDONED, `NOW_CLINICIAN_GATED`.
 *   3 · Replaying the SAME check-in history this route already trusts shows
 *       the stage already moved past what this promise was waiting on — the
 *       backstop for a check-in whose synchronous resolve
 *       (`v5/return/checkin/route.ts`) was itself contained by an outage.
 *       RESOLVED, `STAGE_ADVANCED`.
 *   4 · Nothing above holds and the ladder still reports `advanceQueued` at
 *       the SAME stage: this is the expected, healthy "waiting on the next
 *       silent check-in" state. Left untouched — resolving it here would be
 *       answering a question only the runner's own body can answer, and
 *       leaving it is not the same defect this file exists to fix (the sweep's
 *       existing overdue alert already covers "nobody checked in for too
 *       long", Rule 23 clause 3).
 *
 * ── LINEAGE, AND WHY THIS DOES NOT RE-DERIVE STALEPLAN-1 ────────────────────
 *
 * Both kinds' `plan_id` (when set) is already protected by
 * `supersedeReassessmentsForArchivedPlans`, called from both
 * `clearActivePlansFor` implementations the moment a plan is archived — by
 * the time either evaluator below reads a LIVE item, that invariant already
 * holds, and re-querying `training_plans.archived_iso` here would be the
 * exact re-derivation CLAUDE.md's Rule 16 (`resolveThresholdCapacity()`, not
 * four copies) warns against. What plan-lineage does NOT cover — because it
 * is not a plan question — is race lineage (a later race superseding this
 * one) and injury lineage (this injury no longer being the active one). Those
 * are new, and this file owns them for exactly these two kinds.
 */
import { pool } from '@/lib/db/pool';
import {
  loadDueItems, resolveReassessment, recordAssessmentFailure,
  type ScheduledReassessment, type ReassessmentKind,
} from './reassessment-scheduler';
import { loadActiveInjuryForReturn, protocolForInjury, loadReturnCheckins } from '@/lib/plan/return-checkin-store';
import { computeReturnLadderState } from '@/lib/plan/return-ladder';

export interface EvaluatedItem {
  readonly itemId: string;
  readonly kind: ReassessmentKind;
  /**
   * The scheduler status this evaluator actually wrote, or `null` when it
   * deliberately left the item standing (still waiting on real-world
   * evidence, not a defect). Never inferred from `decision`'s string shape —
   * the caller counts off this field directly.
   */
  readonly wroteStatus: 'RESOLVED' | 'ABANDONED' | null;
  readonly decision: string | null;
  readonly why: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * POST_RACE_RECOVERY_CHECK
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Deliberately NOT `rowOrNull` (which the analogous plan-drift scheduling
 * read uses, and which is fine there — a swallowed read there only means
 * "not scheduled this cycle, retried next time it's due"). This evaluator's
 * answer is TERMINAL: resolving `POST_RACE_RECOVERY_CHECK` off a false "no
 * later race" would be Rule 11's exact failure, wearing this file's own
 * costume — a read that failed reported as a read that found nothing. So
 * this throws on a genuine query failure, same as `loadActiveInjuryForReturn`
 * (no `.catch()`, by that function's own header), and the dispatcher's
 * try/catch routes it to `recordAssessmentFailure` for a real retry instead
 * of a silent, wrong RESOLVED.
 */
async function laterRaceAlreadyHappened(
  userUuid: string, excludeSlug: string, afterISO: string, onOrBeforeISO: string,
): Promise<{ slug: string; date: string } | null> {
  const r = await pool.query<{ slug: string; race_date: string }>(
    `SELECT slug, (meta->>'date')::text AS race_date
       FROM races
      WHERE user_uuid = $1::uuid
        AND slug <> $2
        AND meta->>'date' IS NOT NULL
        AND (meta->>'date') > $3
        AND (meta->>'date') <= $4
      ORDER BY (meta->>'date') ASC
      LIMIT 1`,
    [userUuid, excludeSlug, afterISO, onOrBeforeISO],
  );
  const row = r.rows[0];
  return row ? { slug: row.slug, date: row.race_date } : null;
}

/**
 * Evaluates and resolves ONE due `POST_RACE_RECOVERY_CHECK` item. Never
 * throws — a failure is reported in the result so the caller can route it
 * through `recordAssessmentFailure` (this module's own dispatcher does).
 */
export async function evaluatePostRaceRecoveryCheckItem(
  item: ScheduledReassessment,
): Promise<EvaluatedItem> {
  const raceSlug = typeof item.payload.raceSlug === 'string' ? item.payload.raceSlug : null;
  const raceDateISO = typeof item.payload.raceDateISO === 'string' ? item.payload.raceDateISO.slice(0, 10) : null;
  const recoveryWeeks = typeof item.payload.recoveryWeeks === 'number' ? item.payload.recoveryWeeks : null;
  if (!raceSlug || !raceDateISO) {
    return {
      itemId: item.id, kind: item.kind, wroteStatus: null, decision: null,
      why: 'payload carried no raceSlug/raceDateISO, so the recovery window cannot be re-derived',
    };
  }

  // 1 · an injury superseding this window entirely.
  const injury = await loadActiveInjuryForReturn(item.userUuid);
  if (injury && injury.startDate >= raceDateISO) {
    const res = await resolveReassessment({
      id: item.id, status: 'ABANDONED', decision: 'SUPERSEDED_BY_INJURY',
      detail: `an active injury (site: ${injury.site}, started ${injury.startDate}) began on or `
        + `after the race date, so return-to-training is governed by the RETURN_TO_TRAINING_STAGE `
        + 'ladder, not a fixed-week recovery calendar',
    });
    return {
      itemId: item.id, kind: item.kind,
      wroteStatus: res.state === 'ok' && res.value ? 'ABANDONED' : null,
      decision: 'SUPERSEDED_BY_INJURY',
      why: res.state === 'ok' ? 'resolved' : `resolveReassessment: ${res.state} · ${res.why}`,
    };
  }

  // 2 · a later race already finished during this window.
  const later = await laterRaceAlreadyHappened(item.userUuid, raceSlug, raceDateISO, item.assessOnISO);
  if (later) {
    const res = await resolveReassessment({
      id: item.id, status: 'ABANDONED', decision: 'SUPERSEDED_BY_LATER_RACE',
      detail: `${later.slug} finished on ${later.date}, inside this recovery window; its own `
        + 'POSTRACE-1 scheduling call queues a fresh recovery check off that finish, so tracking '
        + 'both would ask the same question twice',
    });
    return {
      itemId: item.id, kind: item.kind,
      wroteStatus: res.state === 'ok' && res.value ? 'ABANDONED' : null,
      decision: 'SUPERSEDED_BY_LATER_RACE',
      why: res.state === 'ok' ? 'resolved' : `resolveReassessment: ${res.state} · ${res.why}`,
    };
  }

  // 3 · the common case: the window closed clean.
  const res = await resolveReassessment({
    id: item.id, status: 'RESOLVED', decision: 'RECOVERY_WINDOW_ELAPSED',
    detail: `Research/00b's ${recoveryWeeks ?? '?'}-week recovery window for ${raceSlug} `
      + `(finished ${raceDateISO}) closed on or before ${item.assessOnISO} with no injury or `
      + 'later race overriding it; normal training resumes',
  });
  return {
    itemId: item.id, kind: item.kind,
    wroteStatus: res.state === 'ok' && res.value ? 'RESOLVED' : null,
    decision: 'RECOVERY_WINDOW_ELAPSED',
    why: res.state === 'ok' ? 'resolved' : `resolveReassessment: ${res.state} · ${res.why}`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * RETURN_TO_TRAINING_STAGE
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Evaluates ONE due `RETURN_TO_TRAINING_STAGE` item. Never mutates the
 * ladder itself — `return-ladder.ts` stays the only place stage state is
 * computed; this only decides whether the SCHEDULER'S row should still stand.
 */
export async function evaluateReturnToTrainingStageItem(
  item: ScheduledReassessment,
): Promise<EvaluatedItem> {
  const injuryId = typeof item.payload.injuryId === 'string' ? item.payload.injuryId : null;
  const promisedStage = typeof item.payload.stage === 'number' ? item.payload.stage : null;
  if (!injuryId) {
    return {
      itemId: item.id, kind: item.kind, wroteStatus: null, decision: null,
      why: 'payload carried no injuryId, so the ladder cannot be re-derived',
    };
  }

  const injury = await loadActiveInjuryForReturn(item.userUuid);

  // 1 · the injury this promise names is no longer the active one.
  if (!injury || injury.id !== injuryId) {
    const res = await resolveReassessment({
      id: item.id, status: 'ABANDONED', decision: 'INJURY_NO_LONGER_ACTIVE',
      detail: injury
        ? `injury ${injuryId} is no longer this runner's active return injury (currently `
          + `${injury.id}); this promise names a ladder that has moved on`
        : `injury ${injuryId} is no longer active (resolved past the 30-day grace window) and no `
          + 'other injury is active; this promise no longer describes a real ladder',
    });
    return {
      itemId: item.id, kind: item.kind,
      wroteStatus: res.state === 'ok' && res.value ? 'ABANDONED' : null,
      decision: 'INJURY_NO_LONGER_ACTIVE',
      why: res.state === 'ok' ? 'resolved' : `resolveReassessment: ${res.state} · ${res.why}`,
    };
  }

  // 2 · the injury is now clinician-gated — self-report can no longer move it.
  const resolved = protocolForInjury(injury);
  if (resolved.clearanceRequired) {
    const res = await resolveReassessment({
      id: item.id, status: 'ABANDONED', decision: 'NOW_CLINICIAN_GATED',
      detail: `injury ${injuryId} is now clinician-gated (${resolved.protocol.clearanceGate ?? 'clearance required'}); `
        + 'a self-report check-in can no longer advance this ladder, which is the same rule '
        + 'POST /api/v5/return/checkin itself refuses on',
    });
    return {
      itemId: item.id, kind: item.kind,
      wroteStatus: res.state === 'ok' && res.value ? 'ABANDONED' : null,
      decision: 'NOW_CLINICIAN_GATED',
      why: res.state === 'ok' ? 'resolved' : `resolveReassessment: ${res.state} · ${res.why}`,
    };
  }

  // 3 · replay the same trusted history fresh — the backstop for a missed
  //     synchronous resolve.
  const checkins = await loadReturnCheckins(item.userUuid, injury.id);
  const state = computeReturnLadderState(checkins, resolved.protocol.startStage);
  if (promisedStage !== null && state.stage > promisedStage) {
    const res = await resolveReassessment({
      id: item.id, status: 'RESOLVED', decision: 'STAGE_ADVANCED',
      detail: `a fresh replay of this injury's check-in history shows the runner is already at `
        + `stage ${state.stage}, past the stage ${promisedStage} this promise was waiting on — `
        + 'backstopping a synchronous resolve that did not land',
    });
    return {
      itemId: item.id, kind: item.kind,
      wroteStatus: res.state === 'ok' && res.value ? 'RESOLVED' : null,
      decision: 'STAGE_ADVANCED',
      why: res.state === 'ok' ? 'resolved' : `resolveReassessment: ${res.state} · ${res.why}`,
    };
  }

  // 4 · still waiting on the runner's own next check-in. Correct, not stale.
  return {
    itemId: item.id, kind: item.kind, wroteStatus: null, decision: null,
    why: `stage ${state.stage} is still waiting on a silent check-in `
      + `(advanceQueued: ${state.advanceQueued}); only the runner's own next check-in can move this, `
      + 'so this evaluator leaves it standing',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE DISPATCHER · one pass, every runner, both kinds
 * ═══════════════════════════════════════════════════════════════════════ */

export interface EvaluationSweepReport {
  readonly examined: number;
  readonly resolved: number;
  readonly abandoned: number;
  readonly stillWaiting: number;
  readonly failed: number;
  readonly ownedElsewhere: number;
  readonly refusal: string | null;
  readonly detail: string;
}

export const OWNED_ELSEWHERE: ReadonlySet<ReassessmentKind> = new Set([
  'EARNING_GATE', 'CONDITIONAL_DOSE', 'PROPOSAL_EXPIRATION', 'DEFERRAL', 'FAILED_EVALUATION',
]);

/**
 * ONE PASS, EVERY RUNNER, BOTH KINDS THIS FILE OWNS.
 *
 * Deliberately reads `loadDueItems` (global, `assess_on_iso <= todayISO`,
 * PENDING or DUE) rather than depending on `sweepReassessments` having
 * already promoted PENDING to DUE first — Rule 23: this job ensures its own
 * precondition rather than assuming another job ran. Promotion and the
 * overdue alert are `sweepReassessments`' own concern (already wired into
 * `run-adaptations`, kind-agnostic, so it already covers these two kinds
 * without any change here); this dispatcher only evaluates.
 *
 * A throw from either evaluator is caught HERE, per item, and recorded via
 * `recordAssessmentFailure` — the retryable-failure machinery migration 167
 * already built (`attempts`/`last_error`/`next_retry_at`/terminal `FAILED`),
 * under the item's OWN kind. This is the FAILED_EVALUATION decision this
 * module makes concrete: no row is ever inserted with
 * `kind = 'FAILED_EVALUATION'` (see `_reassessment_evaluators.test.ts`'s
 * `FAILED_EVALUATION_STAYS_UNUSED` assertion), because the retry state lives
 * on the failing item itself, exactly as `_reassessment_scheduler.test.ts`'s
 * own `NO_CALLER_YET.FAILED_EVALUATION` entry already argues.
 */
export interface EvaluatorDeps {
  readonly evaluatePostRaceRecoveryCheckItem: typeof evaluatePostRaceRecoveryCheckItem;
  readonly evaluateReturnToTrainingStageItem: typeof evaluateReturnToTrainingStageItem;
}

const REAL_DEPS: EvaluatorDeps = { evaluatePostRaceRecoveryCheckItem, evaluateReturnToTrainingStageItem };

/**
 * `deps` defaults to the real evaluators and exists ONLY so
 * `_reassessment_evaluators.db.test.ts` can inject a throwing stand-in to
 * falsify the failure-recording path (Rule 18) without needing to engineer a
 * genuine database fault. No production call site ever passes it.
 */
export async function runReassessmentEvaluationSweep(
  todayISO: string,
  deps: EvaluatorDeps = REAL_DEPS,
): Promise<EvaluationSweepReport> {
  const due = await loadDueItems(todayISO);
  if (due.state !== 'ok') {
    return {
      examined: 0, resolved: 0, abandoned: 0, stillWaiting: 0, failed: 0, ownedElsewhere: 0,
      refusal: due.state, detail: due.why,
    };
  }

  let resolved = 0;
  let abandoned = 0;
  let stillWaiting = 0;
  let failed = 0;
  let ownedElsewhere = 0;
  const problems: string[] = [];

  for (const item of due.value) {
    if (OWNED_ELSEWHERE.has(item.kind)) { ownedElsewhere += 1; continue; }
    if (item.kind !== 'POST_RACE_RECOVERY_CHECK' && item.kind !== 'RETURN_TO_TRAINING_STAGE') {
      // A future kind this dispatcher does not yet know. Counted honestly
      // rather than silently skipped (Rule 11) — visible in `problems`.
      problems.push(`${item.id}: unrecognized kind '${item.kind}', not evaluated`);
      continue;
    }
    try {
      const outcome = item.kind === 'POST_RACE_RECOVERY_CHECK'
        ? await deps.evaluatePostRaceRecoveryCheckItem(item)
        : await deps.evaluateReturnToTrainingStageItem(item);
      // Counted off `wroteStatus` directly — never inferred from the shape
      // of `decision`'s string, which is a human-readable label, not a
      // machine contract.
      if (outcome.wroteStatus === 'RESOLVED') resolved += 1;
      else if (outcome.wroteStatus === 'ABANDONED') abandoned += 1;
      else stillWaiting += 1;
    } catch (e) {
      failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      problems.push(`${item.id} (${item.kind}): ${message}`);
      try {
        await recordAssessmentFailure(item.id, `evaluation threw: ${message}`);
      } catch { /* recordAssessmentFailure's own failure is already visible in `problems` above */ }
    }
  }

  if (problems.length > 0) {
    return {
      examined: due.value.length, resolved, abandoned, stillWaiting, failed, ownedElsewhere,
      refusal: 'partial-failure',
      detail: `${resolved} resolved · ${abandoned} abandoned · ${stillWaiting} still-waiting · `
        + `${ownedElsewhere} owned-elsewhere, with ${problems.length} failure(s): ${problems.join('; ')}`,
    };
  }
  return {
    examined: due.value.length, resolved, abandoned, stillWaiting, failed, ownedElsewhere,
    refusal: null,
    detail: `${due.value.length} examined · ${resolved} resolved · ${abandoned} abandoned · `
      + `${stillWaiting} still-waiting · ${ownedElsewhere} owned-elsewhere`,
  };
}
