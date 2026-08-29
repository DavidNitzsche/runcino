/**
 * RACE-PATH WEEK-COUNT PARITY GATE (2026-06-26 · rewritten 2026-08-24).
 *
 * Locks the goalMode:'race' (LITERAL race date) preview to ship the SAME number of weeks
 * production does, and to start week 0 where production starts it. Production's real-race path
 *
 *     app/api/race/route.ts  →  generatePlan({ startDateISO, startAnchor:'today' })
 *                            →  loadGeneratorInputs snaps the anchor to the runner's
 *                               TRAINING-WEEK BOUNDARY (WEEK-ALIGN-1)
 *                            →  composePlan(snappedStart, literalRace)
 *
 * floors the runway with composePlan's formula (generate.ts):
 *
 *     totalWeeks = floor(daysBetween(snappedStart, literalRace) / 7) + 1
 *
 * WHAT CHANGED, AND WHY THE GATE FLIPPED. This file used to assert the OPPOSITE of what it
 * asserts now: that week 0 starts on the LITERAL chosen date and the count is floored from it.
 * That contract came out of the reverted MAINT-ALIGN-1 experiment, whose conclusion was that
 * calendar alignment is a render-layer concern. It is not. A block authored in weeks that start
 * on the signup weekday is READ BACK by `trainingWeekWindow` in weeks that end on the runner's
 * long-run day, and the two coincide for one signup weekday in seven — two of the seven active
 * production plans on 2026-08-24 were misaligned, and each showed its runner a planned-mileage
 * figure that disagreed with the week strip printed underneath it. WEEK-ALIGN-1 snaps the anchor
 * and clips the pre-signup part of week 0 instead, which is the pair of decisions the literal
 * anchor was conflating.
 *
 * So the +1 the old gate called an inflation is now the correct answer: the runway genuinely
 * spans one more TRAINING week, whose first days are simply not the runner's.
 *
 *   1. COUNT — buildSimPlan(...).composed.weeks.length === floor(daysBetween(snapped, race)/7)+1
 *              for every start-DOW × longRunDay × race-DOW.
 *   2. ALIGNED START — weeks[0].startISO is the training-week boundary on or before the chosen
 *              start, and never after it (nothing may be dated before the runner arrives beyond
 *              the six days `persistPlan` clips).
 *   3. NON-VACUOUS — the matrix must contain cells where the snap actually moves the anchor,
 *              so the gate is proving something rather than passing on identity.
 *
 * The matrix is built entirely from half/marathon at a 12-14 week horizon so every cell is
 * race-prep (no maintenance/recovery) — a dense, non-vacuous sweep of the three DOW axes.
 * Pure · no DB.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_race_weekcount_invariant.test.ts
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import type { SimInputs, SimDistance } from './sim-constants';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

// Mirror generate.ts daysBetween (exclusive day count, noon-UTC anchored) exactly.
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const dowOf = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay();
const plusDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The training-week boundary on or before `iso`, where the week ENDS on `longRunDow`.
 *  Mirrors generate.ts `weekStartBoundaryOf`, which is what the loader snaps with. */
const boundaryOf = (iso: string, longRunDow: number) => {
  const weekStartDow = (longRunDow + 1) % 7;
  return plusDays(iso, -(((dowOf(iso) - weekStartDow) % 7 + 7) % 7));
};
/** The production race-path formula, from the SNAPPED anchor and the literal race date. */
const prodWeekCount = (anchor: string, literalRace: string) =>
  Math.floor(daysBetween(anchor, literalRace) / 7) + 1;

// start-DOW axis · 7 consecutive days = every weekday a runner might pick to start.
const STARTS = Array.from({ length: 7 }, (_, i) => plusDays('2026-07-05', i)); // Sun..Sat
// race-DOW axis · 14 consecutive days at a 12-14wk horizon = every race weekday, twice,
// across a month boundary. All within the half/marathon build window → all race-prep.
const RACES = Array.from({ length: 14 }, (_, i) => plusDays('2026-09-27', i));
// longRunDay axis · all 7.
const LONG_DAYS = DAY_KEYS;
// Big-window distances keep every cell race-prep (the count is distance-independent — it lives
// in the date arithmetic — but race-prep is the mode that ships a race-prep count to match).
const DISTS: SimDistance[] = ['half', 'marathon'];
const GOAL: Record<string, number> = { half: 6300, marathon: 13500 };

describe('race-path week-count parity (goalMode:race == production formula)', () => {
  // SWEEP-TIMEOUT-1 (2026-08-29) · an explicit budget, because this is a
  // sweep and vitest's default is 5s. Measured 6948ms on 2026-08-29, so it
  // had been failing on every run for as long as the sweep has been this size. A timeout is not a
  // logic failure, but it reads as one in the summary, and a suite that is
  // red for a reason nobody can act on trains people to skim red — the same
  // habit `vitest.setup.ts`'s header was written about. 60s is far above
  // what this needs and far below a hang, so a real regression still shows.
  it('previews exactly floor(daysBetween(literalStart, literalRace)/7)+1 weeks, from the literal start', { timeout: 60000 }, () => {
    const countViolations: string[] = [];
    const startViolations: string[] = [];
    let asserted = 0;
    let snapWouldInflate = 0; // cells where the boundary snap actually moves the anchor

    for (const distance of DISTS)
      for (const longRunDay of LONG_DAYS)
        for (const startDateISO of STARTS)
          for (const raceDateISO of RACES) {
            const built = buildSimPlan({
              goalMode: 'race', distance, experienceLevel: 'intermediate', weeklyFrequency: 5,
              weeklyMileageBucket: 25, longestRunBucket: '6-10', longRunDay, restDay: 'sat',
              startDateISO, raceDateISO, goalTimeSec: GOAL[distance], planWeeks: 0,
              lastRaceFinishedDaysAgo: 0, lastRaceDistance: null, raceHistory: [], availableDays: null,
            } as SimInputs);
            // Invariant is scoped to race-prep (the only mode that ships a race-prep count).
            if (!built.ok || built.mode !== 'race-prep') continue;
            asserted++;

            const longRunDow = DAY_KEYS.indexOf(longRunDay);
            const anchor = boundaryOf(startDateISO, longRunDow);
            const expected = prodWeekCount(anchor, raceDateISO);
            const rendered = built.composed.weeks.length;
            const arc = `${distance}/lr=${longRunDay}/start${dowOf(startDateISO)}(${startDateISO})/race${dowOf(raceDateISO)}(${raceDateISO})`;
            // 1 · COUNT parity with the production formula (from the SNAPPED anchor).
            if (rendered !== expected)
              countViolations.push(`${arc}: rendered ${rendered} != prod ${expected}`);
            // weeks.length and totalWeeks must agree (no silent drop/add downstream of compose).
            if (built.composed.totalWeeks !== rendered)
              countViolations.push(`${arc}: totalWeeks ${built.composed.totalWeeks} != weeks.length ${rendered}`);
            // 2 · ALIGNED-START contract: week 0 composes from the runner's training-week
            //     boundary, and never later than the day they chose.
            const w0 = built.composed.weeks[0]?.startISO;
            if (w0 !== anchor)
              startViolations.push(`${arc}: weeks[0].startISO ${w0} != training-week boundary ${anchor}`);
            if (w0 != null && w0 > startDateISO)
              startViolations.push(`${arc}: weeks[0].startISO ${w0} is AFTER the chosen start ${startDateISO}`);
            // The clip `persistPlan` applies can never exceed six days.
            if (w0 != null && daysBetween(w0, startDateISO) > 6)
              startViolations.push(`${arc}: anchor ${w0} is ${daysBetween(w0, startDateISO)} days before the chosen start`);

            // Non-vacuity: count the cells where the snap actually MOVES the anchor, so the gate
            // is proving the snapped formula rather than passing on cells where it is a no-op.
            if (anchor !== startDateISO) snapWouldInflate++;
          }

    if (countViolations.length)
      console.log(`\n${countViolations.length} count violations:\n  ${countViolations.slice(0, 25).join('\n  ')}`);
    if (startViolations.length)
      console.log(`\n${startViolations.length} literal-start violations:\n  ${startViolations.slice(0, 25).join('\n  ')}`);
    console.log(`\n=== race-path parity: ${asserted} race-prep archetypes asserted, ${snapWouldInflate} where the snap moves the anchor ===`);

    // THE GATE · every previewed race-prep plan ships production's week count, from the literal start.
    expect(countViolations, `goalMode:'race' preview week count drifted from the production formula`).toEqual([]);
    expect(startViolations, `goalMode:'race' week-0 is not the runner's training-week boundary`).toEqual([]);
    // Non-vacuous: the matrix must actually contain race-prep plans...
    expect(asserted).toBeGreaterThan(1000);
    // ...and the snap must actually move the anchor in most of them, so the gate provably
    // asserts the snapped formula rather than passing on cells where snapping is a no-op.
    expect(snapWouldInflate).toBeGreaterThan(asserted / 2);
  });
});
