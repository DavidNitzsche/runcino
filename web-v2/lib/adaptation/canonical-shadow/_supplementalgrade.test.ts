/**
 * lib/adaptation/canonical-shadow/_supplementalgrade.test.ts · falsification
 * suite for SUPPLEMENTALGRADE-1 (Rule 18).
 *
 * `buildPrescriptionRunMatches` (`live-input.ts`) is pure — no `pool`, no
 * `roQuery` — so every case here drives it directly with hand-built
 * `PlanWorkoutRow`/`GradingRunRow` fixtures. Test 1 is the falsifier the
 * defect was found from: it was run against the PRE-FIX shape
 * (`runData.find((r) => r.dateISO === w.date_iso)`, a same-date match with
 * no identity check) and FAILED there — `matches.get('pw_tempo')` returned
 * `'run_shakeout'`, the supplemental run, because it was first in the fixture
 * array and the pre-fix code never looked past the date. It passes now
 * because `buildPrescriptionRunMatches` routes through `classifyDay`
 * (`lib/execution/day-resolver.ts`), the one EXACT/LEGACY/SUPPLEMENTAL
 * resolver, instead of a raw date match.
 *
 * ── RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ────────────────────────────────
 *
 * It exercises `classifyDay`'s EXACT/LEGACY/SUPPLEMENTAL rule only through
 * this one caller's translation into `PrescribedRow`/`RunRow` shapes — it does
 * not re-prove `classifyDay` itself (`_day_resolver.test.ts` and
 * `_identity_truth_table.test.ts` own that), and it cannot see a bug in
 * `readPlanWorkouts`/`readRecentRuns`'s own SQL, which needs a live database
 * and is out of reach for a suite that must pass on a clean checkout.
 */
import { describe, it, expect } from 'vitest';
import { buildPrescriptionRunMatches, type PlanWorkoutRow, type GradingRunRow } from './live-input';
import type { RunData } from '@/lib/runs/run-shape';

function workout(overrides: Partial<PlanWorkoutRow> = {}): PlanWorkoutRow {
  return {
    id: 'pw_tempo',
    week_id: null,
    date_iso: '2026-09-01',
    type: 'tempo',
    distance_mi: 9.5,
    pace_target_s_per_mi: null,
    workout_spec: null,
    is_quality: true,
    is_long: false,
    sub_label: null,
    ...overrides,
  };
}

function run(id: string, dateISO: string, data: Partial<RunData> = {}): GradingRunRow {
  return { id, dateISO, d: { distanceMi: 3, ...data } as RunData };
}

describe('SUPPLEMENTALGRADE-1 · a same-date run is never mistaken for the prescription’s execution', () => {
  it('THE FALSIFIER · picks the EXACT-stamped run over a same-date supplemental, whatever order the fetch returned them in', () => {
    const w = workout();
    // Listed FIRST on purpose — this is exactly the shape that made the
    // pre-fix `runData.find((r) => r.dateISO === w.date_iso)` return the
    // wrong run: a shakeout that happens to sort ahead of the run that
    // actually executed the prescription.
    const supplemental = run('run_shakeout', '2026-09-01', { distanceMi: 3.1 });
    const exact = run('run_tempo', '2026-09-01', { distanceMi: 9.6, planWorkoutId: 'pw_tempo' });

    const matches = buildPrescriptionRunMatches([w], [supplemental, exact]);
    expect(matches.get('pw_tempo')).toBe('run_tempo');
  });

  it('never invents a match for a bare same-date run that never claimed the prescription (no exact/legacy stamp)', () => {
    const w = workout({ id: 'pw_tempo2', date_iso: '2026-09-02' });
    const supplementalOnly = run('run_shakeout2', '2026-09-02', { distanceMi: 4 });

    const matches = buildPrescriptionRunMatches([w], [supplementalOnly]);
    expect(matches.has('pw_tempo2')).toBe(false);
  });

  it('still matches a LEGACY run (live-tracked source, single prescription of that type that day, no stamped id)', () => {
    const w = workout({ id: 'pw_easy', date_iso: '2026-09-03', type: 'easy', is_quality: false });
    const legacyMatch = run('run_easy', '2026-09-03', {
      distanceMi: 6,
      source: 'watch',
      workoutType: 'easy',
      workoutTypeSource: 'plan',
    });

    const matches = buildPrescriptionRunMatches([w], [legacyMatch]);
    expect(matches.get('pw_easy')).toBe('run_easy');
  });

  it('refuses to guess when two same-type prescriptions land on one date — a tie is not a name', () => {
    const w1 = workout({ id: 'pw_a', date_iso: '2026-09-04', type: 'tempo' });
    const w2 = workout({ id: 'pw_b', date_iso: '2026-09-04', type: 'tempo' });
    // pw_a's run carries an unambiguous EXACT id stamp, so it still resolves
    // even with a same-type sibling that day; pw_b has nothing claiming it
    // and must not be filled in by a type guess.
    const stamped = run('run_1', '2026-09-04', { distanceMi: 8, planWorkoutId: 'pw_a' });

    const matches = buildPrescriptionRunMatches([w1, w2], [stamped]);
    expect(matches.get('pw_a')).toBe('run_1');
    expect(matches.has('pw_b')).toBe(false);
  });

  it('is a per-date resolution — a run on a different date never satisfies a different day’s prescription', () => {
    const w = workout({ id: 'pw_x', date_iso: '2026-09-05' });
    const wrongDayRun = run('run_wrong_day', '2026-09-06', { distanceMi: 9.5, planWorkoutId: 'pw_x' });

    // Same as production: `readRecentRuns` returns a window, not just one
    // day, so a stale/mis-stamped id from a neighbouring date must not leak
    // into this date's resolution.
    const matches = buildPrescriptionRunMatches([w], [wrongDayRun]);
    expect(matches.has('pw_x')).toBe(false);
  });
});
