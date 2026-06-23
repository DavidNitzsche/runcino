/**
 * SP-6 + VAR-06pt2 regression guard (third deep audit, 2026-06-23).
 *
 * VAR-06pt2 · the 45+ weekly-mileage bucket no longer collapses to the 35-45 value (40).
 * SP-6     · the maintenance long is proportional (≤110% recent, ≤30% week, 4mi floor),
 *            not an absolute 8mi floor that gave a 15mpw / 5mi-recent runner a 160%-of-recent long.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { recentWeeklyMiFromBucket } from './sim-constants';

describe('SP-6 + VAR-06pt2', () => {
  it('VAR-06pt2 · 45+ bucket is distinct from 35-45', () => {
    expect(recentWeeklyMiFromBucket(35 as any)).toBe(40);
    expect(recentWeeklyMiFromBucket(45 as any)).toBe(50);
  });

  it('SP-6 · maintenance long is proportional to recent fitness, not floored at 8', () => {
    const r = buildSimPlan({
      goalMode: 'race', distance: 'marathon', startDateISO: '2026-07-06',
      raceDateISO: '2027-02-06', planWeeks: 0, goalTimeSec: null, lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
      experienceLevel: 'intermediate', weeklyFrequency: 4, weeklyMileageBucket: 15, longestRunBucket: '3-6',
      raceHistory: [], longRunDay: 'sun', availableDays: [],
    } as any);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mode).toBe('maintenance');
    const longs = r.composed.weeks.flatMap((w: any) => w.days.filter((d: any) => d.isLong).map((d: any) => d.distanceMi));
    // recent long 5 → must be ≤ ~110% of recent (≤6), never the old absolute 8, and ≥ the 4mi coherence floor.
    for (const l of longs) {
      expect(l).toBeLessThanOrEqual(6);
      expect(l).toBeGreaterThanOrEqual(4);
    }
  });
});
