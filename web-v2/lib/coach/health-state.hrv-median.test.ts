/**
 * lib/coach/health-state.hrv-median.test.ts
 *
 * 2026-06-09 · regression-audit G3 falsifier.
 *
 * Production incident this locks down (2026-06-08): a single 29 ms
 * partial-night HRV read — later corrected to 46 ms on re-sync — entered
 * the 7-day MEAN, scored readiness 38 PULL-BACK, and fired pull-back
 * prescriptions. 29 ms is inside any sane physiological bounds, so the
 * ingest clamp (the other half of G3) cannot catch it; the MEDIAN must.
 *
 *   F1  one garbage sample in a 7-day window → hrvCurrent is the median
 *       (unmoved), not the mean (dragged)
 *   F2  clean window → median ≈ mean (no behavior change on good data)
 *   F3  even-length window → median averages the middle pair (no NaN)
 *
 * Mock style: query-text dispatch on sample_type (same vi.mock pool
 * pattern as simulator-db-errors.test.ts) — robust to the Promise.all
 * call order inside loadHealthState.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({
  pool: { query: vi.fn() },
}));

vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-06-09'),
  // health-state imports nothing else from runner-tz, but keep the module
  // shape permissive in case of indirect imports.
  runnerTimezone: vi.fn().mockResolvedValue('America/Los_Angeles'),
  // 2026-07-06 · volume.ts (reached via health-state's ACWR fold) resolves
  // the runner tz for identity clustering.
  runnerTimezoneOrPacific: vi.fn().mockResolvedValue('America/Los_Angeles'),
}));

import { pool } from '@/lib/db/pool';
import { loadHealthState } from './health-state';

/** Build pg-shaped daily rows for the hrv query (d: Date, v: value). */
function hrvRows(values: number[]): Array<{ d: Date; v: number }> {
  // Oldest first, ending 2026-06-09 — matches ORDER BY ASC in the loader.
  const end = Date.parse('2026-06-09T12:00:00Z');
  return values.map((v, i) => ({
    d: new Date(end - (values.length - 1 - i) * 86400000),
    v,
  }));
}

function dispatchQueries(hrv: number[]): void {
  (pool.query as ReturnType<typeof vi.fn>).mockImplementation(
    (sql: string) => {
      if (typeof sql === 'string' && sql.includes("sample_type = 'hrv'")) {
        return Promise.resolve({ rows: hrvRows(hrv) });
      }
      // Every other stream (sleep, rhr, weight, cadence, vo2, stages,
      // wrist temp, niggles…) returns empty — the loader's no-data
      // branches all tolerate it.
      return Promise.resolve({ rows: [] });
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadHealthState — HRV 7-day median (G3)', () => {
  it('F1 · the Jun 8 incident shape: one 29 ms artifact does not move the headline HRV', async () => {
    // Last 7 nights with the garbage read in the middle of an honest 53-57 band.
    dispatchQueries([55, 56, 54, 57, 55, 53, 29]);
    const s = await loadHealthState('test-user');
    // median([29,53,54,55,55,56,57]) = 55 · mean would be ≈ 51 (−7% vs baseline
    // band instead of neutral). The pillar reads hrv.current.
    expect(s.hrv.current).toBe(55);
  });

  it('F2 · clean window: median sits inside the band the mean would give', async () => {
    dispatchQueries([54, 55, 56, 55, 54, 56, 55]);
    const s = await loadHealthState('test-user');
    expect(s.hrv.current).toBe(55);
  });

  it('F3 · even-length window (6 nights): middle-pair average, integer-rounded', async () => {
    dispatchQueries([50, 52, 54, 56, 58, 60]);
    const s = await loadHealthState('test-user');
    // median of [50,52,54,56,58,60] = (54+56)/2 = 55
    expect(s.hrv.current).toBe(55);
  });
});
