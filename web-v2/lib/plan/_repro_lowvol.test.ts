/**
 * Round-3 adversarial reproduction of S2-LOWVOL-DEGENERATE-1MI-LONG.
 * Clean-room: build ComposePlanInput exactly like _audit_structural's builder,
 * for a 5K beginner recentWeeklyMi=5 recentLongMi=2 goal 35:00 freq 3 12wk.
 * Print long-by-week + persisted-realized quality-vs-long.
 */
import { describe, it, expect } from 'vitest';
import {
  composePlan,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  type ComposePlanInput,
  type DOW,
} from './generate';
import { tPaceFromGoal, buildWorkoutSpec, capSpecToDistance, totalDistanceMiFromSpec } from './spec-builder';

const ISO_START = '2026-01-05'; // Monday
function raceDateForWeeks(weeks: number): string {
  const d = new Date(ISO_START + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + weeks * 7 - 1);
  return d.toISOString().slice(0, 10);
}

function buildInput(o: {
  level: ComposePlanInput['level'];
  weeklyMi: number;
  freq: number | null;
  raceMi: number;
  goalSec: number | null;
  weeks: number;
  recentLongMi?: number;
}): ComposePlanInput {
  const cat = distanceCategoryOfPublic(o.raceMi);
  const goalPaceSec = o.goalSec != null ? Math.round(o.goalSec / o.raceMi) : null;
  return {
    raceDistanceMi: o.raceMi,
    goalSec: o.goalSec,
    goalPaceSec,
    raceDateISO: raceDateForWeeks(o.weeks),
    startMondayISO: ISO_START,
    level: o.level,
    recentWeeklyMi: o.weeklyMi,
    easyDayMedianMi: Math.max(3, Math.round(o.weeklyMi / 5)),
    recentLongMi: o.recentLongMi ?? Math.round(o.weeklyMi * 0.25),
    isMidBlock: false,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    availableDows: null,
    trainingDaysPerWeek: o.freq,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: goalPaceSec != null ? tPaceFromGoal(o.goalSec, o.raceMi) : null,
    lthr: null,
    maxHr: null,
  };
}

// Mirror persistPlan's realized-distance derivation: each quality row's
// PERSISTED distance_mi = totalDistanceMiFromSpec(capSpecToDistance(spec, dayMi)).
function realizedPersistedMi(input: ComposePlanInput, type: string, dayMi: number, prescription: string | null): number {
  const tPace = input.tPaceSec ?? 480;
  const spec = buildWorkoutSpec(type, dayMi, tPace, input.lthr, prescription, input.maxHr, input.goalPaceSec).spec;
  const capped = capSpecToDistance(spec, dayMi);
  return totalDistanceMiFromSpec(capped, dayMi);
}

describe('S2-LOWVOL repro', () => {
  it('5K beginner 5mpw long-by-week + quality-vs-long', () => {
    const input = buildInput({ level: 'beginner', weeklyMi: 5, freq: 3, raceMi: 3.10686, goalSec: 2100, weeks: 12, recentLongMi: 2 });
    const res = composePlan(input);
    const rows: string[] = [];
    for (let i = 0; i < res.weeks.length; i++) {
      const w = res.weeks[i];
      const longDay = w.days.find((d) => d.isLong && d.type !== 'race');
      const raceDay = w.days.find((d) => d.type === 'race');
      const longMi = longDay?.distanceMi ?? (raceDay?.distanceMi ?? 0);
      const quals = w.days.filter((d) => d.isQuality && d.type !== 'race' && !d.isLong);
      const qDesc = quals.map((d) => {
        const realized = realizedPersistedMi(input, d.type, d.distanceMi, d.subLabel ?? null);
        return `${d.type}(day=${d.distanceMi} persisted=${realized.toFixed(1)})`;
      }).join(',');
      const easies = w.days.filter((d) => d.type === 'easy').map((d) => d.distanceMi);
      rows.push(`wk${i} phase=${w.phase} weekMi=${w.weeklyMi} LONG=${(longDay?.distanceMi ?? 0)} race=${raceDay?.distanceMi ?? '-'} easy=[${easies.join(',')}] qual=[${qDesc}]`);
    }
    console.log('GOALpace=' + input.goalPaceSec + ' tPace=' + input.tPaceSec);
    console.log(rows.join('\n'));
    expect(res.weeks.length).toBeGreaterThan(0);
  });

  it('5K beginner mpw boundary scan: long-by-week minLong', () => {
    for (const mpw of [5, 6, 8, 10, 12, 14, 16, 18, 20]) {
      const input = buildInput({ level: 'beginner', weeklyMi: mpw, freq: 3, raceMi: 3.10686, goalSec: 2100, weeks: 12, recentLongMi: Math.round(mpw * 0.25) });
      const res = composePlan(input);
      const trainingLongs = res.weeks
        .filter((w) => !w.isRaceWeek)
        .map((w) => Math.max(0, ...w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi)));
      const minLong = Math.min(...trainingLongs);
      const maxLong = Math.max(...trainingLongs);
      const weekMis = res.weeks.map((w) => w.weeklyMi);
      console.log(`mpw=${mpw}: minLong=${minLong} maxLong=${maxLong} longs=[${trainingLongs.join(',')}] weekMi=[${weekMis.join(',')}]`);
    }
    expect(true).toBe(true);
  });
});
