/**
 * coach.recentAdjustments · 7-day plan-adjustments rollup.
 *
 * Covers the contract documented on the Coach interface:
 *   1. A steady-runner fixture with no missed days + no firing signals
 *      returns an empty items array (page renders "Plan held steady").
 *   2. A fixture where today's signals trip adjustForReality returns
 *      at least one item with `changed: true` (today's real
 *      adjustment).
 *   3. NO retroactive synthesis, past days NEVER emit items just
 *      because last7Days is empty. The adaptive layer has no
 *      persistence yet, so historical adjustments are 0 by design.
 *      Item count is bounded by {0, 1}: today's adjustForReality fires
 *      or doesn't.
 *   4. Honest "Run not logged", when the user has populated
 *      Strava activities in the current calendar week, the past-day
 *      false-positive that triggered the original bug never surfaces.
 *
 * The fixtures lean on the existing STATE_MID_BUILD_WEEK_4 snapshot so
 * the engine sees a normal build phase; only the volume.last7Days and
 * recovery.daysSinceLastRun fields move between the two scenarios.
 */

import { describe, expect, it } from 'vitest';
import { coach } from '../../coach/coach';
import { STATE_MID_BUILD_WEEK_4, TODAY_ISO, dayOffsetISO } from './fixtures/coach-states';
import type { CoachState } from '../coach-state';

/** Build a 7-day daily-miles series from today back. `runDays` is the
 *  set of offsets-from-today (0=today, -1=yesterday) that have runs.
 *  All other days are 0 miles. */
function makeLast7Days(runDays: Set<number>): Array<{ date: string; miles: number; runs: number }> {
  const out: Array<{ date: string; miles: number; runs: number }> = [];
  for (let offset = -6; offset <= 0; offset++) {
    const date = dayOffsetISO(offset);
    if (runDays.has(offset)) {
      out.push({ date, miles: 5, runs: 1 });
    } else {
      out.push({ date, miles: 0, runs: 0 });
    }
  }
  return out;
}

describe('coach.recentAdjustments · no signals', () => {
  it('returns empty items when runner hit every planned day and no signals fire', async () => {
    // Steady runner, every day ran, ACWR in sweet spot, no check-in
    // signals. The engine should hold the plan steady.
    const state: CoachState = {
      ...STATE_MID_BUILD_WEEK_4,
      volume: {
        ...STATE_MID_BUILD_WEEK_4.volume,
        last7Days: makeLast7Days(new Set([-6, -5, -4, -3, -2, -1, 0])),
        last7Mi: 28,
        weeklyAvg8w: 28, // ACWR = 1.0
      },
      recovery: {
        ...STATE_MID_BUILD_WEEK_4.recovery,
        daysSinceLastRun: 0,
      },
      checkin: null,
    };
    const out = await coach.recentAdjustments({ today: TODAY_ISO, state });
    expect(
      out.answer.items,
      'no missed days + no firing signals → empty rollup so the UI renders "Plan held steady"',
    ).toHaveLength(0);
    expect(out.answer.sinceISO).toBe(dayOffsetISO(-6));
    expect(out.answer.untilISO).toBe(TODAY_ISO);
  });
});

describe('coach.recentAdjustments · today\'s adjustForReality signal', () => {
  it('surfaces today\'s adjustment when live signals trip adjustForReality', async () => {
    // 5 days since last run + check-in poor-days = 3 trips
    // adjustForReality's rebuild path. The historical past-day walk is
    // gone (no retroactive synthesis); only today's item should fire.
    const state: CoachState = {
      ...STATE_MID_BUILD_WEEK_4,
      volume: {
        ...STATE_MID_BUILD_WEEK_4.volume,
        // Only day -6 logged a run. Everything since: missed.
        last7Days: makeLast7Days(new Set([-6])),
        last7Mi: 5,
        weeklyAvg8w: 28,
      },
      recovery: {
        ...STATE_MID_BUILD_WEEK_4.recovery,
        daysSinceLastRun: 5,
      },
      // Three flagged check-in days = doctrine cutback territory.
      checkin: {
        rowsCount: 5,
        latestDateISO: TODAY_ISO,
        loggedToday: true,
        poorDaysCount: 3,
      },
    };
    const out = await coach.recentAdjustments({ today: TODAY_ISO, state });
    expect(
      out.answer.items.length,
      'live recovery signals must produce today\'s adjustment item',
    ).toBeGreaterThan(0);
    expect(
      out.answer.items.length,
      'with no persistence layer, at most ONE item (today\'s) can fire',
    ).toBeLessThanOrEqual(1);
    // The single item must be today's, not a retroactive past day.
    for (const item of out.answer.items) {
      expect(item.changed, 'rollup items only when the engine actually moved').toBe(true);
      expect(item.dateISO, 'no retroactive synthesis, only today').toBe(TODAY_ISO);
      expect(item.dateDisplay).toBe('TODAY');
    }
    expect(out.answer.rationale.length).toBeGreaterThan(0);
  });
});

describe('coach.recentAdjustments · Bug 1 regression: no retroactive synthesis', () => {
  it('returns 0 items when last7Days is empty and no live signals fire (the original bug)', async () => {
    // This was the exact bug the user caught on /overview: the adaptive
    // layer JUST shipped, but the card was showing "5 ADJUSTMENTS THIS
    // WEEK", five fabricated rows for SUN/SAT/FRI/THU/WED all saying
    // "Run not logged · week-volume target adjusts down." The engine
    // wasn't operating on those days; there are no real adjustments to
    // report.
    //
    // After the fix: 0 items. UI renders "Plan held steady, Coach
    // didn't need to move anything this week."
    const state: CoachState = {
      ...STATE_MID_BUILD_WEEK_4,
      volume: {
        ...STATE_MID_BUILD_WEEK_4.volume,
        // Empty last7Days, simulates a fresh user / no Strava history
        // / the exact "no data" path that should NOT fabricate items.
        last7Days: makeLast7Days(new Set()),
        last7Mi: 0,
        weeklyAvg8w: 28, // ACWR = 0/28 = 0, no spike
      },
      recovery: {
        ...STATE_MID_BUILD_WEEK_4.recovery,
        // 0 days since last run, adjustForReality won't trip rebuild.
        daysSinceLastRun: 0,
      },
      checkin: null,
    };
    const out = await coach.recentAdjustments({ today: TODAY_ISO, state });
    expect(
      out.answer.items,
      'no persistence layer + no live signals → 0 items, NOT 5 fabricated past days',
    ).toHaveLength(0);
    expect(out.answer.rationale).toContain('Plan held steady');
  });
});

describe('coach.recentAdjustments · Bug 2 regression: honest "run logged" check', () => {
  it('does NOT claim runs are missing when last7Days has populated activities', async () => {
    // The user's report: real Strava runs exist for those dates, but
    // the card said "Run not logged." This test pins the inverse:
    // when last7Days IS populated, no false "skipped" items emerge.
    const state: CoachState = {
      ...STATE_MID_BUILD_WEEK_4,
      volume: {
        ...STATE_MID_BUILD_WEEK_4.volume,
        // Every day populated, the user has been running.
        last7Days: makeLast7Days(new Set([-6, -5, -4, -3, -2, -1, 0])),
        last7Mi: 35,
        weeklyAvg8w: 30,
      },
      recovery: {
        ...STATE_MID_BUILD_WEEK_4.recovery,
        daysSinceLastRun: 0,
      },
      checkin: null,
    };
    const out = await coach.recentAdjustments({ today: TODAY_ISO, state });
    // No "Run not logged" / "skipped" items should surface.
    for (const item of out.answer.items) {
      expect(
        item.why.toLowerCase(),
        'when activities exist, no item should claim "Run not logged"',
      ).not.toContain('not logged');
      expect(
        item.changeDisplay.toLowerCase(),
        'when activities exist, no item should claim "skipped"',
      ).not.toContain('skipped');
    }
  });
});
