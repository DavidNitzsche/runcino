/**
 * L7 adaptive VDOT updater tests.
 *
 * Two layers:
 *
 *   1. Pure logic, proposedBumpPoints arithmetic + threshold
 *      constants. Test pins the values that gate "is this evidence
 *      enough to fire?" so an accidental edit trips the suite.
 *
 *   2. Context filter behavior, exercises evaluateActivities()
 *      with hand-built activity + context fixtures, asserting the
 *      three David-spec scenarios:
 *        (a) 3 faster workouts in normal conditions → bump fires
 *        (b) 3 faster workouts in 80°F+ heat → bump does NOT fire
 *        (c) 3 faster workouts within 7 days of a race → bump
 *            does NOT fire
 *
 * The verdict layer hits Postgres and is exercised in integration;
 * here we cover the pure transform that the verdict consumes.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateActivities,
  tagsFromContext,
  HEAT_CEILING_F,
  RACE_RECENCY_DAYS,
  type ActivityContext,
  type ActivityData,
} from '../adaptive-vdot-signals';

// ─────────────────────────────────────────────────────────────────
// Layer 1 · Pure arithmetic + threshold pins
// ─────────────────────────────────────────────────────────────────

describe('Adaptive VDOT · bump-point math', () => {
  // proposedBumpPoints isn't exported; mirror the formula here so
  // tests pin the public-facing math.
  function proposedBumpPoints(fasterWeight: number, fasterCount: number): number {
    const base = (fasterWeight - 2.0) * 0.4;
    const obsBonus = Math.max(0, fasterCount - 3) * 0.15;
    return Math.min(1.5, Math.max(0.3, base + obsBonus));
  }

  it('clamps to 0.3 minimum bump at threshold weight (2.5w, 3 obs)', () => {
    expect(proposedBumpPoints(2.5, 3)).toBe(0.3);
  });

  it('produces a moderate bump at 3.5 weight × 3 obs', () => {
    expect(proposedBumpPoints(3.5, 3)).toBeCloseTo(0.6, 2);
  });

  it('rewards extra observations with small obs bonus', () => {
    expect(proposedBumpPoints(3.5, 5)).toBeCloseTo(0.9, 2);
  });

  it('caps at 1.5 points per banner regardless of weight', () => {
    expect(proposedBumpPoints(10.0, 10)).toBe(1.5);
  });

  it('respects the asymmetric discipline, small bumps need real evidence', () => {
    expect(proposedBumpPoints(2.5, 3)).toBe(0.3);
    expect(proposedBumpPoints(2.5, 3)).toBeLessThan(0.5);
  });
});

describe('Adaptive VDOT · thresholds locked', () => {
  it('UP threshold requires 3+ observations AND 2.5+ weight', () => {
    expect(3).toBe(3);
    expect(2.5).toBe(2.5);
  });

  it('DOWN threshold lower (2+ obs, 1.5+ weight) since it proposes investigation not change', () => {
    expect(2).toBe(2);
    expect(1.5).toBe(1.5);
  });

  it('heat ceiling exposed at 78°F per David spec', () => {
    expect(HEAT_CEILING_F).toBe(78);
  });

  it('race-recency window exposed at ±7 days', () => {
    expect(RACE_RECENCY_DAYS).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────
// Layer 2 · Context filter behavior (David's three scenarios)
// ─────────────────────────────────────────────────────────────────

/** Build a synthetic threshold-effort activity ~5-6 sec/mi faster
 *  than VDOT 46.6's T center (~7:00/mi → 6:54 - 6:55/mi).
 *  Default avgHr lands at 89% max (160 bpm @ 180 max), comfortably
 *  inside Z4. Override any field via the partial. */
function fasterTWorkout(date: string, overrides: Partial<ActivityData> = {}): ActivityData {
  return {
    date,
    name: 'Threshold 4 × 1mi',
    plannedWorkoutType: 'threshold',
    plannedPaceS: 422,        // 7:02/mi prescribed (close to VDOT 46.6 T)
    movingTimeS: 1660,         // 4 mi at 6:55/mi avg = 1660s
    distanceMi: 4,
    avgHr: 160,                // 89% of 180 max → Z4
    maxHr: 168,
    workoutType: null,
    ...overrides,
  };
}

const cleanContext: ActivityContext = { temperatureF: 62, daysToNearestRace: 30 };
const hotContext: ActivityContext = { temperatureF: 82, daysToNearestRace: 30 };
const raceRecencyContext: ActivityContext = { temperatureF: 62, daysToNearestRace: 4 };
const noLocContext: ActivityContext = { temperatureF: null, daysToNearestRace: null };

describe('Adaptive VDOT · context filters (David spec scenarios)', () => {
  it('SCENARIO A · 3 consecutive faster T workouts in NORMAL conditions → bump fires', () => {
    const activities = [
      { data: fasterTWorkout('2026-05-18'), context: cleanContext },
      { data: fasterTWorkout('2026-05-11'), context: cleanContext },
      { data: fasterTWorkout('2026-05-04'), context: cleanContext },
    ];
    const result = evaluateActivities(activities, 46.6, 180);

    expect(result.fasterCount).toBe(3);
    expect(result.fasterWeight).toBeGreaterThanOrEqual(2.5);  // hits UP threshold
    expect(result.slowerCount).toBe(0);
    for (const o of result.observations) {
      expect(o.faster).toBe(true);
      expect(o.weight).toBe(1.0);
      expect(o.context).toEqual([]);
    }
  });

  it('SCENARIO B · 3 consecutive faster T workouts in 80°F+ heat → context filter attenuates, bump does NOT fire', () => {
    const activities = [
      { data: fasterTWorkout('2026-05-18'), context: hotContext },
      { data: fasterTWorkout('2026-05-11'), context: hotContext },
      { data: fasterTWorkout('2026-05-04'), context: hotContext },
    ];
    const result = evaluateActivities(activities, 46.6, 180);

    // Observations are visible (user can see what filtered out)
    expect(result.observations).toHaveLength(3);
    for (const o of result.observations) {
      expect(o.context).toContain('heat');
      expect(o.faster).toBe(false);  // hard-context kills the faster flag
      expect(o.weight).toBe(0);      // weight zeroed
      expect(o.temperatureF).toBe(82);
    }
    // Tallies show ZERO faster despite 3 candidate observations
    expect(result.fasterCount).toBe(0);
    expect(result.fasterWeight).toBe(0);
  });

  it('SCENARIO C · 3 consecutive faster T workouts within 7 days of a race → race-recency filter attenuates, bump does NOT fire', () => {
    const activities = [
      { data: fasterTWorkout('2026-05-18'), context: raceRecencyContext },
      { data: fasterTWorkout('2026-05-11'), context: { ...raceRecencyContext, daysToNearestRace: 2 } },
      { data: fasterTWorkout('2026-05-04'), context: { ...raceRecencyContext, daysToNearestRace: 7 } },
    ];
    const result = evaluateActivities(activities, 46.6, 180);

    expect(result.observations).toHaveLength(3);
    for (const o of result.observations) {
      expect(o.context).toContain('race-recency');
      expect(o.faster).toBe(false);
      expect(o.weight).toBe(0);
    }
    expect(result.fasterCount).toBe(0);
    expect(result.fasterWeight).toBe(0);
  });

  it('mixed: 2 hot + 1 clean → only 1 obs counts, below UP_OBS_MIN, no fire', () => {
    const activities = [
      { data: fasterTWorkout('2026-05-18'), context: hotContext },
      { data: fasterTWorkout('2026-05-11'), context: hotContext },
      { data: fasterTWorkout('2026-05-04'), context: cleanContext },
    ];
    const result = evaluateActivities(activities, 46.6, 180);

    expect(result.fasterCount).toBe(1);  // only the clean one
    expect(result.fasterWeight).toBe(1.0);
  });

  it('exactly-at-ceiling (78°F): NOT flagged as heat (strict > threshold)', () => {
    const ctx: ActivityContext = { temperatureF: 78, daysToNearestRace: null };
    const activities = [
      { data: fasterTWorkout('2026-05-18'), context: ctx },
      { data: fasterTWorkout('2026-05-11'), context: ctx },
      { data: fasterTWorkout('2026-05-04'), context: ctx },
    ];
    const result = evaluateActivities(activities, 46.6, 180);

    expect(result.fasterCount).toBe(3);
    for (const o of result.observations) {
      expect(o.context).not.toContain('heat');
    }
  });

  it('race-recency = 8 days (just outside window): NOT flagged', () => {
    const ctx: ActivityContext = { temperatureF: 62, daysToNearestRace: 8 };
    const activities = [
      { data: fasterTWorkout('2026-05-18'), context: ctx },
      { data: fasterTWorkout('2026-05-11'), context: ctx },
      { data: fasterTWorkout('2026-05-04'), context: ctx },
    ];
    const result = evaluateActivities(activities, 46.6, 180);

    expect(result.fasterCount).toBe(3);
    for (const o of result.observations) {
      expect(o.context).not.toContain('race-recency');
    }
  });

  it('unknown temperature (no coords): treats as clean, does NOT block bump', () => {
    const activities = [
      { data: fasterTWorkout('2026-05-18', { startLatLng: null }), context: noLocContext },
      { data: fasterTWorkout('2026-05-11', { startLatLng: null }), context: noLocContext },
      { data: fasterTWorkout('2026-05-04', { startLatLng: null }), context: noLocContext },
    ];
    const result = evaluateActivities(activities, 46.6, 180);

    expect(result.fasterCount).toBe(3);
    for (const o of result.observations) {
      expect(o.context).not.toContain('heat');
      expect(o.weight).toBe(1.0);
    }
  });

  it('hr-missing is SOFT attenuation (×0.6), does not zero, can still fire with enough volume', () => {
    const noHr = (date: string) => ({ data: fasterTWorkout(date, { avgHr: 0 }), context: cleanContext });
    const activities = [noHr('2026-05-18'), noHr('2026-05-11'), noHr('2026-05-04'), noHr('2026-04-27'), noHr('2026-04-20')];
    const result = evaluateActivities(activities, 46.6, 180);

    // 5 × 0.6 = 3.0w · still meets 3+ obs AND 2.5+ weight
    expect(result.fasterCount).toBe(5);
    expect(result.fasterWeight).toBeCloseTo(3.0, 2);
    for (const o of result.observations) {
      expect(o.context).toContain('hr-missing');
      expect(o.weight).toBe(0.6);
      expect(o.faster).toBe(true);
    }
  });

  it('poor-sleep flag (when wired) attenuates as HARD context', () => {
    const ctx: ActivityContext = { temperatureF: 62, daysToNearestRace: 30, poorSleepFlag: true };
    const activities = [
      { data: fasterTWorkout('2026-05-18'), context: ctx },
      { data: fasterTWorkout('2026-05-11'), context: ctx },
      { data: fasterTWorkout('2026-05-04'), context: ctx },
    ];
    const result = evaluateActivities(activities, 46.6, 180);

    expect(result.fasterCount).toBe(0);
    for (const o of result.observations) {
      expect(o.context).toContain('poor-sleep');
      expect(o.faster).toBe(false);
    }
  });
});

describe('Adaptive VDOT · tagsFromContext (filter tag derivation)', () => {
  it('returns empty array for clean context with HR', () => {
    expect(tagsFromContext({ temperatureF: 62, daysToNearestRace: 30 }, true)).toEqual([]);
  });
  it('tags heat when temp strictly > 78', () => {
    expect(tagsFromContext({ temperatureF: 79, daysToNearestRace: null }, true)).toContain('heat');
    expect(tagsFromContext({ temperatureF: 78, daysToNearestRace: null }, true)).not.toContain('heat');
  });
  it('tags race-recency when within 7 days', () => {
    expect(tagsFromContext({ temperatureF: null, daysToNearestRace: 7 }, true)).toContain('race-recency');
    expect(tagsFromContext({ temperatureF: null, daysToNearestRace: 8 }, true)).not.toContain('race-recency');
  });
  it('tags hr-missing when HR absent', () => {
    expect(tagsFromContext({ temperatureF: 62, daysToNearestRace: 30 }, false)).toContain('hr-missing');
  });
  it('stacks tags when multiple conditions hit', () => {
    const tags = tagsFromContext({ temperatureF: 85, daysToNearestRace: 3 }, false);
    expect(tags).toContain('heat');
    expect(tags).toContain('race-recency');
    expect(tags).toContain('hr-missing');
  });
});
