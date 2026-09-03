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
import { resolveDayExecutions, primaryPrescription } from './day-resolver';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DAY = '2026-09-03';

interface Prescription {
  id: string; type: string; distance_mi: string | null; sub_label: string | null;
  is_quality: boolean; is_long: boolean;
}
interface Run { id: string; data: Record<string, unknown> }

function wire(prescriptions: Prescription[], runs: Run[]) {
  (getCanonicalRunIds as any).mockResolvedValue(runs.map((r) => r.id));
  (pool.query as any).mockImplementation((sql: string) => {
    if (sql.includes('FROM plan_workouts')) return Promise.resolve({ rows: prescriptions });
    if (sql.includes('FROM runs')) return Promise.resolve({ rows: runs });
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
