/**
 * lib/evidence/_load_activity_evidence_identity_gate.test.ts · EXECID-DOORCLOSE-1.
 *
 * Falsifies (Rule 18) and then confirms the fix for the "date-only
 * supplemental-run identity side door" found in
 * docs/audit-2026-09-10-brain-adaptation-forensic-audit-v2-CORRECTED.md §7:
 * `classifyStoredActivity` and `classifyRecentActivities` used to decide a
 * run's `plannedWorkout` by joining `plan_workouts` on the run's calendar
 * date alone, never checking whether `lib/execution/day-resolver.ts` — the
 * ONE place David's ruling says gets to decide "which run satisfies which
 * prescription" — actually considers this run a match for that prescription.
 *
 * `pool` and `lib/execution/day-resolver` are mocked (same pattern
 * `lib/audit/_pace_drift_autopropose.test.ts` uses for the same reason: this
 * suite is about the GATE this file adds, not about day-resolver's own
 * matching rules, which `_day_resolver.test.ts` /
 * `_identity_truth_table.test.ts` already cover). `./activity-evidence`'s
 * `classifyActivityEvidence` is also mocked so each test can inspect exactly
 * what `ClassifyContext.plannedWorkout` this file handed it — the one field
 * the whole defect is about.
 *
 * WHAT THIS FILE CANNOT FAIL ON (Rule 22): whether `day-resolver.ts` itself
 * resolves EXACT/LEGACY/SUPPLEMENTAL correctly (that is its own gate's job);
 * whether the mocked SQL strings are the ones that actually run against
 * Postgres (no database here — `_activity_evidence.audit.test.ts` is the
 * `DATABASE_URL_RO` companion for that); the classifier's own judgement given
 * a `plannedWorkout` (`_classify_evidence.test.ts`'s job).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));

const mockResolveDayExecutions = vi.fn();
const mockResolveDateRangeExecutions = vi.fn();
vi.mock('@/lib/execution/day-resolver', () => ({
  resolveDayExecutions: (...args: unknown[]) => mockResolveDayExecutions(...args),
  resolveDateRangeExecutions: (...args: unknown[]) => mockResolveDateRangeExecutions(...args),
}));

const mockClassify = vi.fn((...args: unknown[]) => ({ mocked: true, args }) as any);
vi.mock('./activity-evidence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./activity-evidence')>();
  return { ...actual, classifyActivityEvidence: (...args: unknown[]) => mockClassify(...args) };
});

import { pool } from '@/lib/db/pool';
import { classifyStoredActivity, classifyRecentActivities } from './load-activity-evidence';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

const USER = 'abcdef12-3456-7890-abcd-ef1234567890';
const RUN_ID = '123456789';
const OTHER_RUN_ID = '999999999';
const DATE = '2026-09-05';
const PRESCRIPTION_ID = 'wko_quality_001';

function runRow(id: string, overrides: Record<string, unknown> = {}) {
  return { id, data: { date: DATE, distanceMi: 6.2, avgHr: 150, ...overrides } };
}

function planDayRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRESCRIPTION_ID, type: 'threshold', distance_mi: '6', duration_min: '40',
    is_quality: true, ...overrides,
  };
}

function resolvedDay(prescriptions: Array<{ id: string; matchedRunId: string | null }>) {
  return {
    dateISO: DATE,
    prescriptions: prescriptions.map((p) => ({
      id: p.id,
      type: 'threshold',
      distanceMi: 6,
      subLabel: null,
      isQuality: true,
      isLong: false,
      matchedRun: p.matchedRunId ? { runId: p.matchedRunId } as any : null,
    })),
    supplementalRuns: [],
  };
}

beforeEach(() => {
  mockedQuery.mockReset();
  mockResolveDayExecutions.mockReset();
  mockResolveDateRangeExecutions.mockReset();
  mockClassify.mockClear();
});

describe('classifyStoredActivity · EXECID-DOORCLOSE-1', () => {
  it('FALSIFIED: a date-only join would have handed the classifier a plannedWorkout for a supplemental run — the gate must refuse it', async () => {
    // Run row, then profile, then plan-day candidates (a real threshold
    // prescription exists that date), then rpe, then checkin.
    mockedQuery
      .mockResolvedValueOnce({ rows: [runRow(RUN_ID)] })          // runRes
      .mockResolvedValueOnce({ rows: [{ lthr: 168 }] })            // profRes
      .mockResolvedValueOnce({ rows: [planDayRow()] })             // planRowsRes
      .mockResolvedValueOnce({ rows: [] })                         // rpeRes
      .mockResolvedValueOnce({ rows: [] });                        // checkinRes
    // day-resolver says: the day's ONE prescription was satisfied by a
    // DIFFERENT run (OTHER_RUN_ID) — this run (RUN_ID) is supplemental.
    mockResolveDayExecutions.mockResolvedValueOnce(
      resolvedDay([{ id: PRESCRIPTION_ID, matchedRunId: OTHER_RUN_ID }]),
    );

    await classifyStoredActivity(USER, RUN_ID);

    expect(mockResolveDayExecutions).toHaveBeenCalledWith(USER, DATE);
    const ctx = mockClassify.mock.calls[0][1] as any;
    expect(ctx.plannedWorkout).toBeNull();
  });

  it('a run day-resolver confirms as the EXACT/LEGACY match DOES get the plan-day context', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [runRow(RUN_ID)] })
      .mockResolvedValueOnce({ rows: [{ lthr: 168 }] })
      .mockResolvedValueOnce({ rows: [planDayRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockResolveDayExecutions.mockResolvedValueOnce(
      resolvedDay([{ id: PRESCRIPTION_ID, matchedRunId: RUN_ID }]),
    );

    await classifyStoredActivity(USER, RUN_ID);

    const ctx = mockClassify.mock.calls[0][1] as any;
    expect(ctx.plannedWorkout).not.toBeNull();
    expect(ctx.plannedWorkout.intent).toBe('THRESHOLD');
    expect(ctx.plannedWorkout.plannedDistanceMi).toBe(6);
  });

  it('no prescription matched at all (day-resolver returns none claimed) also refuses the plan context', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [runRow(RUN_ID)] })
      .mockResolvedValueOnce({ rows: [{ lthr: 168 }] })
      .mockResolvedValueOnce({ rows: [planDayRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockResolveDayExecutions.mockResolvedValueOnce(
      resolvedDay([{ id: PRESCRIPTION_ID, matchedRunId: null }]),
    );

    await classifyStoredActivity(USER, RUN_ID);

    const ctx = mockClassify.mock.calls[0][1] as any;
    expect(ctx.plannedWorkout).toBeNull();
  });
});

describe('classifyRecentActivities · EXECID-DOORCLOSE-1', () => {
  it('FALSIFIED: a supplemental run in a window carrying a same-day quality prescription must not inherit that prescription\'s intent', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [runRow(RUN_ID)] })                       // runsRes
      .mockResolvedValueOnce({ rows: [{ lthr: 168 }] })                        // profRes
      .mockResolvedValueOnce({ rows: [{ ...planDayRow(), date_iso: DATE }] })  // planRes (ownedDaysSql)
      .mockResolvedValueOnce({ rows: [] })                                    // rpeRes
      .mockResolvedValueOnce({ rows: [] });                                   // checkinRes
    mockResolveDateRangeExecutions.mockResolvedValueOnce(
      new Map([[DATE, resolvedDay([{ id: PRESCRIPTION_ID, matchedRunId: OTHER_RUN_ID }])]]),
    );

    const out = await classifyRecentActivities(USER, DATE, DATE);

    expect(out).toHaveLength(1);
    const ctx = mockClassify.mock.calls[0][1] as any;
    expect(ctx.plannedWorkout).toBeNull();
  });

  it('a matched run in the window DOES get the plan-day context', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [runRow(RUN_ID)] })
      .mockResolvedValueOnce({ rows: [{ lthr: 168 }] })
      .mockResolvedValueOnce({ rows: [{ ...planDayRow(), date_iso: DATE }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockResolveDateRangeExecutions.mockResolvedValueOnce(
      new Map([[DATE, resolvedDay([{ id: PRESCRIPTION_ID, matchedRunId: RUN_ID }])]]),
    );

    await classifyRecentActivities(USER, DATE, DATE);

    const ctx = mockClassify.mock.calls[0][1] as any;
    expect(ctx.plannedWorkout).not.toBeNull();
    expect(ctx.plannedWorkout.intent).toBe('THRESHOLD');
  });
});
