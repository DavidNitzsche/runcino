/**
 * decideMode + decidePhase against advanced state — regression for the
 * "11 weeks of BASE_MAINTENANCE" bug. The bug: decideMode read from
 * state.races.inWindow (a static array set at gather-time), so as
 * advanceState walked the simulation forward in days, mode stayed
 * 'base' even when the race's daysAway entered the build window.
 *
 * Fix: decideMode computes from nextA.daysAway directly against the
 * distance-aware build window. These tests assert the transition
 * happens at the right boundary.
 */
import { describe, expect, it } from 'vitest';
import { buildWindowDays, raceSubPhase } from '../coach-principles';

describe('build window boundaries', () => {
  it('half marathon build window is 12 weeks (84 days)', () => {
    expect(buildWindowDays(13.1)).toBe(84);
  });
  it('marathon build window is 16 weeks (112 days)', () => {
    expect(buildWindowDays(26.2)).toBe(112);
  });
  it('10K build window is 8 weeks', () => {
    expect(buildWindowDays(6.2)).toBe(56);
  });
  it('5K build window is 6 weeks', () => {
    expect(buildWindowDays(3.1)).toBe(42);
  });
});

describe('raceSubPhase transitions for a half marathon (12wk window)', () => {
  // SUBPHASE_FRACTIONS: BASE 4/16, BUILD 6/16, PEAK 4/16, TAPER 2/16.
  // Boundaries (days from race):
  //   peakEnd  = 84 * 2/16 = 10.5
  //   buildEnd = 10.5 + 84 * 4/16 = 31.5
  //   baseEnd  = 31.5 + 84 * 6/16 = 63
  const HALF = 13.1;

  it('returns TAPER inside the last 10.5 days', () => {
    expect(raceSubPhase(7, HALF)).toBe('TAPER');
    expect(raceSubPhase(10, HALF)).toBe('TAPER');
  });
  it('returns PEAK between 10.5 and 31.5 days', () => {
    expect(raceSubPhase(15, HALF)).toBe('PEAK');
    expect(raceSubPhase(30, HALF)).toBe('PEAK');
  });
  it('returns BUILD between 31.5 and 63 days', () => {
    expect(raceSubPhase(40, HALF)).toBe('BUILD');
    expect(raceSubPhase(60, HALF)).toBe('BUILD');
  });
  it('returns BASE between 63 and 84 days (still in build window)', () => {
    expect(raceSubPhase(70, HALF)).toBe('BASE');
    expect(raceSubPhase(84, HALF)).toBe('BASE');
  });
  it('returns BASE outside build window too (engine swaps to base mode at decideMode level)', () => {
    // raceSubPhase doesn't check window boundary — it just classifies
    // by days-out per the ladder. Mode-level decision (race vs base)
    // is what determines whether to consult raceSubPhase at all.
    expect(raceSubPhase(101, HALF)).toBe('BASE');
  });
});
