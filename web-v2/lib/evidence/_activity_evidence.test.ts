/**
 * lib/evidence/_activity_evidence.test.ts · the Evidence Engine's gate.
 *
 * Two locked reference cases are the spec, so they are the fixtures:
 *
 *   · `docs/reference-cases/easy-run-warm-conditions-2026-08-31.md` — the
 *     RESTRAINT case. Its §24 is an explicit fifteen-point acceptance
 *     checklist, and each point below names the item it covers.
 *   · `docs/reference-cases/structured-long-run-2026-08-30.md` — the STRUCTURE
 *     case. Its Part 1 requires structure to be inferred without a label, its
 *     Part 2 states what to conclude, and its Part 3 requires the third
 *     outcome: evidence that challenges a belief without updating it.
 *
 * ── PROVENANCE OF THE TWO SPLIT ARRAYS, STATED PLAINLY ─────────────────────
 *
 * `LONG_RUN_SPLITS` is the LIVE production array, transcribed verbatim from
 * `runs.id = -245190372869167`, `data.splits`. `_activity_evidence.audit.test.ts`
 * reads the same row over the read-only role and asserts these values still
 * match, so this fixture cannot drift from production without a test failing.
 *
 * `EASY_RUN_SPLITS` is NOT in the database. The 2026-08-31 row carries
 * `splits_unreliable: true` and `splits_validation: {deltaS: -110, durationS:
 * 3095, splitsSumS: 2985, droppedCount: 7}` — SEVEN splits were computed at
 * ingest and DROPPED, and the count matches the seven rows the reference case
 * §3 prints exactly. The array here is transcribed from that document, which
 * the runner read off his own watch. It is used as a SYNTHETIC fixture for the
 * general logic, and it is labelled as such rather than presented as a
 * database read. The audit test runs the SAME classifier against the row as it
 * actually stands — with no splits — and asserts the honestly degraded result,
 * so nothing here is smuggling a fabricated array into a claim about
 * production.
 *
 * ── WHAT THIS SUITE CANNOT FAIL ON (Rule 22) ───────────────────────────────
 *
 * It cannot fail on a wrong LTHR, a wrong temperature, or a splits array that
 * is internally consistent but describes a different run — every one of those
 * is an input, and the classifier reads its inputs as given.
 *
 * It cannot fail on anything longitudinal. Corroboration, trend and "is this
 * normal for this runner" are Runner Model questions; a bug in how the belief
 * this suite hands the classifier was RESOLVED would be invisible here.
 *
 * It cannot fail on the segment boundaries being slightly wrong in TIME: at
 * per-mile granularity a boundary can only land on a mile marker, so a block
 * that really began 300m into mile 4 is reported as beginning at mile 4 and
 * this suite would not notice.
 *
 * DISTRIBUTION (Rule 22, and the reason it is counted rather than asserted by
 * feel): the capacity assertions below split 9 `no_evidence` / 4 `evidence` /
 * 2 `indeterminate`, which is lopsided toward refusal — as the two fixtures
 * are, because two ordinary training runs genuinely demonstrate very little.
 * The imbalance is therefore in the FIXTURES, not in the gate's instincts, and
 * the falsifiers at the bottom cover the other direction explicitly: a
 * synthetic race that DOES produce anchor-capable evidence, a clean run that
 * is NOT flagged as interrupted, a belief tension that does NOT fire, and a
 * ceiling that DOES lift for a race.
 */
import { describe, it, expect } from 'vitest';
import { friel7Zones } from '@/lib/training/zones';
import {
  ANCHOR_MOVE_MIN_WEIGHT,
  DRIFT_NORMAL_BAND_PCT_PER_60MIN,
  DRIFT_SCOPE_MIN_MINUTES,
  MEANINGFUL_HR_SEPARATION_BPM,
  SINGLE_ACTIVITY_EVIDENCE_CEILING,
  classifyActivityEvidence,
  detectInterruptedSplits,
  readContinuity,
  readEnvironment,
  segmentActivity,
  type EvidenceSplit,
  type RawActivityInput,
} from './activity-evidence';

/** David's LTHR on both fixture dates — `profile.lthr`, re-anchored
 *  2026-08-31 off the Americas Finest City half. The audit test asserts the
 *  live value still equals this. */
const LTHR = 168;

/* ── FIXTURE A · easy run in warm conditions, 2026-08-31 ────────────────── */
/** Transcribed from the reference case §3. See the provenance note above:
 *  these seven splits existed at ingest and were dropped by the HealthKit
 *  route's split reconciliation; they are NOT in the database. */
const EASY_RUN_SPLITS: EvidenceSplit[] = [
  { index: 1, distanceMi: 1, paceSecPerMi: 495, hrBpm: 129, powerW: 286 },
  { index: 2, distanceMi: 1, paceSecPerMi: 491, hrBpm: 142, powerW: 292 },
  { index: 3, distanceMi: 1, paceSecPerMi: 497, hrBpm: 147, powerW: 280 },
  { index: 4, distanceMi: 1, paceSecPerMi: 499, hrBpm: 153, powerW: 284 },
  { index: 5, distanceMi: 1, paceSecPerMi: 510, hrBpm: 153, powerW: 282 },
  { index: 6, distanceMi: 1, paceSecPerMi: 510, hrBpm: 155, powerW: 291 },
  { index: 7, distanceMi: 0.18, paceSecPerMi: 521, hrBpm: 158, powerW: 308 },
];

/** The scalars are the LIVE row (`runs.id = -41598809443969`). `elapsedSec` is
 *  the ONE value that is not: the reference case §2 cites 55:00 elapsed
 *  against 51:35 moving, and the row stores only the one clock. The audit test
 *  asserts the row genuinely has no elapsed field, so this is a stated
 *  substitution rather than a hidden one. */
const EASY_RUN: RawActivityInput = {
  activityId: 'wko_F1BC81A2-9F57-402A-BB86-CAA8B2593CD3',
  date: '2026-08-31',
  distanceMi: 6.18,
  activeSec: 3095,
  elapsedSec: 3300,
  avgHrBpm: 147,
  maxHrBpm: 164,
  avgPowerW: 286.7,
  avgCadenceSpm: 162,
  groundContactMs: 249,
  verticalOscillationCm: 10.1,
  strideLengthM: 1.19,
  elevationGainFt: 168,
  splits: EASY_RUN_SPLITS,
  tempF: 76.2,
  humidityPct: 65,
  cloudCoverPct: null,
  conditions: null,
  indoor: false,
  lthrBpm: LTHR,
};

/* ── FIXTURE B · unlabelled structured long run, 2026-08-30 ─────────────── */
/** VERBATIM from production, `runs.id = -245190372869167`, `data.splits`. */
const LONG_RUN_SPLITS: EvidenceSplit[] = (
  [
    [505, 145], [490, 142], [470, 147], [412, 166], [442, 166], [518, 149],
    [436, 166], [453, 164], [474, 166], [447, 168], [510, 168], [501, 161], [505, 163],
  ] as ReadonlyArray<readonly [number, number]>
).map(([paceSecPerMi, hrBpm], i) => ({
  index: i + 1, distanceMi: 1, paceSecPerMi, hrBpm, powerW: null,
}));

const LONG_RUN: RawActivityInput = {
  activityId: '0645f40c-951d-4ccc-b86e-9979cd26c795-2026-08-30#0740',
  date: '2026-08-30',
  distanceMi: 13.49,
  activeSec: 6383,
  elapsedSec: null,
  avgHrBpm: 159,
  maxHrBpm: 179,
  avgPowerW: 302.8,
  avgCadenceSpm: 162,
  groundContactMs: 250,
  verticalOscillationCm: 10.2,
  strideLengthM: 1.28,
  elevationGainFt: 230,
  splits: LONG_RUN_SPLITS,
  tempF: 76.3,
  humidityPct: 67.7,
  cloudCoverPct: 96,
  conditions: 'cloudy',
  indoor: false,
  lthrBpm: LTHR,
};

const easy = () =>
  classifyActivityEvidence(EASY_RUN, {
    plannedWorkout: { intent: 'EASY', sourceType: 'easy' },
    subjectiveReport: { appleEffortRating: 4 },
  });

const long = (belief?: number) =>
  classifyActivityEvidence(LONG_RUN, {
    plannedWorkout: { intent: 'LONG', sourceType: 'long' },
    subjectiveReport: { rpe: 7 },
    currentBelief:
      belief != null
        ? { thresholdPaceSecPerMi: belief, thresholdConfidence: 0.6, asOf: '2026-08-29' }
        : null,
  });

/* ══════════════════════════════════════════════════════════════════════════
 * A · THE EASY-RUN REFERENCE CASE
 * ══════════════════════════════════════════════════════════════════════ */

describe('easy run in warm conditions · 2026-08-31 reference case', () => {
  it('§4 · grades data quality PER SIGNAL, not pass/fail for the activity', () => {
    const r = easy();
    expect(r.eligibility.admissible).toBe(true);
    // "Pace/GPS: HIGH" · "Power: HIGH" · "Heart rate: MODERATE-HIGH".
    expect(r.eligibility.signals.pace).toBe('high');
    expect(r.eligibility.signals.power).toBe('high');
    expect(r.eligibility.signals.hr).toBe('moderate_high');
    // "Continuity: MODERATE — workout time 51:35 vs elapsed 55:00".
    expect(r.eligibility.continuity.grade).toBe('moderate');
    expect(r.eligibility.continuity.unaccountedSec).toBe(3300 - 3095);
  });

  it('§24 item 2 · the opening HR settling mile is excluded from the drift read', () => {
    const r = easy();
    expect(r.internalCost.ok).toBe(true);
    if (!r.internalCost.ok) return;
    expect(r.internalCost.splitsExcludedSettling).toBe(1);
    // Mile 1 (129 bpm) is the excluded one, so the analysed first half opens
    // in the 140s rather than the 120s.
    expect(r.internalCost.firstHalfHr).toBeGreaterThan(140);
    // And the fragment tail is excluded as a non-comparable unit.
    expect(r.internalCost.splitsExcludedFragment).toBe(1);
  });

  it('§5 / §24 item 3 · conditions modify interpretation, never a corrected pace', () => {
    const r = easy();
    // §19 "ENVIRONMENTAL LOAD: Moderate".
    expect(r.environment.load).toBe('moderate');
    expect(r.environment.hrCostPlausiblyElevated).toBe(true);
    // Continuous, and NON-ZERO at 76.2°F — below the 77°F step confounder,
    // which is exactly the cliff this must not have (Rule 9).
    expect(r.environment.hrConfoundWeight).toBeGreaterThan(0);
    expect(r.environment.hrConfoundWeight).toBeLessThan(1);
    // No corrected performance number is exposed anywhere on the result.
    expect(Object.keys(r.environment)).not.toContain('adjustedPaceSecPerMi');
    expect(JSON.stringify(r)).not.toMatch(/adjustedPace|correctedPace|normalisedPace/i);
  });

  it('§6 / §24 item 5-6 · intent and observed execution are separate fields', () => {
    const r = easy();
    expect(r.plannedIntent).toBe('EASY');
    expect(r.observedExecution).toBe('EASY_TO_AEROBIC_STEADY');
    // Diverged — and that is a statement, not a failure verdict. Nothing in
    // the output calls it failed.
    expect(r.executionDivergedFromIntent).toBe(true);
    expect(r.executionQuality).toBe('controlled');
    expect(JSON.stringify(r)).not.toMatch(/failed|failure/i);
  });

  it('§7 · stable external output, rising internal cost', () => {
    const r = easy();
    expect(r.externalOutput.paceStability).toBe('high');
    expect(r.externalOutput.powerStability).toBe('high');
    expect(r.externalOutput.verdict).toBe('stable');
    expect(r.internalCost.ok).toBe(true);
    if (!r.internalCost.ok) return;
    expect(r.internalCost.detected).toBe(true);
  });

  it('§8 · drift is MODERATE magnitude at MODERATE confidence, and inside doctrine’s normal band', () => {
    const r = easy();
    expect(r.internalCost.ok).toBe(true);
    if (!r.internalCost.ok) return;
    expect(r.internalCost.magnitude).toBe('moderate');
    expect(r.internalCost.confidenceBand).toBe('moderate');
    // Research/03 §2: "+5–15% over 60 min" is the EXPECTED response. Reading
    // it as a durability problem is what §8 forbids.
    const [lo, hi] = DRIFT_NORMAL_BAND_PCT_PER_60MIN;
    expect(r.internalCost.risePctPer60Min).toBeGreaterThanOrEqual(lo);
    expect(r.internalCost.risePctPer60Min).toBeLessThanOrEqual(hi);
    expect(r.internalCost.withinDoctrineNormalBand).toBe(true);
  });

  it('§9 / §24 items 7-9 · no high-intensity, no threshold, low-to-moderate durability', () => {
    const r = easy();
    expect(r.capacities.high_intensity.kind).toBe('no_evidence');
    expect(r.capacities.high_intensity.reasons).toContain('NO_HIGH_INTENSITY_WORK_PERFORMED');
    expect(r.capacities.threshold.kind).toBe('no_evidence');
    expect(r.capacities.threshold.reasons).toContain('NO_SUSTAINED_THRESHOLD_SEGMENT');

    const d = r.capacities.durability;
    expect(d.kind).toBe('evidence');
    if (d.kind !== 'evidence') return;
    expect(d.strength).toBe('low_to_moderate');
    expect(d.reliability).toBe('low_to_moderate');
    expect(d.reasons).toContain('STABLE_OUTPUT_WITH_RISING_INTERNAL_COST');
    expect(d.reasons).toContain('DURATION_BELOW_PROTOCOL');
    expect(d.reasons).toContain('ENVIRONMENTALLY_AFFECTED');
    expect(d.reasons).toContain('ACTIVITY_INTERRUPTED');
  });

  it('§10-11 · the observation ENTERS THE LEDGER without moving the anchor', () => {
    const r = easy();
    const entry = r.ledger.find((l) => l.kind === 'AEROBIC_DURABILITY_OBSERVATION');
    expect(entry).toBeTruthy();
    // The §10 shape, field for field.
    expect(entry!.intent).toBe('EASY');
    expect(entry!.observedExecution).toBe('EASY_TO_AEROBIC_STEADY');
    expect(entry!.externalLoad).toBe('stable');
    expect(entry!.paceStability).toBe('high');
    expect(entry!.powerStability).toBe('high');
    expect(entry!.cardiovascularDrift).toBe('moderate');
    expect(entry!.environment).toBe('moderate');
    expect(entry!.interruptionsPresent).toBe(true);
    expect(entry!.reliability).toBe('low_to_moderate');
    // The explicit, inspectable "supporting evidence only" outcome — not an
    // implication left to be inferred from a low confidence number.
    expect(entry!.anchorEffect).toBe('supporting_evidence_only');
    // §16-17 · the environmental response is retained for the longitudinal
    // question this layer cannot answer.
    expect(r.ledger.some((l) => l.kind === 'ENVIRONMENTAL_RESPONSE_OBSERVATION')).toBe(true);
  });

  it('§14 / §24 items 10-12 · no anchor move, no pace change, no plan trigger', () => {
    const r = easy();
    expect(r.anchorMoveCandidate).toBe(false);
    expect(r.anchorMoveReasons).toContain('SINGLE_ACTIVITY_BELOW_ANCHOR_MOVE_TIER');
    for (const c of Object.values(r.capacities)) {
      if (c.kind === 'evidence') expect(c.anchorEffect).toBe('supporting_evidence_only');
    }
    // §21 · "Your easy pace should now be slower" is exactly what this run
    // does not license.
    expect(r.capacities.easy_ceiling.kind).toBe('no_evidence');
    expect(r.capacities.easy_ceiling.reasons).toContain('SINGLE_ACTIVITY_DOES_NOT_RESET_EASY_CEILING');
  });

  it('§12 / §24 item 13 · the run is still valuable training with little fitness evidence', () => {
    const r = easy();
    expect(r.trainingLoad.stimulus).toBe('aerobic_development');
    expect(r.trainingLoad.aerobicMinutes).toBeCloseTo(51.6, 1);
    expect(r.trainingLoad.distanceMi).toBe(6.18);
  });

  it('§18 / §24 item 14 · running dynamics are stored and silent', () => {
    const r = easy();
    expect(r.runningDynamics.cadenceSpm).toBe(162);
    expect(r.runningDynamics.groundContactMs).toBe(249);
    expect(r.runningDynamics.verticalOscillationCm).toBe(10.1);
    expect(r.runningDynamics.strideLengthM).toBe(1.19);
    expect(r.runningDynamics.surfaced).toBe(false);
  });

  it('is NOT treated as structured — one continuous effort, one segment', () => {
    const r = easy();
    expect(r.structured).toBe(false);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].classification).toBe('easy_aerobic');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B · THE STRUCTURED-LONG-RUN REFERENCE CASE
 * ══════════════════════════════════════════════════════════════════════ */

describe('unlabelled structured long run · 2026-08-30 reference case', () => {
  it('Part 1 · infers the structure with no label: easy → quality → recovery → quality → easy', () => {
    const r = long();
    expect(r.structured).toBe(true);
    expect(r.segments).toHaveLength(5);
    expect(r.segments.map((s) => s.classification)).toEqual([
      'easy_aerobic', 'threshold_like', 'recovery', 'threshold_like', 'steady_aerobic',
    ]);
    // The exact block boundaries the fixture names.
    expect(r.segments[0].splitIndices).toEqual([1, 2, 3]);
    expect(r.segments[1].splitIndices).toEqual([4, 5]);
    expect(r.segments[2].splitIndices).toEqual([6]);
    expect(r.segments[3].splitIndices).toEqual([7, 8, 9, 10]);
    expect(r.segments[4].splitIndices).toEqual([11, 12, 13]);
  });

  it('Part 1 · mile 3 is REJECTED as quality — pace lifted, heart rate did not', () => {
    const r = long();
    // 7:50/mi is ~7% faster than the run's own easy baseline, so the pace
    // clause alone would have promoted it. HR 147 against easy miles at
    // 145/142 is the clause that refuses.
    expect(r.segments[0].splitIndices).toContain(3);
    expect(r.segments[0].reasons).toContain('PACE_LIFT_NOT_CORROBORATED_BY_HR');
  });

  it('Part 1 · recovery is identified structurally, not by a pace threshold', () => {
    const r = long();
    const recovery = r.segments[2];
    expect(recovery.classification).toBe('recovery');
    expect(recovery.reasons).toContain('SITS_BETWEEN_QUALITY_BLOCKS');
    // Mile 6 is only ~2.6% slower than the run's baseline — any percentage
    // rule would have had to hair-split it (Rule 9).
    expect(recovery.relativeIntensity).toBeGreaterThan(0.95);
    // HR corroborates: 149 against the 166 either side.
    expect(recovery.meanHrBpm).toBe(149);
  });

  it('Part 1 / Part 2 item 3 · every segment carries WHERE in the timeline it happened', () => {
    const r = long();
    expect(r.segments[1].accumulatedMinutesBefore).toBeCloseTo(24.4, 1);
    expect(r.segments[3].accumulatedMinutesBefore).toBeCloseTo(47.3, 1);
    // The first block is NOT under accumulated load; the second is. That is
    // the whole "a strong block 70 minutes in is different evidence" point.
    expect(r.segments[1].underAccumulatedLoad).toBe(false);
    expect(r.segments[3].underAccumulatedLoad).toBe(true);
    expect(r.segments[3].accumulatedMinutesBefore).toBeGreaterThan(DRIFT_SCOPE_MIN_MINUTES);
  });

  it('Part 1 · power is reported NULL with a reason, never back-filled from the run average', () => {
    const r = long();
    for (const s of r.segments) {
      expect(s.meanPowerW).toBeNull();
      expect(s.reasons).toContain('NO_POWER_RECORDED_FOR_THIS_ACTIVITY');
    }
    // The whole-run average exists and is deliberately not spread across them.
    expect(LONG_RUN.avgPowerW).toBe(302.8);
  });

  it('Part 2 · whole-run averages are refused as evidence for a mixed activity', () => {
    const r = long();
    // The 7:37 whole-run average describes neither demand honestly, so the
    // halves-comparison drift read refuses rather than producing a number.
    expect(r.internalCost.ok).toBe(false);
    if (r.internalCost.ok) return;
    expect(r.internalCost.reason).toBe('activity_is_structured');
    expect(r.observedExecution).toBe('MIXED');
    expect(r.anchorMoveReasons).toContain('MIXED_INTENSITY_ACTIVITY_AVERAGE_NOT_EVIDENCE');
  });

  it('Part 2 item 1 · threshold evidence is POSITIVE and CORROBORATING, never anchor-setting', () => {
    const r = long();
    const t = r.capacities.threshold;
    expect(t.kind).toBe('evidence');
    if (t.kind !== 'evidence') return;
    expect(t.reasons).toContain('SUSTAINED_THRESHOLD_LIKE_WORK_PRESENT');
    expect(t.anchorEffect).toBe('supporting_evidence_only');
    expect(t.weight).toBeLessThan(ANCHOR_MOVE_MIN_WEIGHT);
    expect(r.anchorMoveCandidate).toBe(false);
  });

  it('Part 2 · high-intensity evidence is little/none — the blocks are threshold-adjacent', () => {
    const r = long();
    // Every block tops out AT LTHR (168), which is Friel 5a. Friel's own 1.03
    // edge is where VO2 work begins, and nothing reached it.
    expect(r.capacities.high_intensity.kind).toBe('no_evidence');
    expect(r.capacities.high_intensity.reasons).toContain('NO_HIGH_INTENSITY_WORK_PERFORMED');
    expect(r.capacities.high_intensity.reasons).toContain('GRANULARITY_CANNOT_RESOLVE_INTERVALS');
  });

  it('Part 2 item 2 · durability weighs MEANINGFULLY MORE than the ordinary easy run', () => {
    const structured = long().capacities.durability;
    const ordinary = easy().capacities.durability;
    expect(structured.kind).toBe('evidence');
    expect(ordinary.kind).toBe('evidence');
    if (structured.kind !== 'evidence' || ordinary.kind !== 'evidence') return;
    // The requirement, stated as the fixture states it.
    expect(structured.weight).toBeGreaterThan(ordinary.weight);
    expect(structured.strength).toBe('moderate');
    expect(ordinary.strength).toBe('low_to_moderate');
    expect(structured.reasons).toContain('QUALITY_SURVIVED_ACCUMULATED_LOAD');
    expect(structured.reasons).toContain('REPEATED_QUALITY_BLOCKS_WITHIN_ONE_ACTIVITY');
    expect(structured.reasons).toContain('NO_LATE_RUN_PACING_COLLAPSE');
  });

  it('Part 2 item 3 · quality-under-load is measured, not just noted', () => {
    const r = long();
    expect(r.qualityUnderLoad.ok).toBe(true);
    if (!r.qualityUnderLoad.ok) return;
    expect(r.qualityUnderLoad.qualityBlocks).toBe(2);
    expect(r.qualityUnderLoad.totalQualityMinutes).toBeCloseTo(44.4, 1);
    expect(r.qualityUnderLoad.qualityMinutesUnderLoad).toBeGreaterThan(30);
    expect(r.qualityUnderLoad.latestBlockStartMinutes).toBeCloseTo(47.3, 1);
    // "held up about as well as the first on pace" — within ~6%.
    expect(r.qualityUnderLoad.lateVsEarlyPaceRatio).toBeLessThan(1.10);
  });

  it('Part 2 item 4 · no pacing collapse, AND the residual HR the pacing-only read misses', () => {
    const r = long();
    expect(r.qualityUnderLoad.ok).toBe(true);
    if (!r.qualityUnderLoad.ok) return;
    expect(r.qualityUnderLoad.lateRunPacingCollapse).toBe(false);
    // Closing miles at 161-168 against opening easy miles at 142-149.
    expect(r.qualityUnderLoad.residualCardiovascularLoad).toBe(true);
    expect(r.qualityUnderLoad.residualHrElevationBpm!).toBeGreaterThanOrEqual(
      MEANINGFUL_HR_SEPARATION_BPM,
    );
    expect(r.segments[4].reasons).toContain('RESIDUAL_HR_ABOVE_OPENING_EASY');
    // Carried as its OWN lower-weight ledger entry, not folded in or dropped.
    const residual = r.ledger.find((l) => l.kind === 'RESIDUAL_CARDIOVASCULAR_LOAD_OBSERVATION');
    expect(residual).toBeTruthy();
    expect(residual!.reliability).toBe('low');
    expect(residual!.anchorEffect).toBe('supporting_evidence_only');
  });

  it('Part 2 item 4 · the closing miles are classified by OUTPUT, with the HR carried separately', () => {
    const r = long();
    const closing = r.segments[4];
    // HR 164 sits in Friel Z4, but the runner was producing easy-baseline
    // output. Classifying that as threshold work would be reading physiology
    // the runner did not produce.
    expect(closing.hrZoneIdx).toBe(4);
    expect(closing.classification).toBe('steady_aerobic');
    expect(closing.reasons).toContain('OUTPUT_AT_EASY_BASELINE_DESPITE_ELEVATED_HR');
  });

  it('Part 3 · the THIRD OUTCOME — challenges the belief without updating it', () => {
    // The fixture's own hypothetical: a current threshold belief of ~7:15/mi.
    const r = long(435);
    expect(r.beliefTension.ok).toBe(true);
    if (!r.beliefTension.ok) return;
    expect(r.beliefTension.code).toBe('CONTRADICTS_CURRENT_ESTIMATE');
    expect(r.beliefTension.direction).toBe('observation_stronger_than_belief');
    expect(r.beliefTension.capacity).toBe('threshold');
    // Magnitude and direction are both reported, per the fixture's
    // implementation requirement.
    expect(r.beliefTension.believedPaceSecPerMi).toBe(435);
    expect(typeof r.beliefTension.magnitudeSecPerMi).toBe('number');
    expect(typeof r.beliefTension.magnitudePct).toBe('number');
    expect(r.beliefTension.accumulatedMinutesBefore).toBeGreaterThan(DRIFT_SCOPE_MIN_MINUTES);
    // It does NOT move the anchor, and the type cannot express that it did.
    expect(r.beliefTension.anchorEffect).toBe('no_change_flag_for_reexamination');
    expect(r.anchorMoveCandidate).toBe(false);
    // The signal a future Runner Model consumes: genuinely computed, in (0,1].
    expect(r.beliefTension.reexaminationWeight).toBeGreaterThan(0);
    expect(r.beliefTension.reexaminationWeight).toBeLessThanOrEqual(1);
    expect(r.beliefTension.reasons).toContain('NOT_CORROBORATED_BY_THIS_ACTIVITY_ALONE');
  });

  it('Part 2 · the run stays valuable training, and the mixed stimulus is named as mixed', () => {
    const r = long();
    expect(r.trainingLoad.stimulus).toBe('mixed_aerobic_and_quality');
    expect(r.trainingLoad.aerobicMinutes).toBeCloseTo(106.4, 1);
    expect(r.executionQuality).toBe('controlled');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C · FALSIFIERS (Rule 18 · a gate that has never failed is a hypothesis)
 *
 * Every one of these was run against a deliberately-broken variant before
 * landing, and every one distinguishes a POSITIVE from a NEGATIVE rather than
 * asserting the absence of something.
 * ══════════════════════════════════════════════════════════════════════ */

describe('falsifiers · the detectors can tell the difference', () => {
  it('the interruption detector does NOT flag a clean continuous run', () => {
    // Monotonically rising HR at steady pace — the easy-run fixture. If the
    // detector always downweighted, this would flag.
    expect(detectInterruptedSplits(EASY_RUN_SPLITS)).toEqual([]);
    // And the long run's mile 12 (HR 168 → 161 at unchanged pace) is a
    // post-block SETTLE, not a pause: monotone, so no V, so not flagged.
    expect(detectInterruptedSplits(LONG_RUN_SPLITS)).toEqual([]);
  });

  it('the interruption detector DOES flag a crosswalk-shaped dip', () => {
    // Same run with one mile carrying a V-shaped HR dip at unchanged pace —
    // the crosswalk signature the reference case §4 describes.
    const withStop = EASY_RUN_SPLITS.map((s) =>
      s.index === 4 ? { ...s, hrBpm: 138 } : s,
    );
    expect(detectInterruptedSplits(withStop)).toEqual([4]);
  });

  it('an HR dip EXPLAINED by slowing down is not called an interruption', () => {
    // Same dip, but the runner also slowed by 60 s/mi. The cause is ordinary.
    const slowedDown = EASY_RUN_SPLITS.map((s) =>
      s.index === 4 ? { ...s, hrBpm: 138, paceSecPerMi: 559 } : s,
    );
    expect(detectInterruptedSplits(slowedDown)).toEqual([]);
  });

  it('the un-split tail is NOT read as unaccounted time', () => {
    // 13.0 miles of splits on a 13.49-mile run: the missing 220s is the tail,
    // not a stop. Reading it as a stop is the exact false positive
    // `split-coverage.ts` was written to end.
    const c = readContinuity({
      activeSec: 6383, elapsedSec: null, distanceMi: 13.49, splits: LONG_RUN_SPLITS,
    });
    expect(c.unaccountedSec).toBeNull();
    expect(c.grade).toBe('high');
    expect(c.weight).toBe(1);
  });

  it('a genuine stopped-clock gap IS read as unaccounted time', () => {
    const c = readContinuity({
      activeSec: 6383, elapsedSec: 7200, distanceMi: 13.49, splits: LONG_RUN_SPLITS,
    });
    expect(c.unaccountedSec).toBe(817);
    expect(c.grade).toBe('low');
    expect(c.weight).toBeLessThan(1);
  });

  it('dropped splits produce a REFUSAL about coverage, not a fabricated gap', () => {
    // Rule 11: with the splits gone we cannot tell an interruption from a
    // legitimate tail, and that is a third fact, not a zero.
    const c = readContinuity({
      activeSec: 3095, elapsedSec: null, distanceMi: 6.18, splits: [], splitsDropped: true,
      splitsReconciliation: { splitsSumS: 2985, durationS: 3095, deltaS: -110, count: 7 },
    });
    expect(c.reasons).toContain('SPLITS_DROPPED_SO_COVERAGE_UNKNOWN');
    expect(c.unaccountedSec).toBeNull();
    expect(c.grade).toBe('unknown');
  });

  it('eligibility REJECTS a broken HR sensor rather than merely downweighting it', () => {
    const broken = classifyActivityEvidence(
      { ...EASY_RUN, avgHrBpm: 190, maxHrBpm: 120 },  // max below average: a fault
      { plannedWorkout: { intent: 'EASY' } },
    );
    expect(broken.eligibility.admissible).toBe(false);
    expect(broken.eligibility.rejections).toContain('HR_SENSOR_IMPLAUSIBLE');
    expect(broken.eligibility.signals.hr).toBe('unusable');
    // Every capacity becomes INDETERMINATE — not `no_evidence`, which would
    // be the Rule 11 collapse.
    for (const c of Object.values(broken.capacities)) expect(c.kind).toBe('indeterminate');
    expect(broken.ledger).toHaveLength(0);
  });

  it('eligibility REJECTS corrupted GPS rather than merely downweighting it', () => {
    const corrupt = classifyActivityEvidence(
      { ...EASY_RUN, distanceMi: 61.8, splits: null },  // 10x distance: 50s/mi
      { plannedWorkout: { intent: 'EASY' } },
    );
    expect(corrupt.eligibility.admissible).toBe(false);
    expect(corrupt.eligibility.rejections).toContain('IMPLAUSIBLE_PACE');
    expect(corrupt.eligibility.signals.pace).toBe('unusable');
  });

  it('eligibility ADMITS the merely-noisy activity the two fixtures are', () => {
    // The complement of the two above: rejection is reserved for the
    // pathological, and both real runs pass with downgraded signals instead.
    expect(easy().eligibility.admissible).toBe(true);
    expect(long().eligibility.admissible).toBe(true);
  });

  it('belief tension does NOT fire when the observation agrees with the belief', () => {
    // A belief of 6:30/mi (390 s/mi): the run's 7:24 sustained work is 14%
    // slower, well outside the match margin, so there is no tension.
    const r = long(390);
    expect(r.beliefTension.ok).toBe(false);
    if (r.beliefTension.ok) return;
    expect(r.beliefTension.reason).toBe('observation_consistent_with_belief');
  });

  it('belief tension does NOT fire on a run with no sustained quality at all', () => {
    const r = classifyActivityEvidence(EASY_RUN, {
      plannedWorkout: { intent: 'EASY' },
      currentBelief: { thresholdPaceSecPerMi: 435 },
    });
    expect(r.beliefTension.ok).toBe(false);
  });

  it('belief tension refuses distinguishably when no belief was supplied', () => {
    const r = long();
    expect(r.beliefTension.ok).toBe(false);
    if (r.beliefTension.ok) return;
    // Rule 11: "nobody gave me a belief" is not "the observation agreed".
    expect(r.beliefTension.reason).toBe('no_belief_supplied');
  });

  it('belief tension fires in the WEAKER direction too — the gate is not one-way', () => {
    // A graded threshold session, fresh, run well slower than the belief.
    const slowThreshold: EvidenceSplit[] = Array.from({ length: 5 }, (_, i) => ({
      index: i + 1, distanceMi: 1, paceSecPerMi: 480, hrBpm: 165, powerW: null,
    }));
    const r = classifyActivityEvidence(
      {
        ...EASY_RUN, activityId: 'tempo', distanceMi: 5, activeSec: 2400, elapsedSec: null,
        avgHrBpm: 165, maxHrBpm: 172, splits: slowThreshold, avgPowerW: null,
      },
      {
        plannedWorkout: { intent: 'THRESHOLD', sourceType: 'threshold' },
        currentBelief: { thresholdPaceSecPerMi: 435 },
      },
    );
    // A continuous tempo is ONE segment, and it must still classify as
    // threshold work. An earlier draft downgraded it, because on a
    // single-segment run the "easy baseline" is that segment's own pace — so
    // every continuous tempo produced no threshold evidence at all. Caught by
    // this falsifier, which is the entire reason it is written this way.
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].classification).toBe('threshold_like');
    expect(r.capacities.threshold.kind).toBe('evidence');

    expect(r.beliefTension.ok).toBe(true);
    if (!r.beliefTension.ok) return;
    expect(r.beliefTension.direction).toBe('observation_weaker_than_belief');
    expect(r.beliefTension.reasons).toContain('GRADED_EFFORT_SLOWER_THAN_BELIEF_WHILE_FRESH');
    // Still does not move anything.
    expect(r.beliefTension.anchorEffect).toBe('no_change_flag_for_reexamination');
  });

  it('the single-activity ceiling BINDS on an ordinary session and LIFTS for a race', () => {
    // Same activity, two intents. The ceiling is Enforcement §10's "no
    // single-run overwrite" made arithmetic, and races are its explicit
    // exceptional-evidence path.
    const asLong = long().capacities.durability;
    expect(asLong.kind).toBe('evidence');
    if (asLong.kind !== 'evidence') return;
    expect(asLong.weight).toBe(SINGLE_ACTIVITY_EVIDENCE_CEILING);
    expect(asLong.reasons).toContain('SINGLE_ACTIVITY_CEILING_APPLIED');

    const asRace = classifyActivityEvidence(LONG_RUN, {
      plannedWorkout: { intent: 'RACE', sourceType: 'race' },
    }).capacities.durability;
    expect(asRace.kind).toBe('evidence');
    if (asRace.kind !== 'evidence') return;
    expect(asRace.weight).toBeGreaterThan(SINGLE_ACTIVITY_EVIDENCE_CEILING);
    expect(asRace.reasons).not.toContain('SINGLE_ACTIVITY_CEILING_APPLIED');
    expect(asRace.anchorEffect).toBe('candidate_anchor_move');
  });

  it('the environmental read is CONTINUOUS across the old 77°F step (Rule 9)', () => {
    // The confounder constant this reuse deliberately does not step on is
    // `HEAT_HR_CONFOUNDER.thresholdF = 77`. Walk 74 → 80 and assert the
    // weight moves monotonically with no jump at the old edge.
    const weights: number[] = [];
    for (let t = 74; t <= 80; t += 0.25) {
      weights.push(
        readEnvironment({ tempF: t, humidityPct: 65, effortSec: 3095 }).hrConfoundWeight,
      );
    }
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeGreaterThanOrEqual(weights[i - 1]);
      // No step: the largest single increment over a quarter-degree is small.
      expect(weights[i] - weights[i - 1]).toBeLessThan(0.02);
    }
    // And it is genuinely non-zero BELOW the old step.
    expect(readEnvironment({ tempF: 76.2, humidityPct: 65, effortSec: 3095 }).hrConfoundWeight)
      .toBeGreaterThan(0);
  });

  it('no weather recorded is UNKNOWN load, never benign (Rule 11)', () => {
    const e = readEnvironment({ tempF: null, humidityPct: null, effortSec: 3095 });
    expect(e.load).toBe('unknown');
    expect(e.reasons).toContain('NO_WEATHER_RECORDED');
    // The complement: benign weather is `none`/`low` and says so.
    const cool = readEnvironment({ tempF: 45, humidityPct: 50, effortSec: 3095 });
    expect(cool.load).toBe('none');
    expect(cool.reasons).toContain('CONDITIONS_BENIGN');
  });

  it('segmentation returns ONE segment for a genuinely continuous run', () => {
    // The complement of the five-segment assertion: a detector that always
    // found structure would fail here.
    const s = segmentActivity({
      splits: EASY_RUN_SPLITS, zoneTable: friel7Zones(LTHR), hasPerSplitPower: true,
    });
    expect(s.segments).toHaveLength(1);
    const l = segmentActivity({
      splits: LONG_RUN_SPLITS, zoneTable: friel7Zones(LTHR), hasPerSplitPower: false,
    });
    expect(l.segments).toHaveLength(5);
  });

  it('without an LTHR every HR-derived capacity refuses rather than guessing', () => {
    const r = classifyActivityEvidence({ ...EASY_RUN, lthrBpm: null }, {});
    expect(r.capacities.high_intensity.kind).toBe('indeterminate');
    expect(r.capacities.high_intensity.reasons).toContain('NO_ZONE_TABLE_WITHOUT_LTHR');
    expect(r.capacities.threshold.kind).toBe('indeterminate');
    expect(r.observedExecution).toBe('INDETERMINATE');
  });

  it('with no splits at all, the drift read REFUSES rather than reporting no drift', () => {
    const r = classifyActivityEvidence(
      { ...EASY_RUN, splits: null, elapsedSec: null },
      { plannedWorkout: { intent: 'EASY' } },
    );
    expect(r.internalCost.ok).toBe(false);
    if (r.internalCost.ok) return;
    expect(r.internalCost.reason).toBe('no_hr_curve');
    // And durability becomes INDETERMINATE — not `no_evidence`, and not a
    // silently smaller weight.
    expect(r.capacities.durability.kind).toBe('indeterminate');
    // The activity is still admissible and still valuable training.
    expect(r.eligibility.admissible).toBe(true);
    expect(r.trainingLoad.stimulus).toBe('aerobic_development');
  });
});
