/**
 * B3 + SP-7 regression guard (third deep audit, 2026-06-23).
 *
 * B3   · quality scheduling orders intervals last + re-spaces only on violation, so 10k/hm
 *        plans are gap-legal (Research/00b:55-60) where feasible.
 * SP-7 · validateComposedPlan now has long-primacy / race-chronology / stimulus-gap invariants
 *        (the "910 green but structurally broken" gap). Here we prove the long-primacy net bites.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { validateComposedPlan, PlanValidationError } from './validate';

const base = {
  startDateISO: '2026-07-06', raceDateISO: '', lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
  raceHistory: [], longRunDay: 'sun', availableDays: [], weeklyFrequency: 6,
} as any;

describe('B3 + SP-7', () => {
  it('B3 · hm/10k feasible weeks have no under-recovered intervals day', () => {
    for (const [dist, weeks, goal, vdot] of [['half', 16, 5370, 54], ['10k', 14, 2400, 50]] as const) {
      const r = buildSimPlan({ ...base, goalMode: 'goal', distance: dist, planWeeks: weeks, goalTimeSec: goal,
        experienceLevel: 'advanced', weeklyMileageBucket: 45, longestRunBucket: '10+', bestRecentVdotOverride: vdot });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      for (const w of r.composed.weeks) {
        const hard = w.days.filter((d: any) => (d.isQuality || d.isLong) && d.type !== 'race' && d.type !== 'shakeout' && d.type !== 'race_week_tuneup')
          .map((d: any) => ({ dow: d.dow, type: d.type, g: d.type === 'intervals' ? 2 : 1 }))
          .sort((a: any, b: any) => a.dow - b.dow);
        if (hard.length < 2) continue;
        const required = hard.reduce((s: number, h: any) => s + h.g, 0);
        if (required > 7 - hard.length) continue; // over-constrained — skip (best-achievable)
        for (let i = 0; i < hard.length; i++) {
          const cur = hard[i], nxt = hard[(i + 1) % hard.length];
          const between = ((nxt.dow - cur.dow + 7) % 7) - 1;
          expect(between).toBeGreaterThanOrEqual(cur.g);
        }
      }
    }
  });

  it('SP-7 · validator rejects an easy ≥ long inversion that passes every other check', () => {
    const r = buildSimPlan({ ...base, goalMode: 'goal', distance: 'marathon', planWeeks: 18, goalTimeSec: 12600,
      experienceLevel: 'advanced', weeklyMileageBucket: 45, longestRunBucket: '10+', bestRecentVdotOverride: 54 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // sanity: the clean plan validates
    expect(() => validateComposedPlan(r.composed, r.raceDistanceMi, r.mode, r.validateCtx)).not.toThrow();
    // corrupt a future, non-race week: push an easy day above the long
    const wk = r.composed.weeks.find((w: any) => !w.isRaceWeek && w.days.some((d: any) => d.isLong && d.type !== 'race') && w.days.some((d: any) => d.type === 'easy'));
    expect(wk).toBeTruthy();
    if (!wk) return;
    const long = wk.days.find((d: any) => d.isLong && d.type !== 'race')!;
    const easy = wk.days.find((d: any) => d.type === 'easy')!;
    easy.distanceMi = long.distanceMi + 5;
    expect(() => validateComposedPlan(r.composed, r.raceDistanceMi, r.mode, r.validateCtx)).toThrow(PlanValidationError);
  });
});
