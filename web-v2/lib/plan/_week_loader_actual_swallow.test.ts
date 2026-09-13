/**
 * lib/plan/_week_loader_actual_swallow.test.ts · WEEKLOADER-ACTUAL-1.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_week_loader_actual_swallow.test.ts
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY
 *
 * `loadPlanWeek`'s actual-mileage read (`canonicalMileageByDay` + the run-id
 * lookup beside it) used to be a bare `catch { actualByDate = new Map(); }`.
 * A transient failure on that specific query — not "nobody ran", the query
 * itself throwing — collapsed into the exact same empty map a genuinely
 * quiet week produces. Every day's `done_mi`/`completedRunId` read `null`,
 * indistinguishable from an honest rest week.
 *
 * That is the read `/api/v5/today`'s STEPPEDDAY-DONE-1 gate sits directly on
 * top of (`viewedDoneMi` / `ranToday`, and `weekStripDays[].isDone`): a
 * completed PAST day whose read failed would fall through `ranToday = false`
 * into the ordinary before-run panel, rendering `before_run` over a run that
 * actually happened — the exact original defect this investigation chain has
 * been fixing, reopened through a read-failure path instead of a
 * date-matching one.
 *
 * `loadSkippedDates` already had the correct shape for its own read
 * (`SkippedDatesRead.failed`, surfaced as `PlanWeekResult.skipStateUnknown`).
 * This locks the same shape onto the actual-mileage read
 * (`PlanWeekResult.actualStateUnknown`) and proves the difference at
 * `loadPlanWeek`'s own boundary — the layer both `/api/v5/today` and the
 * watch's `build-workout.ts` consume, so a fix at the read reaches every
 * caller with no per-surface repair needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));

vi.mock('@/lib/coach/settings', () => ({
  loadSettings: vi.fn().mockResolvedValue({ long_run_day: 'sun' }),
}));

vi.mock('@/lib/execution/day-resolution', () => ({
  resolveDateRangeDayStatus: vi.fn().mockResolvedValue(new Map()),
}));

// The function under test: `canonicalMileageByDay` throws or resolves per
// test, controlled via this mock directly (isolates "this read failed" from
// a general pool outage, same discipline as `_skip_and_projection.test.ts`'s
// `skipReadFails` flag).
vi.mock('@/lib/runs/merge', () => ({
  canonicalMileageByDay: vi.fn(),
}));

import { pool } from '@/lib/db/pool';
import { canonicalMileageByDay } from '@/lib/runs/merge';
import { loadPlanWeek } from './week-loader';

const UUID = '00000000-0000-0000-0000-0000000000ab';
const PLAN_ID = 'pln_test_actual';
const TODAY = '2026-09-13'; // Sunday
const WEEK_START = '2026-09-07';
const WEEK_END = '2026-09-13';
const RUN_DAY = '2026-09-11'; // a Friday inside the loaded week — a PAST day
const RUN_ID = 'run_completed_0911';

const PLAN_ROWS = [
  { id: 'w1', date_iso: '2026-09-07', dow: 1, type: 'easy', distance_mi: '5', sub_label: null, notes: null },
  { id: 'w2', date_iso: '2026-09-08', dow: 2, type: 'easy', distance_mi: '5', sub_label: null, notes: null },
  { id: 'w3', date_iso: '2026-09-09', dow: 3, type: 'easy', distance_mi: '5', sub_label: null, notes: null },
  { id: 'w4', date_iso: '2026-09-10', dow: 4, type: 'easy', distance_mi: '5', sub_label: null, notes: null },
  // The day this whole test is about: a THRESHOLD session that was actually run.
  { id: 'w5', date_iso: RUN_DAY, dow: 5, type: 'threshold', distance_mi: '7', sub_label: null, notes: null },
  { id: 'w6', date_iso: '2026-09-12', dow: 6, type: 'easy', distance_mi: '5', sub_label: null, notes: null },
  { id: 'w7', date_iso: TODAY, dow: 0, type: 'long', distance_mi: '14', sub_label: null, notes: null },
];

function installBasePool() {
  (pool.query as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (sql: string) => {
      const s = String(sql);
      if (s.includes('FROM training_plans')) {
        return { rows: [{ id: PLAN_ID, last_adapted_at: null }] };
      }
      if (s.includes('MIN(date_iso)')) {
        return { rows: [{ start_iso: PLAN_ROWS[0].date_iso, end_iso: PLAN_ROWS[PLAN_ROWS.length - 1].date_iso }] };
      }
      if (s.includes('FROM plan_workouts')) {
        return { rows: PLAN_ROWS };
      }
      if (s.includes('FROM day_actions')) {
        return { rows: [] }; // nobody skipped anything in this fixture
      }
      throw new Error(`_week_loader_actual_swallow: unhandled SQL: ${s}`);
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  installBasePool();
});

describe('WEEKLOADER-ACTUAL-1 · actualByDate read failure is a distinct fact from "nobody ran"', () => {
  it('a healthy read: the completed day carries its mileage, and the flag is absent', async () => {
    (canonicalMileageByDay as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([[RUN_DAY, { mi: 7.1, canonicalIds: [RUN_ID] }]]),
    );
    // The id-lookup query the loader issues against `runs` for the canonical ids.
    (pool.query as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('FROM runs')) {
        return { rows: [{ row_id: RUN_ID, strava_id: RUN_ID, mi: 7.1, day: RUN_DAY }] };
      }
      if (s.includes('FROM training_plans')) return { rows: [{ id: PLAN_ID, last_adapted_at: null }] };
      if (s.includes('MIN(date_iso)')) return { rows: [{ start_iso: PLAN_ROWS[0].date_iso, end_iso: PLAN_ROWS[PLAN_ROWS.length - 1].date_iso }] };
      if (s.includes('FROM plan_workouts')) return { rows: PLAN_ROWS };
      if (s.includes('FROM day_actions')) return { rows: [] };
      throw new Error(`unhandled SQL: ${s}`);
    });

    const result = await loadPlanWeek(UUID, TODAY);
    expect(result.actualStateUnknown).toBeUndefined();
    const runDay = result.days.find((d) => d.date_iso === RUN_DAY);
    expect(runDay?.done_mi).toBe(7.1);
    expect(runDay?.completedRunId).toBe(RUN_ID);
  });

  it('a genuinely quiet week: no mileage anywhere, and the flag is STILL absent', async () => {
    (canonicalMileageByDay as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());

    const result = await loadPlanWeek(UUID, TODAY);
    expect(result.actualStateUnknown).toBeUndefined();
    expect(result.days.every((d) => d.done_mi === null)).toBe(true);
  });

  it('THE FALSIFIER · a failed read on a COMPLETED day must not silently read as "no run" with no signal', async () => {
    // The specific query this file exists for: not empty, THROWN — a
    // transient DB error, e.g. a dropped connection mid-query.
    (canonicalMileageByDay as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('simulated transient DB error'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadPlanWeek(UUID, TODAY);

    // OLD CODE (bare `catch { actualByDate = new Map(); }`) reproduced here:
    // `done_mi`/`completedRunId` for the day that was ACTUALLY RUN still read
    // exactly like an unrun day — this is unavoidable without the fix
    // changing the wire shape of `done_mi` itself, which Rule 11 does not
    // require (the value stays best-effort, same as `skipped` does).
    const runDay = result.days.find((d) => d.date_iso === RUN_DAY);
    expect(runDay?.done_mi).toBeNull();
    expect(runDay?.completedRunId).toBeNull();

    // NEW CODE: the result says so. This is the assertion that fails against
    // the pre-fix `catch { actualByDate = new Map(); }` — that branch drops
    // the exception and returns a `PlanWeekResult` with no
    // `actualStateUnknown` key at all, identical to the quiet-week case
    // above. A caller (STEPPEDDAY-DONE-1's `ranToday` gate, chief among them)
    // now has a fact to check before treating `done_mi === null` as "he did
    // not run".
    expect(result.actualStateUnknown).toBe(true);

    // And it must not be silent (Rule 18 — a swallowed exception with no
    // trace is worse than one that throws).
    expect(warn.mock.calls.some((c) => String(c[0]).includes('[week-loader]'))).toBe(true);
    warn.mockRestore();
  });

  it('liveness · the fixture actually reaches the actual-mileage read', async () => {
    // Rule 18 guard 2: if this mock stopped being called, every assertion
    // above would pass vacuously (an always-empty map looks the same as a
    // "never called" mock).
    (canonicalMileageByDay as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Map());
    await loadPlanWeek(UUID, TODAY);
    expect(canonicalMileageByDay).toHaveBeenCalledWith(UUID, WEEK_START, WEEK_END);
  });
});
