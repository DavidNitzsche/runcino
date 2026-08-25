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

/** "6:48" from seconds per mile. Null in, null out. */
export function formatWorkPace(sPerMi: number | null): string | null {
  if (sPerMi == null || !isFinite(sPerMi) || sPerMi <= 0) return null;
  const m = Math.floor(sPerMi / 60);
  const s = Math.round(sPerMi % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}
