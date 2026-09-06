/**
 * THE SCHEDULED EVALUATION, TESTED PURE.
 *
 * WHAT THIS ASSERTS
 *   · "Complete demand": a week is never priced until every one of its days
 *     has elapsed. Falsified on purpose (see the test that walks the day
 *     boundary) so a future edit that loosens this back to a partial read
 *     fails here first.
 *   · The declared race-priority mapping matches `Research/00b`'s own A/B/C
 *     table, reusing `lib/race/effort-authority.ts`'s graded-priority set
 *     rather than a second copy of it.
 *   · The pure boundary-1 composition (readings → `priceWeek` →
 *     `demandBaseline` → `boundaryBeforeWeek`) reproduces the SAME worked
 *     example `_rolling_boundary.test.ts` already prices, off readings shaped
 *     like what `readCompletedWeek` actually returns — proving the plumbing
 *     between "real reading" and "the existing, already-proven decision
 *     function" carries the numbers through unchanged.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22)
 *   · Whether `mileageByDay` or `plan_workouts` themselves are correct — this
 *     tests the composition, not the underlying primitives, which carry their
 *     own tests.
 *   · Whether boundary 2's absorbed-grade gap ever closes — `readAbsorbedGrade`
 *     is asserted to return `null` today, which is the honest, stated state
 *     the module header names, not a promise about tomorrow.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateBoundary1FromReadings, raceEffortFromDeclaredPriority, readAbsorbedGrade,
  ROLLING_BOUNDARY_ALLOWED_STEP_SHARE, type CompletedWeekReading,
} from './rolling-boundary-evaluator';
import { priceWeek } from './rolling-boundary';

const never = false;

// Shaped exactly like `readCompletedWeek`'s real return value.
const reading = (
  weekStartISO: string, weeklyMi: number, longRunMi: number, qualityMinutes: number,
  prescribedMi: number, weekEndISO: string, isPrescribedDip = never,
): CompletedWeekReading => ({
  weekStartISO, weeklyMi, longRunMi, qualityMinutes, prescribedMi, isPrescribedDip, weekEndISO,
});

describe('rolling-boundary-evaluator · complete demand, not a partial read', () => {
  const trailing: CompletedWeekReading[] = [
    reading('2026-08-31', 46.5, 15, 102, 46.5, '2026-09-06'),
    reading('2026-09-07', 24.4, 6.2, 87, 24.4, '2026-09-13'),
    reading('2026-09-14', 46.8, 16.5, 65, 46.8, '2026-09-20'),
  ];
  const proposed = priceWeek({ weekStartISO: '2026-09-21', weeklyMi: 55.2, longRunMi: 17, qualityMinutes: 110 });

  it('reproduces the worked example\'s demand step, priced against the REAL 10% rule', () => {
    const d = evaluateBoundary1FromReadings({
      trailing, proposed, todayISO: '2026-09-20',
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22',
    });
    // completionRatio = 46.8/46.8 = 1.0, so the allowance is the FULL 10%
    // (`ROLLING_BOUNDARY_ALLOWED_STEP_SHARE`) — and the real 14.1% demand
    // step is past it. `_rolling_boundary.test.ts` illustrates this same week
    // PROCEEDING under an 0.15 example share; wiring the app's own §14 10%
    // rule (not the test file's illustrative 0.15) changes the verdict, which
    // is exactly the kind of thing a real reader has to surface honestly
    // rather than pick whichever constant makes the example look clean.
    expect(d.verdict).toBe('REDUCE');
    expect(d.because).toContain('14.1%');
    expect(d.because).toContain('10.0%');
  });

  it('FALSIFIED ON PURPOSE · refuses the day BEFORE the preceding week has fully elapsed', () => {
    const d = evaluateBoundary1FromReadings({
      trailing, proposed, todayISO: '2026-09-19', // one day short of weekEndISO 2026-09-20
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22',
    });
    expect(d.verdict).toBe('REFUSE');
    expect(d.because).toContain('has not fully elapsed');
  });

  it('proceeds to a real verdict exactly ON the day the preceding week completes (no off-by-one)', () => {
    const d = evaluateBoundary1FromReadings({
      trailing, proposed, todayISO: '2026-09-20', // == weekEndISO, the week is now complete
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22',
    });
    expect(d.verdict).not.toBe('REFUSE');
  });

  it('a hair short of full completion still reduces continuously, not off a cliff (Rule 9)', () => {
    const partial = [...trailing];
    partial[2] = reading('2026-09-14', 46.8 * 0.5, 16.5, 65, 46.8, '2026-09-20');
    const d = evaluateBoundary1FromReadings({
      trailing: partial, proposed, todayISO: '2026-09-20',
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22',
    });
    expect(d.verdict).toBe('REDUCE');
    expect(d.mutation?.newType).toBe('easy');
  });

  it('no trailing week at all refuses rather than defaulting to a step', () => {
    const d = evaluateBoundary1FromReadings({
      trailing: [], proposed, todayISO: '2026-09-20',
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22',
    });
    expect(d.verdict).toBe('REFUSE');
  });

  it('the step allowance is the app\'s own §14 10% rule, imported not retyped', () => {
    expect(ROLLING_BOUNDARY_ALLOWED_STEP_SHARE).toBeCloseTo(0.10, 5);
  });
});

describe('rolling-boundary-evaluator · declared race priority, Research/00b\'s own table', () => {
  it('A is a true race, B is threshold-like, C is controlled', () => {
    expect(raceEffortFromDeclaredPriority('A')).toBe('TRUE_RACE');
    expect(raceEffortFromDeclaredPriority('B')).toBe('THRESHOLD_LIKE');
    expect(raceEffortFromDeclaredPriority('C')).toBe('CONTROLLED_C');
  });

  it('lower-case and whitespace are tolerated, the same as the priority is stored', () => {
    expect(raceEffortFromDeclaredPriority(' a ')).toBe('TRUE_RACE');
    expect(raceEffortFromDeclaredPriority('c')).toBe('CONTROLLED_C');
  });

  it('an ungraded or missing priority is UNRELIABLE, not defaulted to a race', () => {
    expect(raceEffortFromDeclaredPriority(null)).toBe('UNRELIABLE');
    expect(raceEffortFromDeclaredPriority(undefined)).toBe('UNRELIABLE');
    expect(raceEffortFromDeclaredPriority('training_run')).toBe('UNRELIABLE');
  });
});

describe('rolling-boundary-evaluator · boundary 2\'s stated, honest gap', () => {
  it('readAbsorbedGrade returns null today — an honest stub, not a fabricated grade', async () => {
    await expect(readAbsorbedGrade('any-user', '2026-09-22')).resolves.toBeNull();
  });
});
