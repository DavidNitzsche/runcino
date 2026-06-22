import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  composePlan,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  type ComposePlanInput,
  type DOW,
} from './generate';
import { buildWorkoutSpec, capSpecToDistance, totalDistanceMiFromSpec, tPaceFromGoal } from './spec-builder';

const START_MONDAY = '2026-01-05';

// Reconstruct the David persona EXACTLY as _audit_periodization does.
function davidInput(): ComposePlanInput {
  const distanceMi = 26.2, goalSec = 10800, weeksOut = 16, weeklyBaseMi = 60;
  const cat = distanceCategoryOfPublic(distanceMi);
  const raceDay = new Date(START_MONDAY + 'T12:00:00Z');
  raceDay.setUTCDate(raceDay.getUTCDate() + weeksOut * 7 - 1);
  return {
    raceDistanceMi: distanceMi,
    goalSec,
    goalPaceSec: Math.round(goalSec / distanceMi),
    raceDateISO: raceDay.toISOString().slice(0, 10),
    startMondayISO: START_MONDAY,
    level: 'advanced',
    recentWeeklyMi: weeklyBaseMi,
    easyDayMedianMi: Math.max(3, Math.round(weeklyBaseMi / 5)),
    recentLongMi: 14,
    isMidBlock: false,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: tPaceFromGoal(goalSec, distanceMi),
    lthr: null,
    maxHr: null,
  } as ComposePlanInput;
}

describe('R3 INV-12: does capSpecToDistance touch the David advanced-marathon plan?', () => {
  it('replicate persist spec chain on every David quality day; capping must be a no-op', () => {
    const input = davidInput();
    const res = composePlan(input);
    const modifiedByCapping: Array<Record<string, unknown>> = [];
    const qualityOverLong: Array<Record<string, unknown>> = [];

    for (const w of res.weeks) {
      const weekT = (w as { tPaceSec?: number | null }).tPaceSec ?? input.tPaceSec;
      // week long persisted distance (single-segment -> distanceMi as-is)
      const longDay = w.days.find(d => d.isLong);
      const longMi = longDay ? longDay.distanceMi : 0;
      for (const d of w.days) {
        if (!d.isQuality) continue;
        if (weekT == null) continue;
        const built = buildWorkoutSpec(
          d.type, d.distanceMi, weekT, input.lthr ?? null, d.subLabel, input.maxHr ?? null,
          input.goalPaceSec ?? null, null,
        );
        const preTotal = totalDistanceMiFromSpec(built.spec, d.distanceMi);
        const capped = capSpecToDistance(built.spec, d.distanceMi);
        const postTotal = totalDistanceMiFromSpec(capped, d.distanceMi);
        const wasModified = JSON.stringify(capped) !== JSON.stringify(built.spec);
        if (wasModified) {
          modifiedByCapping.push({
            wkStart: w.startISO, type: d.type, sub: d.subLabel,
            dDist: d.distanceMi, preTotal, postTotal,
          });
        }
        if (longMi > 0 && postTotal > longMi + 0.001) {
          qualityOverLong.push({
            wkStart: w.startISO, type: d.type, sub: d.subLabel,
            persisted: postTotal, longMi,
          });
        }
      }
    }

    writeFileSync('/tmp/r3_david_cap.json', JSON.stringify({
      modifiedByCappingCount: modifiedByCapping.length,
      modifiedByCapping,
      qualityOverLongCount: qualityOverLong.length,
      qualityOverLong,
    }, null, 1));

    // INVARIANT 12: the protected David plan must NOT be touched by capping,
    // AND must not violate quality<=long.
    expect(modifiedByCapping.length, 'capping modified a David quality spec').toBe(0);
    expect(qualityOverLong.length, 'David quality persisted > long').toBe(0);
  });
});
