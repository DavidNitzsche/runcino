import { describe, expect, it } from 'vitest';
import { vdotFromRace, vdotRow, pacesFromVdot } from '../vdot';

describe('vdotFromRace', () => {
  it('returns null for non-canonical distances', () => {
    // 7.5 miles isn't within 5% of any canonical distance (15K=9.32, 10K=6.21).
    expect(vdotFromRace(7.5, 50 * 60)).toBeNull();
  });

  it('infers VDOT ~51 from a 1:30 half marathon', () => {
    // Doctrine table: VDOT 50 → HM 5495s (~1:31:35), VDOT 52 → 5311s
    // (~1:28:31). 1:30:00 (5400s) interpolates to ~51.0.
    const vdot = vdotFromRace(13.109, 90 * 60);
    expect(vdot).not.toBeNull();
    expect(vdot!).toBeGreaterThan(50);
    expect(vdot!).toBeLessThan(52);
  });

  it('infers VDOT ~58 from a 1:20 half marathon', () => {
    // Doctrine table: VDOT 58 → HM 4830s (~1:20:30).
    const vdot = vdotFromRace(13.109, 80 * 60);
    expect(vdot).not.toBeNull();
    expect(vdot!).toBeGreaterThan(57);
    expect(vdot!).toBeLessThan(59);
  });

  it('infers VDOT 50 from a 19:57 5K', () => {
    // Doctrine table: VDOT 50 → 5K 1197s (~19:57).
    const vdot = vdotFromRace(3.107, 1197);
    expect(vdot).not.toBeNull();
    expect(vdot!).toBeGreaterThan(49);
    expect(vdot!).toBeLessThan(51);
  });
});

describe('pacesFromVdot', () => {
  it('produces ordered E > M > T > I > R bands at VDOT 50', () => {
    const set = pacesFromVdot(50);
    expect(set).not.toBeNull();
    // Higher s/mi = slower. E should be the slowest, R the fastest.
    expect(set!.E.lowS).toBeGreaterThan(set!.M.lowS);
    expect(set!.M.lowS).toBeGreaterThan(set!.T.lowS);
    expect(set!.T.lowS).toBeGreaterThan(set!.I.lowS);
    expect(set!.I.lowS).toBeGreaterThan(set!.R.lowS);
  });

  it('VDOT 50 M pace ≈ 5:58/mi (Daniels canonical training pace)', () => {
    // Daniels training paces table for VDOT 50: M = 358 sec/mi.
    // PRE-FIX bug: derived from marathonS/26.219 = 436 sec/mi (7:16/mi),
    // about 78 sec/mi slower than Daniels canonical. Fixed by reading
    // from TRAINING_PACES_TABLE directly.
    const set = pacesFromVdot(50);
    const mCenter = (set!.M.lowS + set!.M.highS) / 2;
    expect(mCenter).toBeGreaterThanOrEqual(356);
    expect(mCenter).toBeLessThanOrEqual(360);
  });

  it('VDOT 50 T pace = 5:33/mi (Daniels canonical, not HM race pace)', () => {
    // Daniels training paces table for VDOT 50: T = 333 sec/mi.
    // PRE-FIX bug: derived from halfS/13.109 = 419 sec/mi, about
    // 86 sec/mi slower than Daniels canonical T pace. T training pace
    // is NOT the same as HM race pace; it's a separate physiological
    // intensity (60-min sustainable effort).
    const set = pacesFromVdot(50);
    const tCenter = (set!.T.lowS + set!.T.highS) / 2;
    expect(tCenter).toBeGreaterThanOrEqual(331);
    expect(tCenter).toBeLessThanOrEqual(335);
  });

  it('VDOT 45 T pace = 6:09/mi (Daniels canonical, not 15K race pace)', () => {
    // Daniels training paces table for VDOT 45: T = 369 sec/mi.
    // PRE-FIX bug: derived from km15S/9.321 = 449 sec/mi (~80 sec/mi
    // too slow). The pre-fix formula used 15K race pace as a proxy
    // for T pace, which over-estimates by the typical 15K-to-T gap
    // (15K is run faster than T because 15K is shorter than the T
    // 60-min anchor duration).
    const set = pacesFromVdot(45);
    const tCenter = (set!.T.lowS + set!.T.highS) / 2;
    expect(tCenter).toBeGreaterThanOrEqual(367);
    expect(tCenter).toBeLessThanOrEqual(371);
  });

  it('VDOT 46 produces Daniels canonical training paces', () => {
    // The exact case the user reported. VDOT 46 (close to user's
    // aggregate VDOT 45.9). Daniels canonical training paces:
    //   E: 8:25–9:05/mi (505-545 sec — actually 449-497 per Daniels)
    //   M: 6:28/mi (388 sec)
    //   T: 6:01/mi (361 sec)
    //   I: 5:31/mi (331 sec)
    //   R: 5:13/mi (313 sec)
    const set = pacesFromVdot(46);
    expect(set).not.toBeNull();
    // M: ±5 sec/mi band centered on 388 (low=386, high=391 after rounding)
    expect(set!.M.lowS).toBeGreaterThanOrEqual(385);
    expect(set!.M.lowS).toBeLessThanOrEqual(386);
    expect(set!.M.highS).toBeGreaterThanOrEqual(390);
    expect(set!.M.highS).toBeLessThanOrEqual(391);
    // T: ±3 sec/mi centered on 361 (low=359, high=362)
    expect(set!.T.lowS).toBeGreaterThanOrEqual(359);
    expect(set!.T.highS).toBeLessThanOrEqual(363);
    // I: ±3 sec/mi centered on 331
    expect(set!.I.lowS).toBeGreaterThanOrEqual(329);
    expect(set!.I.highS).toBeLessThanOrEqual(333);
    // E: window from 449 to 497 (Daniels publishes E as a range)
    expect(set!.E.lowS).toBe(449);
    expect(set!.E.highS).toBe(497);
  });
});

describe('vdotRow interpolation', () => {
  it('clamps below table minimum', () => {
    const row = vdotRow(20);
    expect(row).not.toBeNull();
  });
  it('clamps above table maximum', () => {
    const row = vdotRow(99);
    expect(row).not.toBeNull();
  });
  it('interpolates between tiers', () => {
    const a = vdotRow(50);
    const b = vdotRow(51);
    const mid = vdotRow(50.5);
    // marathon time at 50.5 should sit between 50 and 51.
    expect(mid!.marathonS).toBeLessThan(a!.marathonS);
    expect(mid!.marathonS).toBeGreaterThan(b!.marathonS);
  });
});
