/**
 * Tests for lib/race/execution-plan.ts · race-critical math.
 *
 * Fixture = David's AFC Half (the audit subject): goal 1:30:00 at
 * 13.1 mi, B goal 1:37:00, LTHR 162, maxHr 181, VDOT 47.9, 7:00 AM gun.
 * Every assertion is a number the runner will execute against on race
 * morning — if these regress, the race plan lies.
 */
import { describe, it, expect } from 'vitest';
import {
  composeRaceExecutionPlan,
  computeRaceFueling,
  DEFAULT_RACE_CARBS_PER_HOUR_G,
  DEFAULT_SERVING_CARBS_G,
} from './execution-plan';

const AFC = {
  goalSec: 5400,
  distanceMi: 13.1,
  bGoalSec: 5820, // 1:37:00
  lthr: 162,
  maxHr: 181,
  vdot: 47.9,
  startTimeLocal: '7:00 AM',
  ci: { loSec: 5516, hiSec: 5872 },
};

describe('composeRaceExecutionPlan · splits', () => {
  const plan = composeRaceExecutionPlan(AFC)!;

  it('composes (non-null) for a valid goal', () => {
    expect(plan).not.toBeNull();
  });

  it('goal pace is goal/distance — 412 s/mi (6:52), NOT T-pace 6:47', () => {
    expect(plan.goalPaceSPerMi).toBe(412);
  });

  it('first mile carries the +12 settle allowance (Research/08 §3.1: +10-15s)', () => {
    expect(plan.splits[0].label).toBe('settle');
    expect(plan.splits[0].paceSPerMi).toBe(424); // 412 + 12 → 7:04
  });

  it('miles 2-3 run +6 (find rhythm · §3.4 +5-10 band)', () => {
    expect(plan.splits[1].paceSPerMi).toBe(418);
    expect(plan.splits[2].paceSPerMi).toBe(418);
    expect(plan.splits[1].label).toBe('find rhythm');
  });

  it('miles 4+ repay the early give-back (slightly under goal pace)', () => {
    const m4 = plan.splits[3];
    expect(m4.label).toBe('goal pace');
    expect(m4.paceSPerMi).toBeLessThan(412);
    expect(m4.paceSPerMi).toBeGreaterThanOrEqual(408);
  });

  it('cumulative lands exactly on the goal', () => {
    expect(plan.splits[plan.splits.length - 1].cumulativeSec).toBe(5400);
  });

  it('covers the full distance (13 whole + final partial)', () => {
    expect(plan.splits).toHaveLength(14);
    expect(plan.splits[13].distanceMi).toBeCloseTo(0.1, 2);
    const total = plan.splits.reduce((s, x) => s + x.distanceMi, 0);
    expect(total).toBeCloseTo(13.1, 2);
  });

  it('final miles are labeled push', () => {
    expect(plan.splits[11].label).toBe('push');
    expect(plan.splits[12].label).toBe('push');
  });
});

describe('composeRaceExecutionPlan · B-goal triggers', () => {
  const plan = composeRaceExecutionPlan(AFC)!;

  it('checkpoint at mile 5 with LTHR+3 HR trigger (165 for LTHR 162)', () => {
    expect(plan.bGoalTriggers[0].atMile).toBe(5);
    expect(plan.bGoalTriggers[0].hrAboveBpm).toBe(165);
  });

  it('pace trigger at goal+23 (435 = 7:15 · ≈5% adrift = §18.2 unrecoverable)', () => {
    expect(plan.bGoalTriggers[0].paceSlowerThanSPerMi).toBe(435);
  });

  it('action names the B goal time and pace', () => {
    expect(plan.bGoalTriggers[0].action).toContain('1:37:00');
    expect(plan.bGoalTriggers[0].action).toContain('7:24');
  });

  it('falls back to maxHr-derived trigger when LTHR absent', () => {
    const noLthr = composeRaceExecutionPlan({ ...AFC, lthr: null })!;
    expect(noLthr.bGoalTriggers[0].hrAboveBpm).toBe(Math.round(181 * 0.91));
  });
});

describe('composeRaceExecutionPlan · heat rules (unified doctrine model)', () => {
  const plan = composeRaceExecutionPlan(AFC)!;

  it('prices 65/70/75/80°F off the Research/06 table × HM duration scale', () => {
    // mid_pack tier (VDOT 47.9) · durationHeatScale(5400s) = 0.85:
    //   65°F: 2.5% × 0.85 × 412 ≈ +9 s/mi
    //   70°F: 4.0% × 0.85 × 412 ≈ +14
    //   75°F: 5.5% × 0.85 × 412 ≈ +19
    //   80°F: 7.5% × 0.85 × 412 ≈ +26
    const byTemp = Object.fromEntries(plan.heatRules.map((r) => [r.ifStartTempAtLeastF, r.addSPerMi]));
    expect(byTemp[65]).toBe(9);
    expect(byTemp[70]).toBe(14);
    expect(byTemp[75]).toBe(19);
    expect(byTemp[80]).toBe(26);
  });
});

describe('composeRaceExecutionPlan · warm-up + fueling + notes', () => {
  const plan = composeRaceExecutionPlan(AFC)!;

  it('warm-up timeline anchors to the 7:00 AM gun (jog at 6:15 AM)', () => {
    const jog = plan.warmup.find((w) => w.minutesBeforeGun === 45)!;
    expect(jog.clock).toBe('6:15 AM');
    expect(plan.warmup.find((w) => w.minutesBeforeGun === 15)!.clock).toBe('6:45 AM');
  });

  it('warm-up clocks are null when gun time unknown', () => {
    const noGun = composeRaceExecutionPlan({ ...AFC, startTimeLocal: null })!;
    expect(noGun.warmup.every((w) => w.clock === null)).toBe(true);
  });

  it('fueling carries the §10.1 carb-load line and an on-course plan', () => {
    expect(plan.fueling.some((f) => f.includes('7-8 g/kg'))).toBe(true);
    // With no fuel entered the on-course line is the structured default
    // (60 g/hr · gel ladder) rather than the old fixed "mile 7-8" string.
    expect(plan.fueling.some((f) => f.startsWith('On course:'))).toBe(true);
    expect(plan.fuelingPlan.targetCarbsPerHourG).toBe(DEFAULT_RACE_CARBS_PER_HOUR_G);
  });

  it('CI note quotes the band', () => {
    expect(plan.ciNote).toContain('1:31:56');
    expect(plan.ciNote).toContain('1:37:52');
  });

  it('returns null on a goal-less race', () => {
    expect(composeRaceExecutionPlan({ goalSec: 0, distanceMi: 13.1 })).toBeNull();
  });
});

describe('computeRaceFueling · entered product', () => {
  // AFC half · 1:30 (5400s), 13.1mi, goal pace 412 s/mi (6:52).
  const base = { goalSec: 5400, distanceMi: 13.1, goalPaceSPerMi: 412 };

  it('Maurten 100 (25g) every 25 min → 75 g/hr, schedule on cadence', () => {
    const fp = computeRaceFueling({
      ...base,
      fuel: { product: 'Maurten Gel 100', carbsPerServingG: 25, cadenceMin: 25 },
    });
    // 25g / 25min × 60 = 60 g/hr? No — 25g every 25min = 1 serving/25min =
    // 60 g/hr. (25 × 60 / 25 = 60.)
    expect(fp.targetCarbsPerHourG).toBe(60);
    expect(fp.productName).toBe('Maurten Gel 100');
    expect(fp.carbsPerServingG).toBe(25);
    expect(fp.isDefault).toBe(false);
    // 1:30 = 1.5h × 60 g/hr = 90g target ÷ 25g = 3.6 → ceil 4 servings.
    expect(fp.recommendedServings).toBe(4);
    expect(fp.totalCarbsG).toBe(100);
    // First at 25 min, then every 25, last clamped to ≤ 80 min (90-10).
    expect(fp.scheduleMin[0]).toBe(25);
    expect(fp.scheduleMin).toEqual([25, 50, 75, 80]);
    // Mile schedule = min×60 / 412 s/mi.
    expect(fp.scheduleMi[0].mi).toBeCloseTo(3.6, 1);
    expect(fp.scheduleMi[0].atMin).toBe(25);
    expect(fp.shortLine).toContain('Maurten Gel 100');
    expect(fp.shortLine).toContain('every 25 min');
  });

  it('20-min cadence (Maurten 25g) → 75 g/hr', () => {
    const fp = computeRaceFueling({
      ...base,
      fuel: { product: 'Maurten Gel 100', carbsPerServingG: 25, cadenceMin: 20 },
    });
    expect(fp.targetCarbsPerHourG).toBe(75); // 25 × 60 / 20
  });

  it('direct g/hr target beats cadence', () => {
    const fp = computeRaceFueling({
      ...base,
      fuel: { product: 'SiS Beta Fuel', carbsPerServingG: 40, cadenceMin: 25, carbsPerHourTargetG: 90 },
    });
    expect(fp.targetCarbsPerHourG).toBe(90);
    // 1.5h × 90 = 135g ÷ 40 = 3.375 → ceil 4 servings.
    expect(fp.recommendedServings).toBe(4);
    expect(fp.totalCarbsG).toBe(160);
  });
});

describe('computeRaceFueling · defaults + edge cases', () => {
  it('no fuel entered → documented default 60 g/hr, isDefault flag set', () => {
    const fp = computeRaceFueling({
      goalSec: 5400, distanceMi: 13.1, goalPaceSPerMi: 412, isDefault: true,
    });
    expect(fp.targetCarbsPerHourG).toBe(DEFAULT_RACE_CARBS_PER_HOUR_G);
    expect(fp.carbsPerServingG).toBe(DEFAULT_SERVING_CARBS_G);
    expect(fp.productName).toBe('gel');
    expect(fp.isDefault).toBe(true);
    // 1.5h × 60 = 90g ÷ 22 = 4.09 → ceil 5 servings.
    expect(fp.recommendedServings).toBe(5);
  });

  it('short race (10K ≈ 40 min) needs no on-course fuel · §11', () => {
    const fp = computeRaceFueling({
      goalSec: 2400, distanceMi: 6.2, goalPaceSPerMi: 387,
      fuel: { product: 'GU', carbsPerServingG: 22, cadenceMin: 20 },
    });
    expect(fp.targetCarbsPerHourG).toBe(0);
    expect(fp.recommendedServings).toBe(0);
    expect(fp.scheduleMi).toHaveLength(0);
    expect(fp.shortLine).toContain('No on-course fuel');
  });

  it('marathon (3:30, 26.2mi) at 60g default carries many servings', () => {
    const fp = computeRaceFueling({
      goalSec: 12600, distanceMi: 26.2, goalPaceSPerMi: 481,
      fuel: { product: 'Maurten Gel 100', carbsPerServingG: 25, cadenceMin: 30 },
    });
    // 30-min cadence, 25g → 50 g/hr. 3.5h × 50 = 175g ÷ 25 = 7 servings.
    expect(fp.targetCarbsPerHourG).toBe(50);
    expect(fp.recommendedServings).toBe(7);
    // No gel inside the last 10 min (≤ 200 min of 210).
    expect(Math.max(...fp.scheduleMin)).toBeLessThanOrEqual(200);
  });

  it('every schedule mile is inside the course and strictly increasing', () => {
    const fp = computeRaceFueling({
      goalSec: 5400, distanceMi: 13.1, goalPaceSPerMi: 412,
      fuel: { product: 'Maurten Gel 100', carbsPerServingG: 25, cadenceMin: 25 },
    });
    for (let i = 0; i < fp.scheduleMi.length; i++) {
      expect(fp.scheduleMi[i].mi).toBeGreaterThan(0);
      expect(fp.scheduleMi[i].mi).toBeLessThanOrEqual(13.1);
      if (i > 0) expect(fp.scheduleMi[i].mi).toBeGreaterThanOrEqual(fp.scheduleMi[i - 1].mi);
    }
  });
});

describe('composeRaceExecutionPlan · structured fuelingPlan', () => {
  it('threads entered fuel into the plan + voices it in the prose', () => {
    const plan = composeRaceExecutionPlan({
      ...AFC,
      fuel: { product: 'Maurten Gel 100', carbsPerServingG: 25, cadenceMin: 25 },
      fuelIsDefault: false,
    })!;
    expect(plan.fuelingPlan).toBeDefined();
    expect(plan.fuelingPlan.productName).toBe('Maurten Gel 100');
    expect(plan.fuelingPlan.recommendedServings).toBe(4);
    expect(plan.fuelingPlan.isDefault).toBe(false);
    // The on-course prose line now reflects the entered product.
    expect(plan.fueling.some((f) => f.includes('Maurten Gel 100'))).toBe(true);
    // Carb-load doctrine line still present (Research/08 §10.1).
    expect(plan.fueling.some((f) => f.includes('7-8 g/kg'))).toBe(true);
  });

  it('no fuel entered → default plan + a prompt to enter fuel', () => {
    const plan = composeRaceExecutionPlan({ ...AFC, fuelIsDefault: true })!;
    expect(plan.fuelingPlan.isDefault).toBe(true);
    expect(plan.fuelingPlan.targetCarbsPerHourG).toBe(DEFAULT_RACE_CARBS_PER_HOUR_G);
    expect(plan.fueling.some((f) => f.toLowerCase().includes('enter your race fuel'))).toBe(true);
  });
});
