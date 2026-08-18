/**
 * DOCTRINE-TID-1 · the 80/20 rule, which the engine had in no form at all.
 *
 * `Research/00a-distance-running-training.md` states the constraint twice —
 * "converge on ≥75% of training volume in Z1" in the TID section, and
 * "| Most base running is easy | 75–90% in Z1 |" in the base-building rules —
 * and until 2026-08-17 nothing in the generator measured intensity
 * distribution, let alone held it.
 *
 * What it was costing, measured by the function this file tests: the marathon
 * RACE-SPECIFIC block ran at 58-71% easy, because `longFinishSegment` puts a
 * 50%-of-the-long marathon-pace finish on EVERY race-specific week and
 * `qualityTypesFor` puts two structured sessions beside it. Research/04 §4.4
 * gives that long run a cadence of "6-10 weeks out"; §16 "Combinations to
 * avoid" names the pairing outright.
 *
 * The tests below assert the floor holds across the archetype matrix, and —
 * just as important — that the correction is INERT on plans that already
 * cleared it. A constraint that quietly reshapes healthy plans is a worse bug
 * than the one it fixes.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_intensity_doctrine.test.ts
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { planIntensity, weekIntensity, splitDay, EASY_SHARE_FLOOR } from './intensity-distribution';
import type { SimDistance } from './sim-constants';

const base = {
  startDateISO: '2026-07-06', raceDateISO: '2027-03-01', lastRaceFinishedDaysAgo: 0,
  lastRaceDistance: null, raceHistory: [], longRunDay: 'sun', restDay: 'sat', availableDays: [],
} as any;

const GOAL_SEC: Record<SimDistance, number> = {
  '5k': 1350, '10k': 2700, half: 6300, marathon: 13500, '50k': 18000, '100k': 43200,
};
const WEEKS: Record<SimDistance, number> = {
  '5k': 12, '10k': 12, half: 14, marathon: 18, '50k': 22, '100k': 24,
};

describe('DOCTRINE-TID-1 · easy/hard intensity distribution', () => {
  it('splits a day into easy and quality MILES, not easy and quality days', () => {
    // The whole measurement turns on this. A "2 mi WU · 4 mi @ T · 2 mi CD"
    // session is eight miles of which four are Z1 — counting the day as hard
    // would report a healthy marathon build near 45% easy and demand
    // corrections doctrine never asked for.
    const tempo = splitDay({ type: 'tempo', distanceMi: 8, subLabel: '2 mi WU · 4 mi @ T · 2 mi CD' });
    expect(tempo.qualityMi).toBeCloseTo(4, 1);
    expect(tempo.easyMi).toBeCloseTo(4, 1);

    // Jog floats between reps are Z1 recovery (Research/04 §1) and stay easy.
    const reps = splitDay({ type: 'intervals', distanceMi: 8, subLabel: '5×1mi @ I pace · 90s jog' });
    expect(reps.qualityMi).toBeLessThanOrEqual(5);
    expect(reps.easyMi).toBeGreaterThan(2);

    // A long run is easy except the finish segment its label declares.
    const long = splitDay({ type: 'long', distanceMi: 20, subLabel: 'LONG · 8mi @ MP', isLong: true });
    expect(long.qualityMi).toBeCloseTo(8, 1);
    expect(long.easyMi).toBeCloseTo(12, 1);
    expect(splitDay({ type: 'long', distanceMi: 20, subLabel: 'LONG', isLong: true }).qualityMi).toBe(0);

    // Strides are "Not a workout" (Research/04:349) and never count against it.
    expect(splitDay({ type: 'easy', distanceMi: 6, subLabel: 'EASY · 6×20s strides' }).qualityMi).toBe(0);
  });

  it('every training week of every archetype clears the doctrine floor', () => {
    const failures: string[] = [];
    for (const distance of ['5k', '10k', 'half', 'marathon', '50k'] as SimDistance[]) {
      for (const experienceLevel of ['beginner', 'intermediate', 'advanced'] as const) {
        for (const weeklyMileageBucket of [15, 25, 35, 45]) {
          for (const weeklyFrequency of [4, 5, 6]) {
            const r = buildSimPlan({
              ...base, goalMode: 'goal', distance, experienceLevel, weeklyMileageBucket,
              weeklyFrequency, planWeeks: WEEKS[distance], goalTimeSec: GOAL_SEC[distance],
              longestRunBucket: weeklyMileageBucket >= 35 ? '10+' : '6-10',
            } as any);
            if (!r.ok) continue;
            for (const [i, w] of r.composed.weeks.entries()) {
              // TAPER and race weeks are exempt by doctrine, not convenience:
              // Research/08 §9.1's taper is volume-cut with intensity PRESERVED,
              // so its hard share rises by design, and a race week's biggest
              // number is the race, which is not training volume.
              if (w.isRaceWeek || w.phase === 'TAPER') continue;
              const share = weekIntensity(w as never).easyShare;
              if (share < EASY_SHARE_FLOOR - 0.005) {
                failures.push(
                  `${distance}/${experienceLevel}/${weeklyMileageBucket}mi/f${weeklyFrequency} ` +
                  `wk${i} (${w.phase}) = ${(share * 100).toFixed(1)}%`,
                );
              }
            }
          }
        }
      }
    }
    expect(failures.slice(0, 12).join('\n')).toBe('');
  });

  it('a plan that already clears the floor keeps its race-pace long runs', () => {
    // The correction can only ever REDUCE a long-run finish, so the way it
    // would misfire is by trimming a plan that never needed trimming. A half at
    // 35 mi/wk sat at 87% easy before this pass existed; every race-specific
    // long must still carry a real race-pace segment afterwards.
    //
    // 5K, 10K and ultra are not usable here: longFinishSegment returns null for
    // them by design — those distances train race pace through reps, not
    // long-run inserts — so they have no finish to preserve either way.
    const r = buildSimPlan({
      ...base, goalMode: 'goal', distance: 'half', experienceLevel: 'intermediate',
      weeklyMileageBucket: 35, weeklyFrequency: 5, planWeeks: 14,
      goalTimeSec: GOAL_SEC.half, longestRunBucket: '6-10',
    } as any);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let checked = 0;
    for (const w of r.composed.weeks) {
      if (w.phase !== 'RACE-SPECIFIC' || w.isRaceWeek) continue;
      const long = w.days.find((d) => d.isLong && d.type === 'long');
      if (!long) continue;
      const m = String(long.subLabel).match(/(\d+(?:\.\d+)?)mi @ (?:HM|MP|M)\b/);
      expect(m, `half RACE-SPECIFIC long lost its race-pace finish: "${long.subLabel}"`).toBeTruthy();
      // What "still reads as a race-pace session" means is stated by doctrine,
      // not by a share of the long: `Research/04-workout-vocabulary.md` §4.5
      // sizes a fast-finish long as "final 2-6 mi at MP or slightly faster".
      // Two miles is therefore the floor, and it is a stronger claim than the
      // 25%-of-the-long proxy that stood here — a quarter of a short long is
      // under two miles and would have passed.
      //
      // DAY-SIZE-1 (2026-08-17) · the proxy is what the change moved. With
      // quality days sized as warm-up + at-pace work + cool-down, this
      // archetype's threshold session reaches 4 mi at T — the bottom of §5.3's
      // own 4-8 mi band, which the 22% whole-day share never let it reach — and
      // the intensity floor gives the difference back out of the long's finish,
      // which is the give-back order `applyIntensityFloor` documents. The
      // week's total hard mileage is unchanged to within a tenth (8.8 -> 8.75
      // on 36 mi); what moved is that it now sits in a real cruise-interval
      // session instead of being spread across an undersized one and an
      // oversized long-run finish.
      expect(Number(m![1])).toBeGreaterThanOrEqual(2);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the marathon keeps marathon-pace long runs after the correction', () => {
    // The floor gives back finish miles; it must not delete the stimulus. A
    // race-specific block with no MP running at all would satisfy 80/20 and
    // fail Research/22 §4.
    const r = buildSimPlan({
      ...base, goalMode: 'goal', distance: 'marathon', experienceLevel: 'advanced',
      weeklyMileageBucket: 55, weeklyFrequency: 6, planWeeks: 18, goalTimeSec: 11400,
      longestRunBucket: '10+', bestRecentVdotOverride: 48,
    } as any);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rs = r.composed.weeks.filter((w) => w.phase === 'RACE-SPECIFIC');
    const withMp = rs.filter((w) => w.days.some((d) => d.isLong && /@ (MP|M)\b/.test(d.subLabel ?? '')));
    expect(withMp.length).toBeGreaterThan(0);
    expect(planIntensity(r.composed.weeks as never).easyShare).toBeGreaterThanOrEqual(EASY_SHARE_FLOOR);
  });
});
