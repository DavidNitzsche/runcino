/**
 * lib/plan/workout-proposals.ts · per-workout adaptation proposals.
 *
 * David 2026-06-04 · "I dont want to wake up to change runs · that
 * was annoying." This module replaces the silent-overnight-mutation
 * pattern with a proposal flow:
 *
 *   1. Evening cron runs detectAdaptations · for readiness_pullback
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

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import type { AdaptationAction, AdaptationTrigger } from './adapt';

export interface PendingProposal {
  id: number;
  userUuid: string;
  planWorkoutId: string;
  workoutDateISO: string;
  actionKind: 'downgrade' | 'shave' | 'reschedule';
  actionPayload: {
    newType?: string;
    newDate?: string;
    shaveFraction?: number;
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
  // Most actions target one or more workoutIds. We write one proposal
  // per (workoutId, action) pair. The triggers array carries the
  // human-readable reason · we use the first matching trigger.
  let count = 0;
  for (const action of actions) {
    const workoutIds = action.workoutIds ?? [];
    if (workoutIds.length === 0) continue;

    // Map action.kind to the proposal_kind union. Only downgrade /
    // shave / reschedule are propose-worthy · mark_dirty and
    // recompute_paces are internal bookkeeping and don't need runner
    // approval.
    if (action.kind !== 'downgrade' && action.kind !== 'shave' && action.kind !== 'reschedule') {
      continue;
    }

    const triggerForAction = triggers.find((t) => t.kind === 'readiness_pullback') ?? triggers[0];
    const reason = triggerForAction?.reason ?? action.why ?? 'Engine proposed an adaptation.';
    const evidence = (triggerForAction?.evidence ?? {}) as Record<string, unknown>;

    for (const workoutId of workoutIds) {
      try {
        // Read the workout's date for the row + sealed-day check.
        const row = (await pool.query<{ date_iso: string }>(
          `SELECT date_iso FROM plan_workouts WHERE id = $1 LIMIT 1`,
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
        const dup = (await pool.query<{ id: number }>(
          `SELECT id FROM plan_workout_proposals
            WHERE plan_workout_id = $1 AND status = 'pending'
            LIMIT 1`,
          [workoutId],
        ).catch(() => ({ rows: [] }))).rows[0];
        if (dup) continue;

        const payload = {
          newType: action.newType ?? null,
          newDate: action.newDate ?? null,
          shaveFraction: action.shaveFraction ?? null,
          why: action.why,
        };

        await pool.query(
          `INSERT INTO plan_workout_proposals
             (user_uuid, plan_workout_id, workout_date_iso, action_kind,
              action_payload, reason, evidence, source)
           VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7::jsonb, 'cron_evening')`,
          [userUuid, workoutId, row.date_iso, action.kind,
           JSON.stringify(payload), reason, JSON.stringify(evidence)],
        );
        count++;
      } catch {
        // Single-proposal failure shouldn't stop the rest of the batch
      }
    }
  }
  return count;
}

/**
 * Load pending proposals for the runner's upcoming workouts. Used
 * by the seed envelope to render the Today-view banner.
 *
 * Auto-marks expired proposals (workout date passed) as 'expired' on
 * read · keeps the table clean without a separate cleanup cron.
 */
export async function loadPendingProposals(
  userUuid: string,
): Promise<PendingProposal[]> {
  // Auto-expire stale rows first · cheap, runs per request.
  await pool.query(
    `UPDATE plan_workout_proposals
        SET status = 'expired', resolved_at = NOW()
      WHERE user_uuid = $1::uuid
        AND status = 'pending'
        AND workout_date_iso < CURRENT_DATE::text`,
    [userUuid],
  ).catch(() => {});

  const rows = (await pool.query<{
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
        AND workout_date_iso >= CURRENT_DATE::text
      ORDER BY workout_date_iso ASC, created_at ASC`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows;

  return rows.map((r) => ({
    id: r.id,
    userUuid: r.user_uuid,
    planWorkoutId: r.plan_workout_id,
    workoutDateISO: r.workout_date_iso,
    actionKind: r.action_kind as 'downgrade' | 'shave' | 'reschedule',
    actionPayload: r.action_payload ?? {},
    reason: r.reason,
    evidence: r.evidence ?? {},
    status: 'pending',
    createdAt: r.created_at.toISOString(),
  }));
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
    actionKind: r.action_kind as 'downgrade' | 'shave' | 'reschedule',
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
