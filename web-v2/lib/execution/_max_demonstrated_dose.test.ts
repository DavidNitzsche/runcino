/**
 * lib/execution/_max_demonstrated_dose.test.ts · F097.
 *
 * Falsifies the four claims the finding's verification bar names:
 *
 *   (a) a real completed session within the rolling 30-day window is
 *       correctly identified as the max for its domain;
 *   (b) a taper day, even objectively larger, never wins;
 *   (c) a session outside the 30-day window never counts, even if it would
 *       otherwise be the biggest;
 *   (d) the window is genuinely ROLLING — recomputed relative to `todayISO`,
 *       not a fixed calendar range: the SAME candidate row is in-window for
 *       one `todayISO` and out of it for a later one.
 *
 * `type: 'race'` fixtures are used throughout rather than 'threshold' or
 * 'intervals'. Reason: `actualDomain` (`./reconstruct.ts`) returns `'race'`
 * UNCONDITIONALLY when the session's own intended domain is `'race'` — no
 * pace-window or `tPaceSecPerMi` comparison ever runs — so a race fixture
 * lets every scenario below control the credited `workMinutes` directly via
 * `movingTimeS`, with no risk of a pace-anchor detail silently reclassifying
 * the domain and invalidating the assertion. Domain CLASSIFICATION itself
 * (`plannedDomain`, `actualDomain`, `paceDomain`) is `reconstruct.ts`'s own
 * concern and is already covered by `_reconstruct.test.ts`; this file tests
 * only what THIS aggregator adds on top: the per-domain MAX over a rolling,
 * taper-excluding window.
 *
 * `resolveDateRangeExecutions`, `resolvePrescribedPaceAnchors` and
 * `resolveCurrentVdotSnapshot` are mocked directly — this file is not
 * re-testing EXECUTION-IDENTITY-1 run-matching or pace-anchor resolution,
 * both already covered by their own suites. `loadPrescribedWindows` is
 * mocked too; `isPrescribedNonNormal` is imported REAL (`importActual`) so
 * the taper-exclusion assertions exercise the actual shared predicate, not a
 * stand-in for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('./day-resolver', () => ({ resolveDateRangeExecutions: vi.fn() }));
vi.mock('@/lib/training/load-prescription-anchors', () => ({
  resolvePrescribedPaceAnchors: vi.fn(),
}));
vi.mock('@/lib/training/projection-snapshots', () => ({
  resolveCurrentVdotSnapshot: vi.fn(),
}));
vi.mock('@/lib/training/normal-window', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/training/normal-window')>();
  return { ...actual, loadPrescribedWindows: vi.fn() };
});

import { pool } from '@/lib/db/pool';
import { resolveDateRangeExecutions } from './day-resolver';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import { resolveCurrentVdotSnapshot } from '@/lib/training/projection-snapshots';
import { loadPrescribedWindows, type PrescribedWindow } from '@/lib/training/normal-window';
import { maxDemonstratedDoseByDomain, MAX_DEMONSTRATED_DOSE_WINDOW_DAYS } from './max-demonstrated-dose';
import type { ResolvedDay, ResolvedRun } from './day-resolver';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

interface RaceRow {
  id: string;
  date_iso: string;
  /** Minutes of moving time the matched run carries — directly controls the
   *  workMinutes this row would contribute if it wins. */
  minutes: number;
}

beforeEach(() => {
  vi.clearAllMocks();
  (resolvePrescribedPaceAnchors as any).mockResolvedValue({ ok: false, reason: 'no-anchor', detail: 'test' });
  (resolveCurrentVdotSnapshot as any).mockResolvedValue({ ok: false });
  (loadPrescribedWindows as any).mockResolvedValue([]);
});

/**
 * Wires `pool.query` (the owned-days CTE) and `resolveDateRangeExecutions`
 * from one flat list of candidate rows — `pool.query`'s mock FILTERS by the
 * `fromISO`/`toISOExclusive` bound params the function under test actually
 * passes, exactly as the real `date_iso >= $2 AND date_iso < $3` predicate
 * would. This is what makes claims (c) and (d) meaningful: a row is excluded
 * because the WINDOW MATH excluded it, not because the fixture omitted it.
 */
function wire(rows: RaceRow[]) {
  (pool.query as any).mockImplementation((sql: string, params: unknown[]) => {
    if (sql.includes('FROM plan_workouts')) {
      const fromISO = String(params[1]);
      const toISOExclusive = String(params[2]);
      const survivors = rows.filter((r) => r.date_iso >= fromISO && r.date_iso < toISOExclusive);
      return Promise.resolve({
        rows: survivors.map((r) => ({
          id: r.id,
          date_iso: r.date_iso,
          type: 'race',
          is_quality: true,
          is_long: true,
          distance_mi: '13.1',
          pace_target_s_per_mi: 480,
          workout_spec: null,
        })),
      });
    }
    return Promise.resolve({ rows: [] });
  });

  (resolveDateRangeExecutions as any).mockImplementation(
    async (_userUuid: string, fromISO: string, toISOExclusive: string): Promise<Map<string, ResolvedDay>> => {
      const map = new Map<string, ResolvedDay>();
      for (const r of rows) {
        if (!(r.date_iso >= fromISO && r.date_iso < toISOExclusive)) continue;
        const run: ResolvedRun = {
          runId: `run_${r.id}`,
          data: { distanceMi: 13.1, movingTimeS: r.minutes * 60 } as any,
          shoeId: null,
          distanceMi: 13.1,
          match: 'exact',
          matchedWorkoutId: r.id,
        };
        map.set(r.date_iso, {
          dateISO: r.date_iso,
          prescriptions: [{
            id: r.id, type: 'race', distanceMi: 13.1, subLabel: null,
            isQuality: true, isLong: true, matchedRun: run,
          }],
          supplementalRuns: [],
        });
      }
      return map;
    },
  );
}

const taperWindow = (fromISO: string, toISO: string): PrescribedWindow => ({
  raceSlug: 'test-race',
  raceDateISO: toISO,
  raceDistanceMi: 13.1,
  category: 'hm',
  priority: 'A',
  taperWeeks: 2,
  recoveryWeeks: 1,
  fromISO,
  toISO,
});

describe('F097 · maxDemonstratedDoseByDomain', () => {
  it('(a) the bigger of two real completed sessions in-window wins its domain', async () => {
    wire([
      { id: 'small', date_iso: '2026-09-01', minutes: 60 },
      { id: 'big', date_iso: '2026-09-05', minutes: 90 },
    ]);
    const read = await maxDemonstratedDoseByDomain(USER, '2026-09-14');
    expect(read.atPaceMinutesByDomain.race).toBe(90);
  });

  it('(b) a taper day never wins, however large — the real session wins instead', async () => {
    wire([
      { id: 'taper_big', date_iso: '2026-09-10', minutes: 200 },
      { id: 'real_small', date_iso: '2026-09-02', minutes: 60 },
    ]);
    (loadPrescribedWindows as any).mockResolvedValue([taperWindow('2026-09-08', '2026-09-12')]);
    const read = await maxDemonstratedDoseByDomain(USER, '2026-09-14');
    expect(read.atPaceMinutesByDomain.race).toBe(60);
  });

  it('(b2) when the ONLY candidate sits in a taper window, the domain reports nothing at all — never a false zero, never the taper number', async () => {
    wire([{ id: 'only_taper', date_iso: '2026-09-10', minutes: 200 }]);
    (loadPrescribedWindows as any).mockResolvedValue([taperWindow('2026-09-08', '2026-09-12')]);
    const read = await maxDemonstratedDoseByDomain(USER, '2026-09-14');
    expect(read.atPaceMinutesByDomain.race).toBeUndefined();
  });

  it('(c) a session outside the 30-day window never counts, even though it is the biggest', async () => {
    wire([
      { id: 'old_huge', date_iso: '2026-08-10', minutes: 300 }, // 35 days before today
      { id: 'recent_small', date_iso: '2026-09-05', minutes: 50 },
    ]);
    const read = await maxDemonstratedDoseByDomain(USER, '2026-09-14');
    expect(read.atPaceMinutesByDomain.race).toBe(50);
  });

  it('(d) the window is ROLLING, not a fixed calendar range — the identical row counts for one "today" and falls out of range two days later', async () => {
    // 2026-08-15 is exactly 30 days before 2026-09-14 (inclusive lower bound).
    wire([{ id: 'boundary', date_iso: '2026-08-15', minutes: 77 }]);

    const inWindow = await maxDemonstratedDoseByDomain(USER, '2026-09-14');
    expect(inWindow.atPaceMinutesByDomain.race).toBe(77);

    // Rolling the clock forward two days rolls the window's lower bound
    // forward with it (to 2026-08-17), pushing 2026-08-15 out of range —
    // the SAME row, with no change to the fixture at all.
    const outOfWindow = await maxDemonstratedDoseByDomain(USER, '2026-09-16');
    expect(outOfWindow.atPaceMinutesByDomain.race).toBeUndefined();
  });

  it('the window length is the doctrine-cited 30 days (Research/00a\'s prior-30-day spike threshold), not the retracted 8-week figure', () => {
    expect(MAX_DEMONSTRATED_DOSE_WINDOW_DAYS).toBe(30);
  });

  it('an empty window is a real, submitted answer — {} — never a thrown error', async () => {
    wire([]);
    const read = await maxDemonstratedDoseByDomain(USER, '2026-09-14');
    expect(read.atPaceMinutesByDomain).toEqual({});
  });
});
