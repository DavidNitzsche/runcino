import { describe, it, expect } from 'vitest';
import { resolveBGoal, B_SAFE_FRACTION } from './b-goal';

const MARATHON_3H = 3 * 3600;
const FIVEK_18 = 18 * 60;

describe('resolveBGoal', () => {
  it('a runner-entered B goal always wins', () => {
    const r = resolveBGoal({ effectiveTargetSec: MARATHON_3H, storedBGoalSec: 3 * 3600 + 720 });
    expect(r.source).toBe('stored');
    expect(r.sec).toBe(3 * 3600 + 720);
  });

  it('derives proportionally from the effective target', () => {
    const r = resolveBGoal({ effectiveTargetSec: MARATHON_3H });
    expect(r.source).toBe('derived');
    expect(r.sec).toBe(Math.round(MARATHON_3H * (1 + B_SAFE_FRACTION))); // 3:05:57
  });

  it('stays sane on a 5K, where the old flat +7:00 did not', () => {
    // The bug: TodayView's race-day hero added a flat 420s at every
    // distance. On an 18:00 5K that is a "safe" target of 25:00 — +39%.
    const r = resolveBGoal({ effectiveTargetSec: FIVEK_18 });
    expect(r.sec).toBe(1116); // 18:36
    const oldFlat = FIVEK_18 + 420;
    expect(oldFlat).toBe(1500); // 25:00 — what the runner used to be shown
    expect(r.sec!).toBeLessThan(oldFlat);
    // The offset must stay a small single-digit percentage at any distance.
    expect((r.sec! - FIVEK_18) / FIVEK_18).toBeLessThan(0.05);
  });

  it('keeps the same relative gap across every distance', () => {
    const distances = [FIVEK_18, 37 * 60, 80 * 60, MARATHON_3H, 5 * 3600];
    const fractions = distances.map((sec) => {
      const b = resolveBGoal({ effectiveTargetSec: sec }).sec!;
      return (b - sec) / sec;
    });
    for (const f of fractions) expect(f).toBeCloseTo(B_SAFE_FRACTION, 3);
  });

  it('derives from the effective target, not a demoted stated goal', () => {
    // Goal 3:00 demoted to a 3:22 projection by the effective-target
    // resolver. B derived off the goal (3:05:57) would be FASTER than the
    // A target the runner is actually paced to (3:22) — a safe target
    // that is not safe.
    const effective = 3 * 3600 + 22 * 60;
    const r = resolveBGoal({ effectiveTargetSec: effective });
    expect(r.sec!).toBeGreaterThan(effective);
    expect(r.sec!).toBeGreaterThan(MARATHON_3H + Math.round(MARATHON_3H * B_SAFE_FRACTION));
  });

  it('returns null rather than fabricating a number', () => {
    expect(resolveBGoal({ effectiveTargetSec: null }).sec).toBeNull();
    expect(resolveBGoal({ effectiveTargetSec: 0 }).source).toBe('none');
    expect(resolveBGoal({ effectiveTargetSec: undefined }).sec).toBeNull();
    expect(resolveBGoal({ effectiveTargetSec: Number.NaN }).sec).toBeNull();
  });

  it('ignores a non-positive or malformed stored value and derives instead', () => {
    expect(resolveBGoal({ effectiveTargetSec: MARATHON_3H, storedBGoalSec: 0 }).source).toBe('derived');
    expect(resolveBGoal({ effectiveTargetSec: MARATHON_3H, storedBGoalSec: -5 }).source).toBe('derived');
    expect(resolveBGoal({ effectiveTargetSec: MARATHON_3H, storedBGoalSec: Number.NaN }).source).toBe('derived');
  });

  it('a B goal is always slower than the target it protects', () => {
    for (const sec of [FIVEK_18, 37 * 60, MARATHON_3H]) {
      expect(resolveBGoal({ effectiveTargetSec: sec }).sec!).toBeGreaterThan(sec);
    }
  });
});
