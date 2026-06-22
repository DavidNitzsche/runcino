/**
 * Round-3 · S2 follow-up. Does ANY plan that PERSISTS (passes validateComposedPlan
 * race-prep) also violate INV6 (race-week training day-sum >= build-peak day-sum)?
 * Sweep beginner+intermediate × 5K/10K × mpw 5..40 × freq null/3/4/5 × planWeeks.
 * Report only the cases that BOTH persist AND violate INV6 (the real shipping bug),
 * plus the closest near-misses.
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  composePlan,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  type ComposePlanInput,
  type ComposedWeek,
  type DOW,
} from './generate';
import { validateComposedPlan, type PlanValidationContext } from './validate';
import { tPaceFromGoal } from './spec-builder';

const START_MONDAY = '2026-01-05';

function build(opts: {
  level: 'beginner' | 'intermediate' | 'advanced' | null;
  mpw: number;
  freq: number | null;
  distMi: number;
  goalPaceSec: number | null;
  longMi: number;
  planWeeks: number;
}): ComposePlanInput {
  const raceDay = new Date(START_MONDAY + 'T12:00:00Z');
  raceDay.setUTCDate(raceDay.getUTCDate() + opts.planWeeks * 7 - 1);
  const raceDateISO = raceDay.toISOString().slice(0, 10);
  const cat = distanceCategoryOfPublic(opts.distMi);
  const goalSec = opts.goalPaceSec != null ? Math.round(opts.goalPaceSec * opts.distMi) : null;
  return {
    raceDistanceMi: opts.distMi,
    goalSec,
    goalPaceSec: opts.goalPaceSec,
    raceDateISO,
    startMondayISO: START_MONDAY,
    level: opts.level,
    recentWeeklyMi: opts.mpw,
    easyDayMedianMi: Math.max(3, Math.round(opts.mpw / 5)),
    recentLongMi: opts.longMi,
    isMidBlock: false,
    longRunDow: 0,
    restDow: 1,
    qualityDows: [2, 4],
    availableDows: null,
    trainingDaysPerWeek: opts.freq,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: tPaceFromGoal(goalSec, opts.distMi),
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
function persists(input: ComposePlanInput, res: ReturnType<typeof composePlan>): boolean {
  const ctx: PlanValidationContext = {
    level: input.level,
    isSteppingStoneToMarathon: false,
    priorPlanPeakLongMi: null,
    todayISO: '2026-01-04',
    trainingDaysPerWeek: input.trainingDaysPerWeek,
    trailingAvgWeeklyMi: input.recentWeeklyMi > 0 ? input.recentWeeklyMi : null,
  };
  try { validateComposedPlan(res, input.raceDistanceMi, 'race-prep', ctx); return true; }
  catch { return false; }
}

describe('R3 · S2 persisting-AND-violating sweep', () => {
  it('finds plans that pass validation yet ship a race week >= build peak', () => {
    const LEVELS: Array<'beginner' | 'intermediate' | 'advanced' | null> = ['beginner', 'intermediate', 'advanced', null];
    const DISTS = [3.1, 6.2]; // 5K, 10K (short races = hardcoded tuneup=4/shakeout=2)
    const PACES: Record<string, (number | null)[]> = {
      '5k': [null, 300, 390, 540],
      '10k': [null, 330, 420, 600],
    };
    const MPW = [5, 6, 8, 10, 12, 15, 18, 20, 22, 25, 28, 30, 35, 40];
    const FREQ: (number | null)[] = [null, 3, 4, 5, 6];
    const PLANWK = [8, 12, 16];

    const persistingViolations: any[] = [];
    const nearMisses: any[] = [];
    let totalPersist = 0;
    let totalViolate = 0;

    for (const level of LEVELS) {
      for (const distMi of DISTS) {
        const cat = distanceCategoryOfPublic(distMi);
        for (const goalPaceSec of PACES[cat]) {
          for (const mpw of MPW) {
            for (const freq of FREQ) {
              for (const planWeeks of PLANWK) {
                const longMi = Math.max(2, Math.round(mpw * 0.25));
                const input = build({ level, mpw, freq, distMi, goalPaceSec, longMi, planWeeks });
                let res;
                try { res = composePlan(input); } catch { continue; }
                const weeks = res.weeks;
                const buildWeeks = weeks.filter((w) => w.phase !== 'TAPER' && !w.isRaceWeek);
                const peakBuild = buildWeeks.length ? Math.max(...buildWeeks.map(weekTotal)) : 0;
                const raceWeek = weeks.find((w) => w.isRaceWeek);
                if (!raceWeek || peakBuild <= 0) continue;
                const raceRow = raceWeek.days.filter((d) => d.type === 'race').reduce((s, d) => s + d.distanceMi, 0);
                const rwTrain = weekTotal(raceWeek) - raceRow;
                const doesPersist = persists(input, res);
                const violates = rwTrain >= peakBuild;
                if (doesPersist) totalPersist++;
                if (violates) totalViolate++;
                const rec = {
                  level, mpw, freq, dist: cat, goalPaceSec, planWeeks,
                  peakBuild, rwTrain, ratio: +(rwTrain / peakBuild).toFixed(2),
                  persists: doesPersist, raceWeekDump: dump(raceWeek),
                };
                if (doesPersist && violates) persistingViolations.push(rec);
                else if (doesPersist && rwTrain >= peakBuild * 0.85) nearMisses.push(rec);
              }
            }
          }
        }
      }
    }
    // dedup
    const dedup = (arr: any[]) => {
      const seen = new Set<string>(); const out: any[] = [];
      for (const r of arr) {
        const k = `${r.level}|${r.dist}|${r.peakBuild}|${r.rwTrain}|${r.persists}`;
        if (seen.has(k)) continue; seen.add(k); out.push(r);
      }
      return out;
    };
    writeFileSync('/tmp/_r3_persisting_violations.json', JSON.stringify({
      totalPersist, totalViolate,
      persistingViolationCount: persistingViolations.length,
      persistingViolations: dedup(persistingViolations),
      nearMissCount: nearMisses.length,
      nearMisses: dedup(nearMisses).slice(0, 40),
    }, null, 2));
    expect(true).toBe(true);
  }, 120000);
});
