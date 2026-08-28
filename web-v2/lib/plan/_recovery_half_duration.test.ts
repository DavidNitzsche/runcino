/**
 * RECOVERY-HALF-DURATION-1 (2026-08-28) · the half sizes its recovery weeks
 * off Research/00b's own MINUTES, not `peakAnchor * pct`.
 *
 * Found in a coach-eye review of the owner's real post-half recovery plan
 * (`pln_0e635603799fd7b1`, week 2, 2026-08-24..30): 45 miles (four 7-mile
 * easy days + a 13-mile long), off a real recent base of 30-40 mi/wk. Root
 * cause: `RECOVERY_WEEKLY_PCT_OF_BASE.hm` (0.60/0.80) was reverse-engineered
 * by summing the half's 14-day protocol's minutes and dividing by an assumed
 * BASE, but DOCTRINE-4 (2026-08-17) made every category's weekly volume
 * `peakAnchor * pct` — a REAL peak week, correct for the marathon table
 * (headed "Volume vs. peak") and wrong for the half, whose fractions were
 * never calibrated against peak. A runner whose pre-race build peak sat
 * meaningfully above their typical base had every half-recovery week
 * inflated by that peak/base ratio.
 *
 * This fixture reproduces the owner's numbers (recent base ~35 mi/wk, a
 * build peak of ~56 mi that a taper preceded, easy pace ~9:20/mi) and pins
 * week 2 to the doctrine-implied band instead of ~45 mi.
 *
 * Research/00b §"Half Marathon Recovery (14-day)", days 8-13 (running days
 * only, matching RECOVERY.half-protocol-run-days's own day filter):
 *   day 8  30-40 min easy or rest
 *   day 9  45 min easy + strides
 *   day 10 40 min easy or short fartlek
 *   day 11 30-40 min easy
 *   day 12 50-70 min easy long run
 *   day 13 30 min easy or rest
 *   sum: 225-265 min → at 9:20/mi (560 s/mi, the slow end of the easy band
 *   this composer converts at) → 24.1-28.4 mi. Midpoint ≈ 26 mi.
 *
 * Week 1 (days 3, 4, 6, 7): 135-180 min → 14.5-19.3 mi. Midpoint ≈ 17 mi.
 */
import { describe, it, expect } from 'vitest';
import { composeRecoveryPlan, type ComposeNonRaceInput, type DOW } from './generate';

function ownerLikeInput(): ComposeNonRaceInput {
  return {
    startMondayISO: '2026-08-24', // the real block's week-2 Monday
    level: 'advanced',
    recentWeeklyMi: 35, // "true" recent base, per the coach-eye review
    recentLongMi: 13,
    recentPeakWeeklyMi: 56, // pre-race build peak · a taper sat between it and the race
    easyDayMedianMi: 6,
    longRunDow: 0 as DOW,
    restDow: 4 as DOW,
    qualityDows: [],
    availableDows: null,
    trainingDaysPerWeek: null,
    crossModes: [],
    tier: 'advanced' as ComposeNonRaceInput['tier'],
    nextRace: null,
    // race finished 8 days before the block's Monday → the SECOND recovery week
    lastRaceFinished: { slug: 'owner-half', name: 'Owner HM', date: '2026-08-16', distanceMi: 13.1, priority: 'A' },
    rxQuality: {} as ComposeNonRaceInput['rxQuality'],
    // 440 s/mi threshold → easy band slow end = 440 + 120 = 560 s/mi = 9:20/mi
    tPaceSec: 440,
    lthr: null,
  };
}

describe('RECOVERY-HALF-DURATION-1 · half recovery sizes off protocol minutes, not peakAnchor', () => {
  it("owner's week 2 lands near the doctrine-implied band (~24-28mi), not 45mi", () => {
    const res = composeRecoveryPlan(ownerLikeInput());
    expect(res.weeks.length).toBe(1); // 8 days post-race, 2-week block → 1 week remains
    const wk2 = res.weeks[0];
    expect(wk2.blockWeekIdx).toBe(1);
    // The regression band this bug shipped: week 2 must be far below 45mi and
    // inside the duration-implied range (some slack for the composer's
    // day-placement rounding).
    expect(wk2.weeklyMi).toBeGreaterThanOrEqual(20);
    expect(wk2.weeklyMi).toBeLessThanOrEqual(30);
    expect(wk2.weeklyMi).toBeLessThan(40); // nowhere near the shipped 45mi
  });

  it('week 1 (full 2-week block, authored day 1) lands near ~14.5-19.3mi, not a peak-scaled number', () => {
    const input = ownerLikeInput();
    input.startMondayISO = '2026-08-17'; // authored the day after the race
    const res = composeRecoveryPlan(input);
    expect(res.weeks.length).toBe(2);
    const wk1 = res.weeks[0];
    expect(wk1.blockWeekIdx).toBe(0);
    expect(wk1.weeklyMi).toBeGreaterThanOrEqual(12);
    expect(wk1.weeklyMi).toBeLessThanOrEqual(22);
  });

  it('the fix is specific to the half · marathon recovery still reads peakAnchor * pct unchanged', () => {
    const input = ownerLikeInput();
    input.lastRaceFinished = { slug: 'owner-m', name: 'Owner M', date: '2026-08-16', distanceMi: 26.2, priority: 'A' };
    const res = composeRecoveryPlan(input);
    // Marathon week 2 (index 1, 30-40% of peakAnchor=56) should still land
    // near peakAnchor * 0.35 ≈ 20mi — the OLD peak-based arithmetic, because
    // the marathon table genuinely is "Volume vs. peak" and is untouched.
    const wk2 = res.weeks.find((w) => w.blockWeekIdx === 1);
    expect(wk2).toBeTruthy();
    if (wk2) {
      expect(wk2.weeklyMi).toBeGreaterThanOrEqual(Math.round(56 * 0.30) - 2);
      expect(wk2.weeklyMi).toBeLessThanOrEqual(Math.round(56 * 0.40) + 2);
    }
  });
});
