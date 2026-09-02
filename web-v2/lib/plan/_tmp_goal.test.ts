import { describe, it } from 'vitest';
import fs from 'node:fs';
import { composePlan, inlinePrescriptions, type ComposePlanInput, type DOW } from './generate';
import { tPaceFromGoal } from './spec-builder';

describe('tmp', () => {
  it('goal diff', () => {
    const base = (goalSec: number): ComposePlanInput => ({
      raceDistanceMi: 26.2, goalSec, goalPaceSec: Math.round(goalSec / 26.2),
      raceDateISO: '2026-12-06', startMondayISO: '2026-08-17', level: 'advanced',
      recentWeeklyMi: 45, easyDayMedianMi: 7, recentLongMi: 18, bestRecentVdot: 48,
      isMidBlock: true, longRunDow: 0 as DOW, restDow: 6 as DOW, qualityDows: [2, 4] as DOW[],
      availableDows: null, trainingDaysPerWeek: null, crossModes: [],
      rxQuality: inlinePrescriptions('m'), rxRaceSpecific: inlinePrescriptions('m'),
      tPaceSec: tPaceFromGoal(10800, 26.2), lthr: null, maxHr: null,
    });
    const a = composePlan(base(Math.round(10800 * 0.85)));
    const b = composePlan(base(Math.round(10800 * 1.15)));
    const out: string[] = [];
    for (let i = 0; i < a.weeks.length; i++) {
      const wa = a.weeks[i]; const wb = b.weeks[i];
      if (wa.weeklyMi !== wb.weeklyMi) out.push(`wk${i} ${wa.startISO} vol ${wa.weeklyMi} vs ${wb.weeklyMi}`);
      for (let d = 0; d < wa.days.length; d++) {
        const da = wa.days[d]; const db = wb.days[d];
        if (da.distanceMi !== db.distanceMi || da.type !== db.type || da.isLong !== db.isLong || da.isQuality !== db.isQuality) {
          out.push(`wk${i} ${wa.startISO} dow${da.dow} ${da.type}/${da.distanceMi}/${da.isLong ? 'L' : ''}${da.isQuality ? 'Q' : ''} vs ${db.type}/${db.distanceMi}/${db.isLong ? 'L' : ''}${db.isQuality ? 'Q' : ''}`);
        }
      }
    }
    fs.writeFileSync('/tmp/goaldiff.txt', out.join('\n') || '(identical)');
  });
});
