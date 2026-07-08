/**
 * lib/training/targets-summary.ts · server-composed Targets summary line.
 *
 * 2026-07-06 · P1-12 / P1-53 / P2-28. The iPhone panel used to compose its
 * own summary sentence client-side and, with no goal time resolved, rendered
 * "On track for —. You're doing the work..." (K_TargetsProjection.swift
 * summaryLine · projFormatTime(nil) → '—'). Broken grammar, and a coach-voice
 * violation: an assertive claim toward a dash. That hit two whole cohorts —
 * no-race fitness-goal runners (tt_goal_* never reached the projection) and
 * casual racers who add a race without a time goal.
 *
 * This composer is the ONE server-side source for that sentence, additive on
 * the /api/targets/projection payload so every surface can adopt it. The
 * contract: the returned copy NEVER contains a dash placeholder. When a
 * target time exists the sentence carries real formatted times; when it
 * doesn't, it falls to trend copy (current fitness direction from the
 * snapshot series — the same held/lastMove signals the panel already shows)
 * or a set-a-goal nudge.
 *
 * Coach voice per the design brief: short, direct, no hype, no exclamation
 * marks, no emoji, no em dashes. "·" separators follow the app label grammar.
 *
 * Pure function · no DB, no clock · testable offline (worktrees lack
 * node_modules; see _audit_goalmode.test.ts).
 */

import { formatRaceTime } from './vdot';

export interface TargetsSummaryArgs {
  /** Final (post-reconciliation) status the payload carries. */
  status: 'on_track' | 'watch' | 'off' | 'race_week' | 'cold';
  /** Resolved goal time, seconds. Null when no target time exists. */
  goalSec: number | null;
  /** The projection to speak to · trajectoryProjectedSec ?? projectionSec. */
  projectedSec: number | null;
  /** Where the goal came from · 'race' (races row) or 'fitness_goal'
   *  (profile tt_goal_*). Null when neither resolved. */
  goalSource: 'race' | 'fitness_goal' | null;
  /** Race name for the no-time-goal race sentence. */
  raceName: string | null;
  /** Days to race day / goal deadline. Null when unknown. */
  daysAway: number | null;
  /** Current VDOT · trend copy anchor. */
  vdot: number | null;
  /** Last VDOT move from the snapshot series (lastMoveFromSeries). */
  lastMove: { prevVdot: number; newVdot: number; deltaVdot: number } | null;
  /** Days the current VDOT has held (heldDays). */
  heldDays: number;
  /** 2026-07-07 · ultra-honesty audit P2-70 · true when the target distance
   *  is past the Daniels validity range (see DANIELS_MAX_VALID_DISTANCE_MI
   *  in lib/training/vdot.ts). goalSec/projectedSec are null for exactly
   *  this reason, not because no goal was set — the summary must say so
   *  instead of nudging the runner to "set a goal" they already set. */
  unsupportedDistance?: boolean;
  /** 2026-07-07 · AUDIT P1-13 · the runner's own demonstrated pace (s/mi)
   *  when it maps below the Daniels VDOT table floor of 30 — see
   *  vdot.ts's BelowTableAnchor / the projection route's below-table
   *  fallback. Null for every runner with an in-table VDOT (the vast
   *  majority) or genuinely no data. Lets the "no baseline yet" copy speak
   *  to the real effort on record instead of asking the runner to
   *  re-produce a baseline they already have. */
  belowTableAnchorPaceSPerMi?: number | null;
}

const fmt = (sec: number): string => formatRaceTime(sec) ?? `${Math.round(sec)}s`;

export function composeTargetsSummaryLine(args: TargetsSummaryArgs): string {
  const { status, goalSec, projectedSec, goalSource, raceName, daysAway,
          vdot, lastMove, heldDays, unsupportedDistance, belowTableAnchorPaceSPerMi } = args;

  // ── Target time exists · speak in real times, keyed by status ─────────
  if (goalSec != null && goalSec > 0 && projectedSec != null && projectedSec > 0) {
    if (status === 'race_week') {
      return `Race week. Projection ${fmt(projectedSec)} against ${fmt(goalSec)}. The work is banked.`;
    }
    if (status === 'on_track') {
      return `On pace for ${fmt(projectedSec)}. Keep doing the work.`;
    }
    if (status === 'watch') {
      return `Projection ${fmt(projectedSec)} against a ${fmt(goalSec)} goal. The next quality run will tell us more.`;
    }
    if (status === 'off') {
      return `Projection ${fmt(projectedSec)} against a ${fmt(goalSec)} goal. The math is honest · time to look at what the plan can still close.`;
    }
    // 'cold' with both numbers shouldn't occur (cold means one is missing) ·
    // fall through to the trend copy rather than assert on-track.
  }

  // ── Ultra target (P2-70) · never say "set a goal" when one exists but the
  // distance is past what the fitness model can honestly project. Distinct
  // from the two branches below, which both assume the absence of a goal. ──
  if (unsupportedDistance) {
    const when = daysAway != null && daysAway >= 0
      ? daysAway === 0 ? ' today'
        : daysAway === 1 ? ' tomorrow'
        : ` in ${daysAway} days`
      : '';
    const named = raceName ? `Racing ${raceName}${when}. ` : '';
    return `${named}Ultra projections aren't supported yet · training targets stay anchored to your current fitness.`;
  }

  // ── Race saved without a time goal (P2-28) · name the race, nudge ─────
  if (goalSource === 'race' && raceName) {
    const when = daysAway != null && daysAway >= 0
      ? daysAway === 0 ? ' today'
        : daysAway === 1 ? ' tomorrow'
        : ` in ${daysAway} days`
      : '';
    return `Racing ${raceName}${when}. Set a time goal to track a projection against it.`;
  }

  // ── No target time · trend copy · current fitness direction ───────────
  const nudge = goalSource === 'fitness_goal'
    ? 'Set a time goal to track a projection against it.'
    : 'Set a goal to track a projection against it.';
  if (lastMove && Math.abs(lastMove.deltaVdot) >= 0.1) {
    const dir = lastMove.deltaVdot > 0 ? 'up' : 'down';
    return `Fitness trending ${dir} · VDOT ${lastMove.prevVdot.toFixed(1)} to ${lastMove.newVdot.toFixed(1)}. ${nudge}`;
  }
  if (vdot != null) {
    const held = heldDays > 1 ? ` for ${heldDays} days` : '';
    return `Fitness holding at VDOT ${vdot.toFixed(1)}${held}. ${nudge}`;
  }
  // 2026-07-07 · AUDIT P1-13 · below-table honest baseline. Before this, a
  // runner whose best race/run implied VDOT < 30 fell all the way to "No
  // baseline yet" — the exact "cold state tells them to race a 5K they
  // already raced" failure the audit named, since their baseline DOES
  // exist, it just doesn't map onto the VDOT number this copy otherwise
  // reports. Speak to the pace itself instead of a VDOT number.
  if (belowTableAnchorPaceSPerMi != null && belowTableAnchorPaceSPerMi > 0) {
    const pace = fmt(Math.round(belowTableAnchorPaceSPerMi));
    return `Building your baseline off a ${pace}/mi effort. ${nudge}`;
  }
  return 'No baseline yet. A steady quality run gives the projection something to read.';
}
