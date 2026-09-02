/**
 * GOALVOL-1 · A TYPED GOAL MAY NOT INCREASE TRAINING VOLUME.
 *
 * David's ruling, 2026-09-02, verbatim:
 *
 *   "A typed goal must not directly increase training volume. Volume must be
 *    governed by demonstrated training history, durable/sustained volume,
 *    recovery, plan phase, and safety constraints. The goal may influence plan
 *    direction and required development, but it cannot manufacture readiness
 *    for more load."
 *
 * ── THE DEFECT THIS FALSIFIES ──────────────────────────────────────────────
 *
 * `lookupTierTarget(goalPaceSec, …)` selected the LOAD row of `TIER_TARGETS`
 * with the runner's typed goal in its first argument, and
 * `classifyGoalTier`'s `advanced`/`advanced_plus` branch was unclamped upward:
 *
 *     TIER_ORD[tier] < TIER_ORD.advanced ? 'advanced' : tier
 *
 * — a floor with no ceiling. Measured on the marathon table: an `advanced`
 * runner whose goal pace crossed the elite line moved from [65, 90] to
 * [70, 100] mi/wk on identical evidence. `volumeCurve` spends
 * `peakWeeklyMileageBand[0]` as a FLOOR on the block's peak, so those five
 * miles are real prescribed load bought by a typed number.
 *
 * ── WHAT THIS FILE ASSERTS, AND IN WHAT ORDER ──────────────────────────────
 *
 *   1 · LIVENESS (Rule 18 point 2). The walk states how many cells it visited
 *       and how many distinct tiers it observed, and FAILS if it saw fewer than
 *       two. A seal test that only ever visits one tier proves nothing and
 *       would report confidence while doing it.
 *   2 · THE SEAL, on the resolver: no goal, at any pace, ever produces a load
 *       tier or a load band above the goal-FREE answer.
 *   3 · THE SEAL, end to end through `composePlan`: two plans for one synthetic
 *       runner differing ONLY in goal pace. This is the assertion the unit test
 *       cannot make, because a leak could enter anywhere between the tier and
 *       `volumeCurve` — `horizonRaise`, the MLR ramp, the long-run share.
 *   4 · RULE 9 · a fine walk across every tier boundary, asserting the peak
 *       band moves monotonically and never inverts (the "fitter runner gets the
 *       worse plan" signature).
 *   5 · RULE 21 · the upward path still exists, and it runs on EVIDENCE:
 *       demonstrated pace lifts the capacity ceiling where a goal cannot.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22, stated not implied) ─────────────────
 *
 *   · A LEAK THAT IS NOT THE TIER. It walks goal pace against composed volume,
 *     so it sees any path from the goal to weekly mileage — but only through
 *     `composePlan`. A goal that reached load through `adapt.ts`, the nightly
 *     flex or the maintenance composer is invisible here; §3 drives the
 *     race-prep path only.
 *   · MAGNITUDE ON THE REDUCTION SIDE. The ruling forbids INCREASE, so this
 *     asserts `<=` and nothing about how far a slow goal may pull a block down.
 *   · THE RESIDUAL, AND IT IS DELIBERATE. `resolveLoadTier` is
 *     `min(capacity, demand)`, so a runner who types a FASTER goal can move
 *     from "reduced" back up to their capacity answer. That is an increase
 *     caused by a typed number, bounded by evidence, and §2 measures it rather
 *     than forbidding it — see the GOALVOL-1 block in `goal-tiers.ts` for why
 *     deleting the reduction half would make the least-evidenced runner in the
 *     app train MORE, and the handback for the open question.
 *   · INTENSITY. `TIER_TARGETS.qualityPerWeek` is checked as a load field, but
 *     how hard a session is does not appear on `ComposedWeek` as a number.
 *
 * ── FALSIFICATION (Rule 18 point 1) ────────────────────────────────────────
 *
 * Run against `main@16664371` — that is, with `resolveLoadTier` replaced by the
 * old `classifyGoalTier` body — §2 fails on
 * `m/advanced/demo=null/goal<=360` (elite [70,100] above the capacity answer
 * advanced [65,90]) and §3 fails with the faster-goal plan peaking above the
 * goal-free plan. Measured across the whole matrix at the time of landing:
 * 1,395 of 8,900 (distance × level × demonstrated × goal-pace) cells moved
 * DOWN and ZERO moved up.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyCapacityTier, goalDemandTier, resolveLoadTier, lookupLoadTierTarget,
  TIER_TARGETS, distanceCategoryOf, type GoalTier, type TierTarget,
} from './goal-tiers';
import { buildSimPlan } from './sim-inputs';
import type { SimInputs } from './sim-constants';

const TIER_ORD: Record<GoalTier, number> = { developing: 0, intermediate: 1, advanced: 2, elite: 3 };

const LEVELS = [null, 'beginner', 'intermediate', 'advanced', 'advanced_plus'] as const;
const DISTANCES: ReadonlyArray<readonly [string, number]> = [
  ['5k', 3.107], ['10k', 6.214], ['hm', 13.109], ['m', 26.219],
];
/**
 * DEMONSTRATED equivalent race paces, chosen to land in each rung of
 * `tierFromPace` for at least one distance — so the walk reaches the
 * capacity-lifted branch and not only the cold-start one (Rule 15: name the
 * case that reaches the mechanism). 300 s/mi grades elite everywhere;
 * 560 grades developing everywhere; `null` is the cold-start rung.
 */
const DEMONSTRATED = [null, 300, 380, 450, 560] as const;

/**
 * The LOAD fields of a tier row. Every one is a DOSE the runner has to absorb,
 * and none may rise because of a typed goal.
 *
 * `longRunShare` is deliberately NOT in this list, and finding out why is what
 * this walk was for: it is a RATIO, not a dose, and it runs the other way down
 * the table — 5K developing is 0.28 against intermediate's 0.24, because a
 * smaller week carries its long run as a bigger fraction of itself. The first
 * run of this test reported 5K/unstated/no-evidence as a violation on exactly
 * that row. The dose the ratio produces is `weeklyMi × longRunShare`, and
 * `layoutWeek` takes `min(weeklyMi × longRunShare, peakLongMiBand[1])` — so the
 * ABSOLUTE cap is what binds, it IS in this list, and it IS monotone. The
 * synthetic product `peakWeeklyMileageBand[1] × longRunShare` was tried here
 * first and is not the engine's quantity: on the half-marathon table it reads
 * developing 35x0.44 = 15.4 against intermediate 45x0.33 = 14.85 and fails,
 * while the real long-run cap goes 12 -> 14 the right way. The share is watched
 * where it actually lands instead - §3 asserts the COMPOSED long run of a real
 * plan, which is the only number the runner ever runs.
 */
const LOAD_FIELDS: ReadonlyArray<[string, (t: TierTarget) => number]> = [
  ['peakWeeklyMileageBand[0]', (t) => t.peakWeeklyMileageBand[0]],
  ['peakWeeklyMileageBand[1]', (t) => t.peakWeeklyMileageBand[1]],
  ['peakLongMiBand[0]', (t) => t.peakLongMiBand[0]],
  ['peakLongMiBand[1]', (t) => t.peakLongMiBand[1]],
  ['qualityPerWeek', (t) => t.qualityPerWeek],
  ['daysPerWeek', (t) => t.daysPerWeek],
  ['mlrPeakMi', (t) => t.mlrPeakMi ?? 0],
];

describe('GOALVOL-1 §1 · liveness', () => {
  it('the walk visits real cells and sees more than one tier', () => {
    const tiers = new Set<GoalTier>();
    let cells = 0;
    for (const [, mi] of DISTANCES) {
      for (const level of LEVELS) {
        for (const demo of DEMONSTRATED) {
          for (let gp = 260; gp <= 700; gp += 5) {
            tiers.add(resolveLoadTier({
              raceDistanceMi: mi, level, demonstratedPaceSec: demo, goalPaceSec: gp,
            }).tier);
            cells++;
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`GOALVOL-1 walk · ${cells} cells, tiers observed: ${[...tiers].sort().join(', ')}`);
    expect(cells).toBeGreaterThan(5000);
    expect(tiers.size).toBeGreaterThanOrEqual(2);
    // The elite rung must be REACHABLE, or §2 could pass because nothing ever
    // reached the band the defect lived in.
    expect(tiers.has('elite')).toBe(true);
  });
});

describe('GOALVOL-1 §2 · the goal never widens the load band', () => {
  it('no goal, at any pace, produces a tier above the goal-free answer', () => {
    const violations: string[] = [];
    for (const [name, mi] of DISTANCES) {
      for (const level of LEVELS) {
        for (const demo of DEMONSTRATED) {
          const capacity = classifyCapacityTier(mi, level, demo);
          const capacityTarget = TIER_TARGETS[distanceCategoryOf(mi)][capacity];
          for (let gp = 200; gp <= 900; gp += 1) {
            const r = resolveLoadTier({ raceDistanceMi: mi, level, demonstratedPaceSec: demo, goalPaceSec: gp });
            if (TIER_ORD[r.tier] > TIER_ORD[capacity]) {
              violations.push(`${name}/${level}/demo=${demo}/goal=${gp}: ${r.tier} > capacity ${capacity}`);
              continue;
            }
            const target = TIER_TARGETS[distanceCategoryOf(mi)][r.tier];
            for (const [field, read] of LOAD_FIELDS) {
              if (read(target) > read(capacityTarget)) {
                violations.push(`${name}/${level}/demo=${demo}/goal=${gp}: ${field} ${read(target)} > ${read(capacityTarget)}`);
              }
            }
          }
        }
      }
    }
    expect(violations.slice(0, 10)).toEqual([]);
  });

  it('an absent goal and a slower-than-capacity goal both return the capacity answer', () => {
    for (const [, mi] of DISTANCES) {
      for (const level of LEVELS) {
        for (const demo of DEMONSTRATED) {
          const capacity = classifyCapacityTier(mi, level, demo);
          expect(resolveLoadTier({ raceDistanceMi: mi, level, demonstratedPaceSec: demo, goalPaceSec: null }).tier).toBe(capacity);
          // `goalDemandTier` returns the top of the ladder with no goal, which
          // is the identity element for the minimum. Stated as an assertion so
          // a change to that sentinel cannot silently start reducing.
          expect(goalDemandTier(null, mi, level)).toBe('elite');
        }
      }
    }
  });

  it('the headline case · a marathoner cannot type their way into a bigger band, by goal OR by level', () => {
    const M = 26.219;
    // TIEREVIDENCE-1 (2026-09-02) · the DEMONSTRATED pace is now supplied,
    // because with none the answer is the bottom row for every level and the
    // two calls below would agree for the wrong reason. 412 s/mi grades
    // 'advanced' at the marathon (the line is 420), which is what makes this an
    // advanced marathoner rather than a runner who says he is one.
    const DEMO_ADVANCED = 412;
    const sub3 = lookupLoadTierTarget({ raceDistanceMi: M, level: 'advanced', demonstratedPaceSec: DEMO_ADVANCED, goalPaceSec: 412 });
    const ambitious = lookupLoadTierTarget({ raceDistanceMi: M, level: 'advanced', demonstratedPaceSec: DEMO_ADVANCED, goalPaceSec: 355 });
    expect(sub3.tier).toBe('advanced');
    expect(ambitious.tier).toBe('advanced');
    expect(ambitious.target.peakWeeklyMileageBand).toEqual(TIER_TARGETS.m.advanced.peakWeeklyMileageBand);
    // and the row the defect used to reach is strictly bigger, so the
    // assertion above is about something rather than trivially true.
    expect(TIER_TARGETS.m.elite.peakWeeklyMileageBand[0])
      .toBeGreaterThan(TIER_TARGETS.m.advanced.peakWeeklyMileageBand[0]);
    // TIEREVIDENCE-1's half of the same sentence: the LEVEL cannot widen the
    // band either. Same evidence, same goal, every level — nobody exceeds the
    // row the evidence earns.
    for (const level of LEVELS) {
      const t = lookupLoadTierTarget({ raceDistanceMi: M, level, demonstratedPaceSec: DEMO_ADVANCED, goalPaceSec: 355 });
      expect(
        t.target.peakWeeklyMileageBand[0] <= TIER_TARGETS.m.advanced.peakWeeklyMileageBand[0],
        `level '${level}' reached a band floor above what 412 s/mi demonstrates`,
      ).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * §3 · THE SAME ASSERTION, THROUGH THE WHOLE COMPOSER
 *
 * The unit test above proves the tier is sealed. It cannot prove the goal does
 * not reach volume some other way, which is the only claim that matters to the
 * runner. Two plans, one runner, one input changed.
 * ───────────────────────────────────────────────────────────────────────── */
const ADVANCED_MARATHONER: SimInputs = {
  goalMode: 'race',
  distance: 'marathon',
  startDateISO: '2026-08-03',
  planWeeks: 0,
  goalTimeSec: 3 * 3600,
  raceDateISO: '2026-12-06',
  experienceLevel: 'advanced',
  weeklyFrequency: 6,
  weeklyMileageBucket: 45,
  longestRunBucket: '10+',
  raceHistory: [],
  longRunDay: 'sun',
} as unknown as SimInputs;

const peakOf = (built: ReturnType<typeof buildSimPlan>): { weekly: number; long: number } => {
  if (!built.ok) throw new Error('sim plan refused');
  const weekly = Math.max(...built.composed.weeks.map((w) => w.weeklyMi));
  const long = Math.max(0, ...built.composed.weeks.flatMap((w) =>
    w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi)));
  return { weekly, long };
};

describe('GOALVOL-1 §3 · end to end · a faster goal buys no volume', () => {
  it('the composed peak never rises above the goal-free plan, however fast the goal', () => {
    const noGoal = peakOf(buildSimPlan({ ...ADVANCED_MARATHONER, goalTimeSec: null as unknown as number }));
    // 2:20 marathon: elite by the pace table, and the exact input that used to
    // move this runner from [65, 90] to [70, 100].
    const eliteGoal = peakOf(buildSimPlan({ ...ADVANCED_MARATHONER, goalTimeSec: 2 * 3600 + 20 * 60 }));
    const sub3 = peakOf(buildSimPlan({ ...ADVANCED_MARATHONER, goalTimeSec: 3 * 3600 }));
    // eslint-disable-next-line no-console
    console.log(`GOALVOL-1 §3 · no goal ${noGoal.weekly}mi/${noGoal.long}mi · 3:00 ${sub3.weekly}mi/${sub3.long}mi · 2:20 ${eliteGoal.weekly}mi/${eliteGoal.long}mi`);
    expect(eliteGoal.weekly).toBeLessThanOrEqual(noGoal.weekly);
    expect(eliteGoal.long).toBeLessThanOrEqual(noGoal.long);
    expect(sub3.weekly).toBeLessThanOrEqual(noGoal.weekly);
    expect(sub3.long).toBeLessThanOrEqual(noGoal.long);
  });

  it('the composed long run never rises either, across levels and distances', () => {
    // Rule 22 · the §2 walk cannot watch `longRunShare`, because it is a ratio
    // that runs the other way down the table. This is where the share is
    // actually checked: the long run of a real composed block.
    const ELITE_SEC: Record<string, number> = { marathon: 2 * 3600 + 20 * 60, half: 4500 };
    let cases = 0;
    for (const distance of ['marathon', 'half'] as const) {
      for (const level of ['beginner', 'intermediate', 'advanced'] as const) {
        const base = { ...ADVANCED_MARATHONER, distance, experienceLevel: level,
          raceDateISO: distance === 'marathon' ? '2026-12-06' : '2026-11-08' } as unknown as SimInputs;
        const noGoal = peakOf(buildSimPlan({ ...base, goalTimeSec: null as unknown as number }));
        const fast = peakOf(buildSimPlan({ ...base, goalTimeSec: ELITE_SEC[distance] }));
        expect(fast.weekly, `${distance}/${level} weekly`).toBeLessThanOrEqual(noGoal.weekly);
        expect(fast.long, `${distance}/${level} long`).toBeLessThanOrEqual(noGoal.long);
        cases++;
      }
    }
    expect(cases).toBe(6);   // liveness · the loop actually composed something
  });

  it('a cold-start account cannot type its way past its own evidence', () => {
    // The COLD-1 shape: NULL experience level, no races, a self-reported base.
    const cold = { ...ADVANCED_MARATHONER, experienceLevel: null, weeklyMileageBucket: 25 } as unknown as SimInputs;
    const noGoal = peakOf(buildSimPlan({ ...cold, goalTimeSec: null as unknown as number }));
    const ambitious = peakOf(buildSimPlan({ ...cold, goalTimeSec: 2 * 3600 + 20 * 60 }));
    expect(ambitious.weekly).toBeLessThanOrEqual(noGoal.weekly);
    expect(ambitious.long).toBeLessThanOrEqual(noGoal.long);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * §4 · RULE 9 · the walk across every tier boundary
 * ───────────────────────────────────────────────────────────────────────── */
describe('GOALVOL-1 §4 · Rule 9 · no cliff, and no inversion', () => {
  it('the peak band is monotone in goal pace and never inverts', () => {
    for (const [name, mi] of DISTANCES) {
      for (const level of LEVELS) {
        for (const demo of DEMONSTRATED) {
          // Walk from very fast to very slow in one-second steps. The tier may
          // step (a band IS discrete) but it may only ever step DOWN, so the
          // fitter-goal runner never gets a plan that differs in kind from the
          // neighbour one second away in the wrong direction.
          let prev: number | null = null;
          for (let gp = 200; gp <= 900; gp += 1) {
            const t = resolveLoadTier({ raceDistanceMi: mi, level, demonstratedPaceSec: demo, goalPaceSec: gp }).tier;
            const band = TIER_TARGETS[distanceCategoryOf(mi)][t].peakWeeklyMileageBand[0];
            if (prev != null) {
              expect(
                band <= prev,
                `${name}/${level}/demo=${demo}: peak band ROSE as the goal got slower at ${gp}s/mi (${prev} → ${band})`,
              ).toBe(true);
            }
            prev = band;
          }
        }
      }
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * §5 · RULE 21 · the upward path exists, and evidence is what opens it
 *
 * Rule 22's own instruction: a gate that can only ask "did you correctly
 * refuse?" will pass an engine that can only refuse. Sealing the goal out of
 * the load path would be worth nothing if it left the band with no way up at
 * all. These are the ACCELERATE-side cases.
 * ───────────────────────────────────────────────────────────────────────── */
describe('GOALVOL-1 §5 · Rule 21 · demonstrated evidence still lifts the band', () => {
  it('a marathoner who DEMONSTRATES elite pace reaches the elite band', () => {
    const M = 26.219;
    // TIEREVIDENCE-1 · the no-evidence answer is the BOTTOM row for every
    // level, not the level's own row. That widens the gap this test measures
    // rather than closing it: evidence now has to carry the whole distance.
    const noEvidence = classifyCapacityTier(M, 'advanced', null);
    const demonstratedElite = classifyCapacityTier(M, 'advanced', 330); // 5:30/mi
    expect(noEvidence).toBe('developing');
    expect(demonstratedElite).toBe('elite');
    expect(TIER_TARGETS.m[demonstratedElite].peakWeeklyMileageBand[0])
      .toBeGreaterThan(TIER_TARGETS.m[noEvidence].peakWeeklyMileageBand[0]);
  });

  it('a level is lifted by evidence and by nothing else (COLD-1, TIEREVIDENCE-1)', () => {
    const M = 26.219;
    // COLD-1 asserted this for an UNSTATED level only. It now holds for every
    // level, which is the whole of TIEREVIDENCE-1 in one loop.
    for (const level of LEVELS) {
      expect(classifyCapacityTier(M, level, null)).toBe('developing');
      // A goal at elite pace does not do it either.
      expect(resolveLoadTier({ raceDistanceMi: M, level, demonstratedPaceSec: null, goalPaceSec: 330 }).tier)
        .toBe('developing');
    }
    // and demonstrated elite pace does, up to each level's own ceiling.
    expect(classifyCapacityTier(M, null, 330)).toBe('elite');
    expect(classifyCapacityTier(M, 'advanced', 330)).toBe('elite');
  });

  it('each stated level has a ceiling evidence may not pass', () => {
    const M = 26.219;
    // beginner is capped at intermediate however fast the demonstrated pace.
    expect(classifyCapacityTier(M, 'beginner', 300)).toBe('intermediate');
    // intermediate is capped at advanced (INTERMEDIATE_LEVEL_TIER_CEILING).
    expect(classifyCapacityTier(M, 'intermediate', 300)).toBe('advanced');
    // TIEREVIDENCE-1 · and the level no longer floors: evidence slower than the
    // word wins, because the evidence is the measurement.
    expect(classifyCapacityTier(M, 'advanced', 700)).toBe('developing');
  });
});
