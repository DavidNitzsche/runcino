/**
 * 2026-07-06 · P1-43 fix · pins the threshold-HR derivation chain that
 * replaced the phone's hardcoded LTHR 162.
 *
 * Doctrine: Research/03-heart-rate-zones.md §6 (Friel LTHR) + §11
 * (crosswalk · Threshold ≈ 86–92% HRmax ≈ 95–102% LTHR → LTHR ≈ 0.90 HRmax).
 */
import { describe, it, expect } from 'vitest';
import { lthrFromMaxHr, lthrFromRace, lthrFromMarathon, calibrateLthr } from './lthr';

describe('lthrFromMaxHr · §11 crosswalk', () => {
  it('LTHR ≈ 0.90 × HRmax', () => {
    expect(lthrFromMaxHr(190)).toBe(171);
    expect(lthrFromMaxHr(200)).toBe(180);
    // The audit's 60-year-old archetype: HRmax ~160 → LTHR ~144, nowhere
    // near the hardcoded 162 they were being judged against.
    expect(lthrFromMaxHr(160)).toBe(144);
  });

  it('implausible max HR → null · never fabricate', () => {
    expect(lthrFromMaxHr(100)).toBeNull();   // below computeZones' maxHr floor
    expect(lthrFromMaxHr(250)).toBeNull();   // above ceiling
    expect(lthrFromMaxHr(NaN)).toBeNull();
    expect(lthrFromMaxHr(0)).toBeNull();
  });
});

describe('race-derived LTHR (existing paths · unchanged)', () => {
  it('half-marathon avg HR ≈ LTHR', () => {
    expect(lthrFromRace(13.1, 168)).toBe(168);
    expect(lthrFromRace(6.2, 175)).toBeNull();   // 10K over-reads LT · rejected
  });
  it('marathon avg HR + 5 (cardiac-drift correction)', () => {
    expect(lthrFromMarathon(26.2, 158)).toBe(163);
  });
  it('calibrateLthr routes by distance and stamps the method', () => {
    expect(calibrateLthr(13.1, 168)).toEqual({ lthr: 168, method: 'race_half' });
    expect(calibrateLthr(26.2, 158)).toEqual({ lthr: 163, method: 'race_full' });
    expect(calibrateLthr(3.1, 180)).toBeNull();
  });
});
