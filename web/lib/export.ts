/**
 * Assemble the full `.runcino.json` (v1.1.0) from pipeline outputs.
 *
 * Takes: parsed GPX track, pacing input, phase list, fueling plan,
 *        optional Claude rationale, optional fitness summary.
 * Returns: the plan object ready to stringify.
 */

import { formatHMS } from './time';
import type {
  FitnessSummary,
  FuelingSummary,
  GpxTrack,
  Interval,
  PacingInput,
  Phase,
  RuncinoPlan,
} from './types';
import type { FuelPlan } from './fueling';

export interface AssembleInput {
  race: {
    name: string;
    date: string;         // "YYYY-MM-DD"
  };
  track: GpxTrack;
  pacing: PacingInput;
  phases: Phase[];
  fueling: FuelPlan;
  fitnessSummary: FitnessSummary;
  landmarks?: Array<{ atMi: number; label: string }>;
  claudeRationale?: string | null;
  generator?: string;
}

/** Build the flat intervals[] array from phases + fuel + landmarks.
 *  Guarantees contiguity in mile space. */
export function buildIntervals(
  phases: Phase[],
  fueling: FuelPlan,
  landmarks: Array<{ atMi: number; label: string }> = [],
  toleranceSPerMi: number
): Interval[] {
  // Collect non-pace "insertion" events sorted by mile
  type Insertion =
    | { atMi: number; kind: 'fuel'; durationS: number; item: string; gelNumber: number; label: string; phaseIdx: number }
    | { atMi: number; kind: 'landmark'; durationS: number; label: string };
  const insertions: Insertion[] = [];

  for (const a of fueling.anchors) {
    insertions.push({
      atMi: a.atMi,
      kind: 'fuel',
      durationS: 30,
      item: `${fueling.summary.gelBrand} gel · water`,
      gelNumber: a.gelNumber,
      label: `Gel ${a.gelNumber}`,
      phaseIdx: a.phaseIdx,
    });
  }
  for (const l of landmarks) {
    insertions.push({
      atMi: l.atMi,
      kind: 'landmark',
      durationS: 10,
      label: l.label,
    });
  }
  insertions.sort((a, b) => a.atMi - b.atMi);

  const intervals: Interval[] = [];
  let nextIdx = 0;

  const phaseIdxFor = (mi: number): number => {
    for (let i = 0; i < phases.length; i++) {
      if (mi >= phases[i].startMi && mi <= phases[i].endMi) return i;
    }
    return phases.length - 1;
  };

  // Emit pace segments broken up by insertions
  let cursorMi = 0;
  for (const phase of phases) {
    // Find insertions within this phase (excluding the phase boundary start)
    const phaseInsertions = insertions.filter(
      i => i.atMi > phase.startMi && i.atMi <= phase.endMi
    );

    let segStartMi = Math.max(cursorMi, phase.startMi);

    for (const ins of phaseInsertions) {
      // Emit pace segment from segStartMi to ins.atMi
      if (ins.atMi > segStartMi + 0.01) {
        intervals.push({
          index: nextIdx++,
          phase_idx: phase.index,
          kind: 'pace',
          at_mi: Math.round(segStartMi * 100) / 100,
          distance_mi: Math.round((ins.atMi - segStartMi) * 100) / 100,
          target_pace_s_per_mi: phase.targetPaceSPerMi,
          tolerance_s_per_mi: toleranceSPerMi,
          label: phase.label,
        });
      }
      // Emit the insertion
      if (ins.kind === 'fuel') {
        intervals.push({
          index: nextIdx++,
          phase_idx: ins.phaseIdx,
          kind: 'fuel',
          at_mi: Math.round(ins.atMi * 100) / 100,
          duration_s: ins.durationS,
          item: ins.item,
          gel_number: ins.gelNumber,
          label: ins.label,
        });
      } else {
        intervals.push({
          index: nextIdx++,
          phase_idx: phaseIdxFor(ins.atMi),
          kind: 'landmark',
          at_mi: Math.round(ins.atMi * 100) / 100,
          duration_s: ins.durationS,
          label: ins.label,
        });
      }
      segStartMi = ins.atMi;
    }

    // Final pace segment in this phase
    if (phase.endMi > segStartMi + 0.01) {
      intervals.push({
        index: nextIdx++,
        phase_idx: phase.index,
        kind: 'pace',
        at_mi: Math.round(segStartMi * 100) / 100,
        distance_mi: Math.round((phase.endMi - segStartMi) * 100) / 100,
        target_pace_s_per_mi: phase.targetPaceSPerMi,
        tolerance_s_per_mi: toleranceSPerMi,
        label: phase.label,
      });
      segStartMi = phase.endMi;
    }
    cursorMi = phase.endMi;
  }

  return intervals;
}

export function assemblePlan(input: AssembleInput): RuncinoPlan {
  const { race, track, pacing, phases, fueling, fitnessSummary, landmarks, claudeRationale } = input;
  const totalMi = track.totalDistanceM / 1609.344;
  const flatPace = Math.round(pacing.goalFinishS / totalMi);

  const intervals = buildIntervals(phases, fueling, landmarks, pacing.toleranceSPerMi);

  return {
    schema_version: '1.1.0',
    generated_at: new Date().toISOString(),
    generator: input.generator ?? 'runcino-web@0.1.0',
    race: {
      name: race.name,
      date: race.date,
      distance_mi: Math.round(totalMi * 100) / 100,
      distance_m: Math.round(track.totalDistanceM),
      total_gain_ft: Math.round(track.smoothedGainFt),
      total_loss_ft: Math.round(track.smoothedLossFt),
    },
    goal: {
      finish_time_s: pacing.goalFinishS,
      finish_time_display: formatHMS(pacing.goalFinishS),
      strategy: pacing.strategy,
      flat_pace_s_per_mi: flatPace,
      warmup: pacing.warmup?.distanceMi
        ? { enabled: true, distance_mi: pacing.warmup.distanceMi, pace_s_per_mi: pacing.warmup.paceSPerMi }
        : { enabled: false, distance_mi: 0, pace_s_per_mi: null },
      claude_rationale: claudeRationale ?? null,
    },
    fitness_summary: {
      baseline_race: fitnessSummary.baselineRace
        ? {
            name: fitnessSummary.baselineRace.name,
            finish_s: fitnessSummary.baselineRace.finishS,
            months_ago: fitnessSummary.baselineRace.monthsAgo,
          }
        : null,
      weekly_mileage: fitnessSummary.weeklyMileage,
      weekly_mileage_trend_6wk: fitnessSummary.weeklyMileageTrend6Wk,
      longest_recent_long_run_mi: fitnessSummary.longestRecentLongRunMi,
      longest_recent_long_run_age_wk: fitnessSummary.longestRecentLongRunAgeWk,
      resting_hr_bpm: fitnessSummary.restingHrBpm,
      resting_hr_trend_8wk: fitnessSummary.restingHrTrend8Wk,
      age: fitnessSummary.age,
      weight_lb: fitnessSummary.weightLb,
      source: fitnessSummary.source,
    } as unknown as typeof fitnessSummary,
    tolerance: { pace_s_per_mi: pacing.toleranceSPerMi },
    phases: phases.map(p => ({
      index: p.index,
      label: p.label,
      start_mi: p.startMi,
      end_mi: p.endMi,
      distance_mi: p.distanceMi,
      target_pace_s_per_mi: p.targetPaceSPerMi,
      target_pace_display: p.targetPaceDisplay,
      mean_grade_pct: p.meanGradePct,
      elevation_gain_ft: p.elevationGainFt,
      elevation_loss_ft: p.elevationLossFt,
      cumulative_time_s: p.cumulativeTimeS,
      cumulative_time_display: p.cumulativeTimeDisplay,
      note: p.note,
    })),
    intervals,
    fueling: {
      carb_target_g_per_hr: fueling.summary.carbTargetGPerHr,
      total_carbs_g: fueling.summary.totalCarbsG,
      gel_count: fueling.summary.gelCount,
      gel_carbs_g: fueling.summary.gelCarbsG,
      gel_brand: fueling.summary.gelBrand,
      notes: fueling.summary.notes,
    },
    brief: null,
  };
}
