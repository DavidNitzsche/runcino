/**
 * Compute-vdot pure-function tests.
 *
 * The DB-fetching wrapper is exercised in integration; this file
 * tests the pure math (cycle-aware weighting, tier classification,
 * Option-B preference, sanity-check end-to-end against David's real
 * race dates) without touching Postgres.
 *
 * Sanity-check anchor: David's locked spec should produce VDOT 47.2
 * for his actual race history (Disney HM Feb 1 + LA Marathon Mar 8
 * with chip time correction + 10K Mar 25) when today is May 18, 2026
 * and the goal race is HM_ISH.
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateVdotFromInputs,
  tierForKm,
  tierFactor,
  recencyFactor,
  lengthFactor,
  type RaceBest,
} from '../compute-vdot';

const TODAY = new Date('2026-05-18T12:00:00Z');

describe('tierForKm · race classification', () => {
  it('classifies ≤3 km as SPRINT', () => {
    expect(tierForKm(1.6)).toBe('SPRINT');
    expect(tierForKm(3.0)).toBe('SPRINT');
  });
  it('classifies 3–15 km as TEN_K_ISH (5K and 10K together)', () => {
    expect(tierForKm(5.0)).toBe('TEN_K_ISH');
    expect(tierForKm(10.0)).toBe('TEN_K_ISH');
    expect(tierForKm(15.0)).toBe('TEN_K_ISH');
  });
  it('classifies 15–25 km as HM_ISH', () => {
    expect(tierForKm(15.01)).toBe('HM_ISH');
    expect(tierForKm(21.1)).toBe('HM_ISH');
    expect(tierForKm(25.0)).toBe('HM_ISH');
  });
  it('classifies >25 km as M_ISH', () => {
    expect(tierForKm(25.01)).toBe('M_ISH');
    expect(tierForKm(42.2)).toBe('M_ISH');
  });
});

describe('tierFactor · weighting by tier proximity to goal', () => {
  it('returns 3.0 for exact tier match', () => {
    expect(tierFactor('HM_ISH', 'HM_ISH')).toBe(3.0);
    expect(tierFactor('M_ISH', 'M_ISH')).toBe(3.0);
  });
  it('returns 1.0 for adjacent tiers', () => {
    expect(tierFactor('TEN_K_ISH', 'HM_ISH')).toBe(1.0);
    expect(tierFactor('HM_ISH', 'M_ISH')).toBe(1.0);
    expect(tierFactor('M_ISH', 'HM_ISH')).toBe(1.0);
  });
  it('returns 0.4 for two-plus tiers off', () => {
    expect(tierFactor('SPRINT', 'HM_ISH')).toBe(0.4);
    expect(tierFactor('SPRINT', 'M_ISH')).toBe(0.4);
    expect(tierFactor('TEN_K_ISH', 'M_ISH')).toBe(0.4);
  });
});

describe('lengthFactor · sqrt(km/10)', () => {
  it('returns 1.0 for 10K', () => {
    expect(lengthFactor(10)).toBeCloseTo(1.0, 5);
  });
  it('returns ~1.45 for HM (21.1 km)', () => {
    expect(lengthFactor(21.1)).toBeCloseTo(1.453, 2);
  });
  it('returns ~2.05 for marathon (42.2 km)', () => {
    expect(lengthFactor(42.195)).toBeCloseTo(2.054, 2);
  });
  it('returns ~0.71 for 5K', () => {
    expect(lengthFactor(5)).toBeCloseTo(0.707, 2);
  });
});

describe('recencyFactor · exp decay with goal-tier-in-cycle exemption', () => {
  const cycleStart = new Date('2026-01-27T00:00:00Z');  // ~16 weeks before TODAY

  it('applies exp(-days/90) for non-goal-tier races', () => {
    const raceDate = new Date('2026-02-01T12:00:00Z');  // 106 days old
    const r = recencyFactor(raceDate, TODAY, false, cycleStart);
    expect(r).toBeCloseTo(Math.exp(-106 / 90), 3);
  });

  it('returns 1.0 for goal-tier races within cycle window', () => {
    const raceDate = new Date('2026-02-01T12:00:00Z');  // in cycle
    const r = recencyFactor(raceDate, TODAY, true, cycleStart);
    expect(r).toBe(1.0);
  });

  it('applies decay for goal-tier races BEFORE cycle start', () => {
    const raceDate = new Date('2026-01-15T12:00:00Z');  // before cycle
    const r = recencyFactor(raceDate, TODAY, true, cycleStart);
    expect(r).toBeLessThan(1.0);
    expect(r).toBeCloseTo(Math.exp(-123 / 90), 3);
  });

  it('caps daysOld at 0 (no negative ages from future-dated races)', () => {
    const futureDate = new Date('2026-06-01T12:00:00Z');
    const r = recencyFactor(futureDate, TODAY, false, cycleStart);
    expect(r).toBe(1.0);  // exp(-0/90) = 1.0
  });
});

describe('aggregateVdotFromInputs · sanity check against David\'s locked spec', () => {
  // The canonical regression case: David's real race dates on
  // 2026-05-18. Should produce VDOT 47.2 (variant c, C3+C1) per the
  // hand-computed math David signed off on.

  const cycleStart = new Date('2026-01-27T00:00:00Z');  // C1 fallback window

  it('produces VDOT 47.2 for David\'s HM+Marathon+10K scenario', () => {
    const bests: RaceBest[] = [
      // Disney HM 2026-02-01 — chip time 1:34:54 (5694s), goal-tier
      { label: 'Half', canonicalMi: 13.109, finishS: 5694, date: '2026-02-01', activityId: '17250968534', source: 'races' },
      // LA Marathon 2026-03-08 — chip time 3:31:40 (12700s), adjacent
      { label: 'Marathon', canonicalMi: 26.219, finishS: 12700, date: '2026-03-08', activityId: '17654375467', source: 'races' },
      // Hypothetical 10K 2026-03-25 — 44:57 (2697s)
      { label: '10K', canonicalMi: 6.214, finishS: 2697, date: '2026-03-25', activityId: 'synthetic-10k', source: 'strava' },
    ];

    const result = aggregateVdotFromInputs({
      bests,
      cycleStart,
      goalTier: 'HM_ISH',
      today: TODAY,
    });

    expect(result).not.toBeNull();
    // The spec math (HM exempt, marathon+10K decayed) lands at 47.15;
    // rounding to 0.1 gives 47.2.
    expect(result!.value).toBeCloseTo(47.2, 1);
    expect(result!.goalTier).toBe('HM_ISH');
    expect(result!.sourceCount).toBe(3);

    // HM should be the heaviest contributor (recency 1.0 × length 1.45 × tier 3.0)
    expect(result!.sources[0].canonicalLabel).toBe('Half');
    expect(result!.sources[0].isGoalTier).toBe(true);
    expect(result!.sources[0].isInCycle).toBe(true);
    expect(result!.sources[0].weightBreakdown.recency).toBe(1.0);
    expect(result!.sources[0].weightBreakdown.tier).toBe(3.0);
    expect(result!.sources[0].source).toBe('races');  // Option-B curated
  });

  it('produces ~45.8 with full curated race set (no dedup by canonical distance)', () => {
    // Real-world scenario after the 2026-05-19 strict Option-B fix:
    // David's curated races table holds 4 past races. None get deduped
    // by canonical distance — both HMs (Disney + Sombrero) and both
    // marathons (LA + Big Sur) each contribute. The aggregate lands
    // around 45.8 with the Sombrero tune-up pulling it down from the
    // Disney HM peak. Tomorrow's race-effort-level flag will let
    // tune-ups carry lower weight; for now, all races weighted normal.
    const bests: RaceBest[] = [
      // Disney HM 2026-02-01 — 1:34:54 chip, goal-tier exempt
      { label: 'Half', canonicalMi: 13.109, finishS: 5694, date: '2026-02-01', activityId: '17250968534', source: 'races' },
      // LA Marathon 2026-03-08 — 3:31:40 chip, adjacent tier
      { label: 'Marathon', canonicalMi: 26.219, finishS: 12700, date: '2026-03-08', activityId: '17654375467', source: 'races' },
      // Big Sur Marathon 2026-04-26 — 3:36:55, adjacent tier
      { label: 'Marathon', canonicalMi: 26.219, finishS: 13015, date: '2026-04-26', activityId: '18270567015', source: 'races' },
      // Sombrero Half 2026-05-03 — 1:40:57, goal-tier exempt (most recent)
      { label: 'Half', canonicalMi: 13.109, finishS: 6057, date: '2026-05-03', activityId: '18362267811', source: 'races' },
    ];

    const result = aggregateVdotFromInputs({
      bests,
      cycleStart,
      goalTier: 'HM_ISH',
      today: TODAY,
    });

    expect(result).not.toBeNull();
    expect(result!.sourceCount).toBe(4);
    // Two HMs (goal-tier exempt, full weight) + two marathons (decay).
    // Hand-computed aggregate lands at 45.8 ±0.2 depending on rounding.
    expect(result!.value).toBeGreaterThanOrEqual(45.5);
    expect(result!.value).toBeLessThanOrEqual(46.1);

    // Both HMs should be exempt (full recency weight).
    const hms = result!.sources.filter((s) => s.canonicalLabel === 'Half');
    expect(hms.length).toBe(2);
    for (const hm of hms) {
      expect(hm.isGoalTier).toBe(true);
      expect(hm.isInCycle).toBe(true);
      expect(hm.weightBreakdown.recency).toBe(1.0);
    }
  });

  it('returns null when no bests provided', () => {
    expect(aggregateVdotFromInputs({ bests: [], cycleStart, goalTier: 'HM_ISH', today: TODAY })).toBeNull();
  });

  it('handles no-goal-race state (goalTier null) with tier factor 1.0', () => {
    // When no race exists in the table, no tier preference applies.
    const bests: RaceBest[] = [
      { label: 'Half', canonicalMi: 13.109, finishS: 5694, date: '2026-02-01', activityId: '17250968534', source: 'strava' },
      { label: 'Marathon', canonicalMi: 26.219, finishS: 12700, date: '2026-03-08', activityId: '17654375467', source: 'strava' },
    ];
    const result = aggregateVdotFromInputs({ bests, cycleStart, goalTier: null, today: TODAY });
    expect(result).not.toBeNull();
    // All races get tier factor 1.0. Goal-tier exemption doesn't fire
    // either (isGoalTier requires a goalTier). So weights are recency
    // × length only.
    for (const s of result!.sources) {
      expect(s.weightBreakdown.tier).toBe(1.0);
      expect(s.isGoalTier).toBe(false);
    }
  });
});

describe('aggregateVdotFromInputs · priority-aware weighting (race-effort-level)', () => {
  const cycleStart = new Date('2026-01-27T00:00:00Z');

  it('priority C (tune-up) reduces weight to 0.3× vs priority A', () => {
    const bestsAA: RaceBest[] = [
      { label: 'Half', canonicalMi: 13.109, finishS: 5694, date: '2026-02-01', activityId: 'd', source: 'races', priority: 'A' },
      { label: 'Half', canonicalMi: 13.109, finishS: 6057, date: '2026-05-03', activityId: 's', source: 'races', priority: 'A' },
    ];
    const bestsAC: RaceBest[] = [
      { label: 'Half', canonicalMi: 13.109, finishS: 5694, date: '2026-02-01', activityId: 'd', source: 'races', priority: 'A' },
      { label: 'Half', canonicalMi: 13.109, finishS: 6057, date: '2026-05-03', activityId: 's', source: 'races', priority: 'C' },
    ];
    const aa = aggregateVdotFromInputs({ bests: bestsAA, cycleStart, goalTier: 'HM_ISH', today: TODAY });
    const ac = aggregateVdotFromInputs({ bests: bestsAC, cycleStart, goalTier: 'HM_ISH', today: TODAY });
    // Disney HM (48.1) is higher VDOT than Sombrero (44.7). When
    // Sombrero is downgraded to C, its weight drops and the aggregate
    // shifts toward Disney HM's anchor.
    expect(ac!.value).toBeGreaterThan(aa!.value);

    // Verify the effort multiplier landed: Sombrero C weight should be
    // 0.3× of what it would be at A.
    const sombreroAC = ac!.sources.find((s) => s.activityId === 's')!;
    const sombreroAA = aa!.sources.find((s) => s.activityId === 's')!;
    expect(sombreroAC.weight).toBeCloseTo(sombreroAA.weight * 0.3, 3);
    expect(sombreroAC.weightBreakdown.effort).toBe(0.3);
    expect(sombreroAA.weightBreakdown.effort).toBe(1.0);
  });

  it('defaults to A (full weight) when priority is unset', () => {
    const bests: RaceBest[] = [
      { label: 'Half', canonicalMi: 13.109, finishS: 5694, date: '2026-02-01', activityId: 'd', source: 'races' },
    ];
    const result = aggregateVdotFromInputs({ bests, cycleStart, goalTier: 'HM_ISH', today: TODAY });
    expect(result!.sources[0].weightBreakdown.effort).toBe(1.0);
    expect(result!.sources[0].priority).toBe('A');
  });
});

describe('aggregateVdotFromInputs · marathon chip-time correction', () => {
  // The whole point of Option-B: when curated chip time replaces
  // Strava elapsed time, the aggregate VDOT shifts slightly.
  const cycleStart = new Date('2026-01-27T00:00:00Z');

  it('produces a lower VDOT with chip time than with Strava gun time', () => {
    const stravaBest: RaceBest = {
      label: 'Marathon', canonicalMi: 26.219, finishS: 12625, // 3:30:25 Strava
      date: '2026-03-08', activityId: '17654375467', source: 'strava',
    };
    const chipBest: RaceBest = {
      ...stravaBest, finishS: 12700, source: 'races', // 3:31:40 chip
    };

    const stravaResult = aggregateVdotFromInputs({ bests: [stravaBest], cycleStart, goalTier: 'M_ISH', today: TODAY });
    const chipResult = aggregateVdotFromInputs({ bests: [chipBest], cycleStart, goalTier: 'M_ISH', today: TODAY });

    expect(stravaResult!.value).toBeGreaterThan(chipResult!.value);
    // Chip time is 75s slower → marathon-VDOT drops by ~0.3
    expect(stravaResult!.value - chipResult!.value).toBeCloseTo(0.3, 1);
  });
});

describe('aggregateVdotFromInputs · goal-tier exemption boundary', () => {
  const cycleStart = new Date('2026-02-15T00:00:00Z');  // tight window

  it('exempts a goal-tier race INSIDE the cycle window', () => {
    const bests: RaceBest[] = [
      { label: 'Half', canonicalMi: 13.109, finishS: 5694, date: '2026-02-20', activityId: 'a', source: 'races' },
    ];
    const result = aggregateVdotFromInputs({ bests, cycleStart, goalTier: 'HM_ISH', today: TODAY });
    expect(result!.sources[0].weightBreakdown.recency).toBe(1.0);
    expect(result!.sources[0].isInCycle).toBe(true);
  });

  it('decays a goal-tier race OUTSIDE the cycle window', () => {
    const bests: RaceBest[] = [
      { label: 'Half', canonicalMi: 13.109, finishS: 5694, date: '2026-01-15', activityId: 'a', source: 'races' },
    ];
    const result = aggregateVdotFromInputs({ bests, cycleStart, goalTier: 'HM_ISH', today: TODAY });
    expect(result!.sources[0].weightBreakdown.recency).toBeLessThan(1.0);
    expect(result!.sources[0].isInCycle).toBe(false);
  });

  it('does NOT exempt non-goal-tier races even when in cycle', () => {
    const bests: RaceBest[] = [
      { label: 'Marathon', canonicalMi: 26.219, finishS: 12700, date: '2026-02-20', activityId: 'a', source: 'races' },
    ];
    const result = aggregateVdotFromInputs({ bests, cycleStart, goalTier: 'HM_ISH', today: TODAY });
    // Marathon is adjacent to HM goal — gets tier 1.0 but normal recency decay.
    expect(result!.sources[0].weightBreakdown.recency).toBeLessThan(1.0);
    expect(result!.sources[0].weightBreakdown.tier).toBe(1.0);
    expect(result!.sources[0].isGoalTier).toBe(false);
  });
});
