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
  // 2026-08-17 · truth-bug fix · the drift cron now writes its TRUE
  // kind (per-axis drift + goal-gap included) instead of a synthetic
  // 'goal_time_changed', which mislabeled a staleness observation as
  // "Goal time updated" and defeated the next-day dedupe.
  | 'easy_drift'
  | 'long_drift'
  | 'quality_drift'
  | 'goal_gap_widening'
  | 'race_date_changed'
  | 'goal_time_changed'    // reserved for ACTUAL goal edits
  | 'a_race_added'
  | 'a_race_removed'
  // 2026-08-17 · coaching-loop reconciliation
  | 'goal_renegotiation'   // unclosable gap sustained ≥5d · revised target band, ambition stays
  | 'pace_reanchor';       // training-drift fitness regression · propose a re-anchor rebuild

export type PlanProposalStatus =
  | 'pending'
  | 'auto_applied'
  | 'accepted'
  | 'dismissed'
  | 'superseded'
  | 'expired';             // 2026-08-17 · pending >14d, expired by the drift cron

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
/** The `plan_proposals` columns both reads select. */
interface ProposalRow {
  id: number;
  plan_id: string | null;
  new_plan_id: string | null;
  proposal_kind: PlanProposalKind;
  status: PlanProposalStatus;
  source: string;
  reasons: Record<string, unknown> | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
}

/** Row → `PlanProposal`. One translation, so two reads cannot disagree. */
function toProposal(r: ProposalRow): PlanProposal {
  const reasons = r.reasons ?? {};
  const severityRaw = typeof reasons.severity === 'number' ? reasons.severity : null;
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
    severity: isHardDriftKind(r.proposal_kind) ? 1.0 : severityRaw,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    resolvedAt: r.resolved_at instanceof Date ? r.resolved_at.toISOString()
      : r.resolved_at ? String(r.resolved_at) : null,
  };
}

/** Pending before auto_applied before everything else, then severity, then recency. */
function sortProposals(proposals: PlanProposal[]): PlanProposal[] {
  return [...proposals].sort((a, b) => {
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
}

export async function loadPlanProposals(userId: string): Promise<PlanProposal[]> {
  const rows = (await pool.query<ProposalRow>(
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
  ).catch(() => ({ rows: [] as ProposalRow[] }))).rows;

  return sortProposals(rows.map(toProposal)).slice(0, 5);
}

/**
 * Every recent proposal, resolved rows included · the debug/audit read behind
 * `GET /api/plan/proposal?all=1` (2026-08-17).
 *
 * `loadPlanProposals` above is the SURFACE read: it hides resolved rows and an
 * auto-applied banner after 24 hours, because that is what a Today card should
 * show. When you are trying to work out why a plan rebuilt itself last Tuesday,
 * those are exactly the rows you need. Same mapping, same sort, wider window —
 * the row → `PlanProposal` translation is shared so the two reads can never
 * describe the same row differently.
 */
export async function loadAllPlanProposals(
  userId: string,
  limit = 25,
): Promise<PlanProposal[]> {
  const rows = (await pool.query<ProposalRow>(
    `SELECT id, plan_id, new_plan_id, proposal_kind, status, source,
            reasons, created_at, resolved_at
       FROM plan_proposals
      WHERE user_uuid = $1
        AND created_at >= NOW() - interval '180 days'
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, Math.max(1, Math.min(100, limit))],
  ).catch(() => ({ rows: [] as ProposalRow[] }))).rows;
  return sortProposals(rows.map(toProposal));
}

function isHardDriftKind(kind: PlanProposalKind): boolean {
  return kind === 'race_date_changed'
      || kind === 'goal_time_changed'
      || kind === 'a_race_added'
      || kind === 'a_race_removed'
      // 2026-08-17 · a sustained-unclosable renegotiation is the highest-
      // stakes card the engine writes · never buried under soft drift.
      || kind === 'goal_renegotiation';
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
      return 'This plan was authored more than 8 weeks ago. Time for a refresh.';
    case 'easy_drift':
      return 'Your easy days run longer than this plan prescribes. Refit so the plan matches reality.';
    case 'long_drift':
      return 'Your long runs have drifted from this plan\'s targets. Refit for an honest progression.';
    case 'quality_drift':
      return 'Your quality sessions have drifted from this plan\'s targets. Refit the work.';
    case 'goal_gap_widening':
      return 'The projection is drifting away from the goal. Rebuild to close the gap.';
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
    case 'goal_renegotiation':
      return 'The gap to your goal is wider than the remaining weeks can close. A revised race target is recommended. The goal stays on the board as the season ambition.';
    case 'pace_reanchor':
      return 'Training evidence reads below the plan\'s pace anchor. Recommend re-anchoring paces to current fitness.';
  }
}
