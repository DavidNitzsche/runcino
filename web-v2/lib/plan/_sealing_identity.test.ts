/**
 * lib/plan/_sealing_identity.test.ts · SEALING-IDENTITY-1 (2026-09-04).
 *
 * The exact live shape this closes: a friend's unrelated 4.48mi easy run,
 * present on the calendar the same date as David's 6mi hill-interval
 * prescription, would have SEALED that prescription's fields against any
 * further write — hours before he actually went out and ran it — because
 * every sealing check in this codebase asked "does a run exist on this
 * date," never "does a run satisfy THIS prescription."
 *
 * Every scenario below is David's own enumerated requirement, verbatim from
 * his ruling. Falsified per Rule 18: run each one against the PRE-fix
 * predicate in your head (any unmerged run on the date seals everything
 * that date) and confirm it would have gotten every one of these wrong.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runs/volume', () => ({ getCanonicalRunIds: vi.fn() }));

import { pool } from '@/lib/db/pool';
import { getCanonicalRunIds } from '@/lib/runs/volume';
import { isDaySealed, isPrescriptionSealed, snapshotSealedDays } from './seal';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DAY = '2026-09-03';

interface Prescription {
  id: string; type: string; distance_mi: string | null; sub_label: string | null;
  is_quality: boolean; is_long: boolean;
}
interface Run { id: string; data: Record<string, unknown> }

const hillPrescription: Prescription = {
  id: 'wko_hills', type: 'intervals', distance_mi: '6', sub_label: '10x60s hills',
  is_quality: true, is_long: false,
};

function wire(prescriptions: Prescription[], runs: Run[], day: string = DAY) {
  (getCanonicalRunIds as any).mockResolvedValue(runs.map((r) => r.id));
  (pool.query as any).mockImplementation((sql: string) => {
    if (sql.includes('FROM plan_workouts') && sql.includes('MIN(')) {
      return Promise.resolve({ rows: [{ min_iso: day, max_iso: day }] });
    }
    if (sql.includes('FROM plan_workouts')) {
      return Promise.resolve({ rows: prescriptions.map((p) => ({ ...p, date_iso: day })) });
    }
    if (sql.includes('FROM runs')) {
      return Promise.resolve({ rows: runs.map((r) => ({ ...r, day })) });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => vi.clearAllMocks());

describe('SEALING-IDENTITY-1 · the exact live shape', () => {
  it('the friend run alone (before the real hill session) does NOT seal the interval prescription', async () => {
    wire([hillPrescription], [{ id: 'run_friend', data: { distanceMi: 4.48, source: 'apple_watch' } }]);
    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(false);
    expect(await isDaySealed(USER, DAY)).toBe(false);
  });

  it('the real hill session, EXACT-linked, DOES seal the prescription', async () => {
    wire([hillPrescription], [
      { id: 'run_friend', data: { distanceMi: 4.48, source: 'apple_watch' } },
      { id: 'run_hills', data: { distanceMi: 4.71, source: 'treadmill', planWorkoutId: 'wko_hills' } },
    ]);
    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(true);
    expect(await isDaySealed(USER, DAY)).toBe(true);
  });
});

describe("David's seven requirements", () => {
  it('1 · EXACT match seals', async () => {
    wire([hillPrescription], [{ id: 'run_hills', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'wko_hills' } }]);
    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(true);
  });

  it('1 · unambiguous LEGACY match seals', async () => {
    wire([hillPrescription], [{ id: 'run_legacy', data: { distanceMi: 6, source: 'watch', workoutType: 'intervals', workoutTypeSource: 'plan' } }]);
    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(true);
  });

  it('2 · SUPPLEMENTAL activity alone never seals — one run', async () => {
    wire([hillPrescription], [{ id: 'run_x', data: { distanceMi: 6.1, source: 'apple_watch' } }]);
    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(false);
  });

  it('2 · SUPPLEMENTAL activity alone never seals — a passive sync stamped with the matching type', async () => {
    // The exact defect: workoutType alone, no live-tracked source.
    wire([hillPrescription], [{ id: 'run_passive', data: { distanceMi: 4.48, source: 'apple_watch', workoutType: 'intervals', workoutTypeSource: 'plan' } }]);
    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(false);
  });

  it('3 · a partial EXACT match still seals — the record is protected, not the completeness claimed', async () => {
    wire([hillPrescription], [{ id: 'run_partial', data: { distanceMi: 4.71, source: 'treadmill', planWorkoutId: 'wko_hills', status: 'partial' } }]);
    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(true);
    // Sealing carries no completion claim of its own — that lives entirely
    // in lib/execution/interpret.ts's ExecutionRead.state, which this file
    // has no opinion on. This test only proves the seal fires; the "not
    // every phase completed" half is EXECUTION-IDENTITY-1's own matrix
    // (lib/execution/_day_resolver.test.ts, the partial-execution case).
  });

  it('4 · multiple supplemental runs still never seal', async () => {
    wire([hillPrescription], [
      { id: 'run_a', data: { distanceMi: 4, source: 'apple_watch' } },
      { id: 'run_b', data: { distanceMi: 3, source: 'strava' } },
    ]);
    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(false);
  });

  it('5 · a race warm-up must not seal the race', async () => {
    const race: Prescription = { id: 'wko_race', type: 'race', distance_mi: '13.1', sub_label: 'Half marathon', is_quality: true, is_long: true };
    wire([race], [{ id: 'run_warmup', data: { distanceMi: 1.2, source: 'apple_watch' } }]);
    expect(await isPrescriptionSealed(USER, DAY, 'wko_race')).toBe(false);
  });

  it('5 · a race cooldown must not seal the race', async () => {
    const race: Prescription = { id: 'wko_race', type: 'race', distance_mi: '13.1', sub_label: 'Half marathon', is_quality: true, is_long: true };
    wire([race], [{ id: 'run_cooldown', data: { distanceMi: 0.8, source: 'apple_watch' } }]);
    expect(await isPrescriptionSealed(USER, DAY, 'wko_race')).toBe(false);
  });

  it('5 · the actual race recording, exact-linked, DOES seal the race', async () => {
    const race: Prescription = { id: 'wko_race', type: 'race', distance_mi: '13.1', sub_label: 'Half marathon', is_quality: true, is_long: true };
    wire([race], [
      { id: 'run_warmup', data: { distanceMi: 1.2, source: 'apple_watch' } },
      { id: 'run_race', data: { distanceMi: 13.1, source: 'watch', planWorkoutId: 'wko_race' } },
    ]);
    expect(await isPrescriptionSealed(USER, DAY, 'wko_race')).toBe(true);
  });

  it('6 · a delayed canonical duplicate never creates a second seal — the loser is not a candidate at all', async () => {
    // getCanonicalRunIds has already excluded the loser; only the survivor's
    // id is passed through `wire`'s canonicalIds.
    (getCanonicalRunIds as any).mockResolvedValue(['run_survivor']);
    (pool.query as any).mockImplementation((sql: string) => {
      if (sql.includes('FROM plan_workouts') && sql.includes('MIN(')) {
        return Promise.resolve({ rows: [{ min_iso: DAY, max_iso: DAY }] });
      }
      if (sql.includes('FROM plan_workouts')) {
        return Promise.resolve({ rows: [{ ...hillPrescription, date_iso: DAY }] });
      }
      if (sql.includes('FROM runs')) {
        return Promise.resolve({
          rows: [{ id: 'run_survivor', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'wko_hills' }, day: DAY }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(true);
    // Sealing is a boolean per prescription — there is no "second seal" to
    // create even in principle once the loser never reaches the resolver.
  });

  it('7 · rescheduling: the OLD date carries no row for the moved prescription, so activity left there cannot seal it', async () => {
    // The prescription now lives on a NEW date; querying the OLD date finds
    // no prescription there at all, and a run stamped with the old
    // planWorkoutId — however it got there — has nothing on THIS date to
    // match against.
    wire([], [{ id: 'run_orphaned', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'wko_hills' } }], DAY);
    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(false);
    expect(await isDaySealed(USER, DAY)).toBe(false);
  });

  it('7 · rescheduling: the NEW date, once genuinely executed there, seals normally', async () => {
    const NEW_DAY = '2026-09-05';
    wire([hillPrescription], [{ id: 'run_hills', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'wko_hills' } }], NEW_DAY);
    expect(await isPrescriptionSealed(USER, NEW_DAY, 'wko_hills')).toBe(true);
  });
});

describe('the rebuild-path snapshot only carries genuinely sealed prescriptions', () => {
  it('a date with only a supplemental run contributes nothing to the snapshot', async () => {
    wire([hillPrescription], [{ id: 'run_friend', data: { distanceMi: 4.48, source: 'apple_watch' } }]);
    const client = { query: pool.query as any };
    const snapshot = await snapshotSealedDays(client, USER);
    expect(snapshot.size).toBe(0);
  });

  it('a date with an exact match contributes exactly that prescription, full-fidelity', async () => {
    (getCanonicalRunIds as any).mockResolvedValue(['run_hills']);
    (pool.query as any).mockImplementation((sql: string) => {
      if (sql.includes('FROM plan_workouts') && sql.includes('MIN(')) {
        return Promise.resolve({ rows: [{ min_iso: DAY, max_iso: DAY }] });
      }
      if (sql.includes('FROM plan_workouts') && sql.includes('pw.id = ANY')) {
        return Promise.resolve({
          rows: [{
            id: 'wko_hills', date_iso: DAY, type: 'intervals', distance_mi: '6',
            pace_target_s_per_mi: null, sub_label: '10x60s hills', workout_spec: { kind: 'intervals' },
            is_quality: true, is_long: false, notes: 'Build the engine.',
          }],
        });
      }
      if (sql.includes('FROM plan_workouts')) {
        return Promise.resolve({ rows: [{ ...hillPrescription, date_iso: DAY }] });
      }
      if (sql.includes('FROM runs')) {
        return Promise.resolve({
          rows: [{ id: 'run_hills', data: { distanceMi: 6, source: 'watch', planWorkoutId: 'wko_hills' }, day: DAY }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const client = { query: pool.query as any };
    const snapshot = await snapshotSealedDays(client, USER);
    expect(snapshot.size).toBe(1);
    const row = snapshot.get(DAY);
    expect(row?.type).toBe('intervals');
    expect(row?.distance_mi).toBe(6);
    expect(row?.notes).toBe('Build the engine.');
  });
});

describe('a resolver failure seals conservatively, never unseals', () => {
  it('isPrescriptionSealed refuses to write when the resolver cannot answer', async () => {
    (getCanonicalRunIds as any).mockRejectedValue(new Error('db down'));
    (pool.query as any).mockRejectedValue(new Error('db down'));
    expect(await isPrescriptionSealed(USER, DAY, 'wko_hills')).toBe(true);
    expect(await isDaySealed(USER, DAY)).toBe(true);
  });
});
