/**
 * The row's own mile splits arbitrate the clock the VDOT path spends.
 *
 * `runFinishSecSql` prefers `movingTimeS`; `survivingMovingSecSql` refuses it
 * only above `MAX_PAUSED_SHARE = 0.5`. A moving time wrong by 10% passes both,
 * and 10% of pace is ~5 VDOT — which is the whole prescription.
 *
 * ── WHAT THIS SUITE CANNOT FAIL ON (Rule 22) ──────────────────────────────
 *
 * It exercises the arbiter, not the ladder that feeds it. It cannot see a row
 * with no splits (the majority), a row whose splits are wrong in the same
 * direction as its clock, or any disagreement under the tolerance — those rows
 * pass through and are exactly as trusted as they were before. It asserts a
 * RATIO between two of a row's own numbers and makes no claim about whether
 * the resulting pace is humanly plausible.
 *
 * Balance: 4 cases that must REFUSE, 5 that must ADMIT. The failure mode being
 * guarded against is over-refusal as much as under-refusal — a suite that only
 * knows how to reject would quietly empty the evidence pool.
 */

import { describe, it, expect } from 'vitest';
import { clockDisprovedBySplits, splitImpliedSeconds } from './vdot-inputs';

/** Splits as the watch writes them · `paceSecPerMi` plus an optional part-mile. */
const splits = (paces: number[], lastMi?: number) =>
  paces.map((p, i) => ({
    mile: i + 1,
    paceSecPerMi: p,
    ...(lastMi != null && i === paces.length - 1 ? { distanceMi: lastMi } : {}),
  }));

/**
 * The owner's 2026-08-11 session · a 4×1km workout, 5.97 mi.
 * durationSec 2784 (7:46/mi) · movingTimeS 2479 (6:55/mi) · splits → 2727 s.
 * Read at 6:55 and typed `threshold` it derives VDOT 49.8, four points clear
 * of anything else in a 60-day pool. No single mile was faster than 7:05.
 */
const AUG_11 = splits([481, 425, 454, 462, 479, 443], 0.9627);
const AUG_11_MI = 5.97;

describe('the splits refuse a clock the row itself disproves', () => {
  it('the 2026-08-11 moving time · 10.0% under its own per-mile record', () => {
    expect(clockDisprovedBySplits(2479, AUG_11, AUG_11_MI)).toBe(true);
  });

  it('and the wall clock on the same row survives · 2.0% is inside tolerance', () => {
    // The point of the guard is that this row HAS a coherent clock. Refusing
    // both would be over-reach dressed as caution.
    expect(clockDisprovedBySplits(2784, AUG_11, AUG_11_MI)).toBe(false);
  });

  it('symmetric · a clock that is too SLOW is refused the same way', () => {
    // Not only the fast direction. An over-long clock understates fitness and
    // prescribes work that is too easy, which is this whole defect's shape.
    expect(clockDisprovedBySplits(3200, AUG_11, AUG_11_MI)).toBe(true);
  });

  it('a grossly wrong clock is refused · the 2026-08-23 absorber shape', () => {
    expect(clockDisprovedBySplits(2389, splits(Array(11).fill(481)), 11.01)).toBe(true);
  });
});

describe('and admit every row they cannot disprove', () => {
  it('an honest row where both agree', () => {
    expect(clockDisprovedBySplits(5400, splits(Array(12).fill(450)), 12)).toBe(false);
  });

  it('a row with no splits at all · "cannot answer" is not "wrong" (Rule 11)', () => {
    expect(clockDisprovedBySplits(2479, [], AUG_11_MI)).toBe(false);
    expect(clockDisprovedBySplits(2479, null, AUG_11_MI)).toBe(false);
    expect(clockDisprovedBySplits(2479, undefined, AUG_11_MI)).toBe(false);
  });

  it('PARTIAL splits cannot arbitrate · under the coverage floor, no verdict', () => {
    // The owner's 2026-08-28 row: 6.00 mi of splits on a 6.32 mi run reads as
    // a 5.5% disagreement that is really just missing miles. Refusing on that
    // would delete a sound candidate.
    expect(splitImpliedSeconds(splits([505, 505, 505]), 12)).toBeNull();
    expect(clockDisprovedBySplits(5400, splits([505, 505, 505]), 12)).toBe(false);
  });

  it('a real stop at a light · inside tolerance, untouched', () => {
    // 2% is the worst honest disagreement measured across the owner's rows.
    expect(clockDisprovedBySplits(5292, splits(Array(12).fill(450)), 12)).toBe(false);
  });

  it('splits that OVERSHOOT the run cannot arbitrate it either', () => {
    // The owner's 2026-05-24 row: 12.0 miles of splits on a 1.00 mile run. A
    // corrupt arbiter is worse than none — it refuses sound rows with the same
    // confidence it refuses broken ones.
    expect(splitImpliedSeconds(splits(Array(12).fill(480)), 1)).toBeNull();
    expect(clockDisprovedBySplits(528, splits(Array(12).fill(480)), 1)).toBe(false);
  });

  it('unparseable splits are ignored rather than scored as zero', () => {
    const junk = [{ mile: 1 }, { mile: 2, paceSecPerMi: 'x' }, null, 'nope'];
    expect(splitImpliedSeconds(junk, 6)).toBeNull();
    expect(clockDisprovedBySplits(2479, junk, 6)).toBe(false);
  });
});

describe('splitImpliedSeconds scales to the run, not to the splits', () => {
  it('a part-mile final split is weighted by its own distance', () => {
    // 5 whole miles at 480 plus half a mile at 600 · 2400 + 300 over 5.5 mi.
    const s = splits([480, 480, 480, 480, 480, 600], 0.5);
    expect(splitImpliedSeconds(s, 5.5)).toBeCloseTo(2700, 5);
  });

  it('splits covering the run scale to the stored distance', () => {
    // 10 miles of splits at 480 on a 10.2 mi run · 0.2 mi extrapolated.
    expect(splitImpliedSeconds(splits(Array(10).fill(480)), 10.2)).toBeCloseTo(4896, 5);
  });
});
