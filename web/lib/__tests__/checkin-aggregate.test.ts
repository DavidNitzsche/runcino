/**
 * checkin-aggregate · 7-day daily_checkin rollup.
 *
 * Covers the contract documented in lib/checkin-aggregate.ts:
 *   - 0 rows → null-shaped aggregate so state.checkin becomes null
 *   - 7 rows of clean data → populated aggregate with computed averages
 *   - 3 "poor" rows → poorDaysCount = 3 (the Decision-Matrix threshold)
 *   - latestDateISO + loggedToday derive from the newest row vs today
 */

import { describe, expect, it } from 'vitest';
import { aggregateCheckins, isPoorRow, type CheckinRow } from '../checkin-aggregate';

const TODAY = '2026-05-12';

function row(date: string, energy: number, soreness: number, stress: number): CheckinRow {
  return { date, energy, soreness, stress };
}

describe('aggregateCheckins · 0 rows', () => {
  it('returns empty aggregate (rowsCount=0, averages null, poor=0)', () => {
    const agg = aggregateCheckins([], TODAY);
    expect(agg.rowsCount, 'no rows means rowsCount=0').toBe(0);
    expect(agg.avgEnergy, '0 rows → no avg energy').toBeNull();
    expect(agg.avgSoreness, '0 rows → no avg soreness').toBeNull();
    expect(agg.avgStress, '0 rows → no avg stress').toBeNull();
    expect(agg.poorDaysCount, '0 rows → 0 poor days').toBe(0);
    expect(agg.latestDateISO, '0 rows → no latest').toBeNull();
    expect(agg.loggedToday, '0 rows → loggedToday false').toBe(false);
  });
});

describe('aggregateCheckins · 7 rows clean', () => {
  it('averages each axis and reports rowsCount=7 with zero poor days', () => {
    const rows: CheckinRow[] = [
      row('2026-05-06', 8, 2, 2),
      row('2026-05-07', 7, 3, 3),
      row('2026-05-08', 8, 2, 2),
      row('2026-05-09', 7, 3, 2),
      row('2026-05-10', 8, 2, 3),
      row('2026-05-11', 7, 3, 2),
      row('2026-05-12', 8, 2, 2),
    ];
    const agg = aggregateCheckins(rows, TODAY);
    expect(agg.rowsCount).toBe(7);
    // (8+7+8+7+8+7+8)/7 = 53/7 ≈ 7.6
    expect(agg.avgEnergy, '7-row avg energy ≈ 7.6').toBeCloseTo(7.6, 1);
    // Soreness avg: (2+3+2+3+2+3+2)/7 = 17/7 ≈ 2.4
    expect(agg.avgSoreness, '7-row avg soreness ≈ 2.4').toBeCloseTo(2.4, 1);
    expect(agg.poorDaysCount, 'all 7 days clean → 0 poor').toBe(0);
    expect(agg.latestDateISO).toBe('2026-05-12');
    expect(agg.loggedToday, 'latest is today').toBe(true);
  });
});

describe('aggregateCheckins · poor days', () => {
  it('counts low energy (≤4) as a poor day', () => {
    const rows: CheckinRow[] = [
      row('2026-05-10', 4, 2, 2), // low energy
      row('2026-05-11', 7, 3, 3),
      row('2026-05-12', 8, 2, 2),
    ];
    const agg = aggregateCheckins(rows, TODAY);
    expect(agg.poorDaysCount, 'energy ≤4 is poor').toBe(1);
  });

  it('counts high soreness (≥7) as a poor day', () => {
    const rows: CheckinRow[] = [
      row('2026-05-10', 7, 8, 2), // high soreness
      row('2026-05-11', 7, 3, 3),
      row('2026-05-12', 8, 2, 2),
    ];
    const agg = aggregateCheckins(rows, TODAY);
    expect(agg.poorDaysCount, 'soreness ≥7 is poor').toBe(1);
  });

  it('counts high stress (≥7) as a poor day', () => {
    const rows: CheckinRow[] = [
      row('2026-05-10', 7, 3, 8), // high stress
      row('2026-05-11', 7, 3, 3),
      row('2026-05-12', 8, 2, 2),
    ];
    const agg = aggregateCheckins(rows, TODAY);
    expect(agg.poorDaysCount, 'stress ≥7 is poor').toBe(1);
  });

  it('crosses the 3+ doctrine threshold cleanly', () => {
    const rows: CheckinRow[] = [
      row('2026-05-08', 3, 8, 3),
      row('2026-05-09', 4, 8, 9),
      row('2026-05-10', 4, 8, 2),
      row('2026-05-11', 7, 3, 3),
      row('2026-05-12', 8, 2, 2),
    ];
    const agg = aggregateCheckins(rows, TODAY);
    expect(agg.poorDaysCount, '3 of 5 rows poor → 3').toBe(3);
  });
});

describe('isPoorRow · individual thresholds', () => {
  it('returns true when energy <=4', () => {
    expect(isPoorRow(row('d', 4, 1, 1))).toBe(true);
  });
  it('returns false on the boundary energy=5', () => {
    expect(isPoorRow(row('d', 5, 1, 1))).toBe(false);
  });
  it('returns false on a clean day', () => {
    expect(isPoorRow(row('d', 8, 2, 2))).toBe(false);
  });
});

describe('aggregateCheckins · latest vs today', () => {
  it('loggedToday=false when latest is older than today', () => {
    const agg = aggregateCheckins([row('2026-05-09', 7, 3, 3)], TODAY);
    expect(agg.latestDateISO).toBe('2026-05-09');
    expect(agg.loggedToday).toBe(false);
  });
});
