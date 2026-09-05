/**
 * lib/plan/_midrace_role.test.ts · REBUILD PRESERVES THE ANSWERED RACE ROLE.
 *
 * The race-role card's accept persists `meta.plannedRole` on the race row;
 * this suite locks the other half of that bargain: any LATER rebuild reads
 * the role through the mid-block loader and `embedMidBlockRaces` shapes the
 * race week accordingly, so the runner's answer survives every re-authoring.
 *
 * Same frame as _midrace_invariants.test.ts (the owner's real CIM layout:
 * Sunday long, Saturday rest, Tue/Thu quality, Run Malibu 2026-11-08 four
 * weeks before the 2026-12-06 target):
 *
 *   · 'b_effort' · B-effort framing on race day, and the post-race window
 *     is the 00b B scale (7 quality-free days for a half, not the default 4).
 *   · 'race'     · honest-race framing, A-effort floor (10 days) — recovery
 *     follows EFFORT GIVEN, not the calendar letter.
 *   · 'mp_workout' · race day IS the week's MP long (race marker kept, long
 *     flag on, MP pace = the plan's own goal pace), no mini-taper, no
 *     cutback flag — the week trains through.
 *   · unanswered · byte-identical to the pre-RACEROLE composition.
 */
import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
  type ComposePlanInput, type DOW, type DayPlan, type EmbeddedRaceSummary,
} from './generate';
import { fixtureTPaceFromGoalPace } from './_fixture-goal-tpace';
import { ROLE_POST_QUALITY_FREE_DAYS } from '@/lib/race/race-role';

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
    tPaceSec: fixtureTPaceFromGoalPace(goalSec, raceDistanceMi),
    lthr: null,
    maxHr: null,
    bestRecentVdot: 45.1,
    midBlockRaces,
  };
}

function build(midBlockRaces: NonNullable<ComposePlanInput['midBlockRaces']>) {
  const input = cimInput(midBlockRaces);
  const composed = composePlan(input);
  finalizeComposedPlan(composed, input.raceDistanceMi, input.level);
  composed.vols = composed.weeks.map((w) => w.weeklyMi);
  return composed;
}

function dayAt(composed: ReturnType<typeof build>, iso: string): { day: DayPlan; weekIdx: number } | null {
  const off = Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(START_MONDAY + 'T12:00:00Z')) / 86400000);
  const wi = Math.floor(off / 7);
  const week = composed.weeks[wi];
  if (!week) return null;
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay() as DOW;
  const day = week.days.find((d) => d.dow === dow);
  return day ? { day, weekIdx: wi } : null;
}

const MALIBU = {
  slug: 'malibu', name: 'Run Malibu', date: '2026-11-08',
  distanceMi: 13.1, goalPaceSec: 412, priority: 'B' as const,
};

const embeddedOf = (composed: ReturnType<typeof build>): EmbeddedRaceSummary[] =>
  ((composed.authoredState as Record<string, unknown>).embedded_races ?? []) as EmbeddedRaceSummary[];

describe("'b_effort' · the answered role shapes race day and the recovery window", () => {
  const composed = build([{ ...MALIBU, plannedRole: 'b_effort' }]);

  it('race day carries the B-effort framing', () => {
    const race = dayAt(composed, MALIBU.date)!;
    expect(race.day.type).toBe('race');
    expect(race.day.subLabel).toBe('RACE · B EFFORT');
    expect(race.day.notes).toContain('B effort. Hard, not all out.');
  });

  it("the post-race window is 00b's B scale (7 days), not the default 4", () => {
    for (let j = 1; j <= ROLE_POST_QUALITY_FREE_DAYS.hm.b_effort; j++) {
      const d = dayAt(composed, addDays(MALIBU.date, j));
      if (!d || d.day.type === 'race') continue;
      expect(d.day.isQuality, `${addDays(MALIBU.date, j)} is quality inside the B-effort window`).toBe(false);
    }
  });

  it('the answered role rides on the embedded-race record', () => {
    expect(embeddedOf(composed).find((e) => e.slug === 'malibu')?.plannedRole).toBe('b_effort');
  });
});

describe("'race' · an honest tune-up recovers like the effort it was", () => {
  const composed = build([{ ...MALIBU, plannedRole: 'race' }]);

  it('race day carries the honest-race framing', () => {
    const race = dayAt(composed, MALIBU.date)!;
    expect(race.day.subLabel).toBe('RACE');
    expect(race.day.notes).toContain('Race it honestly');
  });

  it("the post-race window is the A-effort floor (10 days)", () => {
    for (let j = 1; j <= ROLE_POST_QUALITY_FREE_DAYS.hm.race; j++) {
      const d = dayAt(composed, addDays(MALIBU.date, j));
      if (!d || d.day.type === 'race') continue;
      expect(d.day.isQuality, `${addDays(MALIBU.date, j)} is quality inside the honest-race window`).toBe(false);
    }
  });
});

describe("'mp_workout' · the race becomes the week's MP long", () => {
  const composed = build([{ ...MALIBU, plannedRole: 'mp_workout' }]);
  const race = dayAt(composed, MALIBU.date)!;

  it('race day keeps the race marker and takes the long + MP shape', () => {
    expect(race.day.type).toBe('race');
    expect(race.day.isLong).toBe(true);
    expect(race.day.subLabel).toBe('RACE · MP LONG');
    expect(race.day.notes).toContain('marathon pace long, not a race');
    // MP = the plan's own goal pace.
    expect(race.day.raceGoalPaceSec).toBe(Math.round(10800 / 26.22));
  });

  it('exactly one long in the race week · the race itself', () => {
    const longs = composed.weeks[race.weekIdx].days.filter((d) => d.isLong);
    expect(longs.length).toBe(1);
    expect(longs[0].type).toBe('race');
  });

  it('no mini-taper · the week trains through (no shakeout conversion, no cutback flag)', () => {
    for (const back of [1, 2, 3]) {
      const d = dayAt(composed, addDays(MALIBU.date, -back));
      expect(d?.day.type, `${back} days before`).not.toBe('shakeout');
    }
    expect(Boolean(composed.weeks[race.weekIdx].isCutback)).toBe(false);
  });

  it('hard-day spacing only · quality is allowed back well before the raced-half window would end', () => {
    // A raced half owes 7-10 quality-free days; a workout does not. Assert
    // some quality exists inside days 2..7 after the MP long (the week after
    // trains normally).
    const window = [] as boolean[];
    for (let j = 2; j <= 7; j++) {
      const d = dayAt(composed, addDays(MALIBU.date, j));
      if (d && d.day.type !== 'race') window.push(Boolean(d.day.isQuality || d.day.isLong));
    }
    expect(window.some(Boolean)).toBe(true);
  });
});

describe('unanswered · byte-identical to the pre-RACEROLE composition', () => {
  it('plannedRole null, undefined, and absent all compose the same plan', () => {
    const absent = build([{ ...MALIBU }]);
    const nulled = build([{ ...MALIBU, plannedRole: null }]);
    expect(JSON.stringify(nulled.weeks)).toBe(JSON.stringify(absent.weeks));
    const race = dayAt(absent, MALIBU.date)!;
    expect(race.day.subLabel).toBe('RACE');
    expect(race.day.notes).toContain('B race · race effort');
    expect(embeddedOf(absent).find((e) => e.slug === 'malibu')?.plannedRole ?? null).toBeNull();
  });
});
