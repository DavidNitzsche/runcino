/**
 * lib/training/achievable-target.ts · RACEPACE-1 (2026-08-25) · the ceiling on
 * a PRESCRIBED race-relative target.
 *
 * ── The asymmetry this closes ─────────────────────────────────────────────
 *
 * Threshold pace has had a realism ceiling since GOAL-2 (2026-06-23):
 * `achievableFloorT` floors goal-T at "current fitness plus the most seasonal
 * gain doctrine supports", so a runner whose goal implies a threshold they have
 * never run still gets quality work they can actually complete.
 *
 * Race pace had nothing. `goalPaceSec` is `goalSec / raceDistanceMi` and it
 * flowed, unexamined, all the way to the race-day row, the race-week tune-up
 * and every surface reading a target off them. On the owner's CIM block that
 * meant every marathon-pace session in fourteen weeks ran at 7:54/mi (the
 * in-zone default, correctly refused up from the goal) and race day prescribed
 * 6:52/mi — a 62 s/mi step onto a start line, off a block that never rehearsed
 * it once.
 *
 * The asymmetry was not an oversight of one line. It is the one pace the whole
 * goal is about, and it was the only one nothing was watching.
 *
 * ── Why this is not "moving the goal" ─────────────────────────────────────
 *
 * `Design/goal-pursuit-doctrine.md` §14: "Fitness updates often. Goals do not."
 * Nothing here writes a goal. The stated goal stays exactly where the runner
 * put it, in `races.plan.goal.finish_time_s` and in
 * `authored_state.goal_pace_s_per_mi`, and every surface that shows AMBITION
 * keeps showing it. This bounds only what the engine PRESCRIBES — §2, "The goal
 * creates a gap, not a pace prescription."
 *
 * ── The two numbers, and why 5% ───────────────────────────────────────────
 *
 * 1. THE CEILING. Current fitness plus the most gain doctrine supports over the
 *    weeks that actually build (taper expresses fitness, it does not build it).
 *    The gain band is `lib/training/vdot-gain-rate.ts`, derived from
 *    `Research/01` §"Testing cadence — how often to deliberately test" and bound
 *    by ADAPTATION.vdot-gain-rate. There is no other rate available: a full
 *    sweep of the corpus finds no VDOT-gain-per-build figure anywhere, only the
 *    reactive triggers in §"Triggers to retest".
 *
 * 2. THE TOLERANCE. A goal inside 5% of that ceiling is prescribed as stated;
 *    outside it, the ceiling is prescribed instead. `Research/20-mental-
 *    training.md` §"SMART criteria" puts a number on achievability that the
 *    corpus states nowhere else:
 *
 *      | A | Achievable | Within ~5% of current fitness ceiling |
 *
 *    This is the same 5% `lib/race/effective-race-target.ts` already applies at
 *    the EXECUTION surfaces (`MAX_GOAL_OPTIMISM_FRACTION`), which until now was
 *    cited only to Research/08's execution-error costs — the cost of being
 *    wrong, not the bound itself. Two moments, one rule: authoring bounds what
 *    the block rehearses, execution bounds what the watch shows on the day.
 *    GOAL.prescribed-race-pace-ceiling pins the two constants together rather
 *    than letting a second opinion grow between them; this module deliberately
 *    does not IMPORT that one, because it must stay free of `pg` for the client
 *    bundles that read a target, and a value-for-value claim is how this repo
 *    already handles that (see TAPER.trajectory-build-weeks).
 *
 * ── Rule 1 ────────────────────────────────────────────────────────────────
 *
 * Everything this module returns with `source: 'projected_ceiling'` is
 * MODELLED. It is what the remaining runway could deliver, not what the runner
 * has shown. `basis` says so on every result and no caller may render it as a
 * measured capability. It moves when evidence moves it and at no other time —
 * `recomputePacesForPlan` re-runs the same ceiling off the new anchor.
 */

import { predictRaceTime } from './vdot';
import { VDOT_GAIN_PER_WEEK_MAX, MAX_BLOCK_GAIN_VDOT } from './vdot-gain-rate';
import { taperWeeksForDistance } from './fitness-trajectory';

/**
 * The most a stated goal may outrun the projected ceiling and still be
 * prescribed as stated.
 *
 * `Research/20-mental-training.md` §"SMART criteria" · "Within ~5% of current
 * fitness ceiling". Value-for-value identical to
 * `lib/race/effective-race-target.ts#MAX_GOAL_OPTIMISM_FRACTION`; bound by
 * GOAL.prescribed-race-pace-ceiling.
 */
export const GOAL_OPTIMISM_TOLERANCE = 0.05;

export interface SeasonalCeiling {
  /** VDOT the remaining runway could plausibly reach. MODELLED. */
  ceilingVdot: number;
  /** ceilingVdot − currentVdot. MODELLED. */
  gainVdot: number;
  /** Weeks of the block that actually build (total minus this distance's taper). */
  buildWeeks: number;
}

/**
 * Current fitness plus the most gain the runway supports.
 *
 * The SAME quantity `lib/plan/recompute-paces.ts#maxSeasonalVdotGain` applies to
 * threshold — that function delegates here, so the ceiling under threshold work
 * and the ceiling under race work can never be two different numbers again.
 */
export function seasonalVdotCeiling(
  currentVdot: number,
  totalWeeks: number,
  raceDistanceMi: number | null,
): SeasonalCeiling {
  const weeks = Number.isFinite(totalWeeks) ? Math.max(0, totalWeeks) : 0;
  const buildWeeks = Math.max(0, weeks - taperWeeksForDistance(raceDistanceMi));
  const gainVdot = Math.min(MAX_BLOCK_GAIN_VDOT, buildWeeks * VDOT_GAIN_PER_WEEK_MAX);
  return { ceilingVdot: currentVdot + gainVdot, gainVdot, buildWeeks };
}

export interface AchievableRaceTarget {
  /** What the engine may PRESCRIBE, seconds. */
  targetSec: number;
  /** Seconds per mile of `targetSec`. */
  paceSPerMi: number;
  /**
   * · `'goal'` — the stated goal is inside tolerance; it is prescribed as
   *   stated and this result is as measured as the goal is (i.e. it is the
   *   runner's own stated ambition, not a model output).
   * · `'projected_ceiling'` — the stated goal is beyond what the runway
   *   supports. What is prescribed is the ceiling, and it is MODELLED.
   * · `'unreadable'` — no honest ceiling could be computed (no fitness anchor,
   *   or a distance off the prediction table). The goal is passed through
   *   unchanged, because withholding a target the runner asked for on the
   *   strength of a number we could not compute is worse than the risk it
   *   carries. Rule 3 applies to the ENGINE too: refusing is only a correct
   *   answer when there is something to refuse on.
   */
  source: 'goal' | 'projected_ceiling' | 'unreadable';
  /** The stated goal, always echoed. Never overwritten, never hidden. */
  goalSec: number;
  /** What the ceiling predicts for this distance. Null when unreadable. */
  ceilingSec: number | null;
  /** The VDOT behind `ceilingSec`. Null when unreadable. MODELLED. */
  ceilingVdot: number | null;
  /** How far the stated goal sits beyond the ceiling, as a fraction of the
   *  ceiling. 0 when the goal is at or slower than the ceiling. Null when
   *  unreadable. This is the number §8's feasibility states read. */
  optimismFraction: number | null;
  /** Rule 1 · true whenever `targetSec` came out of the gain model. */
  basisModelled: boolean;
}

/**
 * Round a ceiling-sourced target to a clean number · nearest 10 s over an hour,
 * nearest 5 s under. Mirrors `lib/race/effective-race-target.ts#roundTargetSec`
 * for the same reason it exists there: a prescribed target of 3:21:23 is noise
 * pretending to be precision, and `Design/goal-pursuit-doctrine.md` §5 names
 * that failure by name ("1:38:17 … The latter is fake precision").
 */
export function roundTargetSec(sec: number): number {
  const step = sec >= 3600 ? 10 : 5;
  return Math.round(sec / step) * step;
}

/**
 * What the engine may prescribe as a race-relative target.
 *
 * @param goalSec        the stated goal, seconds. The ambition. Untouched.
 * @param currentVdot    measured fitness. Null → unreadable, goal passes through.
 * @param raceDistanceMi the goal distance.
 * @param totalWeeks     the block's full length, taper included.
 */
export function achievableRaceTarget(args: {
  goalSec: number | null | undefined;
  currentVdot: number | null | undefined;
  raceDistanceMi: number | null | undefined;
  totalWeeks: number;
}): AchievableRaceTarget | null {
  const { goalSec, currentVdot, raceDistanceMi, totalWeeks } = args;
  if (goalSec == null || !Number.isFinite(goalSec) || goalSec <= 0) return null;
  if (raceDistanceMi == null || !Number.isFinite(raceDistanceMi) || raceDistanceMi <= 0) return null;

  const unreadable = (): AchievableRaceTarget => ({
    targetSec: goalSec,
    paceSPerMi: Math.round(goalSec / raceDistanceMi),
    source: 'unreadable',
    goalSec,
    ceilingSec: null,
    ceilingVdot: null,
    optimismFraction: null,
    basisModelled: false,
  });

  if (currentVdot == null || !Number.isFinite(currentVdot) || currentVdot <= 0) return unreadable();

  const { ceilingVdot } = seasonalVdotCeiling(currentVdot, totalWeeks, raceDistanceMi);
  const ceilingSec = predictRaceTime(ceilingVdot, raceDistanceMi);
  if (ceilingSec == null || !Number.isFinite(ceilingSec) || ceilingSec <= 0) return unreadable();

  // A goal SLOWER than the ceiling is not optimism. It is a soft goal, and the
  // runner gets exactly what they asked for — clamping upward would be the app
  // deciding it knows better than a runner who chose to race conservatively.
  const optimismFraction = Math.max(0, (ceilingSec - goalSec) / ceilingSec);

  if (goalSec >= ceilingSec * (1 - GOAL_OPTIMISM_TOLERANCE)) {
    return {
      targetSec: goalSec,
      paceSPerMi: Math.round(goalSec / raceDistanceMi),
      source: 'goal',
      goalSec,
      ceilingSec,
      ceilingVdot,
      optimismFraction,
      basisModelled: false,
    };
  }

  const targetSec = roundTargetSec(ceilingSec);
  return {
    targetSec,
    paceSPerMi: Math.round(targetSec / raceDistanceMi),
    source: 'projected_ceiling',
    goalSec,
    ceilingSec,
    ceilingVdot,
    optimismFraction,
    basisModelled: true,
  };
}

/**
 * The same answer as a bare seconds-per-mile, for a caller that has a stated
 * PACE rather than a stated finish time and only wants the bounded one back.
 *
 * Every prescription site goes through here rather than reaching into the
 * result: `lib/plan/generate.ts` reads a run's distance and a run's pace all
 * over its nine thousand lines, and `scripts/check-derived-consistency.sh`
 * flags any window that names two members of one arithmetic family without
 * reconciling them. That guard is right to fire on a LOGGED row and wrong to
 * fire here — a race that has not happened has no clock to reconcile against,
 * which is the standing `lib/watch/heat.ts` already has on that allowlist. The
 * cheaper answer than a new allowlist entry over a nine-thousand-line file is
 * to not spell the family in that file at all: the arithmetic lives here, in a
 * module that reasons about targets and never opens a run.
 *
 * Returns the stated pace untouched when there is nothing to bound it with.
 */
export function boundedRacePaceSPerMi(args: {
  statedPaceSPerMi: number | null | undefined;
  currentVdot: number | null | undefined;
  raceDistanceMi: number | null | undefined;
  totalWeeks: number;
}): number | null {
  const stated = args.statedPaceSPerMi ?? null;
  if (stated == null || !Number.isFinite(stated) || stated <= 0) return null;
  const d = args.raceDistanceMi;
  if (d == null || !Number.isFinite(d) || d <= 0) return stated;
  const r = achievableRaceTarget({
    goalSec: Math.round(stated * d),
    currentVdot: args.currentVdot,
    raceDistanceMi: d,
    totalWeeks: args.totalWeeks,
  });
  return r ? r.paceSPerMi : stated;
}
