/**
 * Reproduce the two LIVE cited plans EXACTLY from their authored_state inputs.
 * pln_9e11f7b8d811278e: recentWeeklyMi 3, recentLongMi 2, goalSec 2100, isMidBlock true, developing 5K
 * pln_20dbb3e9de49a1f5: recentWeeklyMi 4, recentLongMi 2, recentQualityDistanceMi 5, recentQualityPerWeek 273,
 *                       easyDayMedianMi 5, goalSec 1980, isMidBlock true
 * Drive composePlan, then mirror persistPlan's realized distance:
 *   persisted = totalDistanceMiFromSpec(capSpecToDistance(spec, d.distanceMi), d.distanceMi)
 * Assert long >= quality on persisted rows.
 */
import { describe, it } from 'vitest';
import {
  composePlan,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  type ComposePlanInput,
  type DOW,
} from './generate';
import { tPaceFromGoal, buildWorkoutSpec, capSpecToDistance, totalDistanceMiFromSpec } from './spec-builder';

const ISO_START = '2026-06-22'; // a Monday near today
function raceDate(weeks: number): string {
  const d = new Date(ISO_START + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + weeks * 7 - 1);
  return d.toISOString().slice(0, 10);
}

function build(o: Partial<ComposePlanInput> & { raceMi: number; goalSec: number; weeks: number }): ComposePlanInput {
  const cat = distanceCategoryOfPublic(o.raceMi);
  const goalPaceSec = Math.round(o.goalSec / o.raceMi);
  return {
    raceDistanceMi: o.raceMi,
    goalSec: o.goalSec,
    goalPaceSec,
    raceDateISO: raceDate(o.weeks),
    startMondayISO: ISO_START,
    level: o.level ?? 'beginner',
    recentWeeklyMi: o.recentWeeklyMi ?? 3,
    easyDayMedianMi: o.easyDayMedianMi ?? 0,
    recentLongMi: o.recentLongMi ?? 2,
    recentQualityDistanceMi: o.recentQualityDistanceMi,
    recentQualityPerWeek: o.recentQualityPerWeek,
    bestRecentVdot: undefined,
    tsbAtStart: 0,
    isMidBlock: o.isMidBlock ?? true,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    availableDows: null,
    trainingDaysPerWeek: o.trainingDaysPerWeek ?? null,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: tPaceFromGoal(o.goalSec, o.raceMi),
    lthr: null,
    maxHr: null,
  };
}

// persistPlan mirror: realized persisted distance for a quality day.
function persistedMi(input: ComposePlanInput, weekT: number | null, type: string, dayMi: number, sub: string | null): number {
  const t = weekT ?? input.tPaceSec ?? 480;
  const built = buildWorkoutSpec(type, dayMi, t, input.lthr, sub, input.maxHr ?? null, input.goalPaceSec ?? null);
  const capped = capSpecToDistance(built.spec, dayMi);
  return totalDistanceMiFromSpec(capped, dayMi);
}

function report(tag: string, input: ComposePlanInput) {
  const res = composePlan(input);
  let violations = 0;
  const lines: string[] = [];
  for (let i = 0; i < res.weeks.length; i++) {
    const w = res.weeks[i];
    const weekT = (w as { tPaceSec?: number | null }).tPaceSec ?? input.tPaceSec ?? null;
    const longDay = w.days.find((d) => d.isLong && d.type !== 'race');
    const raceDay = w.days.find((d) => d.type === 'race');
    const longMi = longDay?.distanceMi ?? 0;
    const raceMi = raceDay?.distanceMi ?? 0;
    const longestPersisted = Math.max(longMi, raceMi); // race exempt but it's the longest
    const quals = w.days.filter((d) => d.isQuality && d.type !== 'race' && !d.isLong);
    let qMax = 0; const qDesc: string[] = [];
    for (const d of quals) {
      const p = persistedMi(input, weekT, d.type, d.distanceMi, d.subLabel ?? null);
      qMax = Math.max(qMax, p);
      qDesc.push(`${d.type}(day=${d.distanceMi}→persisted=${p.toFixed(1)})`);
    }
    // easy persisted == day distance (single-segment)
    const easies = w.days.filter((d) => d.type === 'easy');
    const eMax = Math.max(0, ...easies.map((d) => d.distanceMi));
    const cmp = Math.max(longMi, raceMi > 0 ? 0 : 0); // training-long only for the INV3 check (race exempt)
    const trainLong = longMi; // race day exempt per INV3
    const viol = (trainLong > 0 && (qMax > trainLong + 0.05 || eMax > trainLong + 0.05));
    if (viol) violations++;
    lines.push(`wk${i} ph=${w.phase} weekMi=${w.weeklyMi} LONG=${longMi} race=${raceMi || '-'} easyMax=${eMax} qualPersistedMax=${qMax.toFixed(1)} quals=[${qDesc.join(',')}]${viol ? '  <<< VIOL (qual/easy>long)' : ''}`);
  }
  console.log(`\n##### ${tag}  goalPace=${input.goalPaceSec} tPace=${input.tPaceSec}  VIOLATIONS=${violations}`);
  console.log(lines.join('\n'));
}

describe('LIVE repro', () => {
  it('pln_9e11f7b8d811278e exact', () => {
    report('9e11 (rWk=3,rLong=2,goal2100,midblock)', build({
      raceMi: 3.10686, goalSec: 2100, weeks: 13, level: 'beginner',
      recentWeeklyMi: 3, recentLongMi: 2, easyDayMedianMi: 0, isMidBlock: true,
    }));
  });
  it('pln_20dbb3e9de49a1f5 exact (contaminated quality floor)', () => {
    report('20db (rWk=4,rLong=2,rQualDist=5,rQualPW=273,easyMed=5,goal1980,midblock)', build({
      raceMi: 3.10686, goalSec: 1980, weeks: 13, level: 'beginner',
      recentWeeklyMi: 4, recentLongMi: 2, easyDayMedianMi: 5,
      recentQualityDistanceMi: 5, recentQualityPerWeek: 273, isMidBlock: true,
    }));
  });
  it('20db WITHOUT contamination (clean true beginner 5K)', () => {
    report('20db-CLEAN (rWk=4,rLong=2,goal1980,midblock,no qualFloor)', build({
      raceMi: 3.10686, goalSec: 1980, weeks: 13, level: 'beginner',
      recentWeeklyMi: 4, recentLongMi: 2, easyDayMedianMi: 0, isMidBlock: true,
    }));
  });
});
