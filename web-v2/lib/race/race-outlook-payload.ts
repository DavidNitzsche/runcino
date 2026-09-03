/**
 * lib/race/race-outlook-payload.ts · the wire shape of the race-pace brain.
 *
 * Additive, snake_case, every number named for the quantity it is. The
 * phone decodes what it knows and ignores the rest. Nothing here is
 * computed — it is `RaceOutlook`, serialised.
 */
import type { RaceOutlook } from './race-outlook';
import { formatRaceTime } from '@/lib/training/vdot';
import { roundTo } from '@/lib/format/run';

function pace(sec: number | null): string | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function time(sec: number | null): string | null {
  return sec == null ? null : formatRaceTime(sec);
}
function range(r: readonly [number, number] | null): { lo_sec: number; hi_sec: number; lo: string | null; hi: string | null } | null {
  return r ? { lo_sec: Math.round(r[0]), hi_sec: Math.round(r[1]), lo: time(r[0]), hi: time(r[1]) } : null;
}

export function raceOutlookPayload(o: RaceOutlook | null | undefined) {
  if (!o) return null;
  return {
    model_version: o.modelVersion,
    resolved_at: o.resolvedAt,
    stated_goal: { sec: o.statedGoal.sec, display: time(o.statedGoal.sec), pace: pace(o.statedGoal.paceSecPerMi) },
    current_projection: {
      sec: o.currentProjection.expectedSec,
      display: time(o.currentProjection.expectedSec),
      pace: o.currentProjection.expectedSec != null && o.race.distanceMi > 0 ? pace(o.currentProjection.expectedSec / o.race.distanceMi) : null,
      likely_range: range(o.currentProjection.likelyRangeSec),
      confidence: o.currentProjection.confidence,
      basis: o.currentProjection.basis,
      primary_limiter: o.currentProjection.primaryLimiter,
    },
    training_prescription: {
      kind: o.trainingPrescription.kind,
      pace_s_per_mi: o.trainingPrescription.paceSecPerMi,
      pace: pace(o.trainingPrescription.paceSecPerMi),
      pace_range: o.trainingPrescription.rangeSecPerMi
        ? { lo: pace(o.trainingPrescription.rangeSecPerMi[0]), hi: pace(o.trainingPrescription.rangeSecPerMi[1]) }
        : null,
      evidence: o.trainingPrescription.evidence,
      demonstrated_pace: pace(o.trainingPrescription.demonstratedPaceSecPerMi),
      rests_on_one_long_race: o.trainingPrescription.restsOnOneLongRace,
      threshold_pace: pace(o.trainingPrescription.thresholdSecPerMi),
      endurance_exponent: o.trainingPrescription.enduranceExponent,
      personally_evidenced: o.trainingPrescription.personallyEvidenced,
      why: o.trainingPrescription.whyThisPace,
    },
    expected_improvement: {
      gain_vdot: roundTo(o.expectedImprovement.gainVdot, 2),
      gain_range_vdot: o.expectedImprovement.gainRangeVdot.map((v) => roundTo(v, 2)),
      build_weeks: o.expectedImprovement.buildWeeks,
      execution_quality: o.expectedImprovement.executionQuality,
      basis: o.expectedImprovement.basis,
      confidence: roundTo(o.expectedImprovement.confidence, 2),
    },
    expected_race_day: {
      sec: o.expectedRaceDay.expectedSec,
      display: time(o.expectedRaceDay.expectedSec),
      pace: o.expectedRaceDay.expectedSec != null && o.race.distanceMi > 0 ? pace(o.expectedRaceDay.expectedSec / o.race.distanceMi) : null,
      likely_range: range(o.expectedRaceDay.likelyRangeSec),
      confidence: o.expectedRaceDay.confidence,
      basis: o.expectedRaceDay.basis,
    },
    execution: {
      target_sec: o.execution.targetSec,
      target_display: time(o.execution.targetSec),
      pace_s_per_mi: o.execution.paceSecPerMi,
      pace: pace(o.execution.paceSecPerMi),
      pace_band: o.execution.paceBandSecPerMi ? { lo: pace(o.execution.paceBandSecPerMi[0]), hi: pace(o.execution.paceBandSecPerMi[1]) } : null,
      source: o.execution.source,
      strategy: o.execution.strategyLabel,
      reason: o.execution.reasonVsExpected,
      hr: o.execution.hr
        ? {
            expected_range_bpm: o.execution.hr.expectedRangeBpm,
            early_ceiling_bpm: o.execution.hr.earlyCeilingBpm,
            early_through_mi: o.execution.hr.earlyThroughMi,
            late_allowance_bpm: o.execution.hr.lateAllowanceBpm,
            checkpoint_mi: o.execution.hr.checkpointMi,
            checkpoint_abort_bpm: o.execution.hr.checkpointAbortBpm,
            informational_only: o.execution.hr.informationalOnly,
            comparable_efforts: o.execution.hr.evidence.comparableEfforts,
            reasons: o.execution.hr.reasons,
          }
        : null,
    },
    /**
     * RP-2 (2026-09-03) · Q7'S FOURTH LAYER REACHED NO SURFACE.
     *
     * `race-outlook.ts` has resolved `conditionalUpside` since EXECTARGET-1 and
     * this serialiser never carried it, so the one thing that keeps the fast
     * edge of the range from being mistaken for the target — the criteria
     * attached to it — existed only in server memory. On the owner's CIM,
     * measured live 2026-09-02, that is 3:13:30 · 7:23/mi: the exact number
     * that used to BE the execution target, and the exact number a page
     * without this field has no way to explain.
     *
     * `PROGRESSIVE_BASELINE_DOCTRINE.md` Q7 asks for four layers. Three
     * shipped.
     */
    conditional_upside: o.conditionalUpside
      ? {
          sec: o.conditionalUpside.targetSec,
          display: time(o.conditionalUpside.targetSec),
          pace: pace(o.conditionalUpside.paceSecPerMi),
          confidence: o.conditionalUpside.confidence,
          criteria: o.conditionalUpside.criteria,
        }
      : null,
    /**
     * RP-3 · "Race day cannot ask for a pace the block never made credible."
     * The seam between the last authored marathon-effort rehearsal and the
     * execution target. Rule 11: `credible: false` with a null gap is "the
     * block rehearses nothing", which is a different fact from a gap that is
     * too wide, and `reason` says which.
     */
    block_seam: o.blockSeam
      ? {
          last_rehearsal_pace: pace(o.blockSeam.lastRehearsalSecPerMi),
          execution_pace: pace(o.blockSeam.executionSecPerMi),
          gap_s_per_mi: o.blockSeam.gapSecPerMi != null ? Math.round(o.blockSeam.gapSecPerMi) : null,
          credible: o.blockSeam.credible,
          reason: o.blockSeam.reason,
        }
      : null,
    goal_feasibility: {
      status: o.goalFeasibility.status,
      gap_sec: o.goalFeasibility.gapSec,
      gap_to_range_edge_sec: o.goalFeasibility.gapToRangeEdgeSec,
    },
    bridge: o.bridge.map((b) => ({
      step: b.step,
      label: b.label,
      value: b.value,
      value_sec: b.valueSec,
      pace: pace(b.paceSecPerMi),
      range: range(b.rangeSec),
      confidence: b.confidence != null ? roundTo(b.confidence, 2) : null,
      evidence: b.evidence,
      change_trigger: b.changeTrigger,
      differs_from_previous: b.differsFromPrevious,
    })),
    change_triggers: o.changeTriggers,
    staleness: {
      newest_evidence: o.staleness.newestEvidenceISO,
      evidence_age_days: o.staleness.evidenceAgeDays,
      stale: o.staleness.stale,
    },
    capacity: {
      threshold_pace: pace(o.capacity.thresholdSecPerMi),
      threshold_vdot: o.capacity.thresholdVdot,
      source_mode: o.capacity.sourceMode,
      confidence: roundTo(o.capacity.confidence, 2),
      newest_evidence: o.capacity.newestEvidenceISO,
      durability_exponent: o.capacity.durabilityExponent,
      durability_races: o.capacity.durabilityRaces,
    },
    flags: o.flags,
  };
}
export type RaceOutlookPayload = ReturnType<typeof raceOutlookPayload>;
