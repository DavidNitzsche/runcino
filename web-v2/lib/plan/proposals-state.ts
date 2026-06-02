/**
 * lib/plan/proposals-state.ts · loader for plan_proposals · the
 * autonomous-rebuild audit + accept/dismiss surface.
 *
 * Read by FaffSeed so the Today view can render:
 *   · Pending proposals (drift_cron → user accepts or dismisses)
 *   · Recent auto_applied rows (immediate-fire hooks → "we rebuilt
 *     your plan because X" notification)
 *
 * Mirrors lib/coach/proposals-state.ts which already powers the
 * illness/injury accept-decline cards.
 */

import { pool } from '@/lib/db/pool';

export type PlanProposalKind =
  | 'volume_drift'
  | 'vdot_drift'
  | 'staleness'
  | 'race_date_changed'
  | 'goal_time_changed'
  | 'a_race_added'
  | 'a_race_removed';

export type PlanProposalStatus =
  | 'pending'
  | 'auto_applied'
  | 'accepted'
  | 'dismissed'
  | 'superseded';

export interface PlanProposal {
  id: number;
  planId: string | null;
  /** 2026-06-02 · explicit alias for `planId` on auto_applied rows ·
   *  for those rows planId = the OLD plan that just got archived (the
   *  `from` side of the diff). Named `previousPlanId` so the diff page
   *  can read `proposal.previousPlanId` without spelunking the schema. */
  previousPlanId: string | null;
  newPlanId: string | null;
  kind: PlanProposalKind;
  status: PlanProposalStatus;
  source: string;
  /** Canonical reasons blob. Includes plain-language `message` field
   *  when the cron writer surfaced one. */
  reasons: Record<string, unknown>;
  /** Plain-language explanation for the runner. Always populated · the
   *  loader synthesizes a fallback when reasons.message isn't set. */
  message: string;
  /** Severity 0-1 for soft-drift kinds. Null for hard-drift kinds
   *  (which are inherently severity-1). */
  severity: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * Pending proposals + recently auto-applied ones the runner should
 * see. Returns up to 5, sorted by:
 *   1. status (pending first · auto_applied second)
 *   2. severity desc (highest impact first)
 *   3. created_at desc
 *
 * Hard-drift kinds (race_*, goal_*, a_race_*) get severity 1.0 so
 * they sort to the top regardless of soft-drift severity scores.
 */
export async function loadPlanProposals(userId: string): Promise<PlanProposal[]> {
  const rows = (await pool.query<{
    id: number;
    plan_id: string | null;
    new_plan_id: string | null;
    proposal_kind: PlanProposalKind;
    status: PlanProposalStatus;
    source: string;
    reasons: Record<string, unknown> | null;
    created_at: Date | string;
    resolved_at: Date | string | null;
  }>(
    // 2026-06-02 · auto_applied banners auto-clear after 24h per the
    // PlanProposalCard doctrine note ("stays up for 24h then hides").
    // Pending proposals stay 14d so the runner has time to accept /
    // dismiss; auto_applied are informational records that should
    // fade once read. The DB row stays · only the surface stops
    // rendering it. Audit + diff-page deep links still work.
    `SELECT id, plan_id, new_plan_id, proposal_kind, status, source,
            reasons, created_at, resolved_at
       FROM plan_proposals
      WHERE user_uuid = $1
        AND (
          (status = 'pending'      AND created_at >= NOW() - interval '14 days') OR
          (status = 'auto_applied' AND created_at >= NOW() - interval '24 hours')
        )
      ORDER BY status ASC, created_at DESC
      LIMIT 20`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows;

  const proposals: PlanProposal[] = rows.map((r) => {
    const reasons = r.reasons ?? {};
    const severityRaw = typeof reasons.severity === 'number' ? reasons.severity : null;
    const severity = isHardDriftKind(r.proposal_kind) ? 1.0 : severityRaw;

    return {
      id: r.id,
      planId: r.plan_id,
      previousPlanId: r.plan_id,
      newPlanId: r.new_plan_id,
      kind: r.proposal_kind,
      status: r.status,
      source: r.source,
      reasons,
      message: synthesizeMessage(r.proposal_kind, r.status, reasons),
      severity,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      resolvedAt: r.resolved_at instanceof Date ? r.resolved_at.toISOString()
        : r.resolved_at ? String(r.resolved_at) : null,
    };
  });

  // Custom sort: pending before auto_applied, then by severity desc
  proposals.sort((a, b) => {
    const statusRank = (s: PlanProposalStatus) =>
      s === 'pending' ? 0 : s === 'auto_applied' ? 1 : 2;
    const sa = statusRank(a.status);
    const sb = statusRank(b.status);
    if (sa !== sb) return sa - sb;
    const va = a.severity ?? 0;
    const vb = b.severity ?? 0;
    if (va !== vb) return vb - va;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });

  return proposals.slice(0, 5);
}

function isHardDriftKind(kind: PlanProposalKind): boolean {
  return kind === 'race_date_changed'
      || kind === 'goal_time_changed'
      || kind === 'a_race_added'
      || kind === 'a_race_removed';
}

function synthesizeMessage(
  kind: PlanProposalKind,
  status: PlanProposalStatus,
  reasons: Record<string, unknown>,
): string {
  if (typeof reasons.message === 'string' && reasons.message.length > 0) {
    return reasons.message;
  }
  // Fallback copy per kind · plain English.
  switch (kind) {
    case 'volume_drift':
      return 'Your recent weekly volume has drifted from this plan\'s baseline. Refit for an honest target.';
    case 'vdot_drift':
      return 'Your current VDOT has drifted from this plan\'s anchor. Pace targets are stale.';
    case 'staleness':
      return 'This plan was authored more than 8 weeks ago. Time for a refit.';
    case 'race_date_changed':
      return status === 'auto_applied'
        ? 'Race date changed · plan timeline rebuilt automatically.'
        : 'Race date changed · plan needs a refit.';
    case 'goal_time_changed':
      return status === 'auto_applied'
        ? 'Goal time changed · pace targets rebuilt automatically.'
        : 'Goal time changed · plan needs a refit.';
    case 'a_race_added':
      return status === 'auto_applied'
        ? 'A new goal race was added · plan rebuilt to point at it.'
        : 'A new goal race was added · plan needs a refit.';
    case 'a_race_removed':
      return 'Your goal race was removed · pick a new A-race to keep training meaningful.';
  }
}
