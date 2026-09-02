/**
 * lib/race/race-hr-guidance.ts · THE race-day heart-rate semantics, resolved
 * once and consumed by the plan row, the phone, the watch, the spoken cues
 * and the post-race read (Phase 3 of the P0 coaching-loop order, 2026-09-01).
 *
 * ── WHY ONE OBJECT ─────────────────────────────────────────────────────────
 *
 * Race day carried a single `hr_cap_bpm` — an AEROBIC-ceiling field graded
 * as a hard cap on every surface — that `spec-builder.ts` filled with a
 * RACE-EFFORT number (the LTHR itself for a half, 92% for a marathon). The
 * owner's own AFC half came in at avg HR 168 against a 168 cap: one beat
 * from amber on his PR, on the phone and the wrist, and not by coincidence,
 * because `lthr-reanchor` had set LTHR *to* that race's average. Meanwhile the
 * `abort` rule (checkpoint avg HR) was authored, persisted, shipped, and read
 * by nothing on the watch. Five meanings, one column, none of them stated.
 *
 * Doctrine (`Research/08` §6.1) states race HR as a BAND per distance — a
 * fraction of LTHR, with drift of 3-5 bpm per hour expected late — never as a
 * ceiling to obey from the gun. This file states each quantity with its own
 * name and its own consumer, and none of them is a pace-derived number.
 *
 *   · expectedRangeBpm     · doctrine's %LTHR band for the distance, the
 *                            informational reference ("expect roughly this")
 *   · earlyCeilingBpm      · the band's LOW edge, through the opening block —
 *                            §3's "go out under control" as a heart-rate line
 *   · lateAllowanceBpm     · the band's high edge plus one hour of doctrine
 *                            drift · where a well-run race may finish
 *   · checkpointAbortBpm   · the existing mid-race abort trigger
 *                            (`raceAbortHrBpm`, band high + margin), evaluated
 *                            as an AVERAGE at the distance's checkpoint mile
 *   · informationalOnly    · true when the runner's OWN evidence at near-race
 *                            pace contradicts the band, so no surface may grade
 *                            or alarm on it — it is shown as a reference and
 *                            the reason is stated
 *
 * ── EVIDENCE, NOT FORMULA ──────────────────────────────────────────────────
 *
 * The band is validated against the runner's own sustained efforts near the
 * execution pace (long runs and races inside ±5% of it). If the observed
 * average sits ABOVE the band's late allowance, the band cannot be an honest
 * instruction for this runner — it is demoted to informational and the
 * conflict is reported. If there is no such evidence, the band stands as
 * doctrine's population reference and says so. Nothing here derives HR from
 * the prescribed pace: the pace decides WHICH evidence is comparable, never
 * the number.
 */
import {
  RACE_HR_PCT_LTHR,
  raceAbortHrBpm,
  raceCheckpointMi,
  raceDistanceCategory,
} from '@/lib/race/distance-doctrine';

/** `Research/08` §6.1 :269 — "drift adds 3-5 bpm/hour". The late-race
 *  allowance spends the upper figure for ONE hour: a marathon finishing at
 *  the band's high edge plus that drift is a well-run race, not a breach. */
export const RACE_HR_LATE_DRIFT_ALLOWANCE_BPM = 5;

/** Sustained efforts within this fraction of the execution pace are
 *  comparable evidence for what the runner's HR does at race intensity.
 *  CONVENTION (the same ±5% width the projection snapshot match already uses). */
export const RACE_HR_EVIDENCE_PACE_TOLERANCE = 0.05;

export interface RaceHrEvidenceRow {
  id: string;
  dateISO: string;
  distanceMi: number;
  paceSecPerMi: number;
  avgHr: number;
  /** 'race' rows are comparable for a half or shorter; for a marathon they
   *  ran faster than the execution pace and are filtered by pace anyway. */
  kind: 'long' | 'race' | 'other';
}

export interface RaceHrGuidance {
  /** The band is only as individual as the LTHR behind it. */
  lthrBpm: number;
  distanceCategory: 'ultra' | 'm' | 'hm' | '10k' | '5k';
  expectedRangeBpm: readonly [number, number];
  earlyCeilingBpm: number;
  /** Miles completed at which `earlyCeilingBpm` stops applying. */
  earlyThroughMi: number;
  lateAllowanceBpm: number;
  checkpointMi: number;
  checkpointAbortBpm: number | null;
  /** True → no surface may grade or alarm on this band; show it as a
   *  reference and say why. */
  informationalOnly: boolean;
  evidence: {
    comparableEfforts: number;
    observedMeanHr: number | null;
    /** Observed mean minus the late allowance; positive = the runner's own
     *  efforts sit above what the band would allow. */
    conflictBpm: number | null;
    efforts: RaceHrEvidenceRow[];
  };
  reasons: RaceHrReason[];
  citation: string;
}

export type RaceHrReason =
  | 'DOCTRINE_BAND_FOR_DISTANCE'
  | 'VALIDATED_AGAINST_OWN_EFFORTS'
  | 'NO_COMPARABLE_EFFORTS_POPULATION_REFERENCE'
  | 'OWN_EFFORTS_EXCEED_BAND_INFORMATIONAL_ONLY'
  | 'NO_LTHR'
  | 'NO_COMPARABLE_EFFORTS_INFORMATIONAL_ONLY';

export function resolveRaceHrGuidance(args: {
  distanceMi: number;
  lthrBpm: number | null;
  maxHrBpm: number | null;
  executionPaceSecPerMi: number;
  efforts: readonly RaceHrEvidenceRow[];
}): RaceHrGuidance | null {
  const cat = raceDistanceCategory(args.distanceMi);
  if (cat == null) return null;
  if (args.lthrBpm == null || !(args.lthrBpm > 0)) return null;
  const lthr = args.lthrBpm;
  const [lo, hi] = RACE_HR_PCT_LTHR[cat];
  const expectedRangeBpm: [number, number] = [Math.round(lthr * lo), Math.round(lthr * hi)];
  const checkpointMi = raceCheckpointMi(args.distanceMi);
  const pace = args.executionPaceSecPerMi;
  const comparable = args.efforts.filter((e) =>
    e.avgHr > 0
    && Math.abs(e.paceSecPerMi - pace) / pace <= RACE_HR_EVIDENCE_PACE_TOLERANCE
    && (cat === 'm' || cat === 'ultra' ? e.kind !== 'race' : true),
  );
  const observedMeanHr = comparable.length > 0
    ? comparable.reduce((a, e) => a + e.avgHr, 0) / comparable.length
    : null;
  const lateAllowanceBpm = expectedRangeBpm[1] + RACE_HR_LATE_DRIFT_ALLOWANCE_BPM;
  const conflictBpm = observedMeanHr != null ? observedMeanHr - lateAllowanceBpm : null;
  // A band with NO personal evidence behind it is a population figure and
  // may inform, never alarm; a band the runner's own efforts contradict is
  // informational for the opposite reason. Enforcement needs evidence.
  const informationalOnly = comparable.length === 0 || (conflictBpm != null && conflictBpm > 0);
  const reasons: RaceHrReason[] = ['DOCTRINE_BAND_FOR_DISTANCE'];
  if (comparable.length === 0) reasons.push('NO_COMPARABLE_EFFORTS_POPULATION_REFERENCE');
  else if (conflictBpm != null && conflictBpm > 0) reasons.push('OWN_EFFORTS_EXCEED_BAND_INFORMATIONAL_ONLY');
  if (comparable.length === 0) reasons.push('NO_COMPARABLE_EFFORTS_INFORMATIONAL_ONLY');
  else reasons.push('VALIDATED_AGAINST_OWN_EFFORTS');
  return {
    lthrBpm: lthr,
    distanceCategory: cat,
    expectedRangeBpm,
    earlyCeilingBpm: expectedRangeBpm[0],
    earlyThroughMi: checkpointMi,
    lateAllowanceBpm,
    checkpointMi,
    checkpointAbortBpm: raceAbortHrBpm({ distanceMi: args.distanceMi, lthr, maxHr: args.maxHrBpm }),
    informationalOnly,
    evidence: {
      comparableEfforts: comparable.length,
      observedMeanHr: observedMeanHr != null ? Math.round(observedMeanHr) : null,
      conflictBpm: conflictBpm != null ? Math.round(conflictBpm) : null,
      efforts: comparable,
    },
    reasons,
    citation: 'Research/08-pacing-and-race-week.md §6.1 (race HR ceilings by distance, %LTHR; drift 3-5 bpm/hour)',
  };
}

/** One runner-facing line, worded for the semantics — never "cap" for a band. */
export function raceHrLine(g: RaceHrGuidance): string {
  const [lo, hi] = g.expectedRangeBpm;
  if (g.informationalOnly) {
    return `Expect roughly ${lo}-${hi} bpm at race effort. Your own efforts at this pace have run higher, so this is a reference, not a line to hold.`;
  }
  return `Expect ${lo}-${hi} bpm. Under ${g.earlyCeilingBpm} through mile ${g.earlyThroughMi}; up to ${g.lateAllowanceBpm} late is drift, not a fault.`;
}
