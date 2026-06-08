/**
 * lib/plan/simulator-db-errors.test.ts
 *
 * Falsifier for Item 13 #1 (docs/OVERNIGHT-REPORT.md):
 *   A DB error on the projection_snapshots query must NOT produce a
 *   SimulatorResult anchored to the VDOT 45 default — it must return
 *   null so the caller refuses to render a wrong confidence band.
 *
 * Three cases:
 *   F1  projection_snapshots query throws   → returns null  (was: VDOT 45)
 *   F2  projection_snapshots returns 0 rows → returns null  (no signal)
 *   F3  projection_snapshots returns VDOT 55 → non-null result, projectedVdot > 50
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — must appear before the imports that trigger resolution.
vi.mock('@/lib/db/pool', () => ({
  pool: { query: vi.fn() },
}));

vi.mock('@/lib/coach/runner-calibration', () => ({
  loadRunnerCalibration: vi.fn().mockResolvedValue({
    vdotPerQuality: 0.1,
    longRunWeight: 0.3,
    recoveryMult: 1.0,
    plateauVdot: 75,
    easyToleranceMi: null,
    longToleranceMi: null,
    qualityToleranceMi: null,
    acwrSlope: null,
    rhrSensitivity: null,
    volumeCeilingMi: null,
    dataQuality: 'cold-start',
    sourceWorkoutCount: 0,
    sourceQualityCount: 0,
    citation: 'mock',
  }),
}));

vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-01-01'),
}));

import { simulateActivePlan } from './simulator';
import { pool } from '@/lib/db/pool';

const UUID = '00000000-0000-0000-0000-000000000001';

const WEEK_ROW = {
  week_idx: 0, start_iso: '2026-01-06', phase: 'BASE',
  weekly_mi: '40', quality_sessions: '2', long_run_mi: '14',
};

function baseRouteQuery(sql: string): Promise<{ rows: unknown[] }> {
  if (sql.includes('training_plans')) {
    return Promise.resolve({ rows: [{ id: 'plan-1', race_id: 'bq-2027' }] });
  }
  if (sql.includes('FROM races')) {
    return Promise.resolve({ rows: [{ meta: { distanceMi: 26.2 } }] });
  }
  if (sql.includes('plan_workouts')) {
    return Promise.resolve({ rows: [WEEK_ROW] });
  }
  return Promise.resolve({ rows: [] });
}

describe('simulateActivePlan — snapshot DB-error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('F1: DB error on projection_snapshots → null, not VDOT-45 result', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pool.query as any).mockImplementation((sql: string) => {
      if (sql.includes('projection_snapshots')) {
        return Promise.reject(new Error('column "vdot" does not exist'));
      }
      return baseRouteQuery(sql);
    });

    const result = await simulateActivePlan(UUID);
    expect(result).toBeNull();
  });

  it('F2: projection_snapshots returns 0 rows (no cron run yet) → null', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pool.query as any).mockImplementation((sql: string) => {
      if (sql.includes('projection_snapshots')) {
        return Promise.resolve({ rows: [] });
      }
      return baseRouteQuery(sql);
    });

    const result = await simulateActivePlan(UUID);
    expect(result).toBeNull();
  });

  it('F3: valid snapshot VDOT 55 → non-null result anchored to 55, not 45', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pool.query as any).mockImplementation((sql: string) => {
      if (sql.includes('projection_snapshots')) {
        return Promise.resolve({ rows: [{ vdot: 55 }] });
      }
      return baseRouteQuery(sql);
    });

    const result = await simulateActivePlan(UUID);
    expect(result).not.toBeNull();
    // Week-0 projectedVdot starts at 55 + small gain (~0.17) — must be well above 45
    expect(result!.weeklyTrajectory[0].projectedVdot).toBeGreaterThan(50);
  });
});
