/**
 * Round-3 adversarial reproduction · S2-LOWVOL-RACEWEEK-NO-TAPER.
 * Claim: race-week branch hardcodes shakeout=2 / tuneup=4 / easy=3-4, so a
 * low-volume (5-6mpw) beginner 5K has race-week TRAINING volume (week minus
 * race row) >= the build-peak training week (INV6 real-taper violation), and
 * validateComposedPlan PERSISTS it (its taper check excludes race week).
 *
 * Reproduce by computing day-sum build peak vs race-week training volume across
 * the mpw boundary, and asking whether validateComposedPlan would persist.
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  composePlan,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  type ComposePlanInput,
  type ComposedWeek,
} from './generate';
import { validateComposedPlan, type PlanValidationContext } from './validate';
import { tPaceFromGoal } from './spec-builder';

const START_MONDAY = '2026-01-05';

function buildBeginner5K(mpw: number, recentLongMi: number, planWeeks = 12): ComposePlanInput {
  const raceDay = new Date(START_MONDAY + 'T12:00:00Z');
  raceDay.setUTCDate(raceDay.getUTCDate() + planWeeks * 7 - 1);
  const raceDateISO = raceDay.toISOString().slice(0, 10);
  const distMi = 3.1;
  const goalSec = 35 * 60; // 35:00 → ~677s/mi → developing tier
  const goalPaceSec = Math.round(goalSec / distMi);
  return {
    raceDistanceMi: distMi,
    goalSec,
    goalPaceSec,
    raceDateISO,
    startMondayISO: START_MONDAY,
    level: 'beginner',
    recentWeeklyMi: mpw,
    easyDayMedianMi: Math.max(3, Math.round(mpw / 5)),
    recentLongMi,
    isMidBlock: false,
    longRunDow: 0,         // Sunday long
    restDow: 1,            // Monday rest
    qualityDows: [2, 4],   // Tue/Thu
    availableDows: null,
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions('5k'),
    rxRaceSpecific: inlinePrescriptions('5k'),
    tPaceSec: tPaceFromGoal(goalSec, distMi),
    lthr: null,
    maxHr: null,
  };
}

function weekTotal(w: ComposedWeek): number {
  return w.days.reduce((s, d) => s + (d.distanceMi || 0), 0);
}
function dump(w: ComposedWeek): string {
  return w.days.map((d) => `${d.type}:${d.distanceMi}`).join(' ');
}

function wouldPersist(input: ComposePlanInput, res: ReturnType<typeof composePlan>): { ok: boolean; err?: string } {
  const ctx: PlanValidationContext = {
    level: input.level,
    isSteppingStoneToMarathon: false,
    priorPlanPeakLongMi: null,
    todayISO: '2026-01-04',
    trainingDaysPerWeek: input.trainingDaysPerWeek,
    trailingAvgWeeklyMi: input.recentWeeklyMi > 0 ? input.recentWeeklyMi : null,
  };
  try {
    validateComposedPlan(res, input.raceDistanceMi, 'race-prep', ctx);
    return { ok: true };
  } catch (e) {
    return { ok: false, err: (e as Error).message };
  }
}

describe('R3 · S2-LOWVOL-RACEWEEK-NO-TAPER reproduction', () => {
  it('computes build-peak vs race-week training volume across the mpw boundary', () => {
    const rows: any[] = [];
    // Auditor's exact clean-room: recentLongMi=2. Also test the harness-derived
    // recentLongMi (round(mpw*0.25)) to be faithful to onboarding.
    const cases: Array<{ mpw: number; long: number; tag: string }> = [
      { mpw: 5, long: 2, tag: 'auditor mpw5 long2' },
      { mpw: 6, long: 2, tag: 'auditor mpw6 long2' },
      { mpw: 8, long: 2, tag: 'auditor mpw8 long2' },
      { mpw: 5, long: 1, tag: 'onboarding mpw5 long~1' },
      { mpw: 6, long: 2, tag: 'onboarding mpw6 long~2' },
      { mpw: 10, long: 3, tag: 'mpw10 long3' },
      { mpw: 15, long: 4, tag: 'mpw15 long4' },
    ];
    for (const c of cases) {
      const input = buildBeginner5K(c.mpw, c.long);
      const res = composePlan(input);
      const weeks = res.weeks;
      const buildWeeks = weeks.filter((w) => w.phase !== 'TAPER' && !w.isRaceWeek);
      const peakBuildDaySum = buildWeeks.length ? Math.max(...buildWeeks.map(weekTotal)) : 0;
      const peakBuildField = buildWeeks.length ? Math.max(...buildWeeks.map((w) => w.weeklyMi)) : 0;
      const raceWeek = weeks.find((w) => w.isRaceWeek)!;
      const raceRowMi = raceWeek.days.filter((d) => d.type === 'race').reduce((s, d) => s + d.distanceMi, 0);
      const raceWkTotal = weekTotal(raceWeek);
      const raceWkTraining = raceWkTotal - raceRowMi;
      const pers = wouldPersist(input, res);
      // also: are there ANY taper-phase weeks, and what's their volume?
      const taperWeeks = weeks.filter((w) => w.phase === 'TAPER');
      const peakBuildWk = buildWeeks.find((w) => weekTotal(w) === peakBuildDaySum);
      rows.push({
        tag: c.tag,
        mpw: c.mpw,
        recentLongMi: c.long,
        nWeeks: weeks.length,
        peakBuildDaySum,
        peakBuildField,
        raceWkTotal,
        raceRowMi,
        raceWkTraining,
        INV6_violation: raceWkTraining >= peakBuildDaySum,
        persists: pers.ok,
        persistErr: pers.err ?? null,
        peakBuildWeekDump: peakBuildWk ? dump(peakBuildWk) : null,
        raceWeekDump: dump(raceWeek),
        taperWkVols: taperWeeks.map((w) => ({ field: w.weeklyMi, daysum: weekTotal(w), dump: dump(w) })),
      });
    }
    writeFileSync('/tmp/_r3_lowvol_taper.json', JSON.stringify(rows, null, 2));
    expect(rows.length).toBe(cases.length);
  });
});
