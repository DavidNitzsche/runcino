/**
 * MID-BLOCK RACE INVARIANTS (2026-08-17).
 *
 * The tune-up embedding landed the same morning as the plan it was written for,
 * and a read-only verification of the owner's CIM block — a 14-week marathon
 * build carrying three of his own races — found two defects that no structural
 * gate could see, because the plan they produce is perfectly well-formed:
 *
 *   1. MINI-TAPER · the B-race easing indexed CALENDAR offsets −1 and −2 and
 *      required the day before the race to be a running day. His rest day is
 *      Saturday and his races are Sunday, so the shakeout conversion was
 *      skipped outright and the "no quality two days out" rule looked at a
 *      Friday easy run that was never quality. Both his B races — a 10K and a
 *      half — were authored off a full Thursday quality session with no taper
 *      of any kind. Every runner who rests the day before a race had the same
 *      no-op.
 *
 *   2. RAMP CEILING · `embedMidBlockRaces` rewrites weekly volumes AFTER
 *      `volumeCurve` has applied `GENERAL_RAMP_CEILING`, and it flags the
 *      tune-up week `isCutback`, which is exactly the flag the validator's
 *      week-over-week check exempts. So the week following a raced half came
 *      out at +37% and as the biggest week of the whole block, carrying its
 *      longest run with a ten-mile marathon-pace finish six days after 13.1
 *      raced miles — inside the two weeks of no quality
 *      `POST_RACE_RECOVERY_WEEKS.hm` mandates.
 *
 * Both are locked here on the layout that exposed them (Sunday long, Sunday
 * race, Saturday rest) rather than on the shape that happened to work.
 *
 * Cite: Research/00b-recovery-protocols.md §"Post-Race Recovery"
 * Cite: Research/08 §9.1 (taper depth · "the largest cut is to easy mileage")
 * Cite: Research/22-plan-templates.md §15 ("tune-up half at HMP-T, 4-6 wk out")
 */
import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
   type ComposePlanInput, type DOW, type DayPlan,
} from './generate';
import { tPaceFromGoal } from './spec-builder';
import { GENERAL_RAMP_CEILING } from './goal-tiers';

const START_MONDAY = '2026-08-31';

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/** The owner's real CIM frame: Sunday long, Saturday rest, Tue/Thu quality. */
function cimInput(midBlockRaces: NonNullable<ComposePlanInput['midBlockRaces']>): ComposePlanInput {
  const raceDistanceMi = 26.22;
  const goalSec = 10800;
  return {
    raceDistanceMi,
    goalSec,
    goalPaceSec: Math.round(goalSec / raceDistanceMi),
    raceDateISO: addDays(START_MONDAY, 14 * 7 - 1),
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
    midBlockRaces,
  };
}

/** Compose + finalize exactly as generatePlan does. */
function build(midBlockRaces: NonNullable<ComposePlanInput['midBlockRaces']>) {
  const input = cimInput(midBlockRaces);
  const composed = composePlan(input);
  finalizeComposedPlan(composed, input.raceDistanceMi, input.level);
  composed.vols = composed.weeks.map((w) => w.weeklyMi);
  return composed;
}

/** Absolute day offset → the composed day, week-index included. */
function dayAt(composed: ReturnType<typeof build>, iso: string): { day: DayPlan; weekIdx: number } | null {
  const off = Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(START_MONDAY + 'T12:00:00Z')) / 86400000);
  const wi = Math.floor(off / 7);
  const week = composed.weeks[wi];
  if (!week) return null;
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay() as DOW;
  const day = week.days.find((d) => d.dow === dow);
  return day ? { day, weekIdx: wi } : null;
}

// Both of his B races fall on a Sunday, with Saturday rest.
const SANTA_MONICA = { slug: 'sm10k', name: 'Santa Monica 10k', date: '2026-09-13', distanceMi: 6.2, goalPaceSec: null, priority: 'B' as const };
const MALIBU = { slug: 'malibu', name: 'Run Malibu', date: '2026-11-08', distanceMi: 13.1, goalPaceSec: 412, priority: 'B' as const };

describe('MINI-TAPER · a rest day the day before a B race does not skip the taper', () => {
  const composed = build([SANTA_MONICA, MALIBU]);

  for (const race of [SANTA_MONICA, MALIBU]) {
    it(`${race.name} · the last RUNNING day before the race is a shakeout`, () => {
      const before = dayAt(composed, addDays(race.date, -1))!;
      expect(before.day.type, 'the day before is the rest day this case is about').toBe('rest');
      const twoBefore = dayAt(composed, addDays(race.date, -2))!;
      expect(twoBefore.day.type).toBe('shakeout');
      expect(twoBefore.day.distanceMi).toBeLessThanOrEqual(2);
      expect(twoBefore.day.subLabel).toMatch(/SHAKEOUT/);
    });

    it(`${race.name} · no quality inside the 2 running days before it`, () => {
      // Saturday rest, Friday shakeout, Thursday = the second running day back.
      for (const back of [2, 3]) {
        const d = dayAt(composed, addDays(race.date, -back))!;
        expect(d.day.isQuality, `${addDays(race.date, -back)} is quality inside the mini-taper`).toBe(false);
      }
    });
  }
});

describe('RAMP CEILING · the week after a tune-up', () => {
  const composed = build([SANTA_MONICA, MALIBU]);
  const peak = Math.max(...composed.weeks.map((w) => w.weeklyMi));

  it('the week after a raced HALF is not the block\'s peak week', () => {
    const raceWk = dayAt(composed, MALIBU.date)!.weekIdx;
    const after = composed.weeks[raceWk + 1];
    expect(after).toBeDefined();
    const priorPeak = Math.max(...composed.weeks.slice(0, raceWk + 1).map((w) => w.weeklyMi));
    expect(after.weeklyMi).toBeLessThanOrEqual(priorPeak + 0.05);
    expect(after.weeklyMi).toBeLessThan(peak + 0.05);
  });

  it('the week after a raced half carries no race-pace finish on its long run', () => {
    const raceWk = dayAt(composed, MALIBU.date)!.weekIdx;
    const long = composed.weeks[raceWk + 1].days.find((d) => d.isLong && d.type === 'long');
    expect(long).toBeDefined();
    // POST_RACE_RECOVERY_WEEKS.hm = 2 weeks of no quality · an MP finish is quality.
    expect(long!.subLabel ?? '').not.toMatch(/@\s*(HM|MP|M)\b/i);
  });

  it('every post-tune-up week respects the general ramp ceiling off the last undistorted week', () => {
    const ceiling = GENERAL_RAMP_CEILING.advanced;
    for (const race of [SANTA_MONICA, MALIBU]) {
      const raceWk = dayAt(composed, race.date)!.weekIdx;
      const after = composed.weeks[raceWk + 1];
      if (!after || after.isRaceWeek) continue;
      let ref = 0;
      for (let k = raceWk - 1; k >= 0; k--) {
        if (composed.weeks[k].isCutback || composed.weeks[k].isRaceWeek) continue;
        ref = composed.weeks[k].weeklyMi;
        break;
      }
      if (!(ref > 0)) continue;
      expect(after.weeklyMi, `week after ${race.name}`).toBeLessThanOrEqual(ref * ceiling + 0.05);
    }
  });
});

describe('BYTE-SAFETY · a plan with no mid-block races is untouched', () => {
  it('composes identically with an empty race list and with the field absent', () => {
    const withEmpty = build([]);
    const input = cimInput([]);
    delete (input as { midBlockRaces?: unknown }).midBlockRaces;
    const withAbsent = composePlan(input);
    finalizeComposedPlan(withAbsent, input.raceDistanceMi, input.level);
    withAbsent.vols = withAbsent.weeks.map((w) => w.weeklyMi);
    expect(withEmpty.vols).toEqual(withAbsent.vols);
    expect(JSON.stringify(withEmpty.weeks)).toBe(JSON.stringify(withAbsent.weeks));
  });
});
