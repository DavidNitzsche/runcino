/**
 * lib/plan/workout-proposals.ts · per-workout adaptation proposals.
 *
 * David 2026-06-04 · "I dont want to wake up to change runs · that
 * was annoying." This module replaces the silent-overnight-mutation
 * pattern with a proposal flow:
 *
 *   1. Evening cron runs detectAdaptations · for load-reducing
 *      kind, calls writeWorkoutProposals() instead of applyAdaptations
 *   2. Today view loads pending proposals via loadPendingProposals()
 *   3. Runner accepts via POST /api/plan/workout-proposals/:id/accept
 *      OR dismisses via /dismiss
 *   4. Accept · existing applyAdaptations path runs · plan_workouts
 *      gets the change + provenance chip
 *   5. Dismiss · proposal goes to 'dismissed', plan unchanged
 *
 * The runner sees the proposed change BEFORE it lands. Engine still
 * detects the signal; the runner stays in the driver's seat.
 */

import { describesEvidence } from '@/lib/brain/objective';
import { PROPOSABLE_KINDS } from '@/lib/plan/adaptation-authority';
import { pool } from '@/lib/db/pool';
import { attempt, rowOrNull } from '@/lib/db/read';
import { expireStaleWorkoutProposals, PROPOSAL_UNANSWERED_EXPIRY_DAYS } from './proposal-expiry';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { addDaysToDayKey } from '@/lib/runtime/day-key';
import { scheduleReassessment, type SchedulerResult } from '@/lib/ops/reassessment-scheduler';
import type { AdaptationAction, AdaptationTrigger } from './adapt';
import { stripResearchCitations } from './strip-citations';
import type { RepricePayload } from './reprice-payload';
import { actionFromAdaptation } from '@/lib/brain/proposal/generate/from-adaptation';
import { serializeAction, type StoredAction } from '@/lib/brain/proposal/serialize';
import type { ActionRowKind } from '@/lib/brain/proposal/write';
import { recordDecision, type LedgerWrite } from '@/lib/brain/ledger/decision-ledger';
import { PLAN_MUTATION_BOUNDARY_MODEL_VERSION, type LedgerLever } from '@/lib/brain/ledger/ledger-entry';

export interface PendingProposal {
  id: number;
  userUuid: string;
  planWorkoutId: string;
  workoutDateISO: string;
  // PROPOSEUP-1 (2026-09-05) · `mark_upgrade` joins the four. The union used
  // to be exactly the load-reducing and neutral kinds, which is the type-level
  // shadow of the same defect `PROPOSABLE_KINDS` had: the proposal lane could
  // not describe an increase, so nothing could have travelled down it even if
  // the seam had let something through.
  //
  // REANCHORPROPOSES-1 (2026-09-05) · `reprice` joins them, and it is the first
  // member that is NOT an `AdaptationAction['kind']`. It cannot be: a repricing
  // is one decision over the whole remaining block, and `AdaptationAction` is
  // per-workout by construction. It therefore does not travel through
  // `writeWorkoutProposals` or `PROPOSABLE_KINDS` at all — `lib/plan/
  // reanchor-proposal.ts` is its writer and the accept route branches on it
  // before it builds an action. See `lib/plan/reprice-payload.ts` for why one
  // coordinated proposal beats seventy-seven cards.
  //
  // ACTIONCOMPLETE-2 (2026-09-05) · `ActionRowKind` joins them, and it is the
  // widening that makes HOLD and SAFETY_STOP possible at all. Every member of
  // it is `Lowercase<ActionKind>` — derived from the union rather than written
  // out, so a kind added to `BrainAction` is a legal row value the same day and
  // this type cannot drift from the vocabulary it is meant to mirror. The six
  // legacy words stay because rows carrying them are in production; four of
  // them (`downgrade`, `shave`, `reschedule`, `field_test`) are engine words
  // with no `BrainAction` of the same spelling, so they are not redundant.
  actionKind:
    | 'downgrade' | 'shave' | 'reschedule' | 'field_test' | 'mark_upgrade' | 'reprice'
    | ActionRowKind;
  actionPayload: {
    newType?: string;
    newDate?: string;
    shaveFraction?: number;
    /**
     * The whole coordinated repricing, present only on a `reprice` row.
     *
     * `action_payload` is jsonb with no constraint, so this needed no
     * migration — the column could always have held it, and only the TYPE said
     * a proposal must be about a single workout.
     */
    reprice?: RepricePayload;
    /**
     * The distance an upward proposal would set. Absent on every other kind.
     *
     * `action_payload` is jsonb and carries no constraint, so this needed no
     * migration: the column could always have held it, and only the TYPE said
     * a proposal may not describe more work. That is the shape of the whole
     * finding, in one field.
     */
    newDistanceMi?: number;
    /**
     * ACTIONCOMPLETE-1 (2026-09-05) · THE DECISION ITSELF, versioned.
     *
     * Present on rows written from 2026-09-05 onward. Absent on the seven that
     * predate it, which is why `actionFromPending` still carries its
     * reconstruction path — an absent action is a row from an older writer,
     * never a row that decided nothing (Rule 11).
     */
    action?: StoredAction;
    why?: string;
  };
  reason: string;
  evidence: Record<string, unknown>;
  status: 'pending';
  createdAt: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * COMPETINGPROPOSAL-1 (2026-09-07) · ARBITRATION, NOT SILENCE.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * David, verbatim: "'Silently skipped by dedup' is not arbitration. Competing
 * proposals need a durable winner, loser, reason and reassessment date."
 *
 * Before this, the dedup check below was `if (dup) continue` — an existing
 * pending row on this `plan_workout_id` made every OTHER action detected for
 * it that night evaporate with no record anywhere. The runner's plan never
 * moved either way (`AUTOMATIC_ADAPTATION_AUTHORITY` is false), but the
 * LOSING JUDGEMENT vanished — Rule 11's worst shape, a decision and a dropped
 * read collapsing into the same nothing.
 *
 * This does not stand up a second arbitrator. It reuses the exact two
 * mechanisms `lib/adaptation/canonical-shadow/live-arbitration-proposals.ts`
 * already wired for lever-vs-lever competition, at workout granularity
 * instead of whole-plan granularity:
 *
 *   · DEFER_INCOMING — the ordinary case. An existing pending proposal already
 *     occupies this workout's one decision slot; the new action is not
 *     dropped, it is queued on `reassessment_schedule` (kind 'DEFERRAL') to be
 *     asked again once the pending card resolves or expires — the same
 *     "supported loser" lane the sibling file uses for a deferred lever.
 *     Nothing is ledgered, because nothing was decided against; it was
 *     deferred.
 *
 *   · SUPERSEDE_EXISTING — the one named exception. CLAUDE.md's own "SAFETY
 *     defeats every PUSH — no exception, ever" (the exact phrase
 *     `live-arbitration-proposals.ts`'s header cites) is not new judgement
 *     invented here; applying it at workout granularity is the extension. An
 *     EVIDENCED load-reducing action (`describesEvidence` already gates this
 *     everywhere else in this file — see below) that targets a workout
 *     currently holding a pending `mark_upgrade` retires that push:
 *     `status = 'superseded'`, guarded on `status = 'pending'` so a race with
 *     the runner's own tap can never double-resolve a row. The retired push is
 *     ledgered on `plan_decision_ledger` with `decision: 'HOLD'`, mirroring
 *     `SAFETY_HELD_NOT_QUEUED` exactly: held, not scheduled, because safety
 *     lifts it, never a date.
 *
 * Neither branch mutates `plan_workouts`. Both are best-effort against tables
 * that are NOT applied to production today (migrations 166/167) —
 * `recordDecision` and `scheduleReassessment` already report `table_absent`
 * rather than throwing, and this function passes that state straight through
 * as a logged line rather than manufacturing a fake success (Rule 11, Rule 19).
 */

/**
 * `AdaptationAction['kind']` → the ledger's controlled lever vocabulary.
 *
 * Every kind here changes ONE session, never a weekly axis, so `VOLUME` /
 * `PACE` / `LONG_RUN` — which mean the WEEKLY lever in `ledger-entry.ts`'s own
 * vocabulary, per `live-arbitration-proposals.ts`'s `LEVER_TO_LEDGER_LEVER` —
 * would overstate what moved. `reschedule` maps onto `SCHEDULE` by name.
 * `recompute_paces` / `mark_dirty` / `note` / `field_test` ask for nothing
 * durable at this granularity, hence `RECORD_ONLY`.
 */
function ledgerLeverForActionKind(kind: AdaptationAction['kind']): LedgerLever {
  switch (kind) {
    case 'reschedule': return 'SCHEDULE';
    case 'downgrade':
    case 'shave':
    case 'mark_upgrade':
    case 'reshape':
      return 'SESSION_SHAPE';
    default:
      return 'RECORD_ONLY';
  }
}

/** One outcome per competing-proposal check. Never silent. */
export interface CompetingProposalOutcome {
  readonly outcome: 'DEFER_INCOMING' | 'SUPERSEDE_EXISTING';
  readonly reassessmentWrite: SchedulerResult<string>['state'] | null;
  readonly ledgerWrite: LedgerWrite['state'] | null;
  readonly detail: string;
}

/**
 * Arbitrate ONE competing pair: an already-pending proposal on this workout
 * (`existing`) against the action just detected for the same workout
 * (`incoming`). Never throws — every write inside is best-effort, matching
 * the loop's own try/catch and every other write in this file.
 */
export async function arbitrateCompetingWorkoutProposal(args: {
  userUuid: string;
  workoutId: string;
  dateISO: string;
  todayISO: string;
  incomingKind: AdaptationAction['kind'];
  incomingWhy: string | null;
  incomingIsEvidencedSafetyDecline: boolean;
  existing: { id: number; action_kind: string; created_at: Date };
}): Promise<CompetingProposalOutcome> {
  const {
    userUuid, workoutId, dateISO, todayISO, incomingKind, incomingWhy,
    incomingIsEvidencedSafetyDecline, existing,
  } = args;

  const existingIsPush = existing.action_kind === 'mark_upgrade';

  /* Set when the safety-override branch below finds the row it meant to
   * retire already gone (a race with the runner's own tap, or a prior
   * sweep). Rather than a silent early return — which would be this exact
   * defect in miniature — that case falls through to the shared
   * DEFER_INCOMING path at the bottom, still reasoned and still scheduled. */
  let raceNote: string | null = null;

  if (incomingIsEvidencedSafetyDecline && existingIsPush) {
    /* ── SUPERSEDE_EXISTING · safety defeats the pending push ──────────── */
    const retired = await rowOrNull<{ id: number }>(
      'plan/workout-proposals · competing-proposal supersede',
      pool.query<{ id: number }>(
        `UPDATE plan_workout_proposals
            SET status = 'superseded', resolved_at = NOW()
          WHERE id = $1 AND status = 'pending'
          RETURNING id`,
        [existing.id],
      ),
    );

    if (retired === null) {
      // The UPDATE itself failed (a DB hiccup, not a race) — logged by
      // rowOrNull's own `attempt`. Rule 11: this is NOT the same fact as
      // "no row matched the WHERE clause" below, even though both currently
      // fall through to the same DEFER_INCOMING path — the note says which
      // one happened rather than collapsing them.
      raceNote = `the supersede write for existing proposal #${existing.id} failed outright `
        + '(not a race · the query itself could not run) · deferred instead of retired';
    } else if (retired === undefined) {
      // Raced with the runner's own accept/dismiss, or a prior sweep already
      // resolved it between the SELECT above and this UPDATE. The slot is
      // either already free or already answered — either way there is
      // nothing left to supersede. This does NOT return early: doing so
      // silently (no ledger, no reassessment) would be the exact defect this
      // function exists to remove, just relocated into a narrower race
      // window. Instead fall through to the ordinary DEFER_INCOMING path so
      // the incoming action is still durably queued rather than dropped.
      raceNote = `existing proposal #${existing.id} was no longer pending by the time this ran `
        + '(resolved between the dedup read and the supersede write) · deferred instead of retired';
    } else {
      const write = await recordDecision({
        userUuid,
        planId: null,
        planLineageId: `workout-proposal-competing:${workoutId}`,
        replacedPlanId: null,
        planVersion: `workout-proposal-competing:${workoutId}:none`,
        scope: 'WORKOUT',
        workoutIds: [workoutId],
        scopeFromISO: todayISO,
        scopeToISO: null,
        lever: ledgerLeverForActionKind('mark_upgrade'),
        direction: 'NEUTRAL',
        evidence: [],
        provenance: 'lib/plan/workout-proposals#competing-proposal-safety-override',
        sourceMode: null,
        beforeState: { pendingProposalId: existing.id, actionKind: existing.action_kind },
        afterState: null,
        authority: 'COACHING_ADAPTATION',
        authorityVerdict: 'HELD',
        hold: {
          owner: 'lib/plan/workout-proposals.ts#arbitrateCompetingWorkoutProposal',
          blocker: `superseded by an evidenced ${incomingKind} on the same workout: `
            + `${incomingWhy ?? '(no reason recorded)'}`,
          expiresWhen: 'the safety concern clears · never a scheduled date, per '
            + '"SAFETY defeats every PUSH, no exception, ever"',
        },
        decision: 'HOLD',
        proposalId: String(existing.id),
        proposal: { supersededByActionKind: incomingKind },
        runnerResponse: null,
        mutationOutcome: null,
        mutationViolations: [],
        explanation: `Pending proposal #${existing.id} (${existing.action_kind}, raised `
          + `${existing.created_at.toISOString()}) was superseded before the runner answered it: `
          + `an evidenced ${incomingKind} for the same workout on ${dateISO} outranks a push under `
          + 'the standing safety-over-push rule.',
        modelVersion: PLAN_MUTATION_BOUNDARY_MODEL_VERSION,
        idempotencyKey: `workout-proposal-competing:${workoutId}:${existing.id}:superseded`,
      });

      return {
        outcome: 'SUPERSEDE_EXISTING',
        reassessmentWrite: null,
        ledgerWrite: write.state,
        detail: `retired pending push #${existing.id} · ${write.state}`,
      };
    }
  }

  /* ── DEFER_INCOMING · the ordinary case (also reached when the
   * safety-override above raced and found nothing left to retire) ───────
   * An existing proposal already occupies this workout's one decision slot.
   * The incoming action is not dropped — it is queued to be asked again once
   * the existing card resolves or expires, using the same runway
   * (`PROPOSAL_UNANSWERED_EXPIRY_DAYS`) the existing card itself is held to. */
  const assessOnISO = addDaysToDayKey(todayISO, PROPOSAL_UNANSWERED_EXPIRY_DAYS);
  const write = await scheduleReassessment({
    userUuid,
    kind: 'DEFERRAL',
    reasonCode: 'competing_workout_proposal',
    reasonDetail: `A proposal is already pending for this workout (#${existing.id}, `
      + `${existing.action_kind}, raised ${existing.created_at.toISOString()}). This session's `
      + `${incomingKind}${incomingWhy ? ` ("${incomingWhy}")` : ''} was not raised, to avoid `
      + 'presenting two competing decisions for one workout. Reassess once the pending proposal '
      + `is resolved or expires.${raceNote ? ` (${raceNote})` : ''}`,
    assessOnISO,
    overdueAfterISO: addDaysToDayKey(assessOnISO, 3),
    requiredEvidence: [{ workoutId, blockedByProposalId: existing.id }],
    evidence: [],
    newestEvidenceISO: todayISO,
    planId: null,
    planLineageId: `workout-proposal-competing:${workoutId}`,
    planVersion: `workout-proposal-competing:${workoutId}:none`,
    lever: ledgerLeverForActionKind(incomingKind),
    beforeValue: null,
    proposedAfterValue: null,
    magnitude: null,
    payload: {
      workoutId, incomingActionKind: incomingKind,
      blockedByProposalId: existing.id, blockedByActionKind: existing.action_kind,
      ...(raceNote ? { raceNote } : {}),
    },
    idempotencyKey: `workout-proposal-competing:${workoutId}:${existing.id}:${incomingKind}`,
    queuedAtISO: todayISO,
  }).catch((e: unknown): SchedulerResult<string> => (
    { state: 'failed', why: e instanceof Error ? e.message : String(e) }
  ));

  return {
    outcome: 'DEFER_INCOMING',
    reassessmentWrite: write.state,
    ledgerWrite: null,
    detail: `deferred ${incomingKind} behind pending #${existing.id} · ${write.state}`
      + (raceNote ? ` · ${raceNote}` : ''),
  };
}

/**
 * Write proposals for each adaptation action. Idempotent · checks for
 * an existing pending row on the same plan_workout_id before insert.
 * Returns the number of proposals written.
 */
export async function writeWorkoutProposals(
  userUuid: string,
  actions: AdaptationAction[],
  triggers: AdaptationTrigger[],
): Promise<number> {
  /** Load-reducing proposals refused for naming no fact. Reported, never dropped. */
  const skippedForUnevidencedDecline: string[] = [];
  // Most actions target one or more workoutIds. We write one proposal
  // per (workoutId, action) pair. The triggers array carries the
  // human-readable reason · we use the first matching trigger.
  let count = 0;
  for (const action of actions) {
    const workoutIds = action.workoutIds ?? [];
    if (workoutIds.length === 0) continue;

    // Map action.kind to the proposal_kind union. Only downgrade /
    // shave / reschedule / field_test are propose-worthy · mark_dirty
    // and recompute_paces are internal bookkeeping and don't need
    // runner approval.
    // PROPOSEUP-1 (2026-09-05) · one list, imported. This was a second copy of
    // `PROPOSABLE_KINDS` written out longhand, and two copies of one set is a
    // Rule 16 collision waiting to drift: adding an upward kind to the seam's
    // list while this one still refused it would have routed the action to a
    // writer that silently drops it, which is the exact evaporation the seam's
    // own comment warns about.
    if (!PROPOSABLE_KINDS.has(action.kind)) {
      continue;
    }

    // 2026-08-17 · prefer the trigger that PRODUCED this action (the
    // sourceTrigger tag) so a field-test proposal carries the field-test
    // reason. The second rung used to be `readiness_pullback`, from when that
    // was the modal proposal; it was deleted 2026-09-02 and the fallback is
    // now just "the first trigger in the pass", which is what the third rung
    // always said anyway.
    const triggerForAction = triggers.find((t) => t.kind === action.sourceTrigger)
      ?? triggers[0];
    // 2026-08-17 · citation scrub at the write site — the proposal
    // reason + why render verbatim on the Today banner.
    const reason = stripResearchCitations(
      triggerForAction?.reason ?? action.why ?? 'Engine proposed an adaptation.',
    );
    const evidence = (triggerForAction?.evidence ?? {}) as Record<string, unknown>;

    for (const workoutId of workoutIds) {
      try {
        // Read the workout's date for the row + sealed-day check.
        /* PROPOSEUP-2 (2026-09-05) · read the session's TYPE and DISTANCE too,
         * not just its date. Two things needed them and neither could have
         * them: the card cannot say "take 17% off" without a denominator, and
         * the staleness check cannot tell whether the session changed under a
         * pending proposal without knowing what it was. Both were reading an
         * evidence blob that only some triggers happened to populate. */
        const row = (await pool.query<{
          date_iso: string; type: string; distance_mi: string | number | null;
        }>(
          `SELECT date_iso, type, distance_mi FROM plan_workouts WHERE id = $1 LIMIT 1`,
          [workoutId],
        ).catch(() => ({ rows: [] }))).rows[0];
        if (!row) continue;

        // Don't propose for a date that's already past · the runner
        // either did the workout or didn't, and either way swapping
        // it is a no-op.
        const today = await runnerToday(userUuid);
        if (row.date_iso < today) continue;

        // Dedupe · skip if a pending proposal already exists for this
        // workout. Idempotent re-run.
        //
        // 2026-08-25 · swallowed-failure sweep · fails CLOSED. This was
        // `.catch(() => ({ rows: [] })).rows[0]`, so a database blip answered
        // "no pending proposal on record" — the one answer that INSERTS. The
        // table has no unique key on plan_workout_id, and the evening cron
        // re-runs, so the runner opened Today to the same decision card two
        // and three times over. A proposal skipped tonight comes back with
        // tomorrow's detection; a stack of duplicate cards has to be cleared
        // by hand.
        const dup = await rowOrNull<{ id: number; action_kind: string; created_at: Date }>(
          'plan/workout-proposals · pending-proposal dedup',
          pool.query<{ id: number; action_kind: string; created_at: Date }>(
            `SELECT id, action_kind, created_at FROM plan_workout_proposals
            WHERE plan_workout_id = $1 AND status = 'pending'
            LIMIT 1`,
            [workoutId],
          ),
        );
        if (dup === null) continue;   // read failed · assume already proposed

        /* ── THE OBJECTIVE, ON THE LIVE PATH (2026-09-05) ─────────────────
         *
         * `lib/brain/objective.ts` says a decline requires evidence just as a
         * push does. This is the one place in production where a decline
         * reaches the runner, so it is where that clause has to bite.
         *
         * A load-reducing proposal whose `why` asserts a disposition rather
         * than a fact ("safer", "this looks aggressive") is DOWNGRADED to an
         * observational note rather than shown as a coaching decision. It is
         * not dropped: Rule 11 says a dropped action is a lost fact, so the
         * intent row still gets written by the caller's `recorded` lane.
         *
         * Upward kinds are exempt by construction, because they are not
         * declining anything.
         *
         * Computed BEFORE the dedup branch below because COMPETINGPROPOSAL-1's
         * safety-override needs to know whether the incoming action is an
         * EVIDENCED decline, not just a load-reducing one.
         */
        const reducesLoad = action.kind === 'downgrade' || action.kind === 'shave';
        const isEvidencedDecline = reducesLoad && describesEvidence(action.why ?? '');

        /* ── COMPETINGPROPOSAL-1 (2026-09-07) · ARBITRATION, NOT SILENCE ────
         * See the header comment above `arbitrateCompetingWorkoutProposal`
         * for the full rationale. `dup` is durable already (it is a row in
         * this very table); what used to be missing is a durable, reasoned
         * account of what happens to the action that lost the slot. */
        let supersededProposal: { id: number; actionKind: string; createdAtISO: string } | null = null;
        if (dup) {
          const arbitration = await arbitrateCompetingWorkoutProposal({
            userUuid,
            workoutId,
            dateISO: row.date_iso,
            todayISO: today,
            incomingKind: action.kind,
            incomingWhy: action.why ?? null,
            incomingIsEvidencedSafetyDecline: isEvidencedDecline,
            existing: dup,
          }).catch((e: unknown) => {
            console.error(
              `[workout-proposals] competing-proposal arbitration threw for workout ${workoutId} `
              + `· falling back to the ordinary dedup skip · `
              + `${e instanceof Error ? e.message : String(e)}`,
            );
            return null;
          });

          if (arbitration === null) continue;  // arbitration itself broke · fail closed, as before

          console.log(
            `[workout-proposals] competing proposal on ${workoutId} · ${arbitration.outcome} · `
            + `${arbitration.detail}`,
          );

          if (arbitration.outcome === 'DEFER_INCOMING') continue;
          // SUPERSEDE_EXISTING · the old pending push is retired; fall through
          // and let this action take the (now-free) pending slot.
          supersededProposal = {
            id: dup.id, actionKind: dup.action_kind, createdAtISO: dup.created_at.toISOString(),
          };
        }

        if (reducesLoad && !isEvidencedDecline) {
          skippedForUnevidencedDecline.push(
            `${action.kind} on ${workoutIds.join(',')}: "${action.why ?? ''}"`,
          );
          continue;
        }

        /* An upgrade names the distance it is proposing. Without it the card
         * reads "Add to Thursday", the accept path finds no target to write,
         * and the runner taps a button that cannot do anything — a proposable
         * kind that is still inert, which is the failure PROPOSEUP-1 was meant
         * to end rather than relocate. */
        const bumpForRow = (action.bumps ?? []).find((b) => b.workoutId === workoutId);

        /* ── ACTIONCOMPLETE-1 (2026-09-05) · THE DECISION, STATED ──────────
         *
         * The four legacy fields below are a LOSSY SUMMARY: everything
         * downstream that wants a `BrainAction` reconstructs one by guessing
         * which of them the writer happened to populate, and no combination of
         * them could ever carry a rep count, a recovery interval or a
         * coordinated part list.
         *
         * So the action is stated here, in the same jsonb column — the same
         * trick `reprice` and `newDistanceMi` already used, which is why this
         * needed no migration. `actionFromPending` prefers it and falls back to
         * its own reconstruction, so the rows already in production are
         * unaffected.
         *
         * Rule 11: a kind with no translation stores NO action rather than a
         * no-op one. A reader that finds none reconstructs as before.
         */
        const brainAction = actionFromAdaptation(action, {
          planWorkoutId: workoutId,
          dateISO: row.date_iso,
          type: row.type,
          distanceMi: row.distance_mi === null ? null : Number(row.distance_mi),
        });

        const payload = {
          newType: action.newType ?? null,
          newDate: action.newDate ?? null,
          shaveFraction: action.shaveFraction ?? null,
          newDistanceMi: bumpForRow?.newDistanceMi ?? null,
          why: stripResearchCitations(action.why),
          ...(brainAction ? { action: serializeAction(brainAction) } : {}),
        };

        /* The session as it stands, recorded ON THE PROPOSAL. This is the
         * `before` the accept path compares against: if the session is moved,
         * resized or retyped while the card is pending, the decision was about
         * something that no longer exists and accepting it would write over a
         * plan it never saw. */
        const evidenceForRow = {
          ...evidence,
          planned_type: row.type,
          planned_distance_mi: row.distance_mi === null ? null : Number(row.distance_mi),
          /* COMPETINGPROPOSAL-1 · this row's own durable record of what it
           * beat, so a reader of `plan_workout_proposals` alone — without
           * cross-referencing `plan_decision_ledger` — can see this was not
           * the only proposal raised for this workout tonight. */
          ...(supersededProposal ? { superseded_proposal: supersededProposal } : {}),
        };

        const inserted = (await pool.query<{ id: number }>(
          `INSERT INTO plan_workout_proposals
             (user_uuid, plan_workout_id, workout_date_iso, action_kind,
              action_payload, reason, evidence, source)
           VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7::jsonb, 'cron_evening')
           RETURNING id`,
          [userUuid, workoutId, row.date_iso, action.kind,
           JSON.stringify(payload), reason, JSON.stringify(evidenceForRow)],
        )).rows[0];
        count++;

        /* ── PROPOSALEXPIRE-1 (2026-09-06) · THE UNANSWERED-CARD PROMISE ────
         *
         * `PROPOSAL_EXPIRATION` has been a real `ReassessmentKind` since
         * migration 167 was drafted and had no production caller — nothing
         * ever asked the durable scheduler to track "this card must not
         * stand forever". `proposal-expiry.ts`'s own direct expiry (14 days,
         * reused here rather than re-derived — Rule 16) still owns the
         * runner-facing `plan_workout_proposals.status`; this is the second,
         * independent surface the sweep's own overdue-alert machinery can
         * see. Resolved on both accept (`[id]/accept`) and decline
         * (`[id]/dismiss`) before it ever reaches its own overdue date, so
         * the sweep's auto-expire branch never claims "not applied" about a
         * card the runner actually answered.
         *
         * Best-effort: a scheduler outage must not cost the proposal itself,
         * which just committed above. */
        if (inserted?.id != null) {
          const dueISO = addDaysToDayKey(row.date_iso, PROPOSAL_UNANSWERED_EXPIRY_DAYS);
          const res = await scheduleReassessment({
            userUuid,
            kind: 'PROPOSAL_EXPIRATION',
            reasonCode: 'workout_proposal_unanswered',
            reasonDetail: `proposal #${inserted.id} (${action.kind} on ${row.date_iso}) must be `
              + `answered within ${PROPOSAL_UNANSWERED_EXPIRY_DAYS} days or it no longer stands`,
            assessOnISO: dueISO,
            overdueAfterISO: addDaysToDayKey(dueISO, 3),
            planVersion: `workout-proposal:${inserted.id}:none`,
            lever: 'RECORD_ONLY',
            payload: { proposalId: inserted.id, planWorkoutId: workoutId },
            idempotencyKey: `workout-proposal:${inserted.id}`,
            queuedAtISO: today,
          }).catch((e: unknown) => ({ state: 'failed' as const, why: e instanceof Error ? e.message : String(e) }));
          if (res.state !== 'ok') {
            console.log(`[workout-proposals] expiration promise not scheduled · ${res.state} · ${res.why}`);
          }
        }
      } catch {
        // Single-proposal failure shouldn't stop the rest of the batch
      }
    }
  }
  // Rule 11: a refusal that nobody can see is indistinguishable from nothing
  // having happened. My first cut collected these and returned, which is the
  // swallowed-failure shape this repo has a gate for.
  if (skippedForUnevidencedDecline.length > 0) {
    console.log(
      `[workout-proposals] ${skippedForUnevidencedDecline.length} load-reducing proposal(s) `
      + 'withheld: the reason named a disposition rather than a fact, so the runner would have '
      + `been asked to do less for no stated evidence · ${skippedForUnevidencedDecline.join(' | ')}`,
    );
  }

  return count;
}

/**
 * A read of the proposal table that says which of the three things happened.
 *
 * Rule 11: "don't know", "measured zero" and "the read failed" are three
 * facts. The failure branch carries NO `proposals` field, so a caller cannot
 * spend an empty list it never actually read — the same enforcement posture as
 * `NormalReading<T>` in `lib/training/normal-window.ts`.
 *
 * This was `Promise<PendingProposal[]>` with `.catch(() => ({ rows: [] }))`
 * behind it, which answered a database outage with the sentence "you have no
 * pending decisions". On the ONE surface whose entire job is to carry a
 * decision to the runner, that is the worst available failure: it does not
 * look broken, it looks like the coach has nothing to say.
 */
export type ProposalRead =
  | { readonly ok: true; readonly proposals: PendingProposal[] }
  | { readonly ok: false; readonly error: Error };

/**
 * Load pending proposals for the runner's upcoming workouts.
 *
 * ENSURES ITS OWN PRECONDITION (Rule 23) rather than assuming the nightly
 * sweep ran: `expireStaleWorkoutProposals` is idempotent and cheap, so calling
 * it here costs nothing when the cron already did the work and saves the read
 * from serving a past-dated row when it did not. What changed is that a FAILED
 * expiry is now reported instead of vanishing into `.catch(() => {})` — the
 * ambiguity that left production row 6 pending for eleven days with no way to
 * tell "nobody called" from "the write failed".
 *
 * An expiry failure does not fail the read. The SELECT below filters
 * past-dated rows itself, so the runner still sees the right list; what the
 * failure costs is the row's status in the table, and that is a log line, not
 * a blank screen.
 */
export async function loadPendingProposals(
  userUuid: string,
): Promise<ProposalRead> {
  const swept = await expireStaleWorkoutProposals(userUuid);
  if (!swept.ok) {
    console.error(
      '[workout-proposals] expiry sweep FAILED · pending rows may outlive their '
      + 'workout date and block the dedupe that stops a duplicate card · '
      + swept.error.message,
    );
  }

  // The runner's day, not the server's. `CURRENT_DATE` is server-clock UTC and
  // rolls over at 5pm for a Pacific runner, which hid TODAY'S proposal from
  // him for the last seven hours of every day. See `lib/runtime/runner-tz.ts`.
  const today = await runnerToday(userUuid);

  const read = await attempt(
    'plan/workout-proposals · pending list',
    pool.query<{
      id: number;
      user_uuid: string;
      plan_workout_id: string;
      workout_date_iso: string;
      action_kind: string;
      action_payload: PendingProposal['actionPayload'];
      reason: string;
      evidence: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT id, user_uuid::text AS user_uuid, plan_workout_id,
              workout_date_iso, action_kind, action_payload, reason,
              evidence, created_at
         FROM plan_workout_proposals
        WHERE user_uuid = $1::uuid
          AND status = 'pending'
          AND workout_date_iso >= $2
        ORDER BY workout_date_iso ASC, created_at ASC`,
      [userUuid, today],
    ),
  );
  if (!read.ok) return { ok: false, error: read.error };

  return { ok: true, proposals: read.value.rows.map(toPending) };
}

/**
 * Every proposal this runner has ever been raised, newest first, whatever
 * became of it.
 *
 * The decision-history surface's only source for the per-workout lane. Kept
 * beside the pending read so the two cannot grow different ideas of what a row
 * means (Rule 16), and sharing `toPending` for exactly that reason.
 */
export async function loadProposalHistory(
  userUuid: string,
  limit = 50,
): Promise<
  | { readonly ok: true; readonly rows: readonly (PendingProposal & { storedStatus: string; resolvedAtISO: string | null })[] }
  | { readonly ok: false; readonly error: Error }
> {
  const read = await attempt(
    'plan/workout-proposals · history',
    pool.query<{
      id: number;
      user_uuid: string;
      plan_workout_id: string;
      workout_date_iso: string;
      action_kind: string;
      action_payload: PendingProposal['actionPayload'];
      reason: string;
      evidence: Record<string, unknown>;
      created_at: Date;
      status: string;
      resolved_at: Date | null;
    }>(
      `SELECT id, user_uuid::text AS user_uuid, plan_workout_id,
              workout_date_iso, action_kind, action_payload, reason,
              evidence, created_at, status, resolved_at
         FROM plan_workout_proposals
        WHERE user_uuid = $1::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [userUuid, Math.max(1, Math.min(200, limit))],
    ),
  );
  if (!read.ok) return { ok: false, error: read.error };

  return {
    ok: true,
    rows: read.value.rows.map((r) => ({
      ...toPending(r),
      storedStatus: r.status,
      resolvedAtISO: r.resolved_at ? r.resolved_at.toISOString() : null,
    })),
  };
}

/** One row shape, one translation. Both reads above use it. */
function toPending(r: {
  id: number;
  user_uuid: string;
  plan_workout_id: string;
  workout_date_iso: string;
  action_kind: string;
  action_payload: PendingProposal['actionPayload'];
  reason: string;
  evidence: Record<string, unknown>;
  created_at: Date;
}): PendingProposal {
  return {
    id: r.id,
    userUuid: r.user_uuid,
    planWorkoutId: r.plan_workout_id,
    workoutDateISO: r.workout_date_iso,
    actionKind: r.action_kind as PendingProposal['actionKind'],
    actionPayload: r.action_payload ?? {},
    reason: r.reason,
    evidence: r.evidence ?? {},
    status: 'pending',
    createdAt: r.created_at.toISOString(),
  };
}

/**
 * Read one pending proposal WITHOUT consuming it.
 *
 * `acceptProposal` marks the row accepted in the same statement that returns
 * it, which is correct for the apply step and wrong for anything that needs to
 * look before it leaps. The staleness check needs to look: a proposal raised
 * against a plan that has since been rebuilt must stay pending rather than be
 * spent on a plan it was not reasoned about.
 *
 * THREE STATES, because there are three (Rule 11). A read that failed is not a
 * proposal that is missing, and the accept route answers them differently — a
 * 500 the runner can retry against a 404 he cannot. My first cut of this
 * function swallowed the failure into an empty row set, which is exactly the
 * defect the swallow ratchet exists to catch, and it caught it.
 */
export type ProposalLookup =
  | { readonly ok: true; readonly proposal: PendingProposal | null }
  | { readonly ok: false };

export async function loadPendingProposalById(
  userUuid: string,
  proposalId: number,
): Promise<ProposalLookup> {
  const r = await rowOrNull<{
    id: number;
    user_uuid: string;
    plan_workout_id: string;
    workout_date_iso: string;
    action_kind: string;
    action_payload: PendingProposal['actionPayload'];
    reason: string;
    evidence: Record<string, unknown>;
    created_at: Date;
  }>(
    'workout-proposals/loadPendingProposalById',
    pool.query(
      `SELECT id, user_uuid, plan_workout_id, workout_date_iso::text AS workout_date_iso,
              action_kind, action_payload, reason, evidence, created_at
         FROM plan_workout_proposals
        WHERE id = $1 AND user_uuid = $2::uuid AND status = 'pending'`,
      [proposalId, userUuid],
    ),
  );

  if (r === null) return { ok: false };
  return { ok: true, proposal: r === undefined ? null : toPending(r) };
}

/**
 * Mark a proposal as accepted · returns the action so the route can
 * call applyAdaptations with the original payload.
 *
 * Returns null when the proposal doesn't exist, isn't owned by this
 * user, or isn't pending (already accepted/dismissed/expired).
 */
export async function acceptProposal(
  userUuid: string,
  proposalId: number,
): Promise<PendingProposal | null> {
  const r = (await pool.query<{
    id: number;
    plan_workout_id: string;
    workout_date_iso: string;
    action_kind: string;
    action_payload: PendingProposal['actionPayload'];
    reason: string;
    evidence: Record<string, unknown>;
    created_at: Date;
  }>(
    `UPDATE plan_workout_proposals
        SET status = 'accepted', resolved_at = NOW()
      WHERE id = $1
        AND user_uuid = $2::uuid
        AND status = 'pending'
      RETURNING id, plan_workout_id, workout_date_iso, action_kind,
                action_payload, reason, evidence, created_at`,
    [proposalId, userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];

  if (!r) return null;
  return {
    id: r.id,
    userUuid,
    planWorkoutId: r.plan_workout_id,
    workoutDateISO: r.workout_date_iso,
    actionKind: r.action_kind as PendingProposal['actionKind'],
    actionPayload: r.action_payload ?? {},
    reason: r.reason,
    evidence: r.evidence ?? {},
    status: 'pending',
    createdAt: r.created_at.toISOString(),
  };
}

/**
 * An ACCEPTED proposal, so it can be put back.
 *
 * V5UNDO-1 (2026-09-05) · `undoWritesFor` has computed the inverse of an
 * accepted action since it was written, and `accept.ts` reports the answer to
 * the runner as `undoable: true`. Nothing could ever apply it: the function had
 * exactly two callers, one of which was its own test. A promise the response
 * makes and no path keeps is the shape CLAUDE.md Rule 21 names, on the half of
 * the bargain the owner said the whole lane rests on — "approval is not the
 * control mechanism; reversibility is".
 *
 * The sibling of `loadPendingProposalById`, scoped to `accepted` because that
 * is the only status an undo applies to. Three states for the same reason
 * (Rule 11): a failed read is not a proposal that was never accepted.
 */
export async function loadAcceptedProposalById(
  userUuid: string,
  proposalId: number,
): Promise<ProposalLookup> {
  const r = await rowOrNull<{
    id: number;
    user_uuid: string;
    plan_workout_id: string;
    workout_date_iso: string;
    action_kind: string;
    action_payload: PendingProposal['actionPayload'];
    reason: string;
    evidence: Record<string, unknown>;
    created_at: Date;
  }>(
    'workout-proposals/loadAcceptedProposalById',
    pool.query(
      `SELECT id, user_uuid, plan_workout_id, workout_date_iso::text AS workout_date_iso,
              action_kind, action_payload, reason, evidence, created_at
         FROM plan_workout_proposals
        WHERE id = $1 AND user_uuid = $2::uuid AND status = 'accepted'`,
      [proposalId, userUuid],
    ),
  );
  if (r === null) return { ok: false };
  return { ok: true, proposal: r === undefined ? null : toPending(r) };
}

/**
 * Three states, because there are three: the row was reopened, the row was not
 * there to reopen, or the write failed. A caller reopening a card is already
 * handling a failure, and collapsing the last two would hide a second one.
 */
export type ReopenResult =
  | { readonly ok: true; readonly reopened: boolean }
  | { readonly ok: false };

/**
 * Put an accepted proposal back to pending.
 *
 * NOT to `dismissed`. An undo is not a decline: the runner accepted, saw the
 * result and reversed it, and the decision is open again rather than answered
 * no. Collapsing the two would make the decision history say he declined a
 * change he actually tried — and the history is the surface built to prove what
 * the coach and the runner each did.
 */
export async function reopenProposal(
  userUuid: string,
  proposalId: number,
): Promise<ReopenResult> {
  /* Rule 11, and the swallow ratchet caught the first cut of this: it ended
   * `.catch(() => null)` and returned a boolean, so "the row was not accepted"
   * and "the write failed" arrived as the same `false`. That matters here more
   * than in most places — every caller reopens a card BECAUSE something else
   * already went wrong, and a failed reopen leaves a decision marked answered
   * whose change never landed. The three states are kept apart so the caller
   * can log the difference rather than guess at it. */
  const r = await attempt(
    'plan/workout-proposals · reopenProposal',
    pool.query(
      `UPDATE plan_workout_proposals
          SET status = 'pending', resolved_at = NULL
        WHERE id = $1
          AND user_uuid = $2::uuid
          AND status = 'accepted'`,
      [proposalId, userUuid],
    ),
  );
  if (!r.ok) return { ok: false };
  return { ok: true, reopened: (r.value.rowCount ?? 0) > 0 };
}

/** Mark dismissed. Returns true on success. */
export async function dismissProposal(
  userUuid: string,
  proposalId: number,
): Promise<boolean> {
  const r = await pool.query(
    `UPDATE plan_workout_proposals
        SET status = 'dismissed', resolved_at = NOW()
      WHERE id = $1
        AND user_uuid = $2::uuid
        AND status = 'pending'`,
    [proposalId, userUuid],
  ).catch(() => null);
  return (r?.rowCount ?? 0) > 0;
}

/**
 * PROPOSALEXPIRE-1 · the one place a `PROPOSAL_EXPIRATION` promise for a
 * per-workout proposal is resolved, called from both accept and dismiss
 * (Rule 16 — one resolver, not one copy per caller). Best-effort and never
 * throws: the proposal itself already committed by the time either route
 * calls this, and a scheduler outage must not turn that into a failure.
 *
 * Silent when nothing is queued for this proposal — most rows predate
 * PROPOSALEXPIRE-1, and a card raised before this landed has nothing to
 * resolve.
 */
export async function resolveProposalExpirationPromise(
  userUuid: string,
  proposalId: number,
  decision: 'ACCEPTED' | 'DECLINED',
  detail: string,
): Promise<void> {
  try {
    const { loadLiveQueue, resolveReassessment } = await import('@/lib/ops/reassessment-scheduler');
    const live = await loadLiveQueue(userUuid, 'PROPOSAL_EXPIRATION');
    if (live.state !== 'ok') {
      if (live.state === 'failed') {
        console.error(`[workout-proposals] could not resolve expiration promise · ${live.why}`);
      }
      return;
    }
    const item = live.value.find((i) => i.payload?.proposalId === proposalId);
    if (!item) return;
    const res = await resolveReassessment({ id: item.id, status: 'RESOLVED', decision, detail });
    if (res.state !== 'ok') {
      console.error(`[workout-proposals] expiration promise resolve failed · ${res.state} · ${res.why}`);
    }
  } catch (e) {
    console.error(
      '[workout-proposals] resolveProposalExpirationPromise threw and was contained ·',
      e instanceof Error ? e.message : e,
    );
  }
}
