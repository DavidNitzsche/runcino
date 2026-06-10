/**
 * Tests for lib/race/execution-plan.ts · race-critical math.
 *
 * Fixture = David's AFC Half (the audit subject): goal 1:30:00 at
 * 13.1 mi, B goal 1:37:00, LTHR 162, maxHr 181, VDOT 47.9, 7:00 AM gun.
 * Every assertion is a number the runner will execute against on race
 * morning — if these regress, the race plan lies.
 */
import { describe, it, expect } from 'vitest';
import { composeRaceExecutionPlan } from './execution-plan';

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

  it('fueling carries the §10.1 carb-load line and an HM gel plan', () => {
    expect(plan.fueling.some((f) => f.includes('7-8 g/kg'))).toBe(true);
    expect(plan.fueling.some((f) => f.includes('mile 7-8'))).toBe(true);
  });

  it('CI note quotes the band', () => {
    expect(plan.ciNote).toContain('1:31:56');
    expect(plan.ciNote).toContain('1:37:52');
  });

  it('returns null on a goal-less race', () => {
    expect(composeRaceExecutionPlan({ goalSec: 0, distanceMi: 13.1 })).toBeNull();
  });
});
