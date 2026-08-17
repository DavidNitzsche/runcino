/**
 * TIER RULES · experience may shape TONE, never a safety number.
 *
 * The defect this locks out, found by the 2026-08-17 doctrine-conformance
 * audit: two of the tier-scaled fields were not tone at all, and both moved
 * in the permissive direction for the runners carrying the most load.
 *
 *   · `sleep7AvgFloor` DROPPED with experience — 6.8 h beginner, 6.2
 *     advanced, 6.0 advanced_plus. Research/00b §"Recovery Scaled to Weekly
 *     Mileage" scales the sleep requirement UP with load: 20-40 mpw wants
 *     7.5-9 h, 40-60 wants 8-9, 60-80 wants 8.5-9.5, 80+ wants 9-10.
 *
 *   · `acwrCaution` / `acwrSpike` ROSE with experience — 1.7 and 1.9 for
 *     advanced_plus. Research/15 §"Acute:Chronic Workload Ratio" is ONE
 *     four-row table with no tier dimension. The justification offered was
 *     Gabbett's "workload tolerance scales with chronic exposure", which is a
 *     statement about what the ratio's DENOMINATOR already encodes.
 *
 * The registry (ELEVATION/TIER.* in lib/doctrine/registry.ts) reads the four
 * mileage rows and the ACWR table out of the docs at run time. This file
 * asserts the shape: same numbers for every tier, rising with mileage, and
 * tone still free to vary.
 */
import { describe, it, expect } from 'vitest';
import {
  ACWR_BANDS,
  SLEEP_TARGET_BY_MPW,
  SLEEP_FLOOR_TOLERANCE_H,
  sleepFloorForMileage,
  sleepTargetForMileage,
  tierRulesFor,
  HARD_RULES,
  type ExperienceLevel,
} from './tier-rules';

const TIERS: NonNullable<ExperienceLevel>[] = ['beginner', 'intermediate', 'advanced', 'advanced_plus'];
const CITE_ACWR = 'Research/15 §"Acute:Chronic Workload Ratio" · one table, no tier column';
const CITE_SLEEP = 'Research/00b §"Recovery Scaled to Weekly Mileage" · the requirement rises with load';

describe('TIER-1 · ACWR thresholds are the same for every runner', () => {
  it("matches Gabbett's zones exactly", () => {
    expect(ACWR_BANDS.detraining, `${CITE_ACWR} · "< 0.8 | Detraining / undertrained"`).toBe(0.8);
    expect(ACWR_BANDS.caution, `${CITE_ACWR} · "1.3 – 1.5 | Caution"`).toBe(1.3);
    expect(ACWR_BANDS.danger, `${CITE_ACWR} · "> 1.5 | Danger zone"`).toBe(1.5);
  });

  it('no tier carries its own ACWR number', () => {
    const seen = new Set(TIERS.map((t) => {
      const r = tierRulesFor(t, 55);
      return `${r.acwrDetraining}/${r.acwrCaution}/${r.acwrSpike}`;
    }));
    expect(
      [...seen],
      `${CITE_ACWR} · advanced_plus used to sit at 0.6/1.7/1.9, which loosens the injury ` +
        'threshold for exactly the cohort with the most volume at stake',
    ).toEqual(['0.8/1.3/1.5']);
  });

  it('the hard cap stays where it was · it was never tier-scaled', () => {
    expect(HARD_RULES.acwrInjuryHardCap).toBe(2.0);
  });
});

describe('TIER-2 · the sleep floor scales with mileage, not with experience', () => {
  it('each row carries its own Research/00b target', () => {
    // Low end of each band · 20-40 → 7.5-9 h, 40-60 → 8-9,
    // 60-80 → 8.5-9.5, 80+ → 9-10.
    expect(sleepTargetForMileage(30), `${CITE_SLEEP} · 20-40 mpw`).toBe(7.5);
    expect(sleepTargetForMileage(50), `${CITE_SLEEP} · 40-60 mpw`).toBe(8.0);
    expect(sleepTargetForMileage(70), `${CITE_SLEEP} · 60-80 mpw`).toBe(8.5);
    expect(sleepTargetForMileage(95), `${CITE_SLEEP} · 80+ mpw`).toBe(9.0);
  });

  it('the floor RISES with mileage · the engine had it inverted', () => {
    const floors = [20, 45, 65, 90].map(sleepFloorForMileage);
    for (let i = 1; i < floors.length; i++) {
      expect(
        floors[i],
        `${CITE_SLEEP} · the engine used to hand the 80+ mpw runner a 6.0 h floor and the ` +
          'beginner 6.8 · that is backwards',
      ).toBeGreaterThan(floors[i - 1]);
    }
  });

  it('the floor is the doctrine target less one fixed engine tolerance', () => {
    for (const [mpw, target] of [[30, 7.5], [50, 8.0], [70, 8.5], [95, 9.0]] as const) {
      expect(sleepFloorForMileage(mpw), `${CITE_SLEEP} · ${mpw} mpw`)
        .toBeCloseTo(target - SLEEP_FLOOR_TOLERANCE_H, 5);
    }
    // The one number here that is engine, not research · carried forward from
    // the shipped 20-40 mpw row so the lightest runner is unchanged.
    expect(sleepFloorForMileage(30)).toBe(6.8);
  });

  it('every tier gets the same floor at the same mileage', () => {
    for (const mpw of [25, 55, 85]) {
      const floors = new Set(TIERS.map((t) => tierRulesFor(t, mpw).sleep7AvgFloor));
      expect([...floors], `${CITE_SLEEP} · tier may shape tone, never the number`).toHaveLength(1);
    }
  });

  it('unknown mileage falls to the table\'s entry row, not below it', () => {
    expect(tierRulesFor('advanced_plus').sleep7AvgFloor).toBe(sleepFloorForMileage(30));
    // Below the table's lightest row doctrine has no lighter guidance.
    expect(sleepFloorForMileage(5)).toBe(sleepFloorForMileage(30));
  });

  it('the four rows the engine carries are the four rows doctrine has', () => {
    expect(SLEEP_TARGET_BY_MPW).toHaveLength(4);
    expect(SLEEP_TARGET_BY_MPW.map((r) => r.throughMpw)).toEqual([40, 60, 80, Infinity]);
  });
});

describe('TIER-3 · tone is still allowed to vary', () => {
  it('the fields that describe how loudly the app speaks still differ', () => {
    const beginner = tierRulesFor('beginner', 30);
    const elite = tierRulesFor('advanced_plus', 30);
    expect(beginner.tone).not.toBe(elite.tone);
    expect(elite.streakDaysMin).toBeGreaterThan(beginner.streakDaysMin);
    expect(elite.pullbackConsecutiveDays).toBeGreaterThan(beginner.pullbackConsecutiveDays);
    expect(beginner.wristTempInformational).not.toBeNull();
    expect(elite.wristTempInformational).toBeNull();
  });
});
