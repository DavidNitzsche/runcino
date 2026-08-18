import { describe, it } from 'vitest';
import { buildSimPlan } from './sim-inputs';

describe('screenshot exact params', () => {
  it('5k race / 5-15mpw / 3days / 6-10 longest / intermediate', () => {
    const r = buildSimPlan({
      goalMode: 'race', distance: '5k', raceDateISO: '2026-09-13',
      startDateISO: '2026-06-25', experienceLevel: 'intermediate',
      weeklyFrequency: 3, weeklyMileageBucket: 5, longestRunBucket: '6-10',
      raceHistory: [], goalTimeSec: null, planWeeks: 12,
      longRunDay: 'sun', restDay: 'sat', availableDays: [],
    });
    if (!r.ok) { console.log('FAIL:', r.reason); return; }
    console.log('trainingDaysPerWeek:', r.derived.trainingDaysPerWeek);
    console.log('recentWeeklyMi:', r.derived.recentWeeklyMi);
    console.log('recentLongMi:', r.derived.recentLongMi);
    r.composed.weeks.slice(0, 2).forEach((w: any, i: number) => {
      const runs = w.days.filter((d: any) => d.distanceMi > 0);
      console.log('W' + (i+1), w.phase, w.weeklyMi + 'mi', runs.length + ' days:', runs.map((d: any) => `dow${d.dow}(${d.type},${d.distanceMi}mi)`).join(' '));
    });
  });
});
