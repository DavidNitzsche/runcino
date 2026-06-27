/**
 * RACE-PATH WEEK-COUNT PARITY GATE (2026-06-26).
 *
 * Locks the goalMode:'race' (LITERAL race date) preview to ship the SAME number of weeks
 * production does. Production's real-race path
 *
 *     app/api/race/route.ts  →  generatePlan({ startDateISO, startAnchor:'today' })
 *                            →  composePlan(literalStart, literalRace)   // NO goalTarget snap
 *
 * floors the runway with composePlan's formula (generate.ts):
 *
 *     totalWeeks = floor(daysBetween(literalStart, literalRace) / 7) + 1
 *
 * The simulator (sim-inputs.ts buildSimPlan) composes the race path from the LITERAL chosen
 * start with NO start-snap (the SIM-FIDELITY contract — calendar-row alignment is a render-layer
 * concern, handled by the plan-week grouping in app/sim/plan/page.tsx), so this parity holds by
 * construction. This gate makes it permanent:
 *
 *   1. COUNT — buildSimPlan(...).composed.weeks.length === floor(daysBetween(start, race)/7)+1
 *              for every start-DOW × longRunDay × race-DOW.
 *   2. LITERAL START — weeks[0].startISO === the chosen start (no snap re-introduced).
 *
 * Why this is needed even though _maint_invariants.test.ts already checks "#8 literal start":
 * that sweep runs the goalMode:'goal' path only and never asserts the resulting week COUNT. The
 * regression this guards is concrete and recently live — a longRunDow start-snap (the reverted
 * MAINT-ALIGN-1) moves the start back while the literal race date stays fixed, STRETCHING the
 * runway and inflating the floored count by +1 whenever the stretch crosses a 7-day boundary
 * (it did so for ~43% of starts: e.g. longRunDay sun, start Mon 2026-07-06, race Sun 2026-10-04
 * previewed 14 weeks while production shipped 13). The matrix below deliberately includes those
 * cases (snapWouldInflate > 0) so the gate provably catches the snap-back class, not just passes.
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
/** The production race-path formula, from the LITERAL inputs the runner supplied. */
const prodWeekCount = (literalStart: string, literalRace: string) =>
  Math.floor(daysBetween(literalStart, literalRace) / 7) + 1;

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
  it('previews exactly floor(daysBetween(literalStart, literalRace)/7)+1 weeks, from the literal start', () => {
    const countViolations: string[] = [];
    const startViolations: string[] = [];
    let asserted = 0;
    let snapWouldInflate = 0; // cells a longRunDow start-snap WOULD inflate — proves the gate guards that class

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

            const expected = prodWeekCount(startDateISO, raceDateISO);
            const rendered = built.composed.weeks.length;
            const arc = `${distance}/lr=${longRunDay}/start${dowOf(startDateISO)}(${startDateISO})/race${dowOf(raceDateISO)}(${raceDateISO})`;
            // 1 · COUNT parity with the production formula (from the LITERAL inputs).
            if (rendered !== expected)
              countViolations.push(`${arc}: rendered ${rendered} != prod ${expected}`);
            // weeks.length and totalWeeks must agree (no silent drop/add downstream of compose).
            if (built.composed.totalWeeks !== rendered)
              countViolations.push(`${arc}: totalWeeks ${built.composed.totalWeeks} != weeks.length ${rendered}`);
            // 2 · LITERAL-START contract: week 0 composes from the chosen start (no snap re-introduced).
            if (built.composed.weeks[0]?.startISO !== startDateISO)
              startViolations.push(`${arc}: weeks[0].startISO ${built.composed.weeks[0]?.startISO} != chosen ${startDateISO}`);

            // Prove the matrix exercises the snap-back regression: recompute the count a longRunDow
            // start-snap (keeping the literal race) WOULD have produced, and flag where it diverges.
            const longRunDow = DAY_KEYS.indexOf(longRunDay);
            const snapBack = (dowOf(startDateISO) - longRunDow + 7) % 7;
            const snappedCount = Math.floor(daysBetween(plusDays(startDateISO, -snapBack), raceDateISO) / 7) + 1;
            if (snappedCount !== expected) snapWouldInflate++;
          }

    if (countViolations.length)
      console.log(`\n${countViolations.length} count violations:\n  ${countViolations.slice(0, 25).join('\n  ')}`);
    if (startViolations.length)
      console.log(`\n${startViolations.length} literal-start violations:\n  ${startViolations.slice(0, 25).join('\n  ')}`);
    console.log(`\n=== race-path parity: ${asserted} race-prep archetypes asserted, ${snapWouldInflate} a start-snap would inflate ===`);

    // THE GATE · every previewed race-prep plan ships production's week count, from the literal start.
    expect(countViolations, `goalMode:'race' preview week count drifted from the production formula`).toEqual([]);
    expect(startViolations, `goalMode:'race' week-0 is not the chosen start — a start-snap was re-introduced`).toEqual([]);
    // Non-vacuous: the matrix must actually contain race-prep plans...
    expect(asserted).toBeGreaterThan(1000);
    // ...and must actually exercise the off-by-one a start-snap reintroduces, so this gate provably
    // guards that regression class rather than passing trivially.
    expect(snapWouldInflate).toBeGreaterThan(0);
  });
});
