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

  it('VDOT 50 marathon center pace ≈ 7:17/mi', () => {
    const set = pacesFromVdot(50);
    // Doctrine: VDOT 50 marathonS = 11449s. 11449 / 26.219 ≈ 436.7 s/mi.
    const mCenter = (set!.M.lowS + set!.M.highS) / 2;
    expect(mCenter).toBeGreaterThan(434);
    expect(mCenter).toBeLessThan(440);
  });

  it('VDOT 50 T pace = HM pace (vdot < 50 uses 15K)', () => {
    // For vdot ≥ 50 T is anchored on HM pace.
    const set = pacesFromVdot(50);
    // halfS 5495 / 13.109 ≈ 419.2 s/mi (~6:59).
    const tCenter = (set!.T.lowS + set!.T.highS) / 2;
    expect(tCenter).toBeGreaterThan(416);
    expect(tCenter).toBeLessThan(423);
  });

  it('VDOT 45 T pace = 15K pace (slower runner)', () => {
    // For vdot < 50 T anchors on 15K pace.
    const set = pacesFromVdot(45);
    // 15K 4193 / 9.321 ≈ 449.8 s/mi (~7:30). HM/13.109 = 459.3 (~7:39).
    // So T should land closer to 450 than 460.
    const tCenter = (set!.T.lowS + set!.T.highS) / 2;
    expect(tCenter).toBeGreaterThan(446);
    expect(tCenter).toBeLessThan(454);
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
