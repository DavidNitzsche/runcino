/**
 * phaseProgress + lerpByProgress — covers gap 1 (progressive ramp).
 *
 * Asserts that:
 *   - phaseProgress returns 0 at the start of a phase, 1 at the end
 *   - The ramp produces monotone increases for early-phase → late-phase
 *   - Edge cases (no race, before window, after race) return 0
 */
import { describe, expect, it } from 'vitest';
import { phaseProgress, lerpByProgress } from '../coach-principles';

describe('phaseProgress', () => {
  // For a 13.1mi half: window = 12wk * 7 = 84 days.
  // SUBPHASE_FRACTIONS: BASE 4/16, BUILD 6/16, PEAK 4/16, TAPER 2/16.
  // Boundaries (days from race):
  //   peakEnd = 84 * 2/16 = 10.5
  //   buildEnd = 10.5 + 84 * 4/16 = 31.5
  //   baseEnd = 31.5 + 84 * 6/16 = 63
  // BUILD spans days 31.5 → 63 from race (closer race = end).
  const HALF_MI = 13.1;

  it('returns 0 at the start of BUILD (just past baseEnd)', () => {
    const p = phaseProgress(63, HALF_MI, 'BUILD');
    expect(p).toBeCloseTo(0, 1);
  });

  it('returns 1 at the end of BUILD (just before buildEnd)', () => {
    const p = phaseProgress(31.5, HALF_MI, 'BUILD');
    expect(p).toBeCloseTo(1, 1);
  });

  it('returns ~0.5 at the midpoint of BUILD', () => {
    const mid = (63 + 31.5) / 2;
    const p = phaseProgress(mid, HALF_MI, 'BUILD');
    expect(p).toBeCloseTo(0.5, 1);
  });

  it('returns 1 at the end of PEAK (just before peakEnd)', () => {
    const p = phaseProgress(10.5, HALF_MI, 'PEAK');
    expect(p).toBeCloseTo(1, 1);
  });

  it('returns 0 when daysAway is null (no race scheduled)', () => {
    expect(phaseProgress(null, HALF_MI, 'BUILD')).toBe(0);
  });

  it('clamps to [0, 1] for daysAway outside phase bounds', () => {
    expect(phaseProgress(200, HALF_MI, 'BUILD')).toBe(0);
    expect(phaseProgress(0, HALF_MI, 'BUILD')).toBe(1);
  });
});

describe('lerpByProgress', () => {
  it('returns low at progress 0', () => {
    expect(lerpByProgress(5, 8, 0)).toBe(5);
  });

  it('returns high at progress 1', () => {
    expect(lerpByProgress(5, 8, 1)).toBe(8);
  });

  it('returns midpoint at progress 0.5', () => {
    expect(lerpByProgress(5, 8, 0.5)).toBe(6.5);
  });

  it('clamps progress > 1 to 1', () => {
    expect(lerpByProgress(5, 8, 1.5)).toBe(8);
  });

  it('clamps progress < 0 to 0', () => {
    expect(lerpByProgress(5, 8, -0.5)).toBe(5);
  });
});
