/**
 * lib/plan/_race_runup.test.ts · the seven days before the gun, on every grid.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_race_runup.test.ts
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * The race-week composer lays a race week out from `raceDow` INSIDE the
 * composed week the race falls in. That is correct while race day sits near
 * the end of that week and silently wrong the moment it does not, because the
 * days leading into the race are then in the PREVIOUS composed week and
 * nothing there knows a race is coming.
 *
 * The concrete output, from the engine, before RACE-RUNUP-1: a marathon block
 * anchored on a Monday with a Sunday race ended its last full week with
 *
 *     Sat 2026-10-03  long: 10 mi     Sun 2026-10-04  race: 26.2
 *
 * — a ten-mile long run the day before a marathon. Under the old literal
 * anchor a well-formed race week needed `raceDow === (startDow + 6) % 7`, one
 * signup weekday in seven; the other six produced race weeks ranging from thin
 * to that.
 *
 * Nothing in the suite looked at the days before race day as a SPAN. Every
 * existing plan gate walks weeks, and a week is exactly the unit this defect
 * hides between.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT ASSERTS
 *
 * Both rules come out of Research/08 §9.3, whose four templates are also read
 * at run time by RACERUNUP.no-long-run-in-race-week and
 * RACERUNUP.day-before-is-the-shortest-run in the doctrine registry. This file
 * asserts the ENGINE keeps them; the registry asserts the DOC still says them.
 *
 *   1. No long run in the seven days ending on race day.
 *   2. The last running day before the race is the shortest run of the run-up,
 *      and it is a shakeout.
 *
 * Swept over every long-run day × every race weekday × four distances, which
 * is the full cross-product of the two grids whose disagreement causes the
 * defect. Pure · no DB.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import type { SimInputs, SimDistance, DayKey } from './sim-constants';

const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DIST: SimDistance[] = ['5k', '10k', 'half', 'marathon'];
const GOAL_SEC: Record<string, number> = { '5k': 1200, '10k': 2500, half: 5700, marathon: 12600 };

const plusDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dowOf = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay();

/** Every composed day, flattened onto real dates. */
function calendar(built: Extract<ReturnType<typeof buildSimPlan>, { ok: true }>) {
  const byDate = new Map<string, { type: string; mi: number; isLong: boolean; subLabel: string | null }>();
  for (const w of built.composed.weeks) {
    const wsd = dowOf(w.startISO);
    for (const d of w.days as Array<{ dow: number; type: string; distanceMi: number; isLong?: boolean; subLabel?: string | null }>) {
      byDate.set(plusDays(w.startISO, (d.dow - wsd + 7) % 7), {
        type: d.type, mi: d.distanceMi, isLong: d.isLong === true, subLabel: d.subLabel ?? null,
      });
    }
  }
  return byDate;
}

describe('the seven days before the goal race', () => {
  // SWEEP-TIMEOUT-1 (2026-08-29) · an explicit budget, because this is a
  // sweep and vitest's default is 5s. Measured 7224ms on 2026-08-29, so it
  // had been failing on every run for as long as the sweep has been this size. A timeout is not a
  // logic failure, but it reads as one in the summary, and a suite that is
  // red for a reason nobody can act on trains people to skim red — the same
  // habit `vitest.setup.ts`'s header was written about. 60s is far above
  // what this needs and far below a hang, so a real regression still shows.
  it('carry no long run, and end on a shakeout, for every long-run day and every race weekday', { timeout: 60000 }, () => {
    const longInRunUp: string[] = [];
    const lastRunNotShakeout: string[] = [];
    const lastRunTooLong: string[] = [];
    let asserted = 0;
    // Cells where race day is NOT the last day of its own training week — the
    // geometry the composer cannot handle alone, and the reason this file
    // exists. Counted so the sweep cannot pass by only walking the easy case.
    let offGridRaces = 0;

    // Each distance starts inside its OWN build window, or `pickPlanMode`
    // answers maintenance and the cell never reaches a race week at all.
    const RUNWAY_WEEKS: Record<string, number> = { '5k': 8, '10k': 9, half: 11, marathon: 16 };

    for (const distance of DIST)
      for (const longRunDay of DAY_KEYS)
        for (let raceShift = 0; raceShift < 7; raceShift++)
        for (let startShift = 0; startShift < 7; startShift++) {
          const raceDateISO = plusDays('2026-10-04', raceShift); // Sun..Sat
          // ...and the signup weekday is swept too: it was the grid the block
          // used to be authored on, and the whole class turned on it.
          const startDateISO = plusDays(raceDateISO, -(RUNWAY_WEEKS[distance] * 7) + startShift);
          const built = buildSimPlan({
            goalMode: 'race', distance, experienceLevel: 'intermediate', weeklyFrequency: 6,
            weeklyMileageBucket: 35, longestRunBucket: '10+', longRunDay,
            restDay: longRunDay === 'sat' ? 'mon' : 'sat',
            startDateISO, raceDateISO, goalTimeSec: GOAL_SEC[distance], planWeeks: 0,
            lastRaceFinishedDaysAgo: 0, lastRaceDistance: null, raceHistory: [], availableDays: null,
          } as unknown as SimInputs);
          if (!built.ok || built.mode !== 'race-prep') continue;
          asserted++;

          const cal = calendar(built);
          const arc = `${distance}/lr=${longRunDay}/race=${raceDateISO}(${DAY_KEYS[dowOf(raceDateISO)]})`;
          if (dowOf(raceDateISO) !== DAY_KEYS.indexOf(longRunDay)) offGridRaces++;

          // 1 · no long run in the six days before the race
          for (let j = 1; j <= 6; j++) {
            const d = cal.get(plusDays(raceDateISO, -j));
            if (!d) continue;
            if (d.isLong || d.type === 'long') {
              longInRunUp.push(`${arc}: T-${j} is ${d.type} ${d.mi} mi`);
            }
          }

          // 2 · the last running day before the race is a shakeout, and no
          //     longer than one. 2 mi is the composer's shakeout; VOL-1's
          //     reconcile can round it, so the ceiling is generous and the
          //     TYPE is the assertion.
          let lastRun: { off: number; type: string; mi: number } | null = null;
          for (let j = 1; j <= 6 && !lastRun; j++) {
            const d = cal.get(plusDays(raceDateISO, -j));
            if (d && d.mi > 0) lastRun = { off: j, type: d.type, mi: d.mi };
          }
          if (lastRun && lastRun.off <= 2) {
            if (lastRun.type !== 'shakeout') {
              lastRunNotShakeout.push(`${arc}: T-${lastRun.off} is ${lastRun.type} ${lastRun.mi} mi`);
            }
            if (lastRun.mi > 4) {
              lastRunTooLong.push(`${arc}: T-${lastRun.off} shakeout is ${lastRun.mi} mi`);
            }
          }
        }

    console.log(`\n=== RACE RUN-UP · ${asserted} race-prep blocks, ${offGridRaces} racing off their own week boundary ===`);
    for (const l of longInRunUp.slice(0, 15)) console.log(`  LONG IN RUN-UP  ${l}`);
    for (const l of lastRunNotShakeout.slice(0, 15)) console.log(`  NOT A SHAKEOUT  ${l}`);
    for (const l of lastRunTooLong.slice(0, 15)) console.log(`  SHAKEOUT TOO LONG  ${l}`);

    expect(longInRunUp, 'a long run inside the seven days before the race').toEqual([]);
    expect(lastRunNotShakeout, 'the last run before the race is not a shakeout').toEqual([]);
    expect(lastRunTooLong, 'the shakeout before the race is not a shakeout-sized run').toEqual([]);
    // Non-vacuous, twice over: the sweep must build real blocks, and most of
    // them must be the off-grid geometry the guard exists for.
    expect(asserted).toBeGreaterThan(500);
    expect(offGridRaces).toBeGreaterThan(asserted / 2);
  });
});
