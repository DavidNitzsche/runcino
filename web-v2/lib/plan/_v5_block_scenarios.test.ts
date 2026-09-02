/**
 * lib/plan/_v5_block_scenarios.test.ts · `GET /api/v5/block`'s
 * scenario-availability matrix — the part of `lib/plan/v5-block.ts` that is
 * checkable without a live plan and a database.
 *
 * `buildScenarios` itself (lib/plan/v5-block.ts) needs a real user with a
 * real plan, the same reason `_replan_scenarios.test.ts` tests
 * `cutbackLongTarget` / `reentryCeilingMi` in isolation rather than
 * `proposeChange` end to end. What IS pure here, and is exactly what this
 * route relies on for "is this scenario reachable at all":
 *
 *   1. `anotherRaceBlockGate` (lib/plan/replan-scenarios.ts) — the three
 *      structural gates on "another race" that hold regardless of which race
 *      gets picked. This is the SAME function `planAnotherRace` calls first,
 *      so a fixture that exercises the refusal here is a real refusal, not a
 *      re-implementation of one.
 *   2. `findMoveDayCandidate` (lib/plan/v5-block.ts) — picking a real
 *      (from, to) argument pair for `move_day`, and the honest "there is
 *      nothing to test" case when no pair exists.
 *   3. `libraryPhaseKey` (lib/plan/v5-block.ts) — the phase-label →
 *      workout-library `phaseFit` vocabulary mapping the catalogue filter
 *      depends on.
 */
import { describe, it, expect } from 'vitest';
import { anotherRaceBlockGate, type PlanShape } from './replan-scenarios';
import { findMoveDayCandidate, libraryPhaseKey, buildPanel, buildCoachLine, weekFlag, buildSoFar } from './v5-block';
import { planWeekFlags } from './generate';
import { pickPlanMode, buildOpensISO } from './goal-tiers';

// ── fixtures ─────────────────────────────────────────────────────────────

function day(over: Partial<PlanShape['weeks'][number]['days'][number]> = {}) {
  return {
    id: 'day-1', weekId: 'week-1', dateISO: '2026-09-01', dow: 2, type: 'easy',
    distanceMi: 5, isQuality: false, isLong: false, subLabel: null,
    paceTargetSPerMi: null, spec: null,
    ...over,
  };
}

function week(over: Partial<PlanShape['weeks'][number]> = {}): PlanShape['weeks'][number] {
  return {
    id: 'week-1', weekIdx: 0, startISO: '2026-08-31', endISO: '2026-09-06',
    phase: 'BASE', isRaceWeek: false, isCutback: false, days: [],
    ...over,
  };
}

function shape(over: Partial<PlanShape> = {}): PlanShape {
  return {
    planId: 'plan-1', userUuid: 'user-1', mode: 'race-prep',
    raceId: 'chicago-2026', goalISO: '2026-12-01', weeks: [],
    ...over,
  };
}

const TODAY = '2026-08-19';

// ── 1 · anotherRaceBlockGate — three real refusals, one real pass ──────────

describe('anotherRaceBlockGate · the structural checks that do not need a race picked yet', () => {
  it('refuses a block that is holding a base rather than building to a race', () => {
    const out = anotherRaceBlockGate(shape({ mode: 'maintenance' }), TODAY);
    expect('unavailable' in out).toBe(true);
    if ('unavailable' in out) {
      expect(out.unavailable).toMatch(/holding a base/);
    }
  });

  it('refuses inside the two-week race-week suppression window', () => {
    // 5 days out — inside suppressDriftNearRace's own 14-day line.
    const out = anotherRaceBlockGate(shape({ goalISO: '2026-08-24' }), TODAY);
    expect('unavailable' in out).toBe(true);
    if ('unavailable' in out) {
      expect(out.unavailable).toMatch(/last two weeks/);
    }
  });

  it('refuses a block with no target race to rebuild around', () => {
    const out = anotherRaceBlockGate(shape({ raceId: null }), TODAY);
    expect('unavailable' in out).toBe(true);
    if ('unavailable' in out) {
      expect(out.unavailable).toMatch(/no target/);
    }
  });

  it('passes a normal race-prep block outside the suppression window', () => {
    const out = anotherRaceBlockGate(shape(), TODAY);
    expect(out).toEqual({ ok: true });
  });

  it('agrees with proposeChange\'s own order: mode is checked before the suppression window', () => {
    // Both would fire; the mode check is first, so its message is the one
    // that comes back — matching planAnotherRace's own check order exactly
    // (anotherRaceBlockGate is that same code, extracted).
    const out = anotherRaceBlockGate(shape({ mode: 'maintenance', goalISO: '2026-08-24' }), TODAY);
    expect('unavailable' in out && out.unavailable).toMatch(/holding a base/);
  });
});

// ── 2 · findMoveDayCandidate — a real pair, or the honest absence of one ───

describe('findMoveDayCandidate · a representative argument for planMoveDay, not a rule', () => {
  it('finds a running day and a rest day in the same future week', () => {
    const s = shape({
      weeks: [
        week({
          id: 'w1', days: [
            day({ id: 'd-mon', dateISO: '2026-08-24', type: 'easy' }),
            day({ id: 'd-tue', dateISO: '2026-08-25', type: 'rest', distanceMi: 0 }),
          ],
        }),
      ],
    });
    const found = findMoveDayCandidate(s, TODAY);
    expect(found).toEqual({ from: '2026-08-24', to: '2026-08-25' });
  });

  it('prefers an easy day over the long or a quality session as the one that moves', () => {
    const s = shape({
      weeks: [
        week({
          id: 'w1', days: [
            day({ id: 'd-long', dateISO: '2026-08-23', type: 'long', isLong: true, distanceMi: 14 }),
            day({ id: 'd-quality', dateISO: '2026-08-24', type: 'threshold', isQuality: true, distanceMi: 6 }),
            day({ id: 'd-easy', dateISO: '2026-08-25', type: 'easy', distanceMi: 5 }),
            day({ id: 'd-rest', dateISO: '2026-08-26', type: 'rest', distanceMi: 0 }),
          ],
        }),
      ],
    });
    const found = findMoveDayCandidate(s, TODAY);
    expect(found?.from).toBe('2026-08-25'); // the easy day, not the long or the quality session
  });

  it('returns null when no future week pairs a running day with a rest day', () => {
    // Every day is already running · nowhere honest to move one into.
    const s = shape({
      weeks: [
        week({
          id: 'w1', days: [
            day({ id: 'd1', dateISO: '2026-08-24', type: 'easy' }),
            day({ id: 'd2', dateISO: '2026-08-25', type: 'easy' }),
          ],
        }),
      ],
    });
    expect(findMoveDayCandidate(s, TODAY)).toBeNull();
  });

  it('never returns a day that is today or in the past', () => {
    const s = shape({
      weeks: [
        week({
          id: 'w1', days: [
            day({ id: 'd-past', dateISO: '2026-08-15', type: 'easy' }),
            day({ id: 'd-rest-past', dateISO: '2026-08-16', type: 'rest', distanceMi: 0 }),
          ],
        }),
      ],
    });
    expect(findMoveDayCandidate(s, TODAY)).toBeNull();
  });
});

// ── 3 · libraryPhaseKey — the catalogue filter's vocabulary mapping ────────

describe('libraryPhaseKey · plan_phases.label → workout-library phaseFit', () => {
  it('maps every real phase label the engine emits', () => {
    expect(libraryPhaseKey('BASE', false)).toBe('base');
    expect(libraryPhaseKey('QUALITY', false)).toBe('quality');
    expect(libraryPhaseKey('RACE-SPECIFIC', false)).toBe('race_specific');
    expect(libraryPhaseKey('TAPER', false)).toBe('taper');
    expect(libraryPhaseKey('MAINTENANCE', false)).toBe('maintenance');
  });

  it('race week overrides whatever phase it sits inside', () => {
    expect(libraryPhaseKey('TAPER', true)).toBe('race_week');
    expect(libraryPhaseKey('RACE-SPECIFIC', true)).toBe('race_week');
  });

  it('an unrecognised label maps to null rather than a guess', () => {
    expect(libraryPhaseKey('SOMETHING-NEW', false)).toBeNull();
    expect(libraryPhaseKey(null, false)).toBeNull();
  });

  it('RECOVERY (generate.ts\'s post-race composer) has no phase_fit value of its own — null, not a guess', () => {
    expect(libraryPhaseKey('RECOVERY', false)).toBeNull();
  });
});

// ── 4 · the panel describes ONE week, and the coach line tells the truth ────
//
// Both added 2026-08-24. `buildPanel` derived its three stats from the
// plan_weeks row today falls inside while the week strip beneath it drew the
// runner's own training week, so on a block authored on a different grid the
// mileage stat and the strip were two different weeks (29.5 mi over a 31.0 mi
// strip, live, on 2026-08-24). And `buildCoachLine` told every MAINTENANCE
// runner "There is no block to build toward yet" — including the ones holding
// a goal race, named in the panel directly above the line.

type TrainingStateShape = import('@/lib/coach/training-state').TrainingState;

function windowDays(): TrainingStateShape['weekWindowDays'] {
  // The runner's week: Mon 2026-08-24 to Sun 2026-08-30 (Sunday long runs).
  const dates = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'];
  return dates.map((date, i) => ({
    id: `d${i}`, date, dow: new Date(date + 'T12:00:00Z').getUTCDay(),
    type: i === 6 ? 'long' : 'easy', mi: i === 6 ? 10 : 4, label: null,
    isQuality: i === 1, isLong: i === 6, spec: null,
    doneMi: 0, activityId: null, donePaceSec: null, doneAvgHr: null, adaptation: null,
  }));
}

function trainingState(over: Partial<TrainingStateShape> = {}): TrainingStateShape {
  const days = windowDays();
  return {
    plan_id: 'pln_x', today: '2026-08-26', race: null, phases: [],
    weeks: [{
      id: 'wk0', idx: 0, phase: 'QUALITY', startDate: '2026-08-24', plannedMi: 34,
      isRaceWeek: false, isCutback: false, days, isCurrent: true,
    }],
    currentPhase: 'QUALITY', currentWeekIdx: 0, currentWeekOrdinal: 1, nextQuality: null,
    weekDone: 12, weekPlanned: 34,
    weekWindow: { startISO: '2026-08-24', endISO: '2026-08-30' },
    weekWindowDays: days,
    last_adapted_at: null, horizonRaise: null, phaseAnswers: null,
    ...over,
  };
}

describe('buildSoFar · "Weeks in" counts, it does not do arithmetic on week_idx', () => {
  // ── David's phone, 2026-08-25 · Block read "Weeks in — 2 of 1" ──────────
  //
  // His active plan holds exactly one week, and that week carries
  // `week_idx = 1` because it is the surviving second week of a two-week
  // recovery plan. `currentWeekIdx + 1` therefore said two against a
  // denominator of one — a number that cannot exist.
  it('a single week carrying week_idx 1 is week 1 of 1, not 2 of 1', () => {
    const days = windowDays();
    const state = trainingState({
      weeks: [{
        id: 'wk_only', idx: 1, phase: 'RECOVERY', startDate: '2026-08-24', plannedMi: 38,
        isRaceWeek: false, isCutback: false, days, isCurrent: true,
      }],
      currentPhase: 'RECOVERY', currentWeekIdx: 1, currentWeekOrdinal: 1,
    });
    const weeksIn = buildSoFar(state).find((r) => r.id === 'weeks-in');
    expect(weeksIn?.value?.text).toBe('1 of 1');
  });

  it('the numerator never exceeds the denominator, whatever the stored indices are', () => {
    const days = windowDays();
    // Indices 4 and 5 — a block whose first three weeks were dropped.
    const state = trainingState({
      weeks: [
        { id: 'a', idx: 4, phase: 'BASE', startDate: '2026-08-17', plannedMi: 30,
          isRaceWeek: false, isCutback: false, days, isCurrent: false },
        { id: 'b', idx: 5, phase: 'BASE', startDate: '2026-08-24', plannedMi: 34,
          isRaceWeek: false, isCutback: false, days, isCurrent: true },
      ],
      currentWeekIdx: 5, currentWeekOrdinal: 2,
    });
    const weeksIn = buildSoFar(state).find((r) => r.id === 'weeks-in');
    expect(weeksIn?.value?.text).toBe('2 of 2');
  });

  it('off-plan reads zero rather than guessing', () => {
    const state = trainingState({ currentWeekIdx: null, currentWeekOrdinal: null });
    const weeksIn = buildSoFar(state).find((r) => r.id === 'weeks-in');
    expect(weeksIn?.value?.text).toBe('0 of 1');
  });
});

describe("buildPanel · the three stats describe the runner's week", () => {
  it('prints the window total, not the plan-week row total', () => {
    // The misalignment, reproduced: the plan_weeks row says 34 mi and the
    // runner's own seven days hold 41. The panel must print the seven days.
    const panel = buildPanel(trainingState({ weekPlanned: 41 }));
    const mileage = panel.stats.find((s) => s.label === "This week's mileage");
    expect(mileage?.value.text).toBe('41 mi');
  });

  it('takes the quality share and the long run from the same seven days as the mileage', () => {
    const panel = buildPanel(trainingState());
    // One quality day of 4 mi in a 34 mi week.
    expect(panel.stats.find((s) => s.label === 'Quality share')?.value.text).toBe('12%');
    expect(panel.stats.find((s) => s.label === 'Long run')?.value.text).toBe('10 mi');
  });

  it('a week with no designated long run says None rather than 0 mi', () => {
    const flat = windowDays().map((d) => ({ ...d, isLong: false }));
    const panel = buildPanel(trainingState({ weekWindowDays: flat }));
    expect(panel.stats.find((s) => s.label === 'Long run')?.value.text).toBe('None');
  });
});

describe('buildCoachLine · MAINTENANCE with a race on the calendar', () => {
  const HALF_MI = 13.1094;
  const maint = (raceDate: string | null) => trainingState({
    currentPhase: 'MAINTENANCE',
    race: raceDate
      ? {
          slug: 'sombrero', name: 'Sombrero Half', date: raceDate, goal: null,
          days_to_race: Math.round(
            (Date.parse(raceDate + 'T12:00:00Z') - Date.parse('2026-08-26T12:00:00Z')) / 86400000,
          ),
        }
      : null,
  });

  it('names the day the build opens instead of denying the race exists', () => {
    // Sixteen weeks out from a half, which is one of the three plan lengths
    // the native goal sheet offers, and outside BUILD_WINDOW_WEEKS.hm.
    const line = buildCoachLine(maint('2026-12-13'), HALF_MI) ?? '';
    expect(line).toContain('Sombrero Half');
    expect(line).toContain('opens');
    expect(line).not.toContain('no block to build toward');
    // Coach voice: no shouting, no em dash.
    expect(line).not.toMatch(/[!—]/);
  });

  it('the date it names is the day pickPlanMode itself flips to race-prep', () => {
    const opens = buildOpensISO('2026-08-26', '2026-12-13', HALF_MI);
    expect(opens).not.toBeNull();
    expect(pickPlanMode(opens!, '2026-12-13', HALF_MI, null, null)).toBe('race-prep');
    const dayBefore = new Date(Date.parse(opens! + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
    expect(pickPlanMode(dayBefore, '2026-12-13', HALF_MI, null, null)).toBe('maintenance');
  });

  it('says nothing new when the window is already open, and keeps the old line with no race', () => {
    expect(buildOpensISO('2026-08-26', '2026-09-27', HALF_MI)).toBeNull();
    expect(buildCoachLine(maint(null), null)).toContain('no block to build toward');
    // A race we cannot size (no distance on the row) falls back rather than
    // guessing at a category.
    expect(buildCoachLine(maint('2026-12-13'), null)).toContain('no block to build toward');
  });
});

// ── 5 · the taper is not a cutback ─────────────────────────────────────────
//
// `plan_weeks.is_cutback` marks a week that drops more than 15% off the one
// before, and a taper week always does — by design, that IS the taper. So
// every taper week landed in the column, and the Block screen's week flag
// checks cutback BEFORE the phase name. Live in production on 2026-08-24 on
// both plans that had reached a taper: three weeks between them, each showing
// "Cutback" with "RACE-SPECIFIC" on the week before, so the block did not say
// anywhere that the taper had begun.
//
// The app already had the rule and only ever applied it in one place:
// `proposeChange('cutback')` refuses a taper week with "The taper is already a
// cutback, and cutting it again would leave you flat on race day."

const wk = (phase: string, mi: number, isRaceWeek = false) => ({
  isRaceWeek, phase, days: [{ distanceMi: mi }],
});

describe('planWeekFlags · is_cutback and is_peak', () => {
  it('does not mark a taper week as a cutback, however far its volume drops', () => {
    const { isCutbackByWeek } = planWeekFlags([
      wk('QUALITY', 40), wk('QUALITY', 44), wk('RACE-SPECIFIC', 46),
      wk('TAPER', 32), wk('TAPER', 22), wk('TAPER', 12, true),
    ]);
    expect(isCutbackByWeek).toEqual([false, false, false, false, false, false]);
  });

  it('still marks a real deload inside the build', () => {
    const { isCutbackByWeek } = planWeekFlags([
      wk('BASE', 30), wk('BASE', 33), wk('BASE', 35), wk('BASE', 26),
      wk('QUALITY', 36),
    ]);
    expect(isCutbackByWeek).toEqual([false, false, false, true, false]);
  });

  it('never marks week 0, which has nothing to have dropped from', () => {
    const { isCutbackByWeek } = planWeekFlags([wk('BASE', 4), wk('BASE', 30)]);
    expect(isCutbackByWeek[0]).toBe(false);
  });

  it('marks the highest non-race week as the peak, earliest occurrence winning', () => {
    const { isPeakByWeek } = planWeekFlags([
      wk('QUALITY', 40), wk('RACE-SPECIFIC', 46), wk('RACE-SPECIFIC', 46),
      wk('TAPER', 30), wk('TAPER', 50, true),
    ]);
    expect(isPeakByWeek).toEqual([false, true, false, false, false]);
  });
});

describe('weekFlag · what the Block screen prints on a week row', () => {
  const week = (over: Partial<import('@/lib/coach/training-state').PlanWeek>) => ({
    id: 'w', idx: 0, phase: 'QUALITY', startDate: '2026-08-24', plannedMi: 30,
    isRaceWeek: false, isCutback: false, days: [], isCurrent: false,
    ...over,
  } as import('@/lib/coach/training-state').PlanWeek);

  it('says TAPER on a taper week even when the stored column says cutback', () => {
    // The two live plans on 2026-08-24 carry exactly this row.
    expect(weekFlag(week({ phase: 'TAPER', isCutback: true }))).toBe('TAPER');
  });

  it('keeps the order that matters above it', () => {
    expect(weekFlag(week({ phase: 'TAPER', isCutback: true, isCurrent: true }))).toBe('This week');
    expect(weekFlag(week({ phase: 'TAPER', isCutback: true, isRaceWeek: true }))).toBe('Race week');
    expect(weekFlag(week({ phase: 'QUALITY', isCutback: true }))).toBe('Cutback');
    expect(weekFlag(week({ phase: 'BASE' }))).toBe('BASE');
  });
});

describe('the block that has finished', () => {
  it('says so, instead of narrating a phase that is over', () => {
    // The state one production plan was in on 2026-08-24: last prescribed day
    // 2026-08-22, still the active plan.
    const ended = trainingState({
      today: '2026-08-24',
      weeks: [{
        id: 'w0', idx: 0, phase: 'QUALITY', startDate: '2026-08-16', plannedMi: 20,
        isRaceWeek: false, isCutback: false, days: [], isCurrent: false,
      }],
      weekPlanned: null,
      weekWindowDays: [],
    });
    const line = buildCoachLine(ended, null) ?? '';
    expect(line).toContain('finished');
    expect(line).not.toContain('Hit the quality sessions');
    expect(line).not.toMatch(/[!\u2014]/);
  });

  it("does not print a prescription of zero for a week the block does not reach", () => {
    const ended = trainingState({ weekPlanned: null, weekWindowDays: [] });
    const panel = buildPanel(ended);
    expect(panel.stats.find((x) => x.label === "This week's mileage")?.value.text).toBe('None');
  });

  it('a block still running narrates its phase as before', () => {
    const line = buildCoachLine(trainingState(), null) ?? '';
    expect(line).toContain('Hit the quality sessions');
  });
});
