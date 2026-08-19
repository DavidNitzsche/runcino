/**
 * lib/race/_distance_category.test.ts · ONE categorizer, one answer.
 *
 * Every case here was a real disagreement before 2026-08-18, when the app ran
 * three incompatible distance categorizers (lib/plan/goal-tiers.ts,
 * lib/race/distance-doctrine.ts, lib/plan/gap-report.ts). The point of the
 * file is not that the boundaries are 4.65 / 7.75 / 19.65 / 31.07 — the
 * doctrine gate checks that against Research/ — it is that every surface gives
 * the SAME answer for the same race, and that an unknown distance never
 * quietly becomes a half marathon.
 */
import { describe, it, expect } from 'vitest';
import {
  DISTANCE_CATEGORIES,
  DISTANCE_CATEGORY_MAX_MI,
  distanceCategoryOrNull,
  distanceCategoryOrThrow,
} from './distance-category';
import { raceDistanceCategory, raceWarmup, raceCarbLoad, raceOpeningPlan, raceAbortHrBpm, raceCarbsPerHourTarget, caffeineStopIndexes } from './distance-doctrine';
import { distanceCategoryOf, distanceCategoryOrNull as tiersCategoryOrNull } from '@/lib/plan/goal-tiers';
import { distanceMiFromLabel } from './distance';

describe('THE categorizer · the named doctrine distances', () => {
  const NAMED: Array<[string, string]> = [
    ['5K', '5k'],
    ['10K', '10k'],
    ['15K', 'hm'],   // Research/01 · T is anchored to 15K-to-half, one LT class
    ['10 mile', 'hm'],
    ['Half Marathon', 'hm'],
    ['Marathon', 'm'],
    ['50K', 'ultra'],
    ['100K', 'ultra'],
    ['100 mile', 'ultra'],
  ];
  for (const [label, cat] of NAMED) {
    it(`${label} is '${cat}'`, () => {
      const mi = distanceMiFromLabel(label);
      expect(mi, `${label} must resolve to miles`).not.toBeNull();
      expect(distanceCategoryOrNull(mi)).toBe(cat);
    });
  }
});

describe('THE categorizer · the boundary cases the three old ones disagreed on', () => {
  it('a 15-mile race is half-marathon-class on EVERY surface', () => {
    // Was 'hm' to the plan engine (2-week taper, HM tier bands, racePaceTag
    // 'HM') and 'm' to race doctrine (marathon warm-up, marathon carb load,
    // marathon HR ceiling). The training plan and the race-day execution plan
    // disagreed about what event the runner was doing.
    expect(distanceCategoryOrNull(15)).toBe('hm');
    expect(raceDistanceCategory(15)).toBe('hm');
    expect(distanceCategoryOf(15)).toBe('hm');
    expect(raceWarmup(15)).toBe(raceWarmup(13.1));
    expect(raceCarbLoad(15)).toBe(raceCarbLoad(13.1));
  });

  it('a 16-mile race is still half-marathon-class, a 20-miler is marathon-class', () => {
    expect(distanceCategoryOrNull(16)).toBe('hm');
    expect(distanceCategoryOrNull(19.6)).toBe('hm');
    expect(distanceCategoryOrNull(19.7)).toBe('m');
    expect(distanceCategoryOrNull(20)).toBe('m');
  });

  it('a 4.2-mile race is 5K-class on EVERY surface', () => {
    // Was '10k' to the plan engine (≤4 → 5k) and '5k' to race doctrine (≤4.4).
    expect(distanceCategoryOrNull(4.2)).toBe('5k');
    expect(raceDistanceCategory(4.2)).toBe('5k');
    expect(distanceCategoryOf(4.2)).toBe('5k');
  });

  it('a 30.5-mile race is marathon-class, and 50K is the ultra floor', () => {
    // Both old categorizers cut the ultra at a flat 30 miles, a number that
    // appears nowhere in Research/. Doctrine writes the row "Ultra (50K+)".
    expect(distanceCategoryOrNull(30.5)).toBe('m');
    expect(raceDistanceCategory(30.5)).toBe('m');
    expect(distanceCategoryOrNull(31.06)).toBe('m');
    expect(distanceCategoryOrNull(31.07)).toBe('ultra');
    expect(distanceCategoryOrNull(distanceMiFromLabel('50K'))).toBe('ultra');
  });

  it('an 8K is 10K-class and a 15K is half-class · the threshold line sits between them', () => {
    expect(distanceCategoryOrNull(distanceMiFromLabel('8k'))).toBe('10k');   // 4.97 mi
    expect(distanceCategoryOrNull(7.74)).toBe('10k');
    expect(distanceCategoryOrNull(7.76)).toBe('hm');
  });
});

describe('THE categorizer · an unknown distance is never a half marathon', () => {
  for (const bad of [null, undefined, 0, -1, NaN, Infinity]) {
    it(`${String(bad)} has no category`, () => {
      expect(distanceCategoryOrNull(bad as number | null | undefined)).toBeNull();
      expect(raceDistanceCategory(bad as number | null | undefined)).toBeNull();
    });
  }

  it('null does NOT resolve to the half marathon · the shipped defect', () => {
    // raceDistanceCategory(null) used to return 'hm', handing a
    // distance-unknown race the half's HR ceiling, warm-up, carb load and
    // caffeine schedule.
    expect(raceDistanceCategory(null)).not.toBe('hm');
    expect(raceWarmup(null)).toBeNull();
    expect(raceCarbLoad(null)).toBeNull();
    expect(raceOpeningPlan({ goalSec: 5400, distanceMi: null })).toBeNull();
    expect(raceAbortHrBpm({ distanceMi: null as unknown as number, lthr: 170 })).toBeNull();
    expect(raceCarbsPerHourTarget(null, 5400)).toBeNull();
    expect(caffeineStopIndexes({ distanceMi: null, stopsMi: [3, 6, 9], stopsMin: [30, 60, 90] }).size).toBe(0);
  });

  it('zero does NOT resolve to a 5K · the plan-drift defect', () => {
    // `Number(meta->>'distanceMi')` on a legacy row with no numeric distance
    // is 0, and the old categorizer answered '5k' — a marathoner got a 10-week
    // build window instead of 18 and lost eight weeks of build with no signal.
    expect(distanceCategoryOrNull(0)).toBeNull();
    expect(distanceCategoryOrNull(Number(null))).toBeNull();
    expect(() => distanceCategoryOf(0)).toThrow(/unrecognized/i);
    expect(() => distanceCategoryOrThrow(0)).toThrow(/unrecognized/i);
  });
});

describe('THE categorizer · one implementation, three names', () => {
  it('goal-tiers, race doctrine and the canonical module never disagree', () => {
    for (let mi = 0.5; mi <= 120; mi += 0.1) {
      const canonical = distanceCategoryOrNull(mi);
      expect(raceDistanceCategory(mi), `race doctrine disagrees at ${mi} mi`).toBe(canonical);
      expect(tiersCategoryOrNull(mi), `goal-tiers disagrees at ${mi} mi`).toBe(canonical);
      expect(distanceCategoryOf(mi), `the deprecated wrapper disagrees at ${mi} mi`).toBe(canonical);
    }
  });

  it('every category is reachable and the bounds ascend', () => {
    let previous = 0;
    for (const cat of DISTANCE_CATEGORIES) {
      const bound = DISTANCE_CATEGORY_MAX_MI[cat];
      expect(bound, `${cat} bound must be above ${previous}`).toBeGreaterThan(previous);
      // A distance just under the bound belongs to this category.
      expect(distanceCategoryOrNull(bound === Infinity ? 200 : bound - 0.01)).toBe(cat);
      previous = bound;
    }
    expect(DISTANCE_CATEGORY_MAX_MI.ultra).toBe(Infinity);
  });
});
