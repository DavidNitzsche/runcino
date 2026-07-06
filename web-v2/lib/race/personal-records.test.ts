/**
 * lib/race/personal-records.test.ts
 *
 * 2026-07-06 · P1-7 falsifiers · the CLAUDE.md race-data checklist as tests:
 *
 *   F1  races.actual_result beats a FASTER training run — curated chip time
 *       is THE record, training pace never outranks it.
 *   F2  meta.finishTime (curated retro) is rung 2 when actual_result absent.
 *   F3  actual_result beats a conflicting meta.finishTime on the same race.
 *   F4  training fallback is ALWAYS provisional:true + source:'training_run'
 *       + the canonical 'Training effort · race to lock in' caption.
 *   F5  training candidates respect the per-bucket whole-run window (a
 *       2.9-mi run cannot claim the 5K record — the b10dab25 floor lesson
 *       inverted: window, not flat floor).
 *   F6  training bests (longest run / biggest week) live OUTSIDE records,
 *       stamped training_run.
 */
import { describe, expect, it, vi } from 'vitest';

// personal-records → races-state/volume → pool + runner-tz. The composer is
// pure; mock the DB modules so importing the chain never touches pg.
vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-07-06'),
  runnerTimezone: vi.fn().mockResolvedValue('America/Los_Angeles'),
}));

import { composePersonalRecords } from './personal-records';
import { PROVISIONAL_FINISH_LABEL } from '@/lib/coach/races-state';

const race5k = (over: Partial<{ meta: Record<string, unknown>; actual_result: Record<string, unknown> | null }> = {}) => ({
  slug: 'my-5k-2026-03-14',
  meta: { name: 'Carlsbad 5000', date: '2026-03-14', distanceLabel: '5K', priority: 'B', ...(over.meta ?? {}) },
  actual_result: over.actual_result === undefined ? { finishS: 1275 } : over.actual_result,
});

const run = (id: string, data: Record<string, unknown>) => ({ id, data });

describe('composePersonalRecords — curated race results first', () => {
  it('F1 · actual_result wins over a FASTER training run', () => {
    const out = composePersonalRecords(
      [race5k()], // 21:15 chip time
      [run('r1', { distanceMi: 3.1, movingTimeS: 1100, date: '2026-05-01', name: 'Tempo blast' })], // 18:20 "run"
    );
    const rec = out.records.find((r) => r.key === '5k')!;
    expect(rec.source).toBe('race_result');
    expect(rec.timeS).toBe(1275);
    expect(rec.timeDisplay).toBe('21:15');
    expect(rec.provisional).toBe(false);
    expect(rec.provisionalLabel).toBeNull();
    expect(rec.slug).toBe('my-5k-2026-03-14');
  });

  it('F2 · meta.finishTime is the curated rung-2 when actual_result is absent', () => {
    const out = composePersonalRecords(
      [race5k({ actual_result: null, meta: { finishTime: '20:45' } })],
      [],
    );
    const rec = out.records.find((r) => r.key === '5k')!;
    expect(rec.source).toBe('race_meta');
    expect(rec.timeS).toBe(20 * 60 + 45);
    expect(rec.provisional).toBe(false);
  });

  it('F3 · actual_result beats a conflicting meta.finishTime on the same race', () => {
    const out = composePersonalRecords(
      [race5k({ actual_result: { finishS: 1275 }, meta: { finishTime: '25:00' } })],
      [],
    );
    const rec = out.records.find((r) => r.key === '5k')!;
    expect(rec.source).toBe('race_result');
    expect(rec.timeS).toBe(1275);
  });

  it('buckets by meta.distanceMi when present (numeric beats label)', () => {
    const out = composePersonalRecords(
      [{
        slug: 'sombrero-half',
        meta: { name: 'Sombrero Half', date: '2026-02-01', distanceMi: 13.1 },
        actual_result: { finishS: 5400 },
      }],
      [],
    );
    const rec = out.records.find((r) => r.key === 'half')!;
    expect(rec.timeDisplay).toBe('1:30:00');
    expect(rec.provisional).toBe(false);
  });
});

describe('composePersonalRecords — provisional training fallback', () => {
  it('F4 · training fallback is flagged provisional with the canonical caption', () => {
    const out = composePersonalRecords(
      [],
      [run('r1', { distanceMi: 3.2, movingTimeS: 1300, date: '2026-06-01', name: 'Parkrun-ish' })],
    );
    const rec = out.records.find((r) => r.key === '5k')!;
    expect(rec.source).toBe('training_run');
    expect(rec.provisional).toBe(true);
    expect(rec.provisionalLabel).toBe(PROVISIONAL_FINISH_LABEL);
    expect(rec.provisionalLabel).toBe('Training effort · race to lock in');
    expect(rec.slug).toBeNull();
    expect(rec.distanceMi).toBe(3.2);
  });

  it('F5 · whole-run window enforced: 2.9 mi cannot claim the 5K, 3.2 can', () => {
    const out = composePersonalRecords(
      [],
      [
        run('short', { distanceMi: 2.9, movingTimeS: 1000, date: '2026-06-01' }),
        run('legit', { distanceMi: 3.2, movingTimeS: 1400, date: '2026-06-02' }),
      ],
    );
    const rec = out.records.find((r) => r.key === '5k')!;
    expect(rec.timeS).toBe(1400); // the 3.2-mi run, NOT the faster 2.9-mi one
  });

  it('picks the fastest-PACE qualifying run, moving-time COALESCE ladder', () => {
    const out = composePersonalRecords(
      [],
      [
        run('a', { distanceMi: 6.2, movingSec: 3100, date: '2026-05-10' }),        // webhook key · 8:20/mi
        run('b', { distanceMi: 6.4, elapsedTimeS: 2880, date: '2026-05-11' }),     // 7:30/mi → wins
      ],
    );
    const rec = out.records.find((r) => r.key === '10k')!;
    expect(rec.timeS).toBe(2880);
    expect(rec.provisional).toBe(true);
  });

  it('empty bucket → no entry (never fabricates)', () => {
    const out = composePersonalRecords([], []);
    expect(out.records).toHaveLength(0);
  });
});

describe('composePersonalRecords — training bests stay outside records', () => {
  it('F6 · longest run + biggest week are training_run-stamped stats', () => {
    const out = composePersonalRecords(
      [],
      [
        run('a', { distanceMi: 20.1, movingTimeS: 10800, date: '2026-06-01', name: 'Long build' }),
        run('b', { distanceMi: 8.0, movingTimeS: 4000, date: '2026-06-02' }),
        run('c', { distanceMi: 6.0, movingTimeS: 3000, date: '2026-06-03' }),
      ],
    );
    expect(out.training.longestRun?.distanceMi).toBe(20.1);
    expect(out.training.longestRun?.source).toBe('training_run');
    // 2026-06-01 is a Monday → all three runs land in the same ISO week.
    expect(out.training.biggestWeek?.miles).toBe(34.1);
    expect(out.training.biggestWeek?.weekStartISO).toBe('2026-06-01');
    // and none of them created a "record" (20.1 mi is no bucket).
    expect(out.records.find((r) => r.key === 'marathon')).toBeUndefined();
  });
});
