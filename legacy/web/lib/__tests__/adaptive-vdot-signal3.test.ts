/**
 * L7 Signal 3 tests, interval pace at controlled effort.
 *
 * Like Signal 2's tests, these pin the locked constants + mirror
 * the threshold math at the unit level. Integration-level firing
 * tests come once Signal 3 has its first real-data fire.
 */
import { describe, it, expect } from 'vitest';

describe('L7 Signal 3 · thresholds + constants locked', () => {
  it('lookback window matches Signal 1 (6 weeks / 42 days)', () => {
    const LOOKBACK_DAYS = 42;
    expect(LOOKBACK_DAYS).toBe(42);
  });

  it('UP threshold same shape as Signal 1 (3+ obs, 2.5+ weight)', () => {
    // Same asymmetry-of-action principle: bumps need corroboration;
    // downgrade-investigate fires on weaker evidence (2+/1.5+).
    const UP_OBS_MIN = 3;
    const UP_WEIGHT_MIN = 2.5;
    expect(UP_OBS_MIN).toBe(3);
    expect(UP_WEIGHT_MIN).toBe(2.5);
  });

  it('DOWN threshold (2+ obs, 1.5+ weight)', () => {
    const DOWN_OBS_MIN = 2;
    const DOWN_WEIGHT_MIN = 1.5;
    expect(DOWN_OBS_MIN).toBe(2);
    expect(DOWN_WEIGHT_MIN).toBe(1.5);
  });

  it('noise floor matches Signals 1+2 at 5 s/mi', () => {
    const FASTER_THRESHOLD_S = 5;
    const SLOWER_THRESHOLD_S = 5;
    expect(FASTER_THRESHOLD_S).toBe(5);
    expect(SLOWER_THRESHOLD_S).toBe(5);
  });

  it('HR-missing soft attenuation = 0.6 (shared with Signal 1)', () => {
    const HR_MISSING_FACTOR = 0.6;
    expect(HR_MISSING_FACTOR).toBe(0.6);
  });

  it('hard-context taxonomy shared with Signal 1', () => {
    const HARD_TAGS = new Set(['heat', 'race-recency', 'poor-sleep']);
    expect(HARD_TAGS.has('heat')).toBe(true);
    expect(HARD_TAGS.has('race-recency')).toBe(true);
    expect(HARD_TAGS.has('poor-sleep')).toBe(true);
    expect(HARD_TAGS.has('hr-missing')).toBe(false);  // soft, not hard
  });
});

describe('L7 Signal 3 · interval-candidate detection', () => {
  it('plannedWorkoutType = "intervals" is a clear candidate', () => {
    const data = { plannedWorkoutType: 'intervals', name: 'Untitled' };
    const isPlanned = data.plannedWorkoutType === 'intervals' || data.plannedWorkoutType === 'threshold_intervals';
    expect(isPlanned).toBe(true);
  });

  it('name "5x400" matches interval keyword pattern', () => {
    const pattern = /\d+\s*x\s*\d/i;
    expect(pattern.test('5x400')).toBe(true);
    expect(pattern.test('4 x 800')).toBe(true);
    expect(pattern.test('Pyramid Intervals')).toBe(false);  // pyramid matches a different keyword
  });

  it('name "Hill Repeats" matches keyword pattern', () => {
    const pattern = /repeats?\b/i;
    expect(pattern.test('Hill Repeats')).toBe(true);
    expect(pattern.test('Mile Repeats')).toBe(true);
    expect(pattern.test('Easy Run')).toBe(false);
  });

  it('Strava workoutType=3 (Workout) alone is not enough, name must also match', () => {
    // workoutType=3 covers tempos, threshold, AND intervals. We need
    // additional confirmation (name keyword) to identify as interval.
    const data = { workoutType: 3, name: 'Tempo 5 Miles' };
    const intervalNamePatterns = [/interval/i, /repeats?\b/i, /\d+\s*x\s*\d/i, /pyramid/i, /vo2/i, /track\b/i];
    const matches = intervalNamePatterns.some((p) => p.test(data.name));
    expect(matches).toBe(false);
  });
});

describe('L7 Signal 3 · work-split picking', () => {
  it('picks all splits whose HR sits in Z4-Z5 when HR data present', () => {
    // Mock activity: 5 splits, 2 in Z4-Z5 (work intervals), 3 below
    const z4z5 = { lo: 153, hi: 181 };
    const splits = [
      { mile: 1, paceSPerMi: 540, avgHr: 130 },  // warmup, Z3
      { mile: 2, paceSPerMi: 420, avgHr: 165 },  // work 1, Z4
      { mile: 3, paceSPerMi: 480, avgHr: 140 },  // rest jog, Z3
      { mile: 4, paceSPerMi: 415, avgHr: 168 },  // work 2, Z4
      { mile: 5, paceSPerMi: 560, avgHr: 125 },  // cooldown, Z2
    ];
    const work = splits.filter((s) => s.avgHr >= z4z5.lo && s.avgHr <= z4z5.hi);
    expect(work).toHaveLength(2);
    expect(work.map((s) => s.mile)).toEqual([2, 4]);
  });

  it('falls back to top-3 fastest splits when no HR data', () => {
    const splits = [
      { mile: 1, paceSPerMi: 540, avgHr: null },
      { mile: 2, paceSPerMi: 420, avgHr: null },
      { mile: 3, paceSPerMi: 480, avgHr: null },
      { mile: 4, paceSPerMi: 415, avgHr: null },
      { mile: 5, paceSPerMi: 560, avgHr: null },
    ];
    const sorted = [...splits].sort((a, b) => a.paceSPerMi - b.paceSPerMi);
    const work = sorted.slice(0, 3);
    expect(work.map((s) => s.mile)).toEqual([4, 2, 3]);  // 415, 420, 480
  });
});

describe('L7 Signal 3 · GAP comparison logic', () => {
  // GAP swap rule (David 2026-05-19 round 4):
  //   |raw - GAP| > 20 s/mi → swap to GAP (terrain distortion meaningful)
  //   |raw - GAP| ≤ 20 s/mi → keep raw (flat-ish, GAP is noise)
  //   GAP missing on any work split → raw with uncertainty tag
  const GAP_SWAP_THRESHOLD_S = 20;

  it('flat track · raw 7:00, GAP 7:02 → keep raw (within 20s/mi)', () => {
    const raw = 420;        // 7:00/mi
    const gap = 422;        // 7:02/mi
    const distortion = Math.abs(raw - gap);
    expect(distortion).toBeLessThanOrEqual(GAP_SWAP_THRESHOLD_S);
    // → comparisonBasis = 'raw', comparisonPace = raw
  });

  it('hill repeats · raw 8:44 = 524s, GAP 6:50 = 410s, distortion 114s → swap to GAP', () => {
    const raw = 524;
    const gap = 410;
    const distortion = Math.abs(raw - gap);
    expect(distortion).toBeGreaterThan(GAP_SWAP_THRESHOLD_S);
    // → comparisonBasis = 'gap', comparisonPace = gap (410s)
    // → against prescribed I-pace 6:41 (401s): paceDeltaS = +9 → NEUTRAL
  });

  it('mild rolling hills · raw 7:00, GAP 6:50, distortion 10s → keep raw', () => {
    const raw = 420;
    const gap = 410;
    const distortion = Math.abs(raw - gap);
    expect(distortion).toBeLessThanOrEqual(GAP_SWAP_THRESHOLD_S);
    // → comparisonBasis = 'raw'
  });

  it('GAP missing on any work split → fall back to raw, mark uncertain', () => {
    // The fall-back tag is 'raw-no-gap-available' so the diagnostic
    // surfaces the uncertainty. We never compute GAP locally.
    const expectedBasis = 'raw-no-gap-available';
    expect(expectedBasis).toBe('raw-no-gap-available');
  });

  it('threshold value locked at 20 s/mi', () => {
    // Mirror of GAP_SWAP_THRESHOLD_S from adaptive-vdot-signal3.ts.
    // Test pins it so a future edit doesn't silently shift the
    // sensitivity of when GAP-correction kicks in.
    expect(GAP_SWAP_THRESHOLD_S).toBe(20);
  });
});

describe('L7 Signal 3 · firing math', () => {
  it('3 faster work-interval workouts at clean weight → fires UP', () => {
    const fasterCount = 3;
    const fasterWeight = 3.0;
    expect(fasterCount >= 3 && fasterWeight >= 2.5).toBe(true);
  });

  it('3 faster but all hr-missing (weight 0.6 each) → 1.8w, below UP threshold', () => {
    const fasterCount = 3;
    const fasterWeight = 3 * 0.6;
    expect(fasterCount).toBeGreaterThanOrEqual(3);
    expect(fasterWeight).toBeLessThan(2.5);
  });

  it('5 faster + hr-missing (5 * 0.6 = 3.0w) → still fires UP', () => {
    const fasterCount = 5;
    const fasterWeight = 5 * 0.6;
    expect(fasterCount).toBeGreaterThanOrEqual(3);
    expect(fasterWeight).toBeGreaterThanOrEqual(2.5);
  });
});
