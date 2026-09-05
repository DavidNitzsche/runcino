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
import { expireStaleWorkoutProposals } from './proposal-expiry';
import { runnerToday } from '@/lib/runtime/runner-tz';
import type { AdaptationAction, AdaptationTrigger } from './adapt';
import { stripResearchCitations } from './strip-citations';
import type { RepricePayload } from './reprice-payload';

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
  actionKind: 'downgrade' | 'shave' | 'reschedule' | 'field_test' | 'mark_upgrade' | 'reprice';
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
    why?: string;
  };
  reason: string;
  evidence: Record<string, unknown>;
  status: 'pending';
  createdAt: string;
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
        const dup = await rowOrNull<{ id: number }>(
          'plan/workout-proposals · pending-proposal dedup',
          pool.query<{ id: number }>(
            `SELECT id FROM plan_workout_proposals
            WHERE plan_workout_id = $1 AND status = 'pending'
            LIMIT 1`,
            [workoutId],
          ),
        );
        if (dup === null) continue;   // read failed · assume already proposed
        if (dup) continue;            // pending proposal on record

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
         */
        const reducesLoad = action.kind === 'downgrade' || action.kind === 'shave';
        if (reducesLoad && !describesEvidence(action.why ?? '')) {
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

        const payload = {
          newType: action.newType ?? null,
          newDate: action.newDate ?? null,
          shaveFraction: action.shaveFraction ?? null,
          newDistanceMi: bumpForRow?.newDistanceMi ?? null,
          why: stripResearchCitations(action.why),
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
        };

        await pool.query(
          `INSERT INTO plan_workout_proposals
             (user_uuid, plan_workout_id, workout_date_iso, action_kind,
              action_payload, reason, evidence, source)
           VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7::jsonb, 'cron_evening')`,
          [userUuid, workoutId, row.date_iso, action.kind,
           JSON.stringify(payload), reason, JSON.stringify(evidenceForRow)],
        );
        count++;
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
