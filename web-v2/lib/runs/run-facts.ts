/**
 * lib/runs/run-facts.ts · THE COHERENT TRIPLE.
 *
 * A run has three headline numbers and they are not independent. Pace is time
 * over distance. Print all three from one row and they must agree, or one of
 * them is a lie and the runner has no way to tell which.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE EXISTS
 *
 * 2026-08-23. David ran 11.01 miles in 5298 seconds — 8:01/mi, on his own
 * watch. Faff pushed the run to Strava, Strava returned a moving time of 2389
 * seconds, and the merge stamped it onto the canonical row BESIDE the watch's
 * figures rather than instead of them. The row then carried, all at once:
 *
 *     distanceMi 11.01 · durationSec 5298 · movingTimeS 2389
 *     elapsedTimeS 2389 · movingSec 2389 · paceSPerMi 217
 *     avgPaceMinPerMi "8:01" · timeMoving "88:23"
 *
 * Three surfaces read that row and printed three different runs:
 *
 *     poster      11.0 mi · 1:28:18 · 3:37/mi     (elapsed clock, Strava pace)
 *     run detail  11.01 mi · 39:49 · 8:01         (Strava clock, watch pace)
 *     log         11.01 mi · 39:49 · 8:01         (same)
 *
 * and the recap told him "Easy 11.0 mi at 3:37/mi. A touch quicker than the
 * 9:22/mi easy target."
 *
 * Every one of those is internally impossible. 11.01 miles in 1:28:18 is not
 * 3:37/mi. 11.01 miles in 39:49 is not 8:01/mi. Each surface had, on the same
 * row, the arithmetic needed to disprove what it was about to print.
 *
 * `runPaceSecPerMi` in `run-shape.ts` states the pace half of this rule, and
 * it is correct. It was also, on the day it landed, called by nothing — every
 * surface still read `data.paceSPerMi` raw. A guard nothing calls is a comment.
 * `lib/conservation/_reader_lint.test.ts` is what stops that recurring.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULE, WHICH IS ARITHMETIC AND NOT PHYSIOLOGY
 *
 * A row is judged only against its own other facts. There is no threshold on
 * human speed here and no doctrine claim, so an elite and a walker are both
 * safe, and so is a genuinely paused run.
 *
 * Moving time cannot exceed elapsed time, and a run cannot be MORE than half
 * paused and still be the same session. A stored moving time — or a stored
 * pace, which implies one — outside that window is not a pause. It is a bad
 * number, and the elapsed clock wins, because it is the one measurement made
 * by the device that ran the session.
 *
 * Whatever clock survives, the pace is derived from it. That is the whole
 * point: the three numbers leave here agreeing with each other, so a surface
 * cannot print a pace its own clock disproves.
 */
import {
  type RunData,
  runDistanceMi,
  runPaceSecPerMi,
} from './run-shape';

/**
 * The largest share of a run that may plausibly be paused before its stored
 * moving time stops being believable. Half.
 *
 * A runner waiting at lights, refilling a bottle or stopping to stretch can
 * lose a lot of a run to pauses; losing MORE than half of it and still calling
 * the remainder the same session is not a run this app has to render
 * faithfully. Well past any honest pause pattern, and tight enough to catch a
 * third party's arithmetic error.
 *
 * Deliberately the same constant, and the same argument, as the one behind
 * `runPaceSecPerMi`. The two must never drift apart.
 */
export const MAX_PAUSED_SHARE = 0.5;

/** Which clock a surface wants to print beside the distance. */
export type ClockBasis = 'moving' | 'elapsed';

/** Where the time in `timeSec` actually came from. */
export type FactsBasis = 'moving' | 'elapsed' | 'none';

export interface RunFacts {
  /** Distance in MILES. Null when the row carries none. */
  distanceMi: number | null;
  /** The clock this run is reported against, seconds. */
  timeSec: number | null;
  /**
   * Seconds per mile. When `distanceMi` and `timeSec` are both present this
   * is exactly `timeSec / distanceMi` — by construction, not by luck.
   */
  paceSecPerMi: number | null;
  /** Which clock `timeSec` came from. */
  basis: FactsBasis;
  /**
   * Elapsed (wall-clock) seconds, when the row carries one. A surface that
   * prints both clocks reads this for the second one.
   */
  elapsedSec: number | null;
  /**
   * The `runs.data` keys this row carried that its own other facts disprove.
   * Empty on a healthy row. Non-empty is a merge that stamped one source's
   * figures beside another's, and is worth reporting rather than only fixing.
   */
  refused: string[];
}

function pos(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Read a run's distance, time and pace as one coherent set.
 *
 * `basis` names the clock the calling surface prefers to print — `'moving'`
 * for the log and run detail, `'elapsed'` for the poster. It is a display
 * preference, not a correctness lever: a preference that the row cannot
 * honour falls through to the clock that survives.
 */
export function runFacts(d: RunData, opts?: { basis?: ClockBasis }): RunFacts {
  const basis: ClockBasis = opts?.basis ?? 'moving';
  const mi = runDistanceMi(d);
  const refused: string[] = [];

  // The elapsed clock. `durationSec` is the watch/HealthKit total and
  // `elapsedTimeS` is Strava's; both are wall-clock, and the larger of the
  // two is the honest outer bound when a merge left both behind. Taking the
  // max is what makes the 2026-08-23 row recoverable: it carried a true
  // durationSec of 5298 and a stamped elapsedTimeS of 2389.
  const durationSec = pos(d.durationSec);
  const elapsedTimeS = pos(d.elapsedTimeS);
  const elapsedSec =
    durationSec != null && elapsedTimeS != null
      ? Math.max(durationSec, elapsedTimeS)
      : durationSec ?? elapsedTimeS;

  /** A candidate moving time is believable only against the row's own clock. */
  const believable = (t: number): boolean =>
    elapsedSec == null || (t <= elapsedSec && t >= elapsedSec * (1 - MAX_PAUSED_SHARE));

  // The stored moving time.
  let movingSec: number | null = null;
  const storedMoving = pos(d.movingTimeS) ?? pos(d.movingSec);
  if (storedMoving != null) {
    if (believable(storedMoving)) movingSec = storedMoving;
    else refused.push(d.movingTimeS != null ? 'movingTimeS' : 'movingSec');
  }

  // A stored pace is itself a claim about moving time, so it is checked the
  // same way. `runPaceSecPerMi` states this rule for the pace alone; calling
  // it keeps the two from drifting rather than restating the arithmetic.
  const storedPace = pos(d.paceSPerMi);
  if (storedPace != null) {
    const checked = runPaceSecPerMi(d);
    if (checked != null && Math.abs(checked - storedPace) > 0.5) refused.push('paceSPerMi');
    else if (movingSec == null && mi != null) {
      // No usable stored moving time, but a pace the row does not disprove.
      // The pace IS the moving-time evidence.
      const implied = storedPace * mi;
      if (believable(implied)) movingSec = implied;
      else if (!refused.includes('paceSPerMi')) refused.push('paceSPerMi');
    }
  }

  const preferred = basis === 'elapsed' ? elapsedSec : movingSec;
  const fallback = basis === 'elapsed' ? movingSec : elapsedSec;
  const timeSec = preferred ?? fallback;
  const resolvedBasis: FactsBasis =
    timeSec == null
      ? 'none'
      : preferred != null
        ? basis
        : basis === 'elapsed'
          ? 'moving'
          : 'elapsed';

  return {
    distanceMi: mi,
    timeSec,
    // THE LAW, made structural. Never a stored key.
    paceSecPerMi: mi != null && mi > 0 && timeSec != null ? timeSec / mi : null,
    basis: resolvedBasis,
    elapsedSec,
    refused,
  };
}
