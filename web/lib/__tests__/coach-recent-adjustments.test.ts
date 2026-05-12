/**
 * coach.recentAdjustments · 7-day plan-adjustments rollup.
 *
 * Covers the contract documented on the Coach interface:
 *   1. A steady-runner fixture with no missed days + no firing signals
 *      returns an empty items array (page renders "Plan held steady").
 *   2. A fixture with a missed quality day in the last 7 days returns
 *      at least one item with `changed: true`.
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
    // Steady runner — every day ran, ACWR in sweet spot, no check-in
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

describe('coach.recentAdjustments · missed-day signal', () => {
  it('surfaces at least one adjustment item when the runner missed a planned day', async () => {
    // 5 days since last run + check-in poor-days = 3 will trip both the
    // simulateRange-based missed-day detector (no miles on days that
    // the engine would have scheduled a run) and the live-signal path.
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
      'real missed-run signal must produce at least one adjustment item',
    ).toBeGreaterThan(0);
    // Every item must have changed=true; the rollup never emits stub
    // "Plan held steady" rows.
    for (const item of out.answer.items) {
      expect(item.changed, 'rollup items only when the engine actually moved').toBe(true);
    }
    expect(out.answer.rationale.length).toBeGreaterThan(0);
  });
});
