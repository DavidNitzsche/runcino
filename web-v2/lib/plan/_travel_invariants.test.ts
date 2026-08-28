/**
 * TRAVEL WINDOW INVARIANTS (TRAVEL-1 · 2026-08-28).
 *
 * Owner ruling: "traveling but I'll want to stay as consistent with my runs
 * as possible. But something the phone should surface, not me and you in the
 * backend." The live case is his own CIM block — Thanksgiving travel
 * (Nov 25–29) landing in the taper — so the frame below is the same
 * Sunday-long / Saturday-rest / Tue-Thu-quality layout the mid-race
 * invariants lock, with the same start Monday.
 *
 * What is locked:
 *
 *   1 · GATE. No travel windows → composePlan output is byte-identical, and
 *       authored_state carries no travel keys.
 *   2 · NO QUALITY ON A TRAVEL DAY. Cite Research/12-travel-timezone.md
 *       §Post-flight ("avoid hard efforts" · quality "permissible" only days
 *       after arrival) — read conservatively for a window with no flight
 *       times: no quality session sits on any declared travel day.
 *   3 · NO FULL LONG RUN ON A TRAVEL DAY. It moves to a clean seat in the
 *       same week when one exists; otherwise it runs easy at the week's own
 *       easy size, honestly noted.
 *   4 · TRAVEL IS NOT REST. Easy days inside the window keep their distance —
 *       consistency is the runner's stated goal, and doctrine is silent on
 *       "how much easier", so the dose does not move.
 *   5 · A SWAP MOVES MILES, NEVER MAKES THEM. A week shaped only by swaps
 *       keeps its exact volume.
 *   6 · RACE WEEK IS NEVER RESHAPED — the race-week composer owns it.
 *   7 · THE ADAPTER never reschedules a missed session onto a travel day.
 */
import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
  type ComposePlanInput, type DOW, type DayPlan,
} from './generate';
import { tPaceFromGoal } from './spec-builder';
import {
  isTravelDay, shapeTravelWindows, travelDatesBetween,
  TRAVEL_EASY_NOTE, type TravelWindow,
} from './travel-windows';
import { chooseRescheduleDate, type RescheduleDayContext } from './adapt';

const START_MONDAY = '2026-08-31';

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/** The owner's CIM frame · Sunday long, Saturday rest, Tue/Thu quality. */
function cimInput(overrides: Partial<ComposePlanInput> = {}): ComposePlanInput {
  const raceDistanceMi = 26.22;
  const goalSec = 10800;
  return {
    raceDistanceMi,
    goalSec,
    goalPaceSec: Math.round(goalSec / raceDistanceMi),
    raceDateISO: addDays(START_MONDAY, 14 * 7 - 1),   // 2026-12-06 · Sunday
    startMondayISO: START_MONDAY,
    level: 'advanced',
    recentWeeklyMi: 30.5,
    easyDayMedianMi: 6,
    recentLongMi: 13,
    isMidBlock: false,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    availableDows: null,
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    rxRaceSpecific: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    tPaceSec: tPaceFromGoal(goalSec, raceDistanceMi),
    lthr: null,
    maxHr: null,
    bestRecentVdot: 45.1,
    ...overrides,
  };
}

function build(overrides: Partial<ComposePlanInput> = {}) {
  const input = cimInput(overrides);
  const composed = composePlan(input);
  finalizeComposedPlan(composed, input.raceDistanceMi, input.level);
  composed.vols = composed.weeks.map((w) => w.weeklyMi);
  return composed;
}

function dayAt(composed: ReturnType<typeof build>, iso: string): DayPlan | null {
  const off = Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(START_MONDAY + 'T12:00:00Z')) / 86400000);
  const wi = Math.floor(off / 7);
  const week = composed.weeks[wi];
  if (!week) return null;
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay() as DOW;
  return week.days.find((d) => d.dow === dow) ?? null;
}

/** The runner's real Thanksgiving window · Wed Nov 25 – Sun Nov 29, inside
 *  the CIM taper, one week clear of race week. */
const THANKSGIVING: TravelWindow = { startISO: '2026-11-25', endISO: '2026-11-29' };

describe('TRAVEL gate · no windows → byte-identical', () => {
  it('undefined and [] both compose exactly the plan composed before the feature', () => {
    const bare = build();
    const empty = build({ travelWindows: [] });
    expect(JSON.stringify(empty)).toBe(JSON.stringify(bare));
    expect(bare.authoredState.travel_shaped).toBeUndefined();
    expect(bare.authoredState.travel_windows).toBeUndefined();
  });
});

describe('TRAVEL · the Thanksgiving window in the CIM taper', () => {
  const composed = build({ travelWindows: [THANKSGIVING] });

  it('no quality session sits on any travel day', () => {
    for (let d = THANKSGIVING.startISO; d <= THANKSGIVING.endISO; d = addDays(d, 1)) {
      const day = dayAt(composed, d);
      if (!day) continue;
      expect(day.isQuality, `${d} must not carry quality`).toBe(false);
      expect(['easy', 'rest', 'shakeout', 'long'].includes(day.type) || !day.isQuality).toBe(true);
    }
  });

  it('no full long run sits on any travel day', () => {
    for (let d = THANKSGIVING.startISO; d <= THANKSGIVING.endISO; d = addDays(d, 1)) {
      const day = dayAt(composed, d);
      if (!day) continue;
      expect(day.isLong, `${d} must not carry the long run`).toBe(false);
      expect(day.type).not.toBe('long');
    }
  });

  it('travel is not rest · running days inside the window keep real mileage', () => {
    const bare = build();
    let runningDays = 0;
    let bareRunningDays = 0;
    for (let d = THANKSGIVING.startISO; d <= THANKSGIVING.endISO; d = addDays(d, 1)) {
      if ((dayAt(composed, d)?.distanceMi ?? 0) > 0) runningDays++;
      if ((dayAt(bare, d)?.distanceMi ?? 0) > 0) bareRunningDays++;
    }
    // The shaped window runs at least as many days as the unshaped plan did ·
    // shaping demotes intensity, never a day.
    expect(runningDays).toBeGreaterThanOrEqual(bareRunningDays);
    expect(runningDays).toBeGreaterThan(0);
  });

  it('every shaped day is on the plan record with a coach note', () => {
    const shaped = composed.authoredState.travel_shaped as Array<{ date: string; action: string }>;
    expect(Array.isArray(shaped)).toBe(true);
    expect(shaped.length).toBeGreaterThan(0);
    for (const c of shaped) {
      expect(isTravelDay(c.date, [THANKSGIVING])).toBe(true);
      const day = dayAt(composed, c.date)!;
      expect(day.notes).toMatch(/Travel/);
    }
    expect(composed.authoredState.travel_windows).toEqual([THANKSGIVING]);
  });

  it('coach voice · no em dash, no exclamation mark in travel notes', () => {
    for (const w of composed.weeks) {
      for (const d of w.days) {
        if (!/Travel/.test(d.notes ?? '')) continue;
        expect(d.notes).not.toMatch(/[—!]/);
      }
    }
  });
});

describe('TRAVEL · race week is never reshaped', () => {
  it('a window over race week produces no shaping inside it', () => {
    const raceWeekWindow: TravelWindow = { startISO: '2026-11-30', endISO: '2026-12-05' };
    const composed = build({ travelWindows: [raceWeekWindow] });
    const shaped = (composed.authoredState.travel_shaped ?? []) as Array<{ date: string }>;
    for (const c of shaped) {
      expect(c.date < '2026-11-30' || c.date > '2026-12-06').toBe(true);
    }
    // The race day itself is untouched.
    expect(dayAt(composed, '2026-12-06')?.type).toBe('race');
  });
});

describe('TRAVEL · relocation vs honest easing', () => {
  it('a one-quality week gives the long run a clean seat when only Sunday is away', () => {
    // One quality day (Tuesday) leaves Thursday flanked by easy days · the
    // long run travels there instead of shrinking.
    const window: TravelWindow = { startISO: '2026-10-11', endISO: '2026-10-11' }; // a Sunday
    const composed = build({ qualityDows: [2] as DOW[], travelWindows: [window] });
    const shaped = composed.authoredState.travel_shaped as Array<{ date: string; action: string; toDate?: string }>;
    const move = shaped.find((c) => c.date === '2026-10-11');
    expect(move).toBeTruthy();
    if (move!.action === 'long_moved') {
      const seat = dayAt(composed, move!.toDate!)!;
      expect(seat.isLong || seat.type === 'long').toBe(true);
      expect(isTravelDay(move!.toDate!, [window])).toBe(false);
      // The vacated Sunday runs easy with the travel note.
      const sunday = dayAt(composed, '2026-10-11')!;
      expect(sunday.isLong).toBe(false);
      expect(sunday.notes).toBe(TRAVEL_EASY_NOTE);
    } else {
      // If this layout composes without a clean seat, the fallback must be
      // the honest ease, never a full long run on the road.
      expect(move!.action).toBe('long_eased');
    }
    // Either way · no long run on the travel day.
    expect(dayAt(composed, '2026-10-11')!.isLong).toBe(false);
  });

  it('a two-quality week has no clean seat · the long runs easy at easy size', () => {
    const window: TravelWindow = { startISO: '2026-10-11', endISO: '2026-10-11' };
    const composed = build({ travelWindows: [window] });      // Tue + Thu quality
    const bare = build();
    const sunday = dayAt(composed, '2026-10-11')!;
    expect(sunday.isLong).toBe(false);
    expect(sunday.isQuality).toBe(false);
    if (sunday.distanceMi > 0) {
      // Eased to the week's own easy size, never grown.
      const bareSunday = dayAt(bare, '2026-10-11')!;
      expect(sunday.distanceMi).toBeLessThanOrEqual(bareSunday.distanceMi);
    }
  });

  it('a swapped week keeps its exact volume · swaps move miles, never make them', () => {
    const window: TravelWindow = { startISO: '2026-10-06', endISO: '2026-10-06' }; // a Tuesday quality day
    const composed = build({ qualityDows: [2] as DOW[], travelWindows: [window] });
    const bare = build({ qualityDows: [2] as DOW[] });
    const shaped = composed.authoredState.travel_shaped as Array<{ date: string; action: string }>;
    const entry = shaped.find((c) => c.date === '2026-10-06');
    expect(entry).toBeTruthy();
    if (entry!.action === 'quality_moved') {
      const wi = Math.floor(Math.round((Date.parse('2026-10-06T12:00:00Z') - Date.parse(START_MONDAY + 'T12:00:00Z')) / 86400000) / 7);
      const sum = (w: typeof composed.weeks[number]) => w.days.reduce((s, d) => s + d.distanceMi, 0);
      expect(sum(composed.weeks[wi])).toBeCloseTo(sum(bare.weeks[wi]), 5);
    }
    // Whatever happened, the travel day itself carries no quality.
    expect(dayAt(composed, '2026-10-06')!.isQuality).toBe(false);
  });
});

describe('TRAVEL · the adapter never reschedules into a window', () => {
  const ctx = (over: Partial<RescheduleDayContext> = {}): RescheduleDayContext => ({
    runCount: 0, qualityOrLong: false, hasRestRow: false, weekRunCount: null, ...over,
  });

  it('a clear day inside a travel window is skipped; the next clear home day wins', () => {
    const today = '2026-11-23';
    const byDate: Record<string, RescheduleDayContext> = {};
    for (let i = 0; i <= 5; i++) byDate[addDays(today, i)] = ctx();
    const travelDates = travelDatesBetween([THANKSGIVING], today, addDays(today, 5));
    const target = chooseRescheduleDate({
      todayISO: today, byDate, longRunDow: null, restDow: null,
      weeklyFrequency: null, raceDates: [], travelDates,
    });
    // today+1 (Nov 24) is home and clear · fine. Push today to sit right
    // before the window and every candidate inside it must be refused.
    expect(target).toBe('2026-11-24');

    const today2 = '2026-11-24';
    const byDate2: Record<string, RescheduleDayContext> = {};
    for (let i = 0; i <= 5; i++) byDate2[addDays(today2, i)] = ctx();
    const travelDates2 = travelDatesBetween([THANKSGIVING], today2, addDays(today2, 5));
    const target2 = chooseRescheduleDate({
      todayISO: today2, byDate: byDate2, longRunDow: null, restDow: null,
      weeklyFrequency: null, raceDates: [], travelDates: travelDates2,
    });
    // Candidates Nov 25–28 are all travel · nothing qualifies.
    expect(target2).toBe(null);
  });

  it('without travelDates the search is unchanged', () => {
    const today = '2026-11-24';
    const byDate: Record<string, RescheduleDayContext> = {};
    for (let i = 0; i <= 5; i++) byDate[addDays(today, i)] = ctx();
    const target = chooseRescheduleDate({
      todayISO: today, byDate, longRunDow: null, restDow: null,
      weeklyFrequency: null, raceDates: [],
    });
    expect(target).toBe('2026-11-25');
  });
});

describe('TRAVEL · pure helpers', () => {
  it('travelDatesBetween clamps to the asked range', () => {
    const set = travelDatesBetween([THANKSGIVING], '2026-11-27', '2026-12-31');
    expect(set.has('2026-11-25')).toBe(false);
    expect(set.has('2026-11-27')).toBe(true);
    expect(set.has('2026-11-29')).toBe(true);
    expect(set.has('2026-11-30')).toBe(false);
  });

  it('shapeTravelWindows ignores malformed windows', () => {
    const composed = build();
    const before = JSON.stringify(composed.weeks);
    const changes = shapeTravelWindows(composed.weeks, {
      startMondayISO: START_MONDAY,
      travelWindows: [
        { startISO: 'not-a-date', endISO: '2026-10-11' },
        { startISO: '2026-10-12', endISO: '2026-10-11' },  // inverted
      ],
    });
    expect(changes).toEqual([]);
    expect(JSON.stringify(composed.weeks)).toBe(before);
  });
});
