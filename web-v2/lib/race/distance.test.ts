/**
 * lib/race/distance.test.ts
 *
 * 2026-07-06 · P1-17 falsifiers for the shared distance-label parser.
 * The parser is now WRITE-path load-bearing (meta.distanceMi is derived
 * from it on every race create/edit) so its label coverage is locked here:
 * every label the app can emit (onboarding raceDistanceLabel: "5K", "10K",
 * "Half Marathon", "Marathon") must resolve, and the codebase-canonical
 * 26.2/13.1/6.2/3.1 values must not drift (projection-snapshot BETWEEN
 * bands are tuned to them).
 */
import { describe, expect, it } from 'vitest';
import { distanceMiFromLabel } from './distance';

describe('distanceMiFromLabel — canonical labels', () => {
  it('resolves every label the onboarding path writes', () => {
    expect(distanceMiFromLabel('5K')).toBe(3.1);
    expect(distanceMiFromLabel('10K')).toBe(6.2);
    expect(distanceMiFromLabel('Half Marathon')).toBe(13.1);
    expect(distanceMiFromLabel('Marathon')).toBe(26.2);
  });

  it('half is checked before bare marathon (ordering trap)', () => {
    expect(distanceMiFromLabel('half marathon')).toBe(13.1);
    expect(distanceMiFromLabel('HALF')).toBe(13.1);
    expect(distanceMiFromLabel('21k')).toBe(13.1);
  });

  it('substring-matches decorated names ("Boston Marathon")', () => {
    expect(distanceMiFromLabel('Boston Marathon')).toBe(26.2);
    expect(distanceMiFromLabel('San Diego Half')).toBe(13.1);
  });

  it('named non-onboarding distances', () => {
    expect(distanceMiFromLabel('15K')).toBe(9.3);
    expect(distanceMiFromLabel('10 mile')).toBe(10.0);
    expect(distanceMiFromLabel('20 Mile')).toBe(20.0);
    expect(distanceMiFromLabel('26.2')).toBe(26.2);
    expect(distanceMiFromLabel('13.1')).toBe(13.1);
  });

  it('numeric fallback: miles bare/suffixed, km converted', () => {
    expect(distanceMiFromLabel('6.2')).toBe(6.2);
    expect(distanceMiFromLabel('6.2 mi')).toBe(6.2);
    expect(distanceMiFromLabel('50km')).toBe(31.07);
    expect(distanceMiFromLabel('8k')).toBe(4.97);
  });

  it('returns null — never a default — for missing/unparseable labels', () => {
    expect(distanceMiFromLabel(null)).toBeNull();
    expect(distanceMiFromLabel(undefined)).toBeNull();
    expect(distanceMiFromLabel('')).toBeNull();
    expect(distanceMiFromLabel('turkey trot')).toBeNull();
    expect(distanceMiFromLabel('0')).toBeNull();
  });

  it('longer named distances do not false-match shorter substrings', () => {
    // "50k" must NOT hit the "5k" branch; "100k" must not hit "10k".
    expect(distanceMiFromLabel('50k')).toBe(31.07);
    expect(distanceMiFromLabel('100k')).toBe(62.14);
  });
});
