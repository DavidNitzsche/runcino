/**
 * Confidence interval + label · pins the calibration so a tweak to a base %
 * or BUILD_RATE can't silently drift the numbers David approved.
 *
 * Reference case (UI-HEALTH 3.4): David, AFC Half (HM), VDOT 47.9 →
 * current-fitness projection 1:34:54 (5694s), goal 1:30:00 (5400s),
 * ~69 days out, status 'watching'.
 *   · band (watching ×1.25 on §13.7 HM ±2.5%) → 1:31:56 – 1:37:52
 *   · label → MEDIUM · doable, not banked
 */
import { describe, it, expect } from 'vitest';
import { computeConfidenceInterval, computeConfidenceLabel } from './goal-projection';

const HM = 13.1;
const DAVID_PROJ = 5694; // predictRaceTime(47.9, 13.1) = 1:34:54
const DAVID_GOAL = 5400; // 1:30:00

describe('computeConfidenceInterval', () => {
  it('David watching · §13.7 HM base ×1.25 → 1:31:56 – 1:37:52', () => {
    const ci = computeConfidenceInterval({
      centerSec: DAVID_PROJ, raceDistanceMi: HM, status: 'watching', pacing: { cv: null, source: 'default' },
    });
    expect(ci).not.toBeNull();
    expect(ci!.lo).toBe(5516); // 1:31:56 (faster edge)
    expect(ci!.hi).toBe(5872); // 1:37:52 (slower edge)
    expect(ci!.pct).toBe(3.1);
    expect(ci!.method).toBe('research-span');
  });

  it('on-track ×1.0 → the unscaled ±2.5% band (1:32:32 – 1:37:16)', () => {
    const ci = computeConfidenceInterval({ centerSec: DAVID_PROJ, raceDistanceMi: HM, status: 'on-track' });
    expect(ci!.lo).toBe(5552); // 1:32:32
    expect(ci!.hi).toBe(5836); // 1:37:16
    expect(ci!.pct).toBe(2.5);
  });

  it('off-track ×1.5 widens the band', () => {
    const ci = computeConfidenceInterval({ centerSec: DAVID_PROJ, raceDistanceMi: HM, status: 'off-track' });
    expect(ci!.lo).toBe(5480);
    expect(ci!.hi).toBe(5908);
    expect(ci!.pct).toBe(3.8); // 2.5 × 1.5, display-rounded
  });

  it('span keys on target distance · 10K tighter, marathon wider', () => {
    expect(computeConfidenceInterval({ centerSec: 3000, raceDistanceMi: 6.2, status: 'on-track' })!.pct).toBe(2.0);
    expect(computeConfidenceInterval({ centerSec: 10800, raceDistanceMi: 26.2, status: 'on-track' })!.pct).toBe(3.0);
  });

  it('observed CV replaces the §13.7 base · tight pacer floored at 2.0%', () => {
    const tight = computeConfidenceInterval({ centerSec: DAVID_PROJ, raceDistanceMi: HM, status: 'on-track', pacing: { cv: 0.015, source: 'observed' } });
    expect(tight!.method).toBe('observed-cv');
    expect(tight!.pct).toBe(2.0);
    const loose = computeConfidenceInterval({ centerSec: DAVID_PROJ, raceDistanceMi: HM, status: 'on-track', pacing: { cv: 0.05, source: 'observed' } });
    expect(loose!.pct).toBe(3.5);
  });

  it('null/zero center → null (cold-start, no band)', () => {
    expect(computeConfidenceInterval({ centerSec: null, raceDistanceMi: HM, status: 'on-track' })).toBeNull();
    expect(computeConfidenceInterval({ centerSec: 0, raceDistanceMi: HM, status: 'on-track' })).toBeNull();
  });
});

describe('computeConfidenceLabel', () => {
  it('David · gap 4:54, ~10wk runway, watching → MEDIUM · doable, not banked', () => {
    const label = computeConfidenceLabel({
      goalSec: DAVID_GOAL, raceDistanceMi: HM, vdot: 47.9, daysToRace: 69, status: 'watching',
    });
    expect(label).not.toBeNull();
    expect(label!.tier).toBe('medium');
    expect(label!.word).toBe('MEDIUM');
    expect(label!.descriptor).toBe('doable, not banked');
    expect(label!.detail).toContain('4:54 to find');
    expect(label!.detail).toContain('10 weeks');
    expect(Number(label!.evidence.gapVdot)).toBeCloseTo(3.0, 1);
  });

  it('already at/ahead of goal fitness → HIGH · ahead of the number', () => {
    const label = computeConfidenceLabel({ goalSec: DAVID_GOAL, raceDistanceMi: HM, vdot: 52, daysToRace: 69, status: 'on-track' });
    expect(label!.tier).toBe('high');
    expect(label!.detail).toBe('ahead of the number · hold the plan');
  });

  it('off-track caps the tier at LOW', () => {
    const label = computeConfidenceLabel({ goalSec: DAVID_GOAL, raceDistanceMi: HM, vdot: 50, daysToRace: 200, status: 'off-track' });
    expect(label!.tier).toBe('low');
  });

  it('watching caps HIGH down to MEDIUM', () => {
    // Small gap + long runway would read HIGH, but watching pulls it to MEDIUM.
    const label = computeConfidenceLabel({ goalSec: DAVID_GOAL, raceDistanceMi: HM, vdot: 50.5, daysToRace: 120, status: 'watching' });
    expect(label!.tier).toBe('medium');
  });

  it('runway under 2 weeks with a real gap → LOW', () => {
    const label = computeConfidenceLabel({ goalSec: DAVID_GOAL, raceDistanceMi: HM, vdot: 47.9, daysToRace: 7, status: 'on-track' });
    expect(label!.tier).toBe('low');
  });

  it('null vdot → null (cold-start, no honest read)', () => {
    expect(computeConfidenceLabel({ goalSec: DAVID_GOAL, raceDistanceMi: HM, vdot: null, daysToRace: 69, status: 'on-track' })).toBeNull();
  });
});

// ── 2026-07-06 · P1-10 fix · execution-basis ladder ───────────────────────
//
// The bug being pinned: for runs with no watch_completion payload the verdict
// judged WHOLE-RUN pace against the WORK-PHASE target, so every correctly-
// executed WU+work+CD quality session graded 'slow' (~30-50 s/mi of WU/CD
// dilution vs a ±10 s/mi band), executionQuality collapsed to ~0.45, and the
// Targets hero flipped BEHIND for every non-watch runner.

import {
  judgeTestPointExecution,
  normalizePaceSplits,
  contiguousWorkWindowMi,
  paceOverWindow,
  blendedOverallTargetSPerMi,
  easyPaceForBlend,
} from './goal-projection';
import { expandSpecToPhases } from './expand-spec';

// Canonical fixture · 6.5mi tempo day: 1.5 WU + 4 @ 7:00 (420) + 1.0 CD.
const TEMPO_SPEC = {
  kind: 'tempo', warmup_mi: 1.5, tempo_distance_mi: 4,
  tempo_pace_s_per_mi: 420, cooldown_mi: 1.0, hr_target_bpm: null,
};
// Perfect execution at easy=520 (target+100 · vdot null fallback):
// time = 1.5×520 + 4×420 + 1.0×520 = 2980s over 6.5mi → overall 458 s/mi.
const PERFECT_OVERALL_S = 458;

const base = {
  type: 'tempo',
  targetS: 420,
  watchWorkS: null as number | null,
  overallS: PERFECT_OVERALL_S,
  rawSplits: null as unknown,
  splitsUnreliable: false,
  spec: TEMPO_SPEC as Record<string, unknown>,
  plannedDistanceMi: 6.5,
  actualDistanceMi: 6.5,
  vdot: null as number | null,
  heatSlowdownPct: 0,
};

describe('judgeTestPointExecution · basis ladder', () => {
  it('watch work-phase pace wins when present (existing behavior)', () => {
    const j = judgeTestPointExecution({ ...base, watchWorkS: 421 });
    expect(j.basis).toBe('work-phase-watch');
    expect(j.actualS).toBe(421);
    expect(j.verdict).toBe('on');
  });

  it('P1-10 regression · perfect no-watch tempo grades ON via the blend, not slow', () => {
    const j = judgeTestPointExecution(base);
    expect(j.basis).toBe('blended-overall');
    expect(j.verdict).toBe('on');           // pre-fix: 458 vs 420 ±10 → 'slow'
    expect(j.actualS).toBe(PERFECT_OVERALL_S);
  });

  it('a real miss still grades slow on the blend', () => {
    // ~40 s/mi slow through the tempo block → overall ≈ 500.
    const j = judgeTestPointExecution({ ...base, overallS: 500 });
    expect(j.basis).toBe('blended-overall');
    expect(j.verdict).toBe('slow');         // 500 > blend 458 + 15
  });

  it('heat widens the blended band (Research/06 §1 · shared heatAdjustedStatus)', () => {
    const noHeat = judgeTestPointExecution({ ...base, overallS: 490 });
    expect(noHeat.verdict).toBe('slow');    // 490 > 458 + 15
    const hot = judgeTestPointExecution({ ...base, overallS: 490, heatSlowdownPct: 5 });
    expect(hot.verdict).toBe('on');         // 490 ≤ round(458×1.05) + 15
  });

  it('mile splits + spec locate the work window · basis work-phase-splits', () => {
    const splits = [
      { mile: 1, paceSecPerMi: 520, distanceMi: 1 },   // WU
      { mile: 2, paceSecPerMi: 470, distanceMi: 1 },   // straddles WU→tempo · excluded
      { mile: 3, paceSecPerMi: 420, distanceMi: 1 },
      { mile: 4, paceSecPerMi: 418, distanceMi: 1 },
      { mile: 5, paceSecPerMi: 422, distanceMi: 1 },
      { mile: 6, paceSecPerMi: 470, distanceMi: 1 },   // straddles tempo→CD · excluded
      { mile: 7, paceSecPerMi: 520, distanceMi: 0.5 }, // CD
    ];
    const j = judgeTestPointExecution({ ...base, rawSplits: splits });
    expect(j.basis).toBe('work-phase-splits');
    expect(j.actualS).toBe(420);            // mean of full-inside miles 3-5
    expect(j.verdict).toBe('on');
  });

  it('unreliable splits fall through to the blend (A5 ingest flag honored)', () => {
    const splits = [
      { mile: 1, paceSecPerMi: 520, distanceMi: 1 },
      { mile: 2, paceSecPerMi: 470, distanceMi: 1 },
      { mile: 3, paceSecPerMi: 420, distanceMi: 1 },
      { mile: 4, paceSecPerMi: 418, distanceMi: 1 },
      { mile: 5, paceSecPerMi: 422, distanceMi: 1 },
      { mile: 6, paceSecPerMi: 470, distanceMi: 1 },
      { mile: 7, paceSecPerMi: 520, distanceMi: 0.5 },
    ];
    const j = judgeTestPointExecution({ ...base, rawSplits: splits, splitsUnreliable: true });
    expect(j.basis).toBe('blended-overall');
  });

  it('run cut well short of the planned shape → abstains (which phase got cut is unknowable)', () => {
    const splits = [
      { mile: 1, paceSecPerMi: 480, distanceMi: 1 },
      { mile: 2, paceSecPerMi: 430, distanceMi: 1 },
      { mile: 3, paceSecPerMi: 420, distanceMi: 1 },
      { mile: 4, paceSecPerMi: 480, distanceMi: 1 },
    ];
    // 4.0 actual vs the 6.5mi planned shape: splits window unusable (mile
    // axis misaligned) AND the blend would mis-weight → verdict null.
    const j = judgeTestPointExecution({
      ...base, rawSplits: splits, actualDistanceMi: 4.0, overallS: 453,
    });
    expect(j.verdict).toBeNull();
    expect(j.basis).toBeNull();
  });

  it('extra easy miles beyond the spec pad the blend at easy pace (live-data shape)', () => {
    // Planned 6.5mi tempo shape inside an 8.5mi run · the extra 2mi assumed
    // easy: (2980 + 2×520) / 8.5 = 473. Perfect execution → ON, where the
    // unpadded 6.5mi blend (458) would have graded the dilution 'slow'.
    const j = judgeTestPointExecution({
      ...base, actualDistanceMi: 8.5, overallS: 473,
    });
    expect(j.basis).toBe('blended-overall');
    expect(j.verdict).toBe('on');
  });

  it('watch/HK ingest splits (pace as "m:ss" string) still resolve the work window', () => {
    // Live-row shape verified 2026-07-06: keys hr/mile/pace/cadence/elev_ft/distanceMi.
    const splits = [
      { hr: 143, mile: 1, pace: '8:40', cadence: 163, elev_ft: 18, distanceMi: 1 },
      { hr: 150, mile: 2, pace: '7:50', cadence: 165, elev_ft: 4, distanceMi: 1 },
      { hr: 160, mile: 3, pace: '7:00', cadence: 172, elev_ft: 0, distanceMi: 1 },
      { hr: 161, mile: 4, pace: '6:58', cadence: 172, elev_ft: 2, distanceMi: 1 },
      { hr: 162, mile: 5, pace: '7:02', cadence: 171, elev_ft: -3, distanceMi: 1 },
      { hr: 158, mile: 6, pace: '7:50', cadence: 166, elev_ft: 1, distanceMi: 1 },
      { hr: 148, mile: 7, pace: '8:40', cadence: 160, elev_ft: 0, distanceMi: 0.5 },
    ];
    const j = judgeTestPointExecution({ ...base, rawSplits: splits });
    expect(j.basis).toBe('work-phase-splits');
    expect(j.actualS).toBe(420); // mean of full-inside miles 3-5 (420/418/422)
    expect(j.verdict).toBe('on');
  });

  it('no spec + no watch → abstains (honest absence, not a fabricated miss)', () => {
    const j = judgeTestPointExecution({ ...base, spec: null });
    expect(j.verdict).toBeNull();
    expect(j.basis).toBeNull();
    expect(j.actualS).toBe(PERFECT_OVERALL_S); // display pace survives
  });

  it('threshold reps · disjoint work blocks → blend, never a splits window', () => {
    const spec = {
      kind: 'threshold', warmup_mi: 1, rep_count: 4, rep_distance_mi: 1,
      rep_pace_s_per_mi: 400, rep_rest_s: 60, cooldown_mi: 1, lthr_bpm: null,
    };
    // blend: (1×500 + 4×400 + 3×60 + 1×500) / (1 + 4 + 3×(60/540) + 1)
    //      = 2780 / 6.333 ≈ 439
    const splits = [
      { mile: 1, paceSecPerMi: 500, distanceMi: 1 },
      { mile: 2, paceSecPerMi: 420, distanceMi: 1 },
      { mile: 3, paceSecPerMi: 430, distanceMi: 1 },
      { mile: 4, paceSecPerMi: 425, distanceMi: 1 },
      { mile: 5, paceSecPerMi: 435, distanceMi: 1 },
      { mile: 6, paceSecPerMi: 500, distanceMi: 1 },
    ];
    const j = judgeTestPointExecution({
      ...base, type: 'threshold', targetS: 400, spec,
      plannedDistanceMi: 6.3, actualDistanceMi: 6.0,
      rawSplits: splits, overallS: 445,
    });
    expect(j.basis).toBe('blended-overall');
    expect(j.verdict).toBe('on');            // 445 within 439 ± 15
  });

  it('long run keeps the whole-run comparison and the generous ±40 band', () => {
    const j = judgeTestPointExecution({
      ...base, type: 'long', targetS: 480, overallS: 501, spec: null,
    });
    expect(j.basis).toBe('overall');
    expect(j.verdict).toBe('on');            // 501 ≤ 480 + 40
    const slow = judgeTestPointExecution({
      ...base, type: 'long', targetS: 480, overallS: 530, spec: null,
    });
    expect(slow.verdict).toBe('slow');       // 530 > 480 + 40
  });

  it('no target on a quality day → abstains', () => {
    const j = judgeTestPointExecution({ ...base, targetS: null });
    expect(j.verdict).toBeNull();
    expect(j.basis).toBeNull();
  });
});

describe('P1-10 helpers', () => {
  it('normalizePaceSplits · resolves every source shape run-state handles', () => {
    // Strava splits_standard (average_speed m/s + distance m)
    const strava = normalizePaceSplits([
      { split: 1, average_speed: 3.35, distance: 1609.34 },
      { split: 2, average_speed: 3.35, distance: 1609.34 },
    ]);
    expect(strava).toHaveLength(2);
    expect(strava[0].distMi).toBeCloseTo(1.0, 2);
    expect(strava[0].timeS / strava[0].distMi).toBeCloseTo(1609.34 / 3.35, 0);
    // Watch/HK numeric
    const hk = normalizePaceSplits([{ mile: 1, paceSecPerMi: 480, distanceMi: 1 }, { mile: 2, paceSecPerMi: 490, distanceMi: 1 }]);
    expect(hk[1].timeS).toBe(490);
  });

  it('normalizePaceSplits · legacy single-split stub on a multi-mile run → []', () => {
    expect(normalizePaceSplits([{ mile: 1, paceSecPerMi: 500, distanceMi: 6 }])).toEqual([]);
  });

  it('normalizePaceSplits · any split without a resolvable pace poisons the set', () => {
    expect(normalizePaceSplits([
      { mile: 1, paceSecPerMi: 500, distanceMi: 1 },
      { mile: 2, distanceMi: 1 },
    ])).toEqual([]);
  });

  it('contiguousWorkWindowMi · tempo has one window, reps have none', () => {
    const tempoPhases = expandSpecToPhases({ spec: TEMPO_SPEC, totalMi: 6.5, easyPaceSec: 520 })!;
    expect(contiguousWorkWindowMi(tempoPhases)).toEqual({ startMi: 1.5, endMi: 5.5 });
    const repPhases = expandSpecToPhases({
      spec: { kind: 'threshold', warmup_mi: 1, rep_count: 4, rep_distance_mi: 1, rep_pace_s_per_mi: 400, rep_rest_s: 60, cooldown_mi: 1, lthr_bpm: null },
      totalMi: 6.3, easyPaceSec: 500, recoveryPaceSec: 540,
    })!;
    expect(contiguousWorkWindowMi(repPhases)).toBeNull();
  });

  it('paceOverWindow · full-inside splits only · coverage floor enforced', () => {
    const splits = [
      { distMi: 1, timeS: 520 }, { distMi: 1, timeS: 470 }, { distMi: 1, timeS: 420 },
      { distMi: 1, timeS: 418 }, { distMi: 1, timeS: 422 }, { distMi: 1, timeS: 470 },
      { distMi: 0.5, timeS: 260 },
    ];
    expect(paceOverWindow(splits, 1.5, 5.5)).toBeCloseTo(420, 5);
    // Window with < 1mi of full-inside splits → null.
    expect(paceOverWindow(splits, 1.6, 2.4)).toBeNull();
  });

  it('blendedOverallTargetSPerMi · distance-weighted WU/work/CD expectation', () => {
    const phases = expandSpecToPhases({ spec: TEMPO_SPEC, totalMi: 6.5, easyPaceSec: 520 })!;
    expect(Math.round(blendedOverallTargetSPerMi(phases)!)).toBe(458); // 2980 / 6.5
  });

  it('easyPaceForBlend · target-anchored fallback when vdot is unknown', () => {
    expect(easyPaceForBlend(null, 'tempo', 420)).toBe(520);       // T + 100
    expect(easyPaceForBlend(null, 'intervals', 402)).toBe(520);   // I = T−18 → +118
    expect(easyPaceForBlend(null, 'tempo', null)).toBeNull();     // never invent
  });
});
