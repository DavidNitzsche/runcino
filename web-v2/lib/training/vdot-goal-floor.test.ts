/**
 * Goal-relative training-VDOT floor + I-pace — verified against Justin
 * Demetrician's REAL Apple Watch runs (the 5K-goal test case, 2026-06-15).
 *
 * Before this fix: a flat 4mi floor in vdotFromRun + the SQL loader rejected
 * every one of his ~3.1mi efforts, so a 5K-goal runner with 6 months of 5K
 * data had NO measured VDOT and was coached on a mileage-fabricated VDOT 32 →
 * "VO2 intervals" at 9:50/mi, slower than his own easy runs.
 */
import { describe, it, expect } from 'vitest';
import {
  vdotRunFloorMi, goalDistanceMiFromCode, vdotFromRun, bestRecentVdot,
  iPaceFromVdot, tPaceFromVdot,
} from './vdot';

// Justin's best honest efforts (source: prod runs table, apple_watch).
// 3.17mi @ 8:37/mi, avg HR 173 / max 188 → ~90% max = a real 5K time trial.
const JUSTIN_BEST = { finishSeconds: 1638, distanceMi: 3.17, avgHr: 173, maxHr: 188 };
const JUSTIN_RUNS = [
  { id: 'a', date: '2026-05-27', workout_type: null, distance_mi: 3.17, finish_seconds: 1638, avg_hr: 173, max_hr: 188 },
  { id: 'b', date: '2026-06-15', workout_type: null, distance_mi: 3.18, finish_seconds: 1664, avg_hr: 167, max_hr: 184 },
];
const TODAY = '2026-06-15';

describe('vdotRunFloorMi — floor keys off the goal event', () => {
  it('5K goal → 3.0mi (admits a 5K time trial)', () => {
    expect(vdotRunFloorMi(goalDistanceMiFromCode('5k'))).toBe(3);
  });
  it('10K / Half / Marathon / unknown → 4.0mi (unchanged)', () => {
    expect(vdotRunFloorMi(goalDistanceMiFromCode('10k'))).toBe(4);
    expect(vdotRunFloorMi(goalDistanceMiFromCode('half'))).toBe(4);
    expect(vdotRunFloorMi(goalDistanceMiFromCode('marathon'))).toBe(4);
    expect(vdotRunFloorMi(goalDistanceMiFromCode('none'))).toBe(4); // null code
    expect(vdotRunFloorMi(null)).toBe(4);
  });
});

describe('vdotFromRun — the bug and the fix on real data', () => {
  it('REJECTS his 3.17mi effort under the legacy flat 4mi floor (the bug)', () => {
    expect(vdotFromRun({ ...JUSTIN_BEST })).toBeNull();               // default 4mi
    expect(vdotFromRun({ ...JUSTIN_BEST, minDistanceMi: 4 })).toBeNull();
  });
  it('ACCEPTS it under the 5K floor and reads a sane novice VDOT (the fix)', () => {
    const v = vdotFromRun({ ...JUSTIN_BEST, minDistanceMi: 3 });
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThanOrEqual(30);  // not the fabricated 32 — measured
    expect(v!).toBeLessThanOrEqual(38);      // ~26:45 5K ≈ VDOT 33
  });
  it('still rejects a short effort below the 5K floor (noise guard intact)', () => {
    expect(vdotFromRun({ finishSeconds: 480, distanceMi: 1.0, avgHr: 175, maxHr: 188, minDistanceMi: 3 })).toBeNull();
  });
  it('still rejects an easy-effort run (HR gate intact)', () => {
    // 3.16mi @ 9:26, avg HR 120 / max 175 → 69% max, not honest effort.
    expect(vdotFromRun({ finishSeconds: 1789, distanceMi: 3.16, avgHr: 120, maxHr: 175, minDistanceMi: 3 })).toBeNull();
  });
});

describe('bestRecentVdot — end to end on his run set', () => {
  it('produces a measured VDOT at the 5K floor, nothing at the 4mi floor', () => {
    const withFix = bestRecentVdot([], TODAY, 180, JUSTIN_RUNS, 3);
    expect(withFix.best).not.toBeNull();
    expect(withFix.best!.vdot).toBeGreaterThanOrEqual(30);
    expect(withFix.best!.vdot).toBeLessThanOrEqual(38);

    const legacy = bestRecentVdot([], TODAY, 180, JUSTIN_RUNS, 4);
    expect(legacy.best).toBeNull(); // every run rejected — the status quo
  });
});

describe('iPaceFromVdot — intervals become true VO2, not near-threshold', () => {
  // Key off his actual MEASURED fitness, not a hard-coded guess.
  const measured = bestRecentVdot([], TODAY, 180, JUSTIN_RUNS, 3).best!.vdot;
  const hisActualBestPace = 1638 / 3.17; // 516.7 s/mi — the 5K effort we read

  it('is faster than threshold and beats the legacy T-18 cruise default', () => {
    const iPace = iPaceFromVdot(measured)!;
    const tPace = tPaceFromVdot(measured)!;
    expect(iPace).toBeLessThan(tPace);          // I-pace faster than T
    expect(iPace).toBeLessThan(tPace - 18);     // beats the old cruise offset
  });

  it('lands near his actual 5K-effort pace (I-pace ≈ current 5K race pace)', () => {
    const iPace = iPaceFromVdot(measured)!;
    // Within ~45s/mi of the 8:37 he actually ran — a real VO2 target, not a jog.
    // (Still slightly slow because reading VDOT off a sub-maximal training run
    //  under-reads true fitness ~3pts — the field-test follow-up closes that.)
    expect(Math.abs(iPace - hisActualBestPace)).toBeLessThanOrEqual(45);
  });

  it('puts intervals ahead of the legacy 9:50/mi (the original absurdity)', () => {
    const legacyInterval = tPaceFromVdot(32)! - 18; // = 590 s/mi = 9:50/mi
    expect(legacyInterval).toBeGreaterThan(560);    // slower than his easy days
    expect(iPaceFromVdot(measured)!).toBeLessThan(legacyInterval);
  });
});
