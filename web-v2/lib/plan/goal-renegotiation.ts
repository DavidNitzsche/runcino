/**
 * lib/plan/goal-renegotiation.ts · the unclosable-gap → revised-target
 * proposal (2026-08-17 coaching-loop reconciliation).
 *
 * goal-gap.ts has classified 'unclosable' correctly since Phase 1.1, and
 * gap-report.ts has computed A/B/C alternative bands since Phase 2.3 —
 * but nothing ever ACTED on unclosable: the drift cron only fired on
 * 'widening' ≥3 days, so a runner whose goal drifted out of physiological
 * reach kept training (and would have raced) against it.
 *
 * This module writes a pending plan_proposals row when 'unclosable' has
 * been SUSTAINED for ≥5 consecutive snapshot days, carrying the A/B/C
 * alternatives the gap report already computes.
 *
 * Framing (David's direction): the proposal proposes a REVISED TARGET
 * BAND while the stated goal stays on the board as the season ambition.
 * The engine recommends racing off evidence; it never deletes the
 * ambition. The accept path is the existing goal edit — PATCH
 * /api/race/[slug] { goalSec, source: 'renegotiate' } — which fires the
 * goal_renegotiated rebuild; the payload references it so every surface
 * can wire the buttons without re-deriving.
 *
 * Also owns the stale-proposal hygiene the audit demanded (19 identical
 * pending staleness proposals rotting): expireStalePendingProposals marks
 * pending rows >14 days old 'expired' — the same window after which
 * proposals-state stops surfacing them.
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.3/2.4;
 *       Research/01-pace-zones-vdot.md §Recalibrate-Paces (honest anchors)
 */

import { pool } from '@/lib/db/pool';
import type { GoalGap } from './goal-gap';
import type { GapReport } from './gap-report';

/** Consecutive unclosable snapshot days before the proposal fires. */
export const RENEGOTIATION_SUSTAINED_DAYS = 5;

/** Pending renegotiation younger than this blocks a rewrite (dedupe);
 *  older pendings are superseded by the fresh one. */
export const RENEGOTIATION_REFRESH_DAYS = 7;

/** Pure gate · exported for tests. */
export function shouldProposeRenegotiation(gap: Pick<GoalGap, 'status' | 'consecutiveUnclosableDays'>): boolean {
  return gap.status === 'unclosable'
    && gap.consecutiveUnclosableDays >= RENEGOTIATION_SUSTAINED_DAYS;
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface RenegotiationReasons {
  message: string;
  goal_sec: number;
  trajectory_sec: number;
  gap_sec: number;
  weeks_remaining: number;
  consecutive_unclosable_days: number;
  /** A/B/C bands from the gap report (A stretch · B tracking · C safe). */
  alternatives: {
    a: { sec: number; display: string; label: string };
    b: { sec: number; display: string; label: string };
    c: { sec: number; display: string; label: string };
  };
  /** The accept seam · the runner's chosen time goes here. */
  accept_path: string;
  race_slug: string;
  keeps_ambition: true;
}

/**
 * Compose the proposal payload. Pure · exported for tests.
 *
 * Coach voice: short, direct, no hype, no exclamation marks, no em
 * dashes. The recommendation races off evidence and keeps the ambition
 * on the board.
 */
export function composeRenegotiationReasons(
  gap: GoalGap,
  report: GapReport | null,
): RenegotiationReasons {
  // A/B/C from the gap report's confidence band when the simulator has
  // one; otherwise an honest fallback off the trajectory itself
  // (A = the stated goal, B = trajectory, C = trajectory + 3%).
  const alt = report?.alternativeRanges;
  const a = alt?.a ?? { sec: gap.goalSec, label: 'A-goal · stretch but possible' };
  const b = alt?.b ?? { sec: gap.trajectorySec, label: 'B-goal · where you\'re tracking' };
  const c = alt?.c ?? { sec: Math.round(gap.trajectorySec * 1.03), label: 'C-goal · safe + executable' };

  const message =
    `Evidence says ${fmtTime(gap.trajectorySec)}. The ${fmtTime(gap.goalSec)} stays on the board as the season ambition. ` +
    `Recommended race target: ${fmtTime(b.sec)}, with ${fmtTime(c.sec)} as the safe floor. ` +
    `Set the revised target to race off the fitness you have. The ambition carries to the next block.`;

  return {
    message,
    goal_sec: gap.goalSec,
    trajectory_sec: gap.trajectorySec,
    gap_sec: gap.gapSec,
    weeks_remaining: gap.weeksRemaining,
    consecutive_unclosable_days: gap.consecutiveUnclosableDays,
    alternatives: {
      a: { sec: a.sec, display: fmtTime(a.sec), label: a.label },
      b: { sec: b.sec, display: fmtTime(b.sec), label: b.label },
      c: { sec: c.sec, display: fmtTime(c.sec), label: c.label },
    },
    accept_path: `PATCH /api/race/${gap.raceSlug} { goalSec, source: 'renegotiate' }`,
    race_slug: gap.raceSlug,
    keeps_ambition: true,
  };
}

/**
 * Write (or refresh) the pending goal_renegotiation proposal.
 *
 * Dedupe/supersede rules:
 *   · a pending row younger than RENEGOTIATION_REFRESH_DAYS → skip
 *   · older pending rows → marked 'superseded', fresh row written
 *   · a dismissal within 14 days → skip (respect the runner's call)
 *
 * Returns true when a row was written.
 */
export async function writeGoalRenegotiationProposal(
  userUuid: string,
  planId: string | null,
  gap: GoalGap,
  report: GapReport | null,
): Promise<boolean> {
  const freshPending = (await pool.query(
    `SELECT 1 FROM plan_proposals
      WHERE user_uuid = $1 AND proposal_kind = 'goal_renegotiation'
        AND status = 'pending'
        AND created_at >= NOW() - make_interval(days => $2::int)
      LIMIT 1`,
    [userUuid, RENEGOTIATION_REFRESH_DAYS],
  ).catch(() => ({ rows: [] as unknown[] }))).rows[0];
  if (freshPending) return false;

  const recentDismiss = (await pool.query(
    `SELECT 1 FROM plan_proposals
      WHERE user_uuid = $1 AND proposal_kind = 'goal_renegotiation'
        AND status = 'dismissed'
        AND resolved_at >= NOW() - interval '14 days'
      LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as unknown[] }))).rows[0];
  if (recentDismiss) return false;

  // Supersede any older still-pending renegotiations · one live proposal
  // at a time, always the freshest numbers.
  await pool.query(
    `UPDATE plan_proposals
        SET status = 'superseded', resolved_at = NOW()
      WHERE user_uuid = $1 AND proposal_kind = 'goal_renegotiation'
        AND status = 'pending'`,
    [userUuid],
  ).catch(() => null);

  const reasons = composeRenegotiationReasons(gap, report);
  await pool.query(
    `INSERT INTO plan_proposals
       (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at)
     VALUES ($1, $2, 'goal_renegotiation', $3::jsonb, 'pending', 'goal_gap_cron', NOW())`,
    [userUuid, planId, JSON.stringify(reasons)],
  );
  return true;
}

/**
 * Hygiene pass · pending proposals older than 14 days (any kind) go to
 * 'expired'. proposals-state already stops SURFACING pending rows after
 * 14 days, so these rows were invisible zombies that also defeated
 * every "is there a pending row" dedupe check — the audit found 19
 * identical staleness proposals accumulated this way. Returns the number
 * of rows expired.
 */
export async function expireStalePendingProposals(userUuid: string): Promise<number> {
  const r = await pool.query(
    `UPDATE plan_proposals
        SET status = 'expired', resolved_at = NOW()
      WHERE user_uuid = $1 AND status = 'pending'
        AND created_at < NOW() - interval '14 days'`,
    [userUuid],
  ).catch(() => ({ rowCount: 0 }));
  return r.rowCount ?? 0;
}
