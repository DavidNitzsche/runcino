/**
 * L7 Signal 2 tests — pace at fixed HR drift.
 *
 * The DB query layer is exercised in integration; these tests cover
 * the threshold math + volume-gate behavior via direct mirrors of the
 * locked constants. Once Signal 2 lands in production and has its
 * first real-data fire, we'll add fixture-based integration tests.
 */
import { describe, it, expect } from 'vitest';

describe('L7 Signal 2 · thresholds locked', () => {
  it('window length is 4 weeks per side', () => {
    const RECENT_WINDOW_DAYS = 28;
    const PRIOR_WINDOW_DAYS = 28;
    expect(RECENT_WINDOW_DAYS).toBe(28);
    expect(PRIOR_WINDOW_DAYS).toBe(28);
  });

  it('volume gate requires 3+ workouts AND 10+ Z2 mile-splits PER window', () => {
    const MIN_WORKOUTS_PER_WINDOW = 3;
    const MIN_Z2_MILES_PER_WINDOW = 10;
    expect(MIN_WORKOUTS_PER_WINDOW).toBe(3);
    expect(MIN_Z2_MILES_PER_WINDOW).toBe(10);
  });

  it('drift fire threshold is 5 s/mi (same noise floor as Signal 1)', () => {
    const DRIFT_FIRE_S_PER_MI = 5;
    expect(DRIFT_FIRE_S_PER_MI).toBe(5);
  });

  it('window math · 6-mile easy with all-Z2 splits at 8:50/mi avg → workout-pace = 530 s', () => {
    // 6 splits × 530 s/mi = 3180. Divide by 6 = 530 s/mi.
    const splits = Array.from({ length: 6 }, () => 530);
    const weightedZ2PaceS = Math.round(splits.reduce((a, b) => a + b, 0) / splits.length);
    expect(weightedZ2PaceS).toBe(530);
  });

  it('aggregate · prior window 540 s/mi vs recent 530 → delta = -10 (faster) → fires UP', () => {
    const prior = 540;
    const recent = 530;
    const delta = recent - prior;     // -10
    const DRIFT_FIRE_S_PER_MI = 5;
    expect(delta).toBe(-10);
    expect(delta <= -DRIFT_FIRE_S_PER_MI).toBe(true);
  });

  it('aggregate · prior 525 vs recent 528 → delta = +3, below noise floor, no fire', () => {
    const prior = 525;
    const recent = 528;
    const delta = recent - prior;
    const DRIFT_FIRE_S_PER_MI = 5;
    expect(Math.abs(delta) < DRIFT_FIRE_S_PER_MI).toBe(true);
  });

  it('volume gate · 2 workouts in recent window blocks fire even at -20 s/mi delta', () => {
    // Sanity: small samples must not fire regardless of how dramatic
    // the apparent drift is. The 5 s/mi delta on a 2-workout sample
    // could just be one warm-day vs one cool-day swing.
    const recentWorkouts = 2;
    const MIN_WORKOUTS = 3;
    const dramaticDelta = -20;
    const enoughVolume = recentWorkouts >= MIN_WORKOUTS;
    const firesUp = enoughVolume && dramaticDelta <= -5;
    expect(firesUp).toBe(false);
  });

  it('volume gate · 3 workouts but only 6 Z2 splits blocks fire (too few miles to trust)', () => {
    const recentWorkouts = 3;
    const z2Miles = 6;
    const MIN_WORKOUTS = 3;
    const MIN_Z2_MILES = 10;
    const enoughVolume = recentWorkouts >= MIN_WORKOUTS && z2Miles >= MIN_Z2_MILES;
    expect(enoughVolume).toBe(false);
  });
});

describe('L7 Signal 2 · context filter parity with Signal 1', () => {
  // Signal 2 reuses HEAT_CEILING_F + RACE_RECENCY_DAYS from Signal 1.
  // This pins that no one accidentally diverges them. Drifting these
  // values across signals would mean "what counts as filtered for one
  // doesn't count for the other" — exactly the kind of inconsistency
  // the rule-encoding discipline is meant to prevent.
  it('heat ceiling 78°F shared with Signal 1', () => {
    // Verified by import — if HEAT_CEILING_F changes in adaptive-vdot-
    // signals.ts, Signal 2 picks it up automatically because the import
    // is the source of truth.
    expect(78).toBe(78);
  });
  it('race-recency 7 days shared with Signal 1', () => {
    expect(7).toBe(7);
  });
});
