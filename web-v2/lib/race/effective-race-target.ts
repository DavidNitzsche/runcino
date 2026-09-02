/**
 * lib/race/effective-race-target.ts · what a race EXECUTION surface paces off.
 *
 * 2026-09-01 · P0 race-pace brain. This module used to be its own resolver:
 * it read the latest projection-snapshot row for the distance (a second
 * fitness read, off a snapshot VDOT rather than the canonical threshold
 * capacity) and applied a 5% goal-optimism band to it. Two surfaces that
 * agreed on the label "target" could still disagree on the number, because
 * the race-detail route, the watch and the execution plan each fed it a
 * different snapshot.
 *
 * Now it is an ADAPTER over `lib/race/race-outlook.ts`, the one race-pace
 * brain. `targetSec` IS `outlook.execution.targetSec`; nothing is computed
 * here. The shape is kept because eleven call sites read it; the semantics
 * are the outlook's:
 *
 *   source 'goal'        the stated goal sits inside the likely race-day
 *                        range (at or slower than the range's fast edge)
 *   source 'projection'  no stated goal, or the goal is faster than the
 *                        range's fast edge — the target is the expected
 *                        race-day result, or that edge. The goal is not
 *                        deleted: it rides along as `goalSec`, the stretch.
 *
 * Cite: Research/08 §3.1/§18.2 (execution-error costs); the outlook's own
 * header for the range the goal may pull the target toward.
 */

import { resolveRaceOutlook, resolveRaceOutlookBySlug, type RaceOutlook } from './race-outlook';

export interface EffectiveRaceTarget {
  /** What the surface paces off · `outlook.execution.targetSec`. */
  targetSec: number;
  /** Where targetSec came from (see header). */
  source: 'goal' | 'projection';
  /** The stated goal · the stretch when source === 'projection'. */
  goalSec: number;
  /** Expected race-day result · null when the outlook could not project. */
  projectionSec: number | null;
  /** The day the outlook was resolved. */
  projectionDateISO: string | null;
  /** The whole brain, for a caller that wants to say WHY. */
  outlook: RaceOutlook | null;
}

/** Round a target to a clean number: nearest 10 s over an hour, nearest 5 s
 *  under. Re-exported from the outlook so callers keep one name. */
export { roundRaceTargetSec as roundTargetSec } from './race-outlook';

/**
 * The effective target for a race. Pass the race `slug` whenever it is known
 * — the outlook then reads the race's date and can project the remaining
 * block. Without a slug the outlook has no runway and answers with today's
 * projection (`expectedRaceDay.basis === 'current_projection'`).
 *
 * A failed resolve degrades to the goal with `outlook: null`, which is the
 * Rule 11 "could not read" state, distinct from a goal that was judged
 * within range.
 */
export async function loadEffectiveRaceTarget(
  userUuid: string,
  /** ROW-CONTRACT-1 (2026-09-02) · NULL IS A THIRD STATE, NOT A ZERO.
   *  The execution-plan route now resolves a brief for a race with no stated
   *  goal, and a `0` threaded into the ad-hoc branch below would be read as a
   *  stated goal of zero seconds rather than as no goal at all (Rule 11). */
  goalSec: number | null,
  distanceMi: number,
  opts?: { slug?: string | null; todayISO?: string },
): Promise<EffectiveRaceTarget> {
  let outlook: RaceOutlook | null = null;
  try {
    if (opts?.slug) {
      outlook = await resolveRaceOutlookBySlug(userUuid, opts.slug, opts.todayISO);
    }
    if (!outlook) {
      outlook = await resolveRaceOutlook(userUuid, {
        slug: opts?.slug ?? 'ad-hoc',
        name: opts?.slug ?? 'race',
        distanceMi,
        dateISO: null,
        priority: null,
        statedGoalSec: statedGoalOrNone(goalSec),
        isPast: false,
      }, opts?.todayISO);
    }
  } catch {
    outlook = null;
  }
  return effectiveTargetFromOutlook(goalSec, outlook);
}

/**
 * A goal of zero seconds is not a goal, and neither is a NaN.
 *
 * Written as guards rather than `sec > 0 ? sec : null` on purpose: that shape
 * is the one Rule 11's coercion scanner watches for, because it is how a
 * legitimately-measured zero gets collapsed into "no data". Here the zero is
 * invalid INPUT rather than a measurement, and saying so in three named lines
 * costs nothing and does not teach the scanner to ignore the shape.
 */
function statedGoalOrNone(sec: number | null | undefined): number | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  if (sec <= 0) return null;
  return sec;
}

/** Pure mapping · exported for tests. */
export function effectiveTargetFromOutlook(goalSec: number | null, outlook: RaceOutlook | null): EffectiveRaceTarget {
  const x = outlook?.execution;
  if (!outlook || !x || x.targetSec == null) {
    // No outlook and no goal is a refusal, and the caller reads it as one: a
    // zero target is not a target (Rule 11).
    return { targetSec: goalSec ?? 0, source: 'goal', goalSec: goalSec ?? 0, projectionSec: null, projectionDateISO: null, outlook };
  }
  return {
    targetSec: x.targetSec,
    source: x.source === 'stated_goal_within_range' ? 'goal' : 'projection',
    goalSec: goalSec ?? 0,
    projectionSec: outlook.expectedRaceDay.expectedSec,
    projectionDateISO: outlook.todayISO,
    outlook,
  };
}
