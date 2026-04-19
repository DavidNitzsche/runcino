/**
 * Post-race retrospective engine.
 *
 * Given a RuncinoPlan (what was planned) and an ActualRace (what
 * happened, imported from the Apple Watch workout export), compute
 * structured comparisons: per-phase deltas, HR envelope stats, drift
 * analysis, personal GAP calibration coefficients.
 *
 * This is the deterministic, testable layer. Claude then writes the
 * narrative on top via /api/retrospective.
 */

import type { RuncinoPlan } from './types';

export interface ActualSplit {
  /** Phase index, matches plan.phases[i].index */
  phaseIdx: number;
  /** Average pace actually run in this phase, in seconds per mile */
  actualPaceSPerMi: number;
  /** Average HR observed in this phase (bpm) */
  meanHrBpm: number;
  /** Max HR observed in this phase (bpm) */
  peakHrBpm: number;
}

export interface ActualRace {
  race_name: string;
  race_date: string;
  finish_time_s: number;
  avg_hr_bpm: number;
  peak_hr_bpm: number;
  /** Wall-clock weather snapshot captured before the race */
  weather: {
    start_temp_f: number;
    finish_temp_f: number;
    wind_mph: number;
    wind_dir: string;
    cloud_cover: string;
  };
  /** One row per plan phase. Must match plan.phases length and order. */
  splits: ActualSplit[];
  /** Optional sparse pace/HR series for chart rendering (can be empty) */
  series: Array<{ atMi: number; paceSPerMi: number; hrBpm: number }>;
}

export interface PhaseDelta {
  phaseIdx: number;
  label: string;
  plannedPaceSPerMi: number;
  actualPaceSPerMi: number;
  /** positive = slower than plan, negative = faster */
  deltaSPerMi: number;
  /** cumulative time drift in seconds at the end of this phase */
  cumulativeTimeDriftS: number;
  meanHrBpm: number;
  peakHrBpm: number;
  /** qualitative: held plan, small drift, large drift */
  status: 'on_plan' | 'small_drift' | 'large_drift';
}

export interface Retrospective {
  race_name: string;
  race_date: string;
  planned_finish_s: number;
  actual_finish_s: number;
  /** positive = slower than goal */
  finish_delta_s: number;
  phase_deltas: PhaseDelta[];
  /** Personal GAP calibration — ratio of actual to planned time on
   *  climbs and descents. 1.0 means you ran exactly as predicted;
   *  >1 means you were slower than predicted for that grade type. */
  calibration: {
    climb_coefficient: number;
    descent_coefficient: number;
    /** s/mi drift per mph of headwind — derived from exposed sections */
    headwind_sensitivity_s_per_mi_per_mph: number | null;
    /** Total HR drift over the race (late - early avg) */
    hr_drift_bpm: number;
  };
  /** Three structured takeaways for the next race — short strings. */
  takeaways: Array<{
    title: string;
    note: string;
  }>;
}

function paceDeltaStatus(deltaSPerMi: number): PhaseDelta['status'] {
  const abs = Math.abs(deltaSPerMi);
  if (abs <= 5) return 'on_plan';
  if (abs <= 15) return 'small_drift';
  return 'large_drift';
}

export function computeRetrospective(plan: RuncinoPlan, actual: ActualRace): Retrospective {
  if (actual.splits.length !== plan.phases.length) {
    throw new Error(
      `Actual has ${actual.splits.length} splits; plan has ${plan.phases.length} phases`
    );
  }

  let cumulativeDriftS = 0;
  const phaseDeltas: PhaseDelta[] = plan.phases.map((p, i) => {
    const a = actual.splits[i];
    const delta = a.actualPaceSPerMi - p.target_pace_s_per_mi;
    cumulativeDriftS += delta * p.distance_mi;
    return {
      phaseIdx: p.index,
      label: p.label,
      plannedPaceSPerMi: p.target_pace_s_per_mi,
      actualPaceSPerMi: a.actualPaceSPerMi,
      deltaSPerMi: Math.round(delta),
      cumulativeTimeDriftS: Math.round(cumulativeDriftS),
      meanHrBpm: a.meanHrBpm,
      peakHrBpm: a.peakHrBpm,
      status: paceDeltaStatus(delta),
    };
  });

  // Climb / descent calibration: among phases with mean_grade_pct > 2
  // (climb) or < -2 (descent), how did actual pace compare to plan?
  // Coefficient = actual_time / planned_time. 1.0 = exactly as predicted.
  const climbPhases = plan.phases
    .map((p, i) => ({ p, a: actual.splits[i] }))
    .filter(x => x.p.mean_grade_pct > 2);
  const descentPhases = plan.phases
    .map((p, i) => ({ p, a: actual.splits[i] }))
    .filter(x => x.p.mean_grade_pct < -2);

  const climbCoef =
    climbPhases.length > 0
      ? climbPhases.reduce((s, x) => s + x.a.actualPaceSPerMi / x.p.target_pace_s_per_mi, 0) / climbPhases.length
      : 1.0;
  const descentCoef =
    descentPhases.length > 0
      ? descentPhases.reduce((s, x) => s + x.a.actualPaceSPerMi / x.p.target_pace_s_per_mi, 0) / descentPhases.length
      : 1.0;

  // Headwind sensitivity: if wind is above 5 mph and we have a
  // large_drift phase, attribute the drift to wind.
  let windSensitivity: number | null = null;
  if (actual.weather.wind_mph >= 5) {
    const exposedDrift = phaseDeltas
      .filter(pd => pd.status === 'large_drift' && pd.deltaSPerMi > 0);
    if (exposedDrift.length > 0) {
      const avgDrift = exposedDrift.reduce((s, pd) => s + pd.deltaSPerMi, 0) / exposedDrift.length;
      windSensitivity = Math.round((avgDrift / actual.weather.wind_mph) * 10) / 10;
    }
  }

  // HR drift: first-third mean vs last-third mean
  const thirds = Math.max(1, Math.floor(actual.splits.length / 3));
  const early = actual.splits.slice(0, thirds).reduce((s, a) => s + a.meanHrBpm, 0) / thirds;
  const late = actual.splits.slice(-thirds).reduce((s, a) => s + a.meanHrBpm, 0) / thirds;
  const hrDrift = Math.round(late - early);

  // Takeaways — deterministic rules. Claude layer writes prose on top.
  const takeaways: Retrospective['takeaways'] = [];
  if (Math.abs(climbCoef - 1.0) < 0.05) {
    takeaways.push({
      title: 'Trust the climb pacing',
      note: 'Climb splits landed within 5% of target. The Minetti GAP model is well-calibrated for your current fitness — don\'t second-guess the pace on next race\'s climbs.',
    });
  } else if (climbCoef > 1.08) {
    takeaways.push({
      title: 'Climb pacing was aggressive',
      note: 'Actual climb pace was over 8% slower than planned. Reduce climb GAF expectation for next race, or accept a slightly slower goal on hilly courses.',
    });
  }
  if (windSensitivity !== null && windSensitivity > 0) {
    takeaways.push({
      title: 'Buffer for wind on exposed sections',
      note: `Observed +${windSensitivity} sec/mi drift per mph of headwind on exposed sections. Add headroom in any forecast showing >8 mph headwind.`,
    });
  }
  if (hrDrift < 6) {
    takeaways.push({
      title: 'Fueling and pacing held up',
      note: 'HR drifted less than 6 bpm from early to late race — a signal that fueling and pacing were sustainable. Don\'t change the gel timing.',
    });
  } else {
    takeaways.push({
      title: 'HR drifted late — review fueling',
      note: `HR drifted ${hrDrift} bpm late in the race. Could be heat, fuel timing, or pacing too aggressive early. Audit before the next race.`,
    });
  }

  return {
    race_name: actual.race_name,
    race_date: actual.race_date,
    planned_finish_s: plan.goal.finish_time_s,
    actual_finish_s: actual.finish_time_s,
    finish_delta_s: actual.finish_time_s - plan.goal.finish_time_s,
    phase_deltas: phaseDeltas,
    calibration: {
      climb_coefficient: Math.round(climbCoef * 100) / 100,
      descent_coefficient: Math.round(descentCoef * 100) / 100,
      headwind_sensitivity_s_per_mi_per_mph: windSensitivity,
      hr_drift_bpm: hrDrift,
    },
    takeaways: takeaways.slice(0, 3),
  };
}
