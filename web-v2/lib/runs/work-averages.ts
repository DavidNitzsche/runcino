import { fmtPace } from '@/lib/format/run';
import { runPhases, type RunData } from '@/lib/runs/run-shape';
/**
 * lib/runs/work-averages.ts · the run's numbers with the jogging taken out.
 *
 * ## Why this is its own module
 *
 * A whole-run average asserts that the run was ONE THING. On a session made of
 * pieces that is false, and not by a little: `Research/04` §6.1 prescribes
 * recovery jogs of roughly the same duration as the reps, so a whole-run
 * average heart rate is a near 50/50 blend of two intensities that were never
 * prescribed together. A 12 x 400 session run entirely at 5K pace can report an
 * average heart rate in Z3, which reads as a session that undershot when it did
 * nothing of the kind.
 *
 * `run-state.ts` has computed the work-scoped answer since P44 and only run
 * detail could see it. The post-run Today card needs the same numbers, and the
 * one thing that must not happen is two screens computing them two ways — so
 * the arithmetic moved here and both call it.
 *
 * ## Why the input shape is minimal
 *
 * The two callers hold phases in different shapes. `run-state.ts` has
 * `PhaseBreakdown` (snake_case, `actual_duration_sec` / `avg_hr`); the v5 Today
 * route has the raw `WatchCompletion` phases (camelCase, `durationSec` /
 * `avgHr`). Normalising into this module rather than teaching it both spellings
 * keeps the arithmetic in one place and the mapping at the edges, where the
 * wire shapes actually live.
 */

/** One phase, reduced to what a weighted average needs. */
export interface WorkPhaseSample {
  /** 'work' is the only value that counts. Anything else is context. */
  type: string | null;
  /** Seconds. The weight for every average here — see below. */
  sec: number | null;
  mi: number | null;
  hr: number | null;
  cadence: number | null;
}

export interface WorkAverages {
  paceSPerMi: number | null;
  hrAvg: number | null;
  cadenceAvg: number | null;
  workSeconds: number | null;
}

const EMPTY: WorkAverages = {
  paceSPerMi: null, hrAvg: null, cadenceAvg: null, workSeconds: null,
};

/**
 * Duration-weighted averages across the WORK phases only.
 *
 * WEIGHTED BY TIME, NOT BY COUNT. A session of 4 x 1 km plus 4 x 200 m has
 * eight work phases and the kilometres are five times the effort; a flat mean
 * over the eight would let the short ones pull the number toward a heart rate
 * that had not yet risen. `Research/03` §13 gives the mechanism — HR lags
 * 30-90 s to plateau — so a short rep genuinely carries a lower reading for the
 * same effort, and weighting by time is what stops that from being read as
 * easier work.
 *
 * Returns nulls rather than zeros when nothing qualifies. A session with no
 * work phase has no work average, and zero is a measurement.
 */
export function workAveragesFromPhases(phases: WorkPhaseSample[]): WorkAverages {
  const work = phases.filter((p) => (p.type ?? '').toLowerCase() === 'work');
  if (work.length === 0) return EMPTY;

  let totalSec = 0;
  let totalMi = 0;
  let hrWeighted = 0;
  let hrWeight = 0;
  let cadWeighted = 0;
  let cadWeight = 0;

  for (const p of work) {
    const sec = Number(p.sec) || 0;
    const mi = Number(p.mi) || 0;
    if (sec > 0) totalSec += sec;
    if (mi > 0) totalMi += mi;
    // A phase with no reading contributes to NEITHER the numerator nor the
    // weight. Counting it with a zero would drag the average toward zero and
    // call the result a measurement.
    if (p.hr && sec > 0) { hrWeighted += Number(p.hr) * sec; hrWeight += sec; }
    if (p.cadence && sec > 0) { cadWeighted += Number(p.cadence) * sec; cadWeight += sec; }
  }

  return {
    paceSPerMi: totalMi > 0 && totalSec > 0 ? Math.round(totalSec / totalMi) : null,
    hrAvg: hrWeight > 0 ? Math.round(hrWeighted / hrWeight) : null,
    cadenceAvg: cadWeight > 0 ? Math.round(cadWeighted / cadWeight) : null,
    workSeconds: totalSec > 0 ? Math.round(totalSec) : null,
  };
}

/**
 * "6:48" from seconds per mile. Null in, null out.
 *
 * Delegates. The version this replaces was CORRECT — it carried the minute
 * when the seconds rounded to 60, which nineteen formatters in this repo did
 * not — but it was still a fifth implementation of one rule, and every one of
 * the other four was written by someone equally sure they had it right.
 * `lib/format/run.ts` is where the rule lives; `_format_lint.test.ts` is what
 * noticed this one within the hour.
 */
export function formatWorkPace(sPerMi: number | null): string | null {
  return fmtPace(sPerMi);
}

/** The three work-scoped numbers exactly as the wire carries them. */
export interface WorkStatsWire {
  hrAvgWork: number | null;
  cadenceAvgWork: number | null;
  paceWork: string | null;
}

/**
 * The three work-scoped stats a post-run screen draws, from STORED phases.
 *
 * -- WHY THIS IS HERE AND NOT INLINE IN THE ROUTE (SIMROW-1 · TODAY) ---------
 *
 * `/api/v5/today` mapped the raw phase array into `WorkPhaseSample` itself,
 * with its own hand-written field-name ladder, and then called
 * `workAveragesFromPhases`. That inline mapping was the only thing standing
 * between a test and the numbers the runner actually reads, so a test of the
 * route's work stats had to re-implement it, and a test that re-implements the
 * code it checks cannot fail on the code changing (Rule 18).
 *
 * -- THE NUMERIC CORE COMES FROM ITS OWNER, NOT A LADDER WRITTEN HERE --------
 *
 * `run-shape.ts#runPhases` already owns "what is in a stored phase": the three
 * eras, which fields each populates, that a heart rate outside 30-230 is a
 * strap sentinel rather than a reading, and that a phase carrying `hrSamples`
 * but no `avgHr` still has a measured heart rate. The route's copy knew none
 * of that. `gradeStoredPhases` in `lib/execution/verdict.ts` already routes
 * through the same owner and says so in its own header; this is that decision
 * applied to the second consumer.
 *
 * Two consequences worth stating, because both are behaviour changes:
 *
 *   1. A work phase whose `avgHr` is absent but whose per-second `hrSamples`
 *      are present now CONTRIBUTES its heart rate instead of being skipped.
 *      Those phases are real (every work phase of the owner's 2026-09-03 hill
 *      session is one) and the Today route's `workoutPhases` block already
 *      computed the same fallback inline for its per-phase rows
 *      (WORKOUTPHASES-2). The screen's per-phase column and its work average
 *      now agree by construction rather than by coincidence (Rule 16).
 *   2. The dead legs of the old ladder are gone. It fell back to `durationSec`,
 *      `duration_sec`, `distanceMi`, `distance_mi`, `avg_hr` and `avg_cadence`.
 *      Measured across all 368 stored phases in this account's history, every
 *      `runs.data.phases` element and every `watch_completion` payload, those
 *      six spellings appear ZERO times and the `actual`-prefixed camelCase
 *      ones appear on all of them. The ladder was not compatibility, it was a
 *      guess, and one of its rungs is what made all three numbers null on
 *      every watch-completed run until 2026-09-01.
 *
 * CADENCE IS READ OFF THE ELEMENT BY POSITION, because `NormalizedPhase` does
 * not carry it. Same shape and same argument as `gradeStoredPhases` and
 * `lib/postrun/experience.ts`, both on `_cadence_units`' allowlist for exactly
 * this: `avgCadence` on a watch PHASE is watch-authored and both-feet already,
 * and a run-level unit question is not a phase-level one.
 *
 * ALL THREE COME FROM ONE ARRAY, always. That is the point of returning them
 * as a set rather than as three reads: the defect this function was extracted
 * for put a stranger's heart rate beside a stranger's pace, and a mixed row is
 * the one outcome that must be impossible by construction (Rule 16).
 *
 * A NULL IS NOT A ZERO. `workAveragesFromPhases` weights by time and skips a
 * phase carrying no reading, so a session whose phases have distance and
 * duration but no strap returns a real `paceWork` and a null `hrAvgWork`:
 * "we did not measure it", which is the honest answer, not a reason to
 * suppress a number we did measure (Rule 11).
 */
export function workStatsForDisplay(phases: readonly unknown[]): WorkStatsWire {
  // Pre-filtered so `normalized[i]` and `elements[i]` name the same phase.
  // `runPhases` drops non-objects, and cadence is read off the element.
  const elements = phases.filter(
    (el): el is Record<string, unknown> => !!el && typeof el === 'object' && !Array.isArray(el),
  );
  const normalized = runPhases({ phases: elements } as unknown as RunData);
  const w = workAveragesFromPhases(normalized.map((n, i) => ({
    // `n.type` is null for a spelling outside the four the owner knows. The
    // raw value still decides, because `workAveragesFromPhases` lower-cases
    // and compares it itself, and dropping the phase here would silently
    // shrink the work set (Rule 11).
    type: n.type ?? (typeof elements[i]?.type === 'string' ? (elements[i].type as string) : null),
    sec: n.actualDurationSec,
    mi: n.actualDistanceMi,
    hr: n.avgHr,
    cadence: Number(elements[i]?.avgCadence) || null,
  })));
  return {
    hrAvgWork: w.hrAvg,
    cadenceAvgWork: w.cadenceAvg,
    paceWork: formatWorkPace(w.paceSPerMi),
  };
}
