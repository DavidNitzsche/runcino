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

// replicate persistPlan's per-day realization (generate.ts:2482-2491), FAITHFULLY — real easyAnchorT, and
// I-pace for 5k/10k/hm long inserts AND any race_week_tuneup day (TAPER-SHARP-1). Returns the finish pace too.
function realize(dayType: string, distanceMi: number, weekT: number, subLabel: string, goalPaceSec: number | null, cat: string, easyAnchorT: number) {
  const iPaceSec = (['5k', '10k', 'hm'].includes(cat) || dayType === 'race_week_tuneup') ? iPaceFromVdot(vdotFromTpace(weekT)) : null;
  const built = buildWorkoutSpec(dayType, distanceMi, weekT, null, subLabel, null, goalPaceSec, iPaceSec, easyAnchorT);
  const persisted = totalDistanceMiFromSpec(capSpecToDistance(built.spec, distanceMi), distanceMi);
  return { paceTarget: built.paceTargetSPerMi, persisted, finishPace: (built.spec as any).finish_pace_s_per_mi ?? null as number | null };
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
        const longDay = w.days.find((d: any) => d.isLong && d.type !== 'race');
        const longMi = Math.max(0, ...w.days.filter((d: any) => d.isLong && d.type !== 'race').map((d: any) => d.distanceMi));
        const longReal = longMi > 0 ? realize('long', longMi, weekT, longDay?.subLabel ?? '', r.derived.goalPaceSec, cat, easyAnchorT) : null;
        const longPersisted = longReal ? longReal.persisted : Infinity;
        const qualityPaces: number[] = [];
        for (const d of w.days) {
          // PINV-1 (2026-06-23) · race_week_tuneup IS checked now — a soft-goal '@ race pace' tune-up that
          // realized SLOWER than easy is exactly the inversion that slipped past this guard before.
          if (!d.isQuality || d.type === 'race' || d.type === 'shakeout') continue;
          const { paceTarget, persisted } = realize(d.type, d.distanceMi, weekT, d.subLabel ?? '', r.derived.goalPaceSec, cat, easyAnchorT);
          qualityPaces.push(paceTarget);
          checks++;
          // BRK-1/PINV-1 · quality work-pace strictly faster than the easy floor (ALL quality incl. tune-up)
          expect(paceTarget, `${c.tag}/${distance} ${d.type} pace ${paceTarget} not < easy ${easyFloor}`).toBeLessThan(easyFloor);
          // long-primacy in the PERSISTED plan (ALL quality)
          expect(persisted, `${c.tag}/${distance} ${d.type} persisted ${persisted} > long ${longPersisted}`).toBeLessThanOrEqual(longPersisted + 0.15);
          // PP-1 · persisted ≈ composed. Exempt race_week_tuneup: its fixed WU/CD/rep footprint (~1.1mi)
          // legitimately exceeds a sub-footprint tiny-budget composed allocation (TUNE-FOOTPRINT, flagged).
          if (d.type !== 'race_week_tuneup') {
            expect(Math.abs(persisted - d.distanceMi), `${c.tag}/${distance} ${d.type} persisted ${persisted} vs composed ${d.distanceMi}`).toBeLessThanOrEqual(0.55);
          }
        }
        // PACE-MFIN-T1/LONGFIN-1 (2026-06-23) · the long's M/HM finish must sit IN the marathon zone: SLOWER
        // than the week's FASTEST quality rep (else T<M inverts — the regression PACE-M1 introduced) and
        // FASTER than the easy band (else it's a soft-goal easy-band inversion). Gates the inversion class
        // that regressed twice. Only when both a finish and a quality rep exist this week.
        if (longReal?.finishPace != null && qualityPaces.length) {
          const fastestQuality = Math.min(...qualityPaces);
          expect(longReal.finishPace, `${c.tag}/${distance} long-finish ${longReal.finishPace} ≤ fastest quality ${fastestQuality} (T<M inversion)`).toBeGreaterThan(fastestQuality);
          expect(longReal.finishPace, `${c.tag}/${distance} long-finish ${longReal.finishPace} ≥ easy ${easyFloor} (finish in easy band)`).toBeLessThan(easyFloor);
        }
      }
    }
    expect(checks).toBeGreaterThan(50);
  });
});
