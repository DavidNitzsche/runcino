/**
 * Calibration mode — a cold-start runner (no measured fitness) eases in with
 * effort-cued threshold for the intro, NOT fabricated-pace VO2 intervals. The
 * daily re-anchor swaps in the real build once a read lands.
 */
import { describe, it, expect } from 'vitest';
import { goalQualityType } from './seed-from-onboarding';

describe('goalQualityType — calibration intro', () => {
  it('normal 5K build: intervals from week 0', () => {
    expect(goalQualityType('5k', 0, false)).toBe('intervals');
    expect(goalQualityType('5k', 5, false)).toBe('intervals');
  });

  it('calibrating: gentle threshold through the intro, then real intervals', () => {
    expect(goalQualityType('5k', 0, true)).toBe('threshold'); // intro
    expect(goalQualityType('5k', 1, true)).toBe('threshold'); // intro
    expect(goalQualityType('5k', 2, true)).toBe('intervals'); // intro over → real build
    expect(goalQualityType('10k', 0, true)).toBe('threshold');
  });

  it('no-goal consistency plan is threshold regardless (calibration is a no-op there)', () => {
    expect(goalQualityType(null, 0, false)).toBe('threshold');
    expect(goalQualityType(null, 0, true)).toBe('threshold');
  });
});
