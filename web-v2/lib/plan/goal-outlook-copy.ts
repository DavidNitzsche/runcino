/**
 * lib/plan/goal-outlook-copy.ts · the sustained-unclosable sentence, once.
 *
 * Pure, import-free, so the writer (lib/plan/goal-outlook.ts), the row →
 * message translation (lib/plan/proposals-state.ts) and any `'use client'`
 * surface all compose the SAME sentence rather than three near-copies. Rule 16
 * for prose, and Rule 19 for the client graph.
 *
 * ── WHY THE RENDERER RECOMPOSES INSTEAD OF PRINTING reasons.message ─────────
 *
 * `plan_proposals` rows persist their copy. The owner has a standing row
 * (id 57, kind `goal_renegotiation`, written 2026-08-28) whose stored message
 * ends "Set the revised target to race off the fitness you have" — the exact
 * imperative the locked rule forbids. Retiring the WRITER does not retire that
 * string; it sits in prod and `synthesizeMessage` used to prefer it over every
 * fallback. So the renderer composes here from the row's STRUCTURED fields and
 * ignores stored prose for these kinds. A sentence no writer can persist is a
 * sentence no future writer can smuggle back.
 *
 * ── AND WHY A RETIRED ROW SHOWS NO NUMBER ──────────────────────────────────
 *
 * A `goal_renegotiation` row carries `expected_race_day_sec`, which sounds like the
 * projection and is not: it is the projection SNAPSHOT, today's current-fitness
 * equivalence (3:31:48 on the owner's CIM row), while every other surface shows
 * the forward trajectory (3:22:17) under the same word. Reprinting it would
 * re-open the three-projections defect that `lib/training/race-projection.ts`
 * was extracted to close. So a retired row is rendered with `projectedSec:
 * null` and states the situation without a figure; the figure is one line above
 * it on every surface that mounts this note, resolved through the shared
 * resolver. Rule 17: say it once, where it is most useful.
 */

/** 'trajectory' = where this build lands him on race day · 'equivalence' =
 *  what today's fitness is worth. Mirrors `RaceProjectionBasis`, restated here
 *  rather than imported so this module stays import-free. */
export type GoalOutlookBasis = 'trajectory' | 'equivalence';

export interface GoalOutlookCopyInput {
  /** The shared resolver's answer, or null when there is none to state. */
  projectedSec: number | null;
  basis: GoalOutlookBasis | null;
  goalSec: number | null;
  weeksRemaining: number | null;
}

/** "3:22:17" / "31:48". Absolute, never signed. */
export function formatOutlookClock(sec: number): string {
  const t = Math.max(0, Math.round(Math.abs(sec)));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/**
 * The note, in coach voice: short, direct, no hype, no exclamation marks, no
 * em dashes, and no instruction about the goal.
 *
 * Read it against the row that caused this rule to be gated:
 *
 *   was · "Evidence says 3:31:48. … Recommended race target: 3:31:48, with
 *          3:38:21 as the safe floor. Set the revised target to race off the
 *          fitness you have."
 *   is  · "This build projects 3:22:17. The 3:00:00 stays on the board as the
 *          season ambition. … Nothing to set here."
 *
 * The opening clause names the BASIS the number actually has, the same grammar
 * `projectionCoachLine` uses, so the prose can never assert "this build
 * projects" over a today's-fitness equivalence.
 */
export function composeGoalOutlookMessage(input: GoalOutlookCopyInput): string {
  const { projectedSec, basis, goalSec, weeksRemaining } = input;
  const goalStr = goalSec != null && goalSec > 0 ? formatOutlookClock(goalSec) : null;

  const opener = projectedSec == null
    ? 'The gap to your goal is wider than the runway can close at the rate the evidence supports.'
    : basis === 'equivalence'
      ? `Today's fitness projects ${formatOutlookClock(projectedSec)}.`
      : `This build projects ${formatOutlookClock(projectedSec)}.`;

  const ambition = goalStr
    ? `The ${goalStr} stays on the board as the season ambition.`
    : 'Your goal stays on the board as the season ambition.';

  const runway = projectedSec == null
    ? null
    : weeksRemaining != null
      ? `The gap is wider than ${weeksRemaining} ${weeksRemaining === 1 ? 'week' : 'weeks'} can close at the rate the evidence supports.`
      : 'The gap is wider than this runway can close at the rate the evidence supports.';

  const close = goalStr
    ? `Nothing to set here. The plan keeps writing to the ${goalStr}, and race day is run off the fitness you arrive with.`
    : 'Nothing to set here. The plan keeps writing to your goal, and race day is run off the fitness you arrive with.';

  return [opener, ambition, runway, close].filter(Boolean).join(' ');
}
