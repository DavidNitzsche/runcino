/**
 * lib/plan/goal-outlook.ts · the sustained-unclosable NOTE.
 *
 * Replaces `lib/plan/goal-renegotiation.ts` (2026-08-30), which violated the
 * owner's locked app-wide rule — see `lib/plan/goal-immutability.ts` for the
 * rule, the live row that broke it, and the seam this module may not touch.
 *
 * ── WHAT CHANGED, AND WHY IT IS NOT A PROPOSAL ANY MORE ─────────────────────
 *
 * The old module wrote a `goal_renegotiation` proposal whose copy instructed
 * ("Set the revised target to race off the fitness you have") and whose
 * `accept_path` named `PATCH /api/race/[slug] { goalSec, source:
 * 'renegotiate' }`. Two web surfaces and the phone wired buttons to it.
 *
 * The projection survives. The renegotiation does not. Concretely:
 *
 *   · kind is `goal_outlook`, declared informational in goal-immutability.ts.
 *     `POST /api/plan/proposal` REFUSES `accept` for it, so the seam is closed
 *     at the server and not merely absent from three renderers.
 *   · the payload carries NO `accept_path` and no alternative "targets" to
 *     set. It carries the projection, the goal, and the gap.
 *   · the copy states where the evidence puts him and asks for nothing.
 *
 * It stays a `plan_proposals` row rather than becoming nothing, because that
 * table is already the transport for coach notes the runner must see and
 * resolve — `race_role` and `race_goal_framing` are both non-rebuild cards —
 * and the row is what supplies the dedupe, supersede and 14-day expiry the
 * note needs, and what keeps `resolveGoalStatus`'s `unclosable` flag alive.
 * What makes it safe is not the table; it is that accepting it cannot mutate
 * a goal, gated in CI.
 *
 * ── THE NUMBER ──────────────────────────────────────────────────────────────
 *
 * RULE 16. The old copy said "Evidence says 3:31:48" — the CURRENT-FITNESS
 * EQUIVALENCE — while every other surface printed 3:22:17 for the same race,
 * the forward trajectory. `lib/training/race-projection.ts` was extracted on
 * 2026-08-30 precisely to stop three quantities being called "projected"; this
 * path never got the memo, because `GoalGap.expectedRaceDaySec` is the projection
 * SNAPSHOT (today's equivalence) wearing the word "trajectory".
 *
 * So the note does not read `gap.expectedRaceDaySec`. It resolves through
 * `resolveRaceProjection`, the same rung-1 `computeGoalProjection().trajectory
 * .projectedSec` that Targets' hero, the Races list and the race detail all
 * show, and `_goal_immutability.test.ts` asserts this file never computes its
 * own.
 */

import { pool } from '@/lib/db/pool';
import type { GoalGap } from './goal-gap';
import {
  raceProjectionFromOutlook,
  type RaceProjectionBasis,
} from '@/lib/training/race-projection';
import { resolveOutlookForGap } from './goal-gap';
import { composeGoalOutlookMessage } from './goal-outlook-copy';

/** Consecutive unclosable snapshot days before the note surfaces. */
export const OUTLOOK_SUSTAINED_DAYS = 5;

/** A pending note younger than this blocks a rewrite (dedupe); older pendings
 *  are superseded by the fresh one. */
export const OUTLOOK_REFRESH_DAYS = 7;

/** Pure gate · exported for tests. Unchanged from the retired module: the
 *  threshold was never the defect. */
export function shouldSurfaceGoalOutlook(
  gap: Pick<GoalGap, 'status' | 'consecutiveUnclosableDays'>,
): boolean {
  return gap.status === 'unclosable'
    && gap.consecutiveUnclosableDays >= OUTLOOK_SUSTAINED_DAYS;
}

export interface GoalOutlookProjection {
  projectedSec: number | null;
  basis: RaceProjectionBasis | null;
}

export interface GoalOutlookReasons {
  message: string;
  goal_sec: number;
  /** The shared resolver's answer. NOT `gap.expectedRaceDaySec`. */
  projected_sec: number | null;
  /** 'trajectory' = race day · 'equivalence' = today's fitness. Drives the
   *  copy's opening clause so the prose names the basis the number has. */
  projection_basis: RaceProjectionBasis | null;
  /** Signed against the goal, recomputed off `projected_sec` so the sentence
   *  and the number cannot disagree. Null when there is no projection. */
  gap_sec: number | null;
  /** Null for a no-race goal with no deadline. */
  weeks_remaining: number | null;
  consecutive_unclosable_days: number;
  /** Null in goal mode · the target lives in profile.tt_goal_*. */
  race_slug: string | null;
  /** The whole point, stated in the row itself so an audit can read it. */
  informational: true;
  keeps_ambition: true;
}

/**
 * Resolve the projection this note speaks about, through the shared resolver.
 *
 * Best-effort by design: a failed read returns `{ null, null }`, which the
 * composer renders as a note with no figure rather than falling back to
 * `gap.expectedRaceDaySec` — that fallback IS the Rule 16 defect, so it does not
 * exist here. Rule 11: "could not project" and "projects level with the goal"
 * are different facts and only one of them has a number.
 */
export async function resolveGoalOutlookProjection(
  userUuid: string,
  gap: GoalGap,
  todayISO: string,
): Promise<GoalOutlookProjection> {
  // 2026-09-01 · P0 · the race-pace brain. One object, mapped to "Projected".
  const outlook = await resolveOutlookForGap(userUuid, gap, todayISO);
  const proj = raceProjectionFromOutlook(outlook);
  return { projectedSec: proj.projectedSec, basis: proj.basis };
}

/**
 * Compose the note. Pure · exported for tests.
 *
 * Coach voice: short, direct, no hype, no exclamation marks, no em dashes —
 * and, now, NO IMPERATIVE ABOUT THE GOAL. Read the three sentences against the
 * row that caused this:
 *
 *   was · "Recommended race target: 3:31:48 … Set the revised target to race
 *          off the fitness you have."      ← an instruction, wired to a button
 *   is  · "This build projects 3:22:17 … Nothing to set here."
 *
 * The first sentence names the basis (`projectionCoachLine`'s grammar: "This
 * build projects" for a race-day trajectory, "Today's fitness projects" for an
 * equivalence) so the prose can never assert a basis the number does not have.
 */
export function composeGoalOutlookReasons(
  gap: GoalGap,
  projection: GoalOutlookProjection,
): GoalOutlookReasons {
  const projectedSec = projection.projectedSec;
  const gapSec = projectedSec != null ? projectedSec - gap.goalSec : null;

  // ONE sentence, composed in goal-outlook-copy.ts, which the renderer also
  // calls. The row persists it for the audit trail; nothing renders the stored
  // string, so a persisted imperative can never reach a runner again.
  const message = composeGoalOutlookMessage({
    projectedSec,
    basis: projection.basis,
    goalSec: gap.goalSec,
    weeksRemaining: gap.weeksRemaining,
  });

  return {
    message,
    goal_sec: gap.goalSec,
    projected_sec: projectedSec,
    projection_basis: projection.basis,
    gap_sec: gapSec,
    weeks_remaining: gap.weeksRemaining,
    consecutive_unclosable_days: gap.consecutiveUnclosableDays,
    race_slug: gap.raceSlug,
    informational: true,
    keeps_ambition: true,
  };
}

/**
 * Write (or refresh) the pending `goal_outlook` note.
 *
 * Dedupe/supersede rules, carried over unchanged from the retired module:
 *   · a pending note younger than OUTLOOK_REFRESH_DAYS → skip
 *   · older pending notes → marked 'superseded', fresh row written
 *   · a dismissal within 14 days → skip (respect the runner's call)
 *
 * The supersede and dismiss scans cover the RETIRED kind as well, so the
 * standing `goal_renegotiation` row cannot sit alongside a new note saying the
 * same thing twice (Rule 17), and a runner who already dismissed the old card
 * is not asked again by its successor.
 *
 * Returns true when a row was written.
 */
export async function writeGoalOutlookNote(
  userUuid: string,
  planId: string | null,
  gap: GoalGap,
  projection: GoalOutlookProjection,
): Promise<boolean> {
  const freshPending = (await pool.query(
    `SELECT 1 FROM plan_proposals
      WHERE user_uuid = $1
        AND proposal_kind IN ('goal_outlook', 'goal_renegotiation')
        AND status = 'pending'
        AND created_at >= NOW() - make_interval(days => $2::int)
      LIMIT 1`,
    [userUuid, OUTLOOK_REFRESH_DAYS],
  ).catch(() => ({ rows: [] as unknown[] }))).rows[0];
  if (freshPending) return false;

  const recentDismiss = (await pool.query(
    `SELECT 1 FROM plan_proposals
      WHERE user_uuid = $1
        AND proposal_kind IN ('goal_outlook', 'goal_renegotiation')
        AND status = 'dismissed'
        AND resolved_at >= NOW() - interval '14 days'
      LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as unknown[] }))).rows[0];
  if (recentDismiss) return false;

  // Supersede any older still-pending note · one live note at a time, always
  // the freshest numbers.
  await pool.query(
    `UPDATE plan_proposals
        SET status = 'superseded', resolved_at = NOW()
      WHERE user_uuid = $1
        AND proposal_kind IN ('goal_outlook', 'goal_renegotiation')
        AND status = 'pending'`,
    [userUuid],
  ).catch(() => null);

  const reasons = composeGoalOutlookReasons(gap, projection);
  await pool.query(
    `INSERT INTO plan_proposals
       (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at)
     VALUES ($1, $2, 'goal_outlook', $3::jsonb, 'pending', 'goal_gap_cron', NOW())`,
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
 *
 * Moved verbatim from the retired `goal-renegotiation.ts` (2026-08-30). It was
 * never part of the violation; it just lived in that file.
 */
export async function expireStalePendingProposals(userUuid: string): Promise<number> {
  const r = await pool.query(
    `UPDATE plan_proposals
        SET status = 'expired', resolved_at = NOW()
      WHERE user_uuid = $1 AND status = 'pending'
        AND created_at < NOW() - interval '14 days'`,
    [userUuid],
  ).catch(() => ({ rowCount: 0 }));
  // 2026-08-17 · one-time-shaped cleanup that rides the existing cron ·
  // the historical mislabeled spam. Before the true-kind fix the drift
  // writer stamped 'goal_time_changed' on staleness/volume/vdot/goal-gap
  // observations; when generatePlan refused (race < 2 weeks out) the
  // failure landed as 'pending' and the mismatched dedupe re-wrote it
  // DAILY ("Goal time updated" cards for a staleness observation — 19
  // on one runner). Expire those regardless of age, keyed on the
  // synthetic marker: kind 'goal_time_changed' + reasons.drift_kind in
  // the drift-signal set. Real goal edits never carry those markers.
  const mislabeled = await pool.query(
    `UPDATE plan_proposals
        SET status = 'expired', resolved_at = NOW()
      WHERE user_uuid = $1 AND status = 'pending'
        AND proposal_kind = 'goal_time_changed'
        AND reasons->>'drift_kind' IN
              ('staleness', 'volume_drift', 'vdot_drift',
               'easy_drift', 'long_drift', 'quality_drift',
               'goal_gap_widening')`,
    [userUuid],
  ).catch(() => ({ rowCount: 0 }));
  return (r.rowCount ?? 0) + (mislabeled.rowCount ?? 0);
}
