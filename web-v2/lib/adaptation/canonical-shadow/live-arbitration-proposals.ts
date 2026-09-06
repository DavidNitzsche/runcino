/**
 * lib/adaptation/canonical-shadow/live-arbitration-proposals.ts · THE PLACE
 * PHASE-AWARE ARBITRATION'S OUTPUT STOPS BEING A SHADOW LOG AND BECOMES A
 * REAL, RUNNER-FACING DECISION.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 *
 * `resolveArbitrationPriority` (`lib/adaptation/canonical/phase-priority.ts`)
 * has been called on every live evaluation since PHASEARB-1: `evaluate.ts`'s
 * `priorityFor` calls it for every runner, every night, through
 * `run-live-shadow-evaluation.ts` — which the `run-adaptations` cron already
 * invokes for real. So the ORDERING was never actually unreachable; what was
 * missing is a destination for its answer. Every `CanonicalDecisionRecord`
 * this produces, including which lever WON the week's one material slot and
 * which SUPPORTED lever was deferred to make room for it, was written to
 * `canonical_adaptation_shadow_log` and nowhere else — a diagnostic table one
 * admin route reads. `lib/brain/orchestration/steps.ts` step 9 named this
 * exactly: "a route reaches it is not the same claim as it decides anything."
 *
 * This file is the destination. It takes the SAME `CanonicalDecisionRecord[]`
 * the shadow evaluation already computed — no second evaluation, no second
 * call into the sealed engine — and, for each record where arbitration
 * actually had something to say, writes ONE of two real, already-WIRED
 * mechanisms:
 *
 *   · the WINNER of this cycle's arbitration (`decision === 'PROGRESS'` and
 *     `suppressedBy === null`) is recorded on `plan_decision_ledger` via
 *     `recordDecision` (orchestration step 10, already WIRED) — a real,
 *     ops- and runner-lineage-visible row, HELD pending the runner's own
 *     acceptance, never a plan mutation.
 *   · a SUPPORTED lever arbitration DEFERRED this cycle (`decision ===
 *     'PROGRESS'` with a `suppressedBy` that carries a `reconsiderAtISO`) is
 *     queued on `reassessment_schedule` via `scheduleReassessment(kind:
 *     'DEFERRAL')` (orchestration step 12) — so it is asked again at the
 *     boundary the arbitration itself named, rather than evaporating the
 *     moment this process exits. This is CLAUDE.md's own instruction for
 *     "the losing proposal persists and returns later": use the reassessment
 *     scheduler, do not stand up a second queue next to the one
 *     `deferral-queue.ts` already keeps for the engine's OWN idempotency
 *     bookkeeping (see below for why those two are not duplicates).
 *
 * A suppression whose `reconsiderAtISO` is null — every safety basis
 * (`SAFETY_HARD_STOP`, `SAFETY_UNREADABLE`, `SAFETY_CONSTRAINED`; see
 * `arbitration.ts`'s own comment: "a SAFETY decline lifts when Safety says
 * so, not at a boundary this engine can schedule against") — is NEVER queued
 * here. That is not an oversight, it is the mechanism that makes "SAFETY
 * defeats every PUSH — no exception, ever" true one layer further out than
 * `resolveArbitrationPriority` itself: even the RECORD of a safety-declined
 * push cannot be re-offered automatically. It is still ledgered, as a HOLD,
 * so Rule 21's log answers "did the engine want to push and get told no" —
 * but nothing here will ever ask again on its own.
 *
 * ── WHY THIS IS NOT A SECOND IMPORTER OF THE SEALED ENGINE ─────────────────
 *
 * This file imports exactly ONE thing from `canonical/`, and it is a TYPE:
 * `CanonicalDecisionRecord`. `_cannot_mutate.test.ts`'s own oracle proves a
 * whole-statement `import type` produces no runtime code and is out of scope
 * for the seal ("a whole-statement `import type` from the engine is correctly
 * out of scope ... which is WHY `live-input.ts`'s many TYPE imports from
 * `canonical/input` need no allowlist entry of their own"). This file needs
 * NO new allowlist entry in `_cannot_mutate.test.ts` or
 * `_never_mutates_plan.test.ts` for exactly that reason — it never calls
 * `evaluateAdaptation` or anything else that runs the engine. It consumes the
 * engine's OUTPUT, already computed by the one authorized caller
 * (`run-live-shadow-evaluation.ts`), as plain data.
 *
 * ── WHY THIS IS NOT A PLAN MUTATION ─────────────────────────────────────────
 *
 * Nothing here calls `mutatePlan` or writes `plan_workouts`.
 * `AUTOMATIC_ADAPTATION_AUTHORITY` stays `false` and is not read here at
 * all — there is nothing to gate, because this file never attempts the write
 * the flag governs. `authority.ts`'s own `insteadDo` for a sealed
 * `COACHING_ADAPTATION` write is exactly what this file does: "persist the
 * decision and raise a runner-visible proposal, then apply it under
 * RUNNER_ACCEPTED when he accepts." Every ledger row this writes carries
 * `authorityVerdict: 'HELD'` with a named, expiring hold — never `'PERMITTED'`
 * — because nothing here is asking to write the plan; it is asking to be
 * SEEN.
 *
 * ── RULE 22 · WHAT THIS FILE'S GATE CANNOT FAIL ON ──────────────────────────
 *
 * · WHETHER THE ARBITRATED ORDER IS THE RIGHT ORDER. That is
 *   `phase-priority.ts`'s own claim, cited and gated there. This file trusts
 *   whatever `CanonicalDecisionRecord.decision` and `.suppressedBy` already
 *   say and adds no judgement of its own.
 * · WHETHER THE RUNNER EVER SEES OR ACTS ON THE LEDGER ROW. That is the
 *   proposal-surfacing UI's job, which is out of scope for this wiring pass.
 * · WHETHER MIGRATION 166 OR 167 IS APPLIED TO PRODUCTION. Neither is,
 *   deliberately, and both `recordDecision` and `scheduleReassessment`
 *   report `table_absent` rather than throwing — this file passes that state
 *   straight through rather than manufacturing a fake success.
 */
import type { CanonicalDecisionRecord } from '@/lib/adaptation/canonical/decision-record';
import type { CanonicalLever } from '@/lib/adaptation/canonical/input';
import { recordDecision, type LedgerWrite } from '@/lib/brain/ledger/decision-ledger';
import type { LedgerLever } from '@/lib/brain/ledger/ledger-entry';
import { PLAN_MUTATION_BOUNDARY_MODEL_VERSION } from '@/lib/brain/ledger/ledger-entry';
import { scheduleReassessment, type SchedulerResult } from '@/lib/ops/reassessment-scheduler';

/** `${planId}:${last_adapted_at}` (`plan-version.ts`) — this file only ever
 *  needs the first half, to link the ledger row and the reassessment item back
 *  to a plan without re-deriving `planVersionOf` from a row it never reads. */
function planIdFromVersion(planVersion: string): string {
  const i = planVersion.indexOf(':');
  return i === -1 ? planVersion : planVersion.slice(0, i);
}

const LEVER_TO_LEDGER_LEVER: Readonly<Record<CanonicalLever, LedgerLever>> = {
  WEEKLY_VOLUME: 'VOLUME',
  LONG_RUN: 'LONG_RUN',
  THRESHOLD_PACE: 'PACE',
};

/** One outcome per record this function actually acted on. */
export interface ArbitratedProposalOutcome {
  readonly lever: CanonicalLever;
  readonly idempotencyKey: string;
  readonly kind: 'ARBITRATED_WINNER' | 'DEFERRED_SUPPORTED_LOSER' | 'SAFETY_HELD_NOT_QUEUED' | 'NOT_APPLICABLE';
  readonly detail: string;
  readonly ledgerWrite: LedgerWrite['state'] | null;
  readonly reassessmentWrite: SchedulerResult<string>['state'] | null;
}

/**
 * The `LedgerEntry.explanation` sentence, shared between the ledger write and
 * the reassessment's `reasonDetail` so the two rows tell the same story
 * (Rule 16 — a reader following one record to the other should not find two
 * accounts of the same decision).
 */
function explanationFor(r: CanonicalDecisionRecord): string {
  const priority = r.ledger.priority;
  return `${r.reason} Arbitrated ${priority.phase} · ${priority.posture} · order `
    + `${priority.order.join(' then ')}. ${priority.why}`.trim();
}

/**
 * Persist what phase-aware arbitration decided for ONE evaluation cycle, for
 * every lever it had an opinion about.
 *
 * Pure orchestration over two already-WIRED writers — no new table, no new
 * queue, no second evaluation. Never throws: each record's write is
 * independent and a failure on one lever must not lose the others, matching
 * every other best-effort step this cron already runs.
 */
export async function persistArbitratedProposals(
  userUuid: string,
  records: readonly CanonicalDecisionRecord[],
): Promise<readonly ArbitratedProposalOutcome[]> {
  const out: ArbitratedProposalOutcome[] = [];

  for (const r of records) {
    if (r.decision !== 'PROGRESS') {
      // HOLD, REGRESS and REFUSE are not arbitration-between-competing-levers
      // outcomes — they are the lever's own verdict with nothing to order
      // against another lever's demand for the same week's one material slot.
      out.push({
        lever: r.lever, idempotencyKey: r.idempotencyKey, kind: 'NOT_APPLICABLE',
        detail: `decision is ${r.decision}, not PROGRESS · arbitration had nothing to order`,
        ledgerWrite: null, reassessmentWrite: null,
      });
      continue;
    }

    if (r.suppressedBy === null) {
      /* ── THE WINNER ────────────────────────────────────────────────────
       * Evidence supports it AND arbitration let it through this cycle. */
      const write = await recordDecision({
        userUuid,
        planId: planIdFromVersion(r.planVersion),
        planLineageId: planIdFromVersion(r.planVersion),
        replacedPlanId: null,
        planVersion: r.planVersion,
        scope: r.affectedWorkoutIds.length > 0 ? 'WORKOUT' : 'PLAN',
        workoutIds: r.affectedWorkoutIds,
        scopeFromISO: r.evaluatedAtISO.slice(0, 10),
        scopeToISO: r.planDiff.reachEndsISO,
        lever: LEVER_TO_LEDGER_LEVER[r.lever],
        // PROGRESS always raises demand on this axis, by the engine's own
        // vocabulary (decision-record.ts: "PROGRESS · evidence supports
        // advancing this lever"). Read from the decision, never re-measured
        // from a before/after plan snapshot this file never takes — there is
        // no snapshot to diff, because nothing has been written yet.
        direction: 'UP',
        evidence: r.evidenceIncluded,
        provenance: 'lib/adaptation/canonical-shadow/live-arbitration-proposals#winner',
        sourceMode: null,
        beforeState: { value: r.beforeValue },
        afterState: { value: r.proposedAfterValue, magnitude: r.magnitude },
        authority: 'COACHING_ADAPTATION',
        authorityVerdict: 'HELD',
        hold: {
          owner: 'lib/brain/mutation/authority.ts#COACHING_ADAPTATION',
          blocker: 'AUTOMATIC_ADAPTATION_AUTHORITY is false — the engine may persist a decision '
            + 'and raise a proposal, it may not write plan_workouts on its own judgement',
          expiresWhen: 'the runner accepts the proposal (RUNNER_ACCEPTED), or a later '
            + 'reassessment supersedes this evidence',
        },
        decision: 'PROGRESS',
        proposalId: r.idempotencyKey,
        proposal: r.planDiff,
        runnerResponse: 'PENDING',
        mutationOutcome: null,
        mutationViolations: [],
        explanation: explanationFor(r),
        modelVersion: PLAN_MUTATION_BOUNDARY_MODEL_VERSION,
        idempotencyKey: r.idempotencyKey,
      });
      out.push({
        lever: r.lever, idempotencyKey: r.idempotencyKey, kind: 'ARBITRATED_WINNER',
        detail: `arbitration ordered this lever ahead of its competitors this cycle: `
          + `${r.ledger.priority.order.join(' then ')}`,
        ledgerWrite: write.state, reassessmentWrite: null,
      });
      continue;
    }

    if (r.suppressedBy.reconsiderAtISO !== null) {
      /* ── A LOSING, SUPPORTED PROPOSAL · deferred, never dropped ─────────
       * Evidence supported it; arbitration gave the slot to something else,
       * or the phase declined it with a known end date. The reassessment
       * scheduler — not a second in-memory queue — is what makes this
       * survive past this process exiting. */
      const write = await scheduleReassessment({
        userUuid,
        kind: 'DEFERRAL',
        reasonCode: r.suppressedBy.rule,
        reasonDetail: r.suppressedBy.detail,
        assessOnISO: r.suppressedBy.reconsiderAtISO,
        requiredEvidence: [{ lever: r.lever, gap: r.gap }],
        evidence: r.evidenceIncluded,
        newestEvidenceISO: r.evidenceIncluded.length > 0
          ? r.evidenceIncluded[r.evidenceIncluded.length - 1]!.dateISO
          : null,
        planId: planIdFromVersion(r.planVersion),
        planLineageId: planIdFromVersion(r.planVersion),
        planVersion: r.planVersion,
        evidenceVersion: r.evidenceVersion,
        modelVersion: r.contractVersion,
        lever: r.lever,
        beforeValue: r.beforeValue,
        proposedAfterValue: r.proposedAfterValue,
        magnitude: r.magnitude,
        payload: { reason: r.reason, priority: r.ledger.priority, gap: r.gap },
        // Same key as the ledger would use for this evidence, so a reader can
        // tell "this deferral and that winner came from the same evaluation
        // cycle" without cross-referencing anything else.
        idempotencyKey: r.idempotencyKey,
        queuedAtISO: r.evaluatedAtISO.slice(0, 10),
      });
      out.push({
        lever: r.lever, idempotencyKey: r.idempotencyKey, kind: 'DEFERRED_SUPPORTED_LOSER',
        detail: `${r.suppressedBy.rule} · reconsidered on ${r.suppressedBy.reconsiderAtISO}`,
        ledgerWrite: null, reassessmentWrite: write.state,
      });
      continue;
    }

    /* ── SAFETY DEFEATED THIS PUSH · ledgered, never queued ──────────────
     * `reconsiderAtISO === null` is, by construction in `arbitration.ts`,
     * exactly the three safety bases. Ledgered as a HOLD so Rule 21's log
     * still answers "did the engine want to push and get told no" — but
     * nothing schedules asking again on a clock. Safety lifts it, not a date. */
    const write = await recordDecision({
      userUuid,
      planId: planIdFromVersion(r.planVersion),
      planLineageId: planIdFromVersion(r.planVersion),
      replacedPlanId: null,
      planVersion: r.planVersion,
      scope: r.affectedWorkoutIds.length > 0 ? 'WORKOUT' : 'PLAN',
      workoutIds: r.affectedWorkoutIds,
      scopeFromISO: r.evaluatedAtISO.slice(0, 10),
      scopeToISO: null,
      lever: LEVER_TO_LEDGER_LEVER[r.lever],
      direction: 'NEUTRAL',
      evidence: r.evidenceIncluded,
      provenance: 'lib/adaptation/canonical-shadow/live-arbitration-proposals#safety-held',
      sourceMode: null,
      beforeState: { value: r.beforeValue },
      afterState: null,
      authority: 'COACHING_ADAPTATION',
      authorityVerdict: 'HELD',
      hold: {
        owner: 'lib/adaptation/canonical/phase-priority.ts#SAFETY',
        blocker: r.suppressedBy.detail,
        expiresWhen: 'the Safety owner lifts the stop or the constraint — never a scheduled date',
      },
      decision: 'HOLD',
      proposalId: null,
      proposal: null,
      runnerResponse: null,
      mutationOutcome: null,
      mutationViolations: [],
      explanation: explanationFor(r),
      modelVersion: PLAN_MUTATION_BOUNDARY_MODEL_VERSION,
      idempotencyKey: `${r.idempotencyKey}:safety-held`,
    });
    out.push({
      lever: r.lever, idempotencyKey: r.idempotencyKey, kind: 'SAFETY_HELD_NOT_QUEUED',
      detail: r.suppressedBy.rule,
      ledgerWrite: write.state, reassessmentWrite: null,
    });
  }

  return out;
}
