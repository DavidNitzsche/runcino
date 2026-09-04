/**
 * lib/execution/_day_resolver.test.ts · WORKOUT-EXECUTION-ID-1 (2026-09-03).
 *
 * The exact live shape that broke, plus every case David's own ruling named
 * explicitly: a completed activity satisfies a prescribed workout only on an
 * exact, durable association — never same date, largest/only run of the day,
 * similar distance, or workout type alone. Falsified per Rule 18: run each
 * scenario against the PRE-fix predicate in your head (same date + biggest
 * run wins) and confirm it would have gotten every one of these wrong before
 * trusting that the resolver gets them right now.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runs/volume', () => ({ getCanonicalRunIds: vi.fn() }));

import { pool } from '@/lib/db/pool';
import { getCanonicalRunIds } from '@/lib/runs/volume';
import { resolveDayExecutions, resolveDateRangeExecutions, primaryPrescription } from './day-resolver';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DAY = '2026-09-03';

interface Prescription {
  id: string; type: string; distance_mi: string | null; sub_label: string | null;
  is_quality: boolean; is_long: boolean;
}
interface Run { id: string; data: Record<string, unknown> }

/**
 * `canonicalIds`, when passed, simulates the REAL SQL's `AND id::text = ANY($n)`
 * filter — a run row present in `runs` but absent from `canonicalIds` never
 * reaches the resolver, exactly as a dedup-losing sibling never reaches it in
 * production. Defaults to every run's own id (nothing pre-excluded) when
 * omitted, matching every existing call site's behaviour unchanged.
 */
function wire(
  prescriptions: Prescription[],
  runs: Run[],
  opts: { day?: string; canonicalIds?: string[] } = {},
) {
  const day = opts.day ?? DAY;
  const canonicalIds = opts.canonicalIds ?? runs.map((r) => r.id);
  (getCanonicalRunIds as any).mockResolvedValue(canonicalIds);
  (pool.query as any).mockImplementation((sql: string) => {
    if (sql.includes('FROM plan_workouts')) {
      return Promise.resolve({ rows: prescriptions.map((p) => ({ ...p, date_iso: day })) });
    }
    if (sql.includes('FROM runs')) {
      const survivors = runs.filter((r) => canonicalIds.includes(r.id));
      return Promise.resolve({ rows: survivors.map((r) => ({ ...r, day })) });
    }
    return Promise.resolve({ rows: [] });
  });
}

const hillPrescription: Prescription = {
  id: 'wko_hills', type: 'intervals', distance_mi: '6', sub_label: '10x60s hills',
  is_quality: true, is_long: false,
};

beforeEach(() => vi.clearAllMocks());

describe('WORKOUT-EXECUTION-ID-1 · the exact live shape', () => {
  it('a same-date, only-run-of-the-day easy activity with no exact id or live-tracked type stamp is SUPPLEMENTAL — the prescription stays unmatched', async () => {
    wire([hillPrescription], [{
      id: 'run_friend', data: {
        distanceMi: 4.48, source: 'apple_watch',
        // The exact defect: a passive HK-ingest stamp claiming the type,
        // with no planWorkoutId and no live-tracked source.
        workoutType: 'intervals', workoutTypeSource: 'plan',
      },
    }]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(primaryPrescription(day)?.matchedRun).toBeNull();
    expect(day.supplementalRuns).toHaveLength(1);
    expect(day.supplementalRuns[0].match).toBe('supplemental');
  });

  it('the friend run counts toward mileage/history via supplementalRuns even while unmatched', async () => {
    wire([hillPrescription], [{ id: 'run_friend', data: { distanceMi: 4.48, source: 'apple_watch' } }]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(day.supplementalRuns[0].distanceMi).toBe(4.48);
  });

  it('a later exact hill execution (planWorkoutId) completes the prescription, easy run stays supplemental', async () => {
    wire([hillPrescription], [
      { id: 'run_friend', data: { distanceMi: 4.48, source: 'apple_watch' } },
      { id: 'run_hills', data: { distanceMi: 6.0, source: 'phone', planWorkoutId: 'wko_hills' } },
    ]);
    const day = await resolveDayExecutions(USER, DAY);
    const primary = primaryPrescription(day);
    expect(primary?.matchedRun?.runId).toBe('run_hills');
    expect(primary?.matchedRun?.match).toBe('exact');
    expect(day.supplementalRuns.map((r) => r.runId)).toEqual(['run_friend']);
  });
});

describe('exact IDs, not ordering, decide association', () => {
  it('a larger unplanned run plus a smaller EXACT matched execution — the exact match wins regardless of size', async () => {
    wire([hillPrescription], [
      { id: 'run_big_unplanned', data: { distanceMi: 12, source: 'apple_watch' } },
      { id: 'run_small_exact', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'wko_hills' } },
    ]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(primaryPrescription(day)?.matchedRun?.runId).toBe('run_small_exact');
    expect(day.supplementalRuns.map((r) => r.runId)).toEqual(['run_big_unplanned']);
  });

  it('an unplanned run only — prescription stays incomplete, no false completion', async () => {
    wire([hillPrescription], [{ id: 'run_x', data: { distanceMi: 6.1, source: 'apple_watch' } }]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(primaryPrescription(day)?.matchedRun).toBeNull();
  });

  it('two runs sharing the SAME workout type on a day with one prescription of that type — legacy tier still requires a live-tracked source, not type alone', async () => {
    wire([hillPrescription], [
      { id: 'run_a', data: { distanceMi: 6, source: 'apple_watch', workoutType: 'intervals', workoutTypeSource: 'plan' } },
      { id: 'run_b', data: { distanceMi: 6.2, source: 'strava', workoutType: 'intervals', workoutTypeSource: 'plan' } },
    ]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(primaryPrescription(day)?.matchedRun).toBeNull();
    expect(day.supplementalRuns).toHaveLength(2);
  });

  it('two PRESCRIBED workouts on one day — each run only satisfies the prescription its exact id names, never by ordering', async () => {
    const tempo: Prescription = { id: 'wko_tempo', type: 'tempo', distance_mi: '5', sub_label: null, is_quality: true, is_long: false };
    wire([hillPrescription, tempo], [
      { id: 'run_tempo', data: { distanceMi: 5, source: 'phone', planWorkoutId: 'wko_tempo' } },
      { id: 'run_hills', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'wko_hills' } },
    ]);
    const day = await resolveDayExecutions(USER, DAY);
    const hills = day.prescriptions.find((p) => p.id === 'wko_hills');
    const tempoP = day.prescriptions.find((p) => p.id === 'wko_tempo');
    expect(hills?.matchedRun?.runId).toBe('run_hills');
    expect(tempoP?.matchedRun?.runId).toBe('run_tempo');
    expect(day.supplementalRuns).toHaveLength(0);
  });

  it('two prescriptions of the SAME type one day — legacy type-tier refuses (ambiguous), never guesses by ordering', async () => {
    const hills2: Prescription = { id: 'wko_hills_2', type: 'intervals', distance_mi: '4', sub_label: null, is_quality: false, is_long: false };
    wire([hillPrescription, hills2], [
      { id: 'run_a', data: { distanceMi: 6, source: 'watch', workoutType: 'intervals', workoutTypeSource: 'plan' } },
    ]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(day.prescriptions.every((p) => p.matchedRun === null)).toBe(true);
    expect(day.supplementalRuns).toHaveLength(1);
  });

  it('Watch-recorded exact execution matches', async () => {
    wire([hillPrescription], [{ id: 'run_w', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'wko_hills' } }]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(primaryPrescription(day)?.matchedRun?.match).toBe('exact');
  });

  it('phone-recorded exact execution matches', async () => {
    wire([hillPrescription], [{ id: 'run_p', data: { distanceMi: 6, source: 'phone', planWorkoutId: 'wko_hills' } }]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(primaryPrescription(day)?.matchedRun?.match).toBe('exact');
  });

  it('a legacy activity lacking a workout id, but genuinely live-tracked and type-stamped, gets conservative legacy credit', async () => {
    wire([hillPrescription], [{ id: 'run_legacy', data: { distanceMi: 6, source: 'watch', workoutType: 'intervals', workoutTypeSource: 'plan' } }]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(primaryPrescription(day)?.matchedRun?.match).toBe('legacy_type');
  });

  it('duplicate/absorbed activities never reach the resolver — getCanonicalRunIds already excluded them, only the survivor is considered', async () => {
    wire([hillPrescription], [{ id: 'run_survivor', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'wko_hills' } }]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(day.prescriptions[0].matchedRun?.runId).toBe('run_survivor');
    expect(day.supplementalRuns).toHaveLength(0);
  });
});

/**
 * EXECUTION-IDENTITY-1 (2026-09-03) · the full matrix David's ruling named
 * explicitly, beyond the live-shape and ordering cases above: temporal
 * ordering within a day, partial completion, treadmill, idempotency against
 * a duplicate recording, a rescheduled prescription, a race with warm-up /
 * cooldown activities, and a day with nothing prescribed at all.
 */
describe('the full named matrix', () => {
  it('supplemental run logged BEFORE the prescribed workout — array order does not decide association', async () => {
    // The friend run's row comes first in the array; the exact hill
    // execution comes second. Only the id link decides, never position.
    wire([hillPrescription], [
      { id: 'run_friend', data: { distanceMi: 4.48, source: 'apple_watch' } },
      { id: 'run_hills', data: { distanceMi: 6, source: 'phone', planWorkoutId: 'wko_hills' } },
    ]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(primaryPrescription(day)?.matchedRun?.runId).toBe('run_hills');
    expect(day.supplementalRuns.map((r) => r.runId)).toEqual(['run_friend']);
  });

  it('supplemental run logged AFTER the prescribed workout — same result, reversed array order', async () => {
    wire([hillPrescription], [
      { id: 'run_hills', data: { distanceMi: 6, source: 'phone', planWorkoutId: 'wko_hills' } },
      { id: 'run_friend', data: { distanceMi: 4.48, source: 'apple_watch' } },
    ]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(primaryPrescription(day)?.matchedRun?.runId).toBe('run_hills');
    expect(day.supplementalRuns.map((r) => r.runId)).toEqual(['run_friend']);
  });

  it('a PARTIAL prescribed execution plus a supplemental run — the partial still owns the exact link, the extra run stays supplemental', async () => {
    wire([hillPrescription], [
      // watchStatus lives in `data`, not the resolver's own classification —
      // `match` only answers identity, never completeness. A partial exact
      // execution is still `exact`; grading its partial-ness is the
      // interpreter's job (lib/execution/interpret.ts), not this file's.
      { id: 'run_hills_partial', data: { distanceMi: 3.5, source: 'watch', planWorkoutId: 'wko_hills', status: 'partial' } },
      { id: 'run_extra', data: { distanceMi: 2.0, source: 'apple_watch' } },
    ]);
    const day = await resolveDayExecutions(USER, DAY);
    const primary = primaryPrescription(day);
    expect(primary?.matchedRun?.runId).toBe('run_hills_partial');
    expect(primary?.matchedRun?.match).toBe('exact');
    expect(day.supplementalRuns.map((r) => r.runId)).toEqual(['run_extra']);
  });

  it('a TREADMILL-recorded exact execution matches, same as watch and phone', async () => {
    wire([hillPrescription], [{ id: 'run_trd', data: { distanceMi: 6, source: 'treadmill', planWorkoutId: 'wko_hills' } }]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(primaryPrescription(day)?.matchedRun?.match).toBe('exact');
  });

  it('a delayed HealthKit duplicate of an app-recorded execution resolves to ONE execution — canonical dedup upstream, never double-counted here', async () => {
    // Two raw rows describe the SAME physical run: the app's own live-tracked
    // completion (exact id) and a later HK import of the identical activity.
    // getCanonicalRunIds is this app's one dedup authority (lib/runs/identity.ts)
    // and has already picked the survivor — only ITS id is passed here. The
    // resolver must never re-admit the loser just because its row exists in
    // `runs`; `wire`'s canonicalIds filter reproduces the real SQL predicate
    // that keeps it out.
    wire(
      [hillPrescription],
      [
        { id: 'run_app_tracked', data: { distanceMi: 6, source: 'phone', planWorkoutId: 'wko_hills' } },
        { id: 'run_hk_duplicate', data: { distanceMi: 6.02, source: 'apple_health' } },
      ],
      { canonicalIds: ['run_app_tracked'] },
    );
    const day = await resolveDayExecutions(USER, DAY);
    const primary = primaryPrescription(day);
    expect(primary?.matchedRun?.runId).toBe('run_app_tracked');
    expect(day.supplementalRuns).toHaveLength(0);
    // The would-be duplicate never appears anywhere in the resolved day —
    // not matched, not supplemental — because it was never a canonical run.
    const allRunIds = [
      ...day.prescriptions.map((p) => p.matchedRun?.runId).filter(Boolean),
      ...day.supplementalRuns.map((r) => r.runId),
    ];
    expect(allRunIds).not.toContain('run_hk_duplicate');
  });

  it('a rescheduled workout executed on its NEW date attaches by exact id, queried against the date it now lives on', async () => {
    const rescheduledDay = '2026-09-05';
    wire(
      [hillPrescription],
      [{ id: 'run_hills_rescheduled', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'wko_hills' } }],
      { day: rescheduledDay },
    );
    const day = await resolveDayExecutions(USER, rescheduledDay);
    expect(primaryPrescription(day)?.matchedRun?.runId).toBe('run_hills_rescheduled');
  });

  it('a race day with a separately-logged warm-up run — the race attaches by exact id, the warm-up stays supplemental', async () => {
    const race: Prescription = { id: 'wko_race', type: 'race', distance_mi: '13.1', sub_label: 'Half marathon', is_quality: true, is_long: true };
    wire([race], [
      { id: 'run_warmup', data: { distanceMi: 1.2, source: 'apple_watch' } },
      { id: 'run_race', data: { distanceMi: 13.1, source: 'watch', planWorkoutId: 'wko_race' } },
    ]);
    const day = await resolveDayExecutions(USER, DAY);
    const primary = primaryPrescription(day);
    expect(primary?.matchedRun?.runId).toBe('run_race');
    expect(day.supplementalRuns.map((r) => r.runId)).toEqual(['run_warmup']);
  });

  it('a race day with a separately-logged COOLDOWN run — same result, the cooldown never inherits the race', async () => {
    const race: Prescription = { id: 'wko_race', type: 'race', distance_mi: '13.1', sub_label: 'Half marathon', is_quality: true, is_long: true };
    wire([race], [
      { id: 'run_race', data: { distanceMi: 13.1, source: 'watch', planWorkoutId: 'wko_race' } },
      { id: 'run_cooldown', data: { distanceMi: 0.8, source: 'apple_watch' } },
    ]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(primaryPrescription(day)?.matchedRun?.runId).toBe('run_race');
    expect(day.supplementalRuns.map((r) => r.runId)).toEqual(['run_cooldown']);
  });

  it('no prescribed workout that day — every run is supplemental, prescriptions is empty, nothing is graded', async () => {
    wire([], [{ id: 'run_rest_day_extra', data: { distanceMi: 3, source: 'apple_watch' } }]);
    const day = await resolveDayExecutions(USER, DAY);
    expect(day.prescriptions).toHaveLength(0);
    expect(primaryPrescription(day)).toBeNull();
    expect(day.supplementalRuns.map((r) => r.runId)).toEqual(['run_rest_day_extra']);
  });

  it('resolveDateRangeExecutions batches multiple days in one pass and each day classifies independently', async () => {
    wire(
      [hillPrescription, { id: 'wko_easy_next', type: 'easy', distance_mi: '5', sub_label: null, is_quality: false, is_long: false }],
      [],
    );
    // Override the plan_workouts mock to return prescriptions on two
    // different dates, and runs on two different dates, all in one batch —
    // the shape resolveDateRangeExecutions actually receives in production.
    (getCanonicalRunIds as any).mockResolvedValue(['run_hills', 'run_friend']);
    (pool.query as any).mockImplementation((sql: string) => {
      if (sql.includes('FROM plan_workouts')) {
        return Promise.resolve({
          rows: [
            { ...hillPrescription, date_iso: '2026-09-03' },
            { id: 'wko_easy_next', type: 'easy', distance_mi: '5', sub_label: null, is_quality: false, is_long: false, date_iso: '2026-09-04' },
          ],
        });
      }
      if (sql.includes('FROM runs')) {
        return Promise.resolve({
          rows: [
            { id: 'run_hills', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'wko_hills' }, day: '2026-09-03' },
            { id: 'run_friend', data: { distanceMi: 3, source: 'apple_watch' }, day: '2026-09-04' },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const map = await resolveDateRangeExecutions(USER, '2026-09-03', '2026-09-05');
    expect(primaryPrescription(map.get('2026-09-03')!)?.matchedRun?.runId).toBe('run_hills');
    expect(primaryPrescription(map.get('2026-09-04')!)?.matchedRun).toBeNull();
    expect(map.get('2026-09-04')!.supplementalRuns.map((r) => r.runId)).toEqual(['run_friend']);
  });
});
