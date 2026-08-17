/**
 * RECOVERY-3 · post-race recovery must match Research/00b-recovery-protocols.md.
 *
 * The defect this locks out, found live on David's first post-race rollover
 * (2026-08-17): his half-marathon recovery prescribed 15 miles across 14 days
 * against a 33 mi/wk base — 6 miles in week 1, 9 in week 2, with five straight
 * rest days — while a goal marathon sat 16 weeks out.
 *
 * The composer had read Research/00b:196-204's "total recovery days (no
 * quality)" column (half = 10-14) and applied it as the "days of zero or
 * very-light running" column (half = 3-5), then sized the weeks off the
 * MARATHON reverse taper (:256-263). Two weeks of no quality became two weeks
 * of no running.
 *
 * These assertions encode the research tables directly. If a future change
 * moves a number away from doctrine, this fails and names the citation.
 */
import { describe, it, expect } from 'vitest';
import {
  RECOVERY_WEEKLY_PCT_OF_BASE,
  RECOVERY_RUN_DAYS,
  RECOVERY_LONG_PCT,
  POST_RACE_RECOVERY_WEEKS,
} from './goal-tiers';

describe('RECOVERY-3 · doctrine conformance · Research/00b §Post-Race Recovery', () => {
  it('marathon keeps the reverse taper verbatim (:256-263)', () => {
    // wk1 10-20% of peak → wk2 30-40% → wk3 50-60% → wk4 70-80%.
    expect(RECOVERY_WEEKLY_PCT_OF_BASE.m).toEqual([0.15, 0.35, 0.55, 0.75]);
    expect(RECOVERY_WEEKLY_PCT_OF_BASE.ultra).toEqual([0.15, 0.35, 0.55, 0.75]);
    // Days 0-3 off, then a couple of short jogs · rebuilding frequency to 6.
    expect(RECOVERY_RUN_DAYS.m[0]).toBeLessThanOrEqual(2);
    expect(RECOVERY_RUN_DAYS.m[RECOVERY_RUN_DAYS.m.length - 1]).toBeGreaterThanOrEqual(5);
  });

  it('sub-marathon recovery is a cutback, never a shutdown (:196-204, :240-255)', () => {
    // "Days of zero/very-light running" is 3-5 for a half, 2-3 for a 10K,
    // 1-2 for a 5K. A week at marathon depth (<= 35% of base) would mean
    // near-total rest, which is the defect this file exists to prevent.
    for (const cat of ['5k', '10k', 'hm'] as const) {
      for (const pct of RECOVERY_WEEKLY_PCT_OF_BASE[cat]) {
        expect(pct).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  it('the half runs on four days in week one and six in week two (:240-255)', () => {
    // Protocol: day 3 jog, day 4 easy, day 6 easy + strides, day 7 medium-long
    // → 4 running days. Week 2 runs days 8, 9, 10, 11, 12 and 13 → 6.
    expect(RECOVERY_RUN_DAYS.hm).toEqual([4, 6]);
    // And volume climbs across the window · never flat, never inverted.
    const hm = RECOVERY_WEEKLY_PCT_OF_BASE.hm;
    expect(hm.length).toBe(POST_RACE_RECOVERY_WEEKS.hm);
    expect(hm[1]).toBeGreaterThan(hm[0]);
  });

  it('every profile ramps monotonically · a later recovery week is never lighter', () => {
    for (const cat of Object.keys(RECOVERY_WEEKLY_PCT_OF_BASE) as (keyof typeof RECOVERY_WEEKLY_PCT_OF_BASE)[]) {
      const seq = RECOVERY_WEEKLY_PCT_OF_BASE[cat];
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i]).toBeGreaterThan(seq[i - 1]);
      }
      const days = RECOVERY_RUN_DAYS[cat];
      for (let i = 1; i < days.length; i++) {
        expect(days[i]).toBeGreaterThanOrEqual(days[i - 1]);
      }
    }
  });

  it('profiles cover exactly the weeks the duration ladder prescribes', () => {
    for (const cat of ['10k', 'hm', 'm', 'ultra'] as const) {
      expect(RECOVERY_WEEKLY_PCT_OF_BASE[cat].length).toBeGreaterThanOrEqual(
        Math.min(POST_RACE_RECOVERY_WEEKS[cat], 4));
      expect(RECOVERY_RUN_DAYS[cat].length).toBe(RECOVERY_WEEKLY_PCT_OF_BASE[cat].length);
    }
  });

  it('the long run returns on schedule and stays easy (:200-201, :250)', () => {
    // Half: long reintroduced day 7-10 at 45-60 min, day 12 at 50-70 min ·
    // ~30% of those weeks. Marathon holds its long deliberately small.
    expect(RECOVERY_LONG_PCT.hm).toBeGreaterThanOrEqual(0.25);
    expect(RECOVERY_LONG_PCT.m).toBeLessThanOrEqual(0.25);
    for (const pct of Object.values(RECOVERY_LONG_PCT)) {
      expect(pct).toBeLessThan(0.5); // never a peak-sized long inside recovery
    }
  });

  it("David's case · a half at a 33 mi/wk base clears 15 miles a week, not 15 a fortnight", () => {
    const base = 33;
    const [wk1, wk2] = RECOVERY_WEEKLY_PCT_OF_BASE.hm.map((p) => Math.round(base * p));
    expect(wk1).toBeGreaterThanOrEqual(18);
    expect(wk2).toBeGreaterThanOrEqual(24);
    expect(wk1 + wk2).toBeGreaterThan(40); // the shipped defect produced 15
  });
});
