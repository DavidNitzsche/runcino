/**
 * lib/plan/_week_primary_run.test.ts · 2026-08-23
 *
 * The week strip's `completedRunId` is the tap target for a day. On a day
 * carrying two physical runs the loader used to read `canonicalIds[0]`, and
 * that index is ordered by nothing — `mileageByDay` builds it from an
 * unordered `SELECT … FROM runs`. In prod on 2026-08-21 that arbitrary pick
 * landed on a 2 mi phantom and the day's real 9.14 mi just-run became
 * unreachable from the strip.
 *
 * These lock the rule: the day's PRIMARY run is its longest, the choice is
 * stable under row order, and `done_mi` still reports the day's SUM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/coach/settings', () => ({
  loadSettings: vi.fn().mockResolvedValue({ long_run_day: 'sun' }),
}));
vi.mock('@/lib/runs/merge', () => ({
  canonicalMileageByDay: vi.fn(),
}));

import { pool } from '@/lib/db/pool';
import { canonicalMileageByDay } from '@/lib/runs/merge';
import { loadPlanWeek } from './week-loader';

const U = 'user-1';
const DAY = '2026-08-21';

/** The two rows that shared 2026-08-21: a 2 mi phantom and the real just-run. */
const PHANTOM = { row_id: '-44858261127515', strava_id: 'phone_conc_0', mi: 2, day: DAY };
const JUST_RUN = { row_id: '-216056293577712', strava_id: 'just-run-A1D7C099#1857', mi: 9.14, day: DAY };

/**
 * @param idOrder the order `canonicalMileageByDay` hands back the day's ids —
 *                the thing the old code was silently trusting.
 */
function wirePool(idOrder: string[], lookupRows: typeof PHANTOM[]) {
  (canonicalMileageByDay as any).mockResolvedValue(
    new Map([[DAY, { mi: 11.1, canonicalIds: idOrder }]]),
  );
  (pool.query as any).mockImplementation((sql: string) => {
    if (sql.includes('FROM training_plans')) return { rows: [{ id: 'plan-1' }] };
    if (sql.includes('FROM plan_workouts')) {
      return { rows: [{ id: 'wko_fri', date_iso: DAY, dow: 5, type: 'rest', distance_mi: '0', sub_label: 'REST' }] };
    }
    if (sql.includes('FROM runs')) return { rows: lookupRows };
    if (sql.includes('FROM day_actions')) return { rows: [] };
    return { rows: [] };
  });
}

const fridayOf = (r: any) => r.days.find((d: any) => d.date_iso === DAY);

describe('the week strip points at the day it actually ran', () => {
  beforeEach(() => vi.clearAllMocks());

  it('picks the longest run when a day carries two, whichever order they arrive in', async () => {
    // Phantom first — the exact prod ordering that broke it.
    wirePool([PHANTOM.row_id, JUST_RUN.row_id], [PHANTOM, JUST_RUN]);
    const a = fridayOf(await loadPlanWeek(U, '2026-08-23', DAY));
    expect(a.completedRunId).toBe(JUST_RUN.strava_id);

    // Reversed. A loader that reads index 0 passes one of these and fails the
    // other; only a distance rule passes both.
    wirePool([JUST_RUN.row_id, PHANTOM.row_id], [JUST_RUN, PHANTOM]);
    const b = fridayOf(await loadPlanWeek(U, '2026-08-23', DAY));
    expect(b.completedRunId).toBe(JUST_RUN.strava_id);
  });

  it('still reports the day SUM as done_mi — a real double is two runs of volume', async () => {
    wirePool([PHANTOM.row_id, JUST_RUN.row_id], [PHANTOM, JUST_RUN]);
    expect(fridayOf(await loadPlanWeek(U, '2026-08-23', DAY)).done_mi).toBe(11.1);
  });

  it('breaks a distance tie on row id, so the tap target cannot flip between renders', async () => {
    const tieA = { row_id: '-100', strava_id: 'run-A', mi: 4, day: DAY };
    const tieB = { row_id: '-200', strava_id: 'run-B', mi: 4, day: DAY };
    wirePool([tieA.row_id, tieB.row_id], [tieA, tieB]);
    const first = fridayOf(await loadPlanWeek(U, '2026-08-23', DAY)).completedRunId;
    wirePool([tieB.row_id, tieA.row_id], [tieB, tieA]);
    const second = fridayOf(await loadPlanWeek(U, '2026-08-23', DAY)).completedRunId;
    expect(first).toBe(second);
  });

  it('a single-run day is unchanged', async () => {
    wirePool([JUST_RUN.row_id], [JUST_RUN]);
    (canonicalMileageByDay as any).mockResolvedValue(
      new Map([[DAY, { mi: 9.1, canonicalIds: [JUST_RUN.row_id] }]]),
    );
    const d = fridayOf(await loadPlanWeek(U, '2026-08-23', DAY));
    expect(d.completedRunId).toBe(JUST_RUN.strava_id);
    expect(d.done_mi).toBe(9.1);
  });
});
