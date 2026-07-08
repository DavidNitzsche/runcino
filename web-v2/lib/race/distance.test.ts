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

// ─── 2026-07-07 · ultra-honesty audit P1-41/P2-70 ───────────────────────────
// The phone's TargetsView Add Race sheet offers exactly ["5K","10K","Half
// Marathon","Marathon","50K","50M","100K","100M","Other"]; every one of
// those labels — including the two "M"-suffixed ones with no unit-carrying
// numeric fallback — must resolve to its real mileage, never to null/13.1.
describe('distanceMiFromLabel — ultra distances (phone Add Race sheet)', () => {
  it('resolves all 4 phone ultra labels exactly', () => {
    expect(distanceMiFromLabel('50K')).toBe(31.07);
    expect(distanceMiFromLabel('50M')).toBe(50);
    expect(distanceMiFromLabel('100K')).toBe(62.14);
    expect(distanceMiFromLabel('100M')).toBe(100);
  });

  it('is case-insensitive on the ultra labels', () => {
    expect(distanceMiFromLabel('50k')).toBe(31.07);
    expect(distanceMiFromLabel('50m')).toBe(50);
    expect(distanceMiFromLabel('100k')).toBe(62.14);
    expect(distanceMiFromLabel('100m')).toBe(100);
  });

  it('substring-matches decorated ultra race names', () => {
    // "Javelina 100M" was the audit's canonical never-matched example.
    expect(distanceMiFromLabel('Javelina 100M')).toBe(100);
    expect(distanceMiFromLabel('Western States 100M')).toBe(100);
    expect(distanceMiFromLabel('Leadville 100')).toBeNull(); // bare "100" has no unit — honest null, not a guess
    expect(distanceMiFromLabel('JFK 50 Mile')).toBe(50);
    expect(distanceMiFromLabel('Lake Sonoma 50M')).toBe(50);
    expect(distanceMiFromLabel('Bandera 100K')).toBe(62.14);
  });

  it('never falls through to 13.1 or any non-ultra value for an ultra label', () => {
    for (const label of ['50K', '50M', '100K', '100M', 'Javelina 100M', 'Bandera 100K']) {
      const mi = distanceMiFromLabel(label);
      expect(mi).not.toBeNull();
      expect(mi).toBeGreaterThan(26.3); // strictly past marathon — the whole point
      expect(mi).not.toBe(13.1);
    }
  });

  it('50-mile and 50k are distinct — "50M" reads as miles per the phone convention, not 50 marathons', () => {
    expect(distanceMiFromLabel('50M')).not.toBe(distanceMiFromLabel('50K'));
    expect(distanceMiFromLabel('100M')).not.toBe(distanceMiFromLabel('100K'));
  });
});
