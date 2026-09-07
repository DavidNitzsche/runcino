/**
 * lib/audit/pace-drift-monitor.ts · DECISION 1 (2026-09-06) · the scheduled
 * replacement for `_cross_surface_contract.test.ts`'s excluded build-blocking
 * pace check.
 *
 * ── THE RULING, VERBATIM ────────────────────────────────────────────────────
 *
 * "Execution surfaces must show the currently accepted, persisted
 * prescription. A different calculated pace is permitted only when it is
 * tied to a current pending proposal containing: Accepted/persisted before
 * value. Proposed after value. Current plan version. Evidence. Creation and
 * expiration. Proposal status. Replace the excluded cross-surface build test
 * with scheduled monitoring that understands this state... Generic 'one
 * reanchor cycle of tolerance' is not approved."
 *
 * Six named fields, not a tolerance number. `DEPLOYFENCE-1`'s exclusion
 * (`scripts/check-generated-content.sh`) left the underlying finding
 * unmonitored between builds — this file is what watches it instead, on a
 * schedule, and the six fields are checked explicitly rather than assumed
 * from "a proposal exists somewhere".
 *
 * ── WHAT COUNTS AS EACH FIELD, AND WHY ──────────────────────────────────────
 *
 * `plan_workout_proposals` (migration 140) has no `expires_at` column, and
 * REANCHORPROPOSES-1's `RepricePayload` (`lib/plan/reprice-payload.ts`) has
 * no `planVersion` stamp — this monitor does not invent either as a new
 * source of truth (Rule 16); it reads what already exists and is honest
 * about what a field means here:
 *
 *   before value   · the LIVE `plan_workouts` row's current pace, at read
 *                    time — not the proposal's own recorded `fromSecPerMi`,
 *                    because the runner's currently-persisted prescription is
 *                    the fact this monitor is protecting, and a proposal
 *                    whose recorded "before" no longer matches the live row
 *                    is itself a stale proposal (see EXPIRATION below).
 *   after value    · `RepriceAnchorMove.toSecPerMi` for the matching anchor
 *                    key, compared against the LIVE recalculated value the
 *                    excluded test itself computes — the proposal's "after"
 *                    must be the SAME number driving the drift, not merely a
 *                    number in the same direction.
 *   plan version   · the proposal's own `RepricePayload.planId` must equal
 *                    the runner's CURRENTLY ACTIVE plan id. A proposal raised
 *                    against a plan that has since been archived or rebuilt
 *                    explains nothing about today's drift.
 *   evidence       · `plan_workout_proposals.evidence` (jsonb) must be
 *                    non-empty. An empty object is not evidence; it means
 *                    nothing was ever recorded.
 *   creation       · `plan_workout_proposals.created_at`, read straight.
 *   expiration     · DERIVED, not stored: a proposal expires when the LIVE
 *                    `plan_workouts` row no longer matches the proposal's own
 *                    recorded `fromSecPerMi` for that anchor (something else
 *                    already changed the row the proposal was raised
 *                    against — its "before" claim is now false), OR when it
 *                    is older than `REPRICE_DISMISSAL_QUIET_DAYS` (the same
 *                    constant `reanchor-proposal.ts` already uses to decide
 *                    when a dismissed repricing may be re-raised — reused
 *                    rather than inventing a second expiry window for the
 *                    same underlying question).
 *   proposal status · must be `'pending'`. `'accepted'`/`'dismissed'`/
 *                    `'expired'` explain nothing: an accepted proposal should
 *                    already have moved the persisted row (if it hasn't, that
 *                    is its own, worse finding, reported separately below).
 *
 * All six must hold for a drift to be EXPLAINED. Any one failing makes the
 * drift UNEXPLAINED, which this monitor reports as a real finding — never
 * silently waved through, and never a generic "within N seconds" tolerance.
 */
import type { PoolClient, Pool } from 'pg';
import { REPRICE_ACTION_KIND, asRepricePayload, type RepriceAnchorMove } from '@/lib/plan/reprice-payload';
import { REPRICE_DISMISSAL_QUIET_DAYS } from '@/lib/plan/reanchor-proposal';

export interface PaceDriftFinding {
  /** The engine's own anchor key, e.g. `threshold_s_per_mi`, matching
   *  `RepriceAnchorMove.key`. */
  readonly anchorKey: string;
  /** What the persisted `plan_workouts` row(s) currently carry. */
  readonly persistedSecPerMi: number;
  /** What the live resolver calculates today. */
  readonly liveSecPerMi: number;
  /** The runner's currently active plan id. */
  readonly activePlanId: string;
}

export interface PendingRepriceRow {
  readonly id: number;
  readonly planId: string;
  readonly anchorMoves: readonly RepriceAnchorMove[];
  readonly evidence: unknown;
  readonly createdAtISO: string;
  readonly status: string;
}

export type DriftVerdict =
  | { readonly explained: true; readonly proposalId: number }
  | { readonly explained: false; readonly reason: string };

function daysSince(iso: string, nowISO: string): number {
  const then = Date.parse(iso);
  const now = Date.parse(nowISO);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return Infinity;
  return Math.max(0, (now - then) / 86_400_000);
}

/**
 * Pure — every fact the six-field check needs is already resolved into its
 * arguments, so this is falsifiable with no database at all.
 */
export function explainPaceDrift(
  finding: PaceDriftFinding,
  proposal: PendingRepriceRow | null,
  nowISO: string,
): DriftVerdict {
  if (proposal == null) {
    return { explained: false, reason: `no pending reprice proposal exists for ${finding.anchorKey}` };
  }
  if (proposal.status !== 'pending') {
    return {
      explained: false,
      reason: `the only candidate proposal (#${proposal.id}) has status '${proposal.status}', not 'pending'`,
    };
  }
  if (proposal.planId !== finding.activePlanId) {
    return {
      explained: false,
      reason: `proposal #${proposal.id} was raised against plan ${proposal.planId}, `
        + `the active plan is now ${finding.activePlanId}`,
    };
  }
  const evidenceIsEmpty = proposal.evidence == null
    || (typeof proposal.evidence === 'object' && Object.keys(proposal.evidence as object).length === 0);
  if (evidenceIsEmpty) {
    return { explained: false, reason: `proposal #${proposal.id} carries no evidence` };
  }
  const move = proposal.anchorMoves.find((m) => m.key === finding.anchorKey);
  if (move == null) {
    return {
      explained: false,
      reason: `proposal #${proposal.id} names no anchor move for ${finding.anchorKey} `
        + `(carries: ${proposal.anchorMoves.map((m) => m.key).join(', ') || '(none)'})`,
    };
  }
  if (move.toSecPerMi !== finding.liveSecPerMi) {
    return {
      explained: false,
      reason: `proposal #${proposal.id}'s proposed after-value for ${finding.anchorKey} is `
        + `${move.toSecPerMi} s/mi, the live calculation is ${finding.liveSecPerMi} s/mi — not the same drift`,
    };
  }
  // EXPIRATION, first form: the proposal's own recorded "before" no longer
  // matches what is actually persisted, so its explanation of TODAY's drift
  // is void even though its status column still says pending.
  if (move.fromSecPerMi !== finding.persistedSecPerMi) {
    return {
      explained: false,
      reason: `proposal #${proposal.id}'s recorded before-value for ${finding.anchorKey} is `
        + `${move.fromSecPerMi} s/mi, the persisted row now carries ${finding.persistedSecPerMi} s/mi — `
        + 'the proposal is stale against its own claim',
    };
  }
  // EXPIRATION, second form: age, using the SAME window the reprice flow
  // itself already uses to decide when a dismissed repricing may be
  // re-raised (Rule 16 — one number, not a second expiry window for the same
  // underlying "is this still a live question" fact).
  const ageDays = daysSince(proposal.createdAtISO, nowISO);
  if (ageDays > REPRICE_DISMISSAL_QUIET_DAYS) {
    return {
      explained: false,
      reason: `proposal #${proposal.id} is ${ageDays.toFixed(1)} days old, past the `
        + `${REPRICE_DISMISSAL_QUIET_DAYS}-day window this engine treats a repricing question as still live`,
    };
  }
  return { explained: true, proposalId: proposal.id };
}

/**
 * Read the runner's current pending reprice proposal, if one exists. At most
 * one is expected — `reanchor-proposal.ts` supersedes the prior one rather
 * than stacking a second — but this reads the newest `pending` row rather
 * than assuming exactly one, so a caller never silently picks an arbitrary
 * row if that invariant is ever violated.
 */
export async function readPendingRepriceProposal(
  exec: Pick<PoolClient, 'query'> | Pool,
  userUuid: string,
): Promise<PendingRepriceRow | null> {
  const r = await exec.query<{
    id: number; action_payload: unknown; evidence: unknown;
    created_at: string; status: string;
  }>(
    `SELECT id, action_payload, evidence, created_at::text AS created_at, status
       FROM plan_workout_proposals
      WHERE user_uuid = $1::uuid AND action_kind = $2 AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1`,
    [userUuid, REPRICE_ACTION_KIND],
  );
  const row = r.rows[0];
  if (!row) return null;
  // FIX (2026-09-07, found rendering DECISION-2 against a real scratch copy
  // of production, Rule 13) · `action_payload` is stored as
  // `{ why, reprice: RepricePayload, action }` — `writeReanchorProposal`'s own
  // INSERT (lib/plan/reanchor-proposal.ts) and its own re-read of prior rows
  // both unwrap `.reprice` before calling `asRepricePayload`. This read
  // passed the WHOLE `{why, reprice, action}` object in, which has no `kind`
  // field at its own top level, so `asRepricePayload` returned null for
  // EVERY reprice proposal ever written and this function always answered
  // "no pending proposal" — meaning `explainPaceDrift` reported every drift
  // UNEXPLAINED forever, even with a valid, matching, pending card already
  // sitting in front of the runner. Nothing caught it: no existing test
  // round-trips a real row through this parse (Rule 15 — the pure
  // `explainPaceDrift` tests construct `PendingRepriceRow` directly and never
  // call this function at all).
  const payload = asRepricePayload((row.action_payload as { reprice?: unknown } | null)?.reprice);
  if (payload == null) return null;
  return {
    id: row.id,
    planId: payload.planId,
    anchorMoves: payload.anchorMoves,
    evidence: row.evidence,
    createdAtISO: row.created_at,
    status: row.status,
  };
}
