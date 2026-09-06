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
  ROLLING_BOUNDARY_REASON_CODES, type CompletedWeekReading,
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

// A clean phase/runway pairing — an ordinary build week with the block
// running well past it. Most tests below use this; the ones demonstrating
// context sensitivity override it explicitly.
const OPEN_PHASE = { trainingPhaseOpenness: 1, runwayOpenness: 1 } as const;

describe('rolling-boundary-evaluator · complete demand, not a partial read', () => {
  const trailing: CompletedWeekReading[] = [
    reading('2026-08-31', 46.5, 15, 102, 46.5, '2026-09-06'),
    reading('2026-09-07', 24.4, 6.2, 87, 24.4, '2026-09-13'),
    reading('2026-09-14', 46.8, 16.5, 65, 46.8, '2026-09-20'),
  ];
  const proposed = priceWeek({ weekStartISO: '2026-09-21', weeklyMi: 55.2, longRunMi: 17, qualityMinutes: 110 });

  it('reproduces the worked example\'s demand step as an EARNABLE PUSH, not an automatic reduction', () => {
    const d = evaluateBoundary1FromReadings({
      trailing, proposed, todayISO: '2026-09-20',
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22', ...OPEN_PHASE,
    });
    // 2026-09-06 ruling: "the 9/21 week at +14.1% demand remains an earnable,
    // lower-confidence PUSH — not an automatic reduction." All three trailing
    // weeks here read fully completed (no dips flagged), the proposed week is
    // an ordinary build week with ample runway, and fatigue/safety reads the
    // honest neutral (no reader wired) — which is enough context to clear
    // `DEMAND_STEP_PUSH_CONFIDENCE_FLOOR` even though the growth itself
    // (14.1%) sits inside the soft 10-15% band. This REPLACES the
    // 2026-09-05 version of this test, which asserted REDUCE off a single
    // flat 10% allowance (`RERAMP_WEEKLY_GROWTH - 1`) the owner has since
    // ruled out by name as the wrong citation for this question.
    expect(d.verdict).toBe('PROCEED');
    expect(d.because).toContain('14.1%');
  });

  it('the SAME growth step reduces once the surrounding context is genuinely poor', () => {
    // Same trailing reads, same proposed week — only the phase/runway/fatigue
    // context degrades. Proves the confidence model is actually reading
    // context, not just growth.
    const d = evaluateBoundary1FromReadings({
      trailing, proposed, todayISO: '2026-09-20',
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22',
      trainingPhaseOpenness: 0.2, runwayOpenness: 0.2, fatigueSafetyClearance: 0.2,
    });
    expect(d.verdict).toBe('REDUCE');
    expect(d.mutation?.newType).toBe('easy');
  });

  it('FALSIFIED ON PURPOSE · refuses the day BEFORE the preceding week has fully elapsed', () => {
    const d = evaluateBoundary1FromReadings({
      trailing, proposed, todayISO: '2026-09-19', // one day short of weekEndISO 2026-09-20
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22', ...OPEN_PHASE,
    });
    expect(d.verdict).toBe('REFUSE');
    expect(d.because).toContain('has not fully elapsed');
  });

  it('proceeds to a real verdict exactly ON the day the preceding week completes (no off-by-one)', () => {
    const d = evaluateBoundary1FromReadings({
      trailing, proposed, todayISO: '2026-09-20', // == weekEndISO, the week is now complete
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22', ...OPEN_PHASE,
    });
    expect(d.verdict).not.toBe('REFUSE');
  });

  it('a partly-completed trailing week still lets confidence move CONTINUOUSLY, and the surrounding '
    + 'context decides whether that is enough to still proceed (Rule 9)', () => {
    // Same partial completion (40% of the last trailing week), two different
    // surrounding contexts. This is the redesign's whole point: one bad week
    // out of three does not by itself cliff the verdict — what it does is
    // move confidence, continuously, and the rest of the picture decides
    // whether that movement crosses the bar.
    const partial = [...trailing];
    partial[2] = reading('2026-09-14', 46.8 * 0.4, 16.5, 65, 46.8, '2026-09-20');

    const withCleanSurroundings = evaluateBoundary1FromReadings({
      trailing: partial, proposed, todayISO: '2026-09-20',
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22',
      trainingPhaseOpenness: 1, runwayOpenness: 1, fatigueSafetyClearance: 1,
    });
    expect(withCleanSurroundings.verdict).toBe('PROCEED');

    const withPoorSurroundings = evaluateBoundary1FromReadings({
      trailing: partial, proposed, todayISO: '2026-09-20',
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22',
      trainingPhaseOpenness: 0.3, runwayOpenness: 0.3, fatigueSafetyClearance: 0.3,
    });
    expect(withPoorSurroundings.verdict).toBe('REDUCE');
    expect(withPoorSurroundings.mutation?.newType).toBe('easy');
  });

  it('no trailing week at all refuses rather than defaulting to a step', () => {
    const d = evaluateBoundary1FromReadings({
      trailing: [], proposed, todayISO: '2026-09-20',
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22', ...OPEN_PHASE,
    });
    expect(d.verdict).toBe('REFUSE');
  });

  it('fatigue/safety defaults to the honest neutral, never silently to "clean"', () => {
    // Same everything as the acceptance case, but ask what happens with the
    // WORST possible fatigue/safety reading (0) versus the default neutral
    // (0.5, used when the arg is omitted) — the default must sit strictly
    // between "assumed clean" (1) and "assumed dangerous" (0), per Rule 11.
    const withDefault = evaluateBoundary1FromReadings({
      trailing, proposed, todayISO: '2026-09-20',
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22', ...OPEN_PHASE,
    });
    const withAssumedClean = evaluateBoundary1FromReadings({
      trailing, proposed, todayISO: '2026-09-20',
      targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22', ...OPEN_PHASE,
      fatigueSafetyClearance: 1,
    });
    expect(withDefault.verdict).toBe('PROCEED');
    expect(withAssumedClean.verdict).toBe('PROCEED');
    // The default must not be AS forgiving as assumed-clean — both land on
    // PROCEED for this particular week, but the confidence text itself must
    // differ, which is what actually proves the default is not silently 1.0.
    expect(withDefault.because).not.toEqual(withAssumedClean.because);
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

describe('rolling-boundary-evaluator · the three reason codes, one shared definition', () => {
  it('names exactly the three rolling boundaries — no fourth, no typo drift', () => {
    expect([...ROLLING_BOUNDARY_REASON_CODES].sort()).toEqual(
      ['long_run_after_race', 'weekend_after_quality', 'week_demand_step'].sort(),
    );
  });
});
