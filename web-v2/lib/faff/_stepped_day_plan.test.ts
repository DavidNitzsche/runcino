/**
 * lib/faff/_stepped_day_plan.test.ts — a day outside this week still has a plan.
 *
 * `loadGlanceState` takes no date. Its `weekDays` is always the CURRENT
 * training week, and the route read the day's plan out of it by matching the
 * requested date. Step the week strip forward and that match fails, the plan
 * falls through to null, and the composer renders REST with "no specific plan
 * today · run by feel" — on a plan with a seven-mile long run on that date.
 *
 * Backwards worked, but only by accident: a stepped-to day inside the current
 * week is still in `weekDays`.
 *
 * This locks the COMPOSER's half of the contract — given a plan for the day,
 * it must not render the day as unplanned. The route's fallback to the
 * date-aware `planWeek` is what supplies it.
 */
import { describe, it, expect } from 'vitest';
import { composeV5Today, type V5TodayContext } from './v5-today';

function ctx(overrides: Partial<V5TodayContext> = {}): V5TodayContext {
  return {
    todayISO: '2026-08-30',
    raceMode: true,
    todayPlan: null,
    weekLine: null,
    phaseLine: 'Recovery',
    weekStripDays: [],
    prescription: null,
    weatherKicker: null,
    paceBandStat: null,
    hrCapStat: null,
    effortStat: null,
    why: null,
    whereYouAre: [],
    beforeYouGo: [],
    paceNote: null,
    raceDay: false,
    recentRun: null,
    weekOff: null,
    offSeason: null,
    injury: null,
    sick: null,
    convergence: null,
    ...overrides,
  } as V5TodayContext;
}

describe('a stepped-to day keeps its plan', () => {
  it('renders the session when the day carries one', () => {
    const out = composeV5Today(ctx({
      isSteppedDay: true,
      todayPlan: { type: 'long', subLabel: 'LONG', distanceMi: 7, originalType: null, originalSubLabel: null },
    }));
    // Title Case here, not upper. The composer's own contract: the client
    // uppercases at the call site so the word also reads inside a sentence.
    expect(out.panel.type).toBe('Long');
    expect(out.panel.dayState).toBe('long');
  });

  // The regression itself, stated as the thing the runner saw.
  it('does not render a planned day as REST', () => {
    const out = composeV5Today(ctx({
      isSteppedDay: true,
      todayPlan: { type: 'long', subLabel: 'LONG', distanceMi: 7, originalType: null, originalSubLabel: null },
    }));
    expect(out.panel.type).not.toBe('Rest');
    expect(JSON.stringify(out)).not.toContain('run by feel');
  });

  // And a genuine rest day still reads as one — the fallback must not invent
  // a session for a day the plan leaves empty.
  it('still renders a real rest day as rest', () => {
    const out = composeV5Today(ctx({ isSteppedDay: true, todayPlan: null }));
    expect(out.panel.dayState).toBe('rest');
  });
});
