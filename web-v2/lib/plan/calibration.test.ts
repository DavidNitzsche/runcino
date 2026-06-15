/**
 * Calibration intro — a cold-start runner (no measured fitness) eases in with
 * effort-cued threshold instead of fabricated-pace VO2 intervals; the re-anchor
 * commits the real build once a read lands.
 */
import { describe, it, expect } from 'vitest';
import { goalQualityType } from './seed-from-onboarding';

describe('goalQualityType — calibration intro', () => {
  it('a 5K build normally starts with VO2 intervals from week 0', () => {
    expect(goalQualityType('5k', 0, false)).toBe('intervals');
    expect(goalQualityType('5k', 5, false)).toBe('intervals');
  });

  it('but a CALIBRATING 5K build eases in with threshold for the intro weeks', () => {
    expect(goalQualityType('5k', 0, true)).toBe('threshold'); // week 0 — gentle
    expect(goalQualityType('5k', 1, true)).toBe('threshold'); // week 1 — gentle
    expect(goalQualityType('5k', 2, true)).toBe('intervals'); // intro over → real build
    expect(goalQualityType('5k', 8, true)).toBe('intervals');
  });

  it('a no-goal consistency plan is threshold throughout (calibration is a no-op)', () => {
    expect(goalQualityType(null, 0, false)).toBe('threshold');
    expect(goalQualityType(null, 0, true)).toBe('threshold');
  });
});
