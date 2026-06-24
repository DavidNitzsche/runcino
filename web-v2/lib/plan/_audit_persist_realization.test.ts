/**
 * PERSIST-REALIZATION gate (re-audit 2026-06-23) — closes the blind spot that hid BRK-1 + PP-1.
 *
 * The all-user sweep grades the COMPOSED tree (stops at finalizeComposedPlan); prod ships the
 * REALIZED spec (buildWorkoutSpec → capSpecToDistance). This replicates persistPlan's per-day math
 * and asserts, across the matrix INCLUDING soft-goal archetypes (runner fitter than the goal):
 *   - NO INVERSION: every quality work-pace is FASTER than easy (BRK-1).
 *   - PERSIST PARITY: |persisted − composed| ≤ 0.5mi per day (PP-1).
 *   - LONG PRIMACY in the persisted plan: no quality day realizes longer than the week's long.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { buildWorkoutSpec, capSpecToDistance, totalDistanceMiFromSpec, conservativeVdotFromMileage } from './spec-builder';
import { tPaceFromVdot, iPaceFromVdot, vdotFromTpace } from '@/lib/training/vdot';
import { distanceCategoryOf } from './goal-tiers';
import { SIM_DISTANCE_MI, type SimDistance } from './sim-constants';

const DISTANCES: SimDistance[] = ['5k', '10k', 'half', 'marathon', '50k', '100k'];
const GOAL_SEC: Record<SimDistance, number> = { '5k': 1350, '10k': 2700, half: 6300, marathon: 13500, '50k': 18000, '100k': 43200 };

// replicate persistPlan's per-day realization (generate.ts:2390-2412)
function realize(dayType: string, distanceMi: number, weekT: number, subLabel: string, goalPaceSec: number | null, cat: string) {
  const goalIPaceEligible = ['5k', '10k', 'hm'].includes(cat);
  const iPaceSec = goalIPaceEligible ? iPaceFromVdot(vdotFromTpace(weekT)) : null;
  const built = buildWorkoutSpec(dayType, distanceMi, weekT, null, subLabel, null, goalPaceSec, iPaceSec, null);
  const persisted = totalDistanceMiFromSpec(capSpecToDistance(built.spec, distanceMi), distanceMi);
  return { paceTarget: built.paceTargetSPerMi, persisted };
}

describe('PERSIST realization · no inversion + persist≤long', () => {
  // soft-goal (runner FITTER than the goal) is the BRK-1 trigger; pair a fast fitness override with a
  // soft standard goal. Plus the standard case and a tiny-budget low-volume case for PP-1.
  const cases: Array<{ tag: string; exp: string; freq: number; mi: number; L: string; vdot?: number }> = [
    { tag: 'standard-int', exp: 'intermediate', freq: 5, mi: 25, L: '6-10' },
    { tag: 'standard-adv', exp: 'advanced', freq: 6, mi: 45, L: '10+' },
    { tag: 'soft-goal (fit runner)', exp: 'advanced', freq: 6, mi: 45, L: '10+', vdot: 62 },
    { tag: 'tiny-budget', exp: 'beginner', freq: 5, mi: 5, L: '0-3' },
  ];
  it('every distance × case: quality faster than easy, persisted ≈ composed, quality ≤ long', () => {
    let checks = 0;
    for (const distance of DISTANCES) for (const c of cases) {
      const r = buildSimPlan({
        goalMode: 'goal', distance, planWeeks: distance === 'marathon' ? 18 : distance === '50k' ? 22 : distance === '100k' ? 24 : distance === 'half' ? 16 : 12,
        goalTimeSec: GOAL_SEC[distance], startDateISO: '2026-07-06', raceDateISO: '', lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
        experienceLevel: c.exp, weeklyFrequency: c.freq, weeklyMileageBucket: c.mi, longestRunBucket: c.L,
        raceHistory: [], longRunDay: 'sun', availableDays: [], bestRecentVdotOverride: c.vdot,
      } as any);
      if (!r.ok) continue;
      const cat = distanceCategoryOf(r.raceDistanceMi);
      const easyAnchorT = tPaceFromVdot(r.derived.bestRecentVdot ?? conservativeVdotFromMileage(r.derived.recentWeeklyMi)) ?? 480;
      const easyFloor = easyAnchorT + 80; // E = easyAnchorT + 80 (spec-builder)
      for (const w of r.composed.weeks as any[]) {
        if (w.isRaceWeek) continue;
        const weekT = w.tPaceSec ?? r.derived.tPaceSec;
        if (weekT == null) continue;
        const longMi = Math.max(0, ...w.days.filter((d: any) => d.isLong && d.type !== 'race').map((d: any) => d.distanceMi));
        const longPersisted = longMi > 0 ? realize('long', longMi, weekT, w.days.find((d: any) => d.isLong)?.subLabel ?? '', r.derived.goalPaceSec, cat).persisted : Infinity;
        for (const d of w.days) {
          if (!d.isQuality || d.type === 'race' || d.type === 'race_week_tuneup' || d.type === 'shakeout') continue;
          const { paceTarget, persisted } = realize(d.type, d.distanceMi, weekT, d.subLabel ?? '', r.derived.goalPaceSec, cat);
          checks++;
          // BRK-1 · quality work-pace strictly faster than the easy floor (lower s/mi)
          expect(paceTarget, `${c.tag}/${distance} ${d.type} pace ${paceTarget} not < easy ${easyFloor}`).toBeLessThan(easyFloor);
          // PP-1 · persisted ≈ composed
          expect(Math.abs(persisted - d.distanceMi), `${c.tag}/${distance} ${d.type} persisted ${persisted} vs composed ${d.distanceMi}`).toBeLessThanOrEqual(0.55);
          // long-primacy in the PERSISTED plan
          expect(persisted, `${c.tag}/${distance} ${d.type} persisted ${persisted} > long ${longPersisted}`).toBeLessThanOrEqual(longPersisted + 0.15);
        }
      }
    }
    expect(checks).toBeGreaterThan(50);
  });
});
