/**
 * lib/runs/log-enrich.test.ts · 2026-08-17 Activity-surface truth fixes.
 *
 * Pure-helper falsifiers:
 *   F1  name coalescing — a merged twin's real name beats the canonical
 *       row's generic 'Run'; a non-generic canonical name is never replaced.
 *   F2  race matching — same date + distance within ~12%, or a
 *       workoutType='race' flag on any row of the physical run.
 *   F3  badge conditions — RACE > ON TARGET > SOLID > LONGEST, and the
 *       branches the UI renders are all reachable.
 *   F4  workoutType resolution order — race > plan type > run's own flag >
 *       activity type.
 */
import { describe, it, expect } from 'vitest';
import {
  isGenericRunName, coalesceRunName, normalizeDataWorkoutType,
  matchRaceForRun, badgeForRun, resolveWorkoutType,
  type RaceForMatch,
} from './log-enrich';

describe('isGenericRunName', () => {
  it('flags device defaults as generic', () => {
    for (const n of ['Run', 'run', ' Run ', 'Treadmill', 'Treadmill Run', 'Morning Run', 'Lunch Run', 'Afternoon Run', 'Evening Run', 'Night Run', 'Workout', '', null, undefined]) {
      expect(isGenericRunName(n as string | null | undefined)).toBe(true);
    }
  });
  it('keeps human-authored names', () => {
    for (const n of ['AFC Half', 'Intervals', 'Little Monday speed hit', 'Big Sur Marathon', 'Tempo Tuesday']) {
      expect(isGenericRunName(n)).toBe(false);
    }
  });
});

describe('coalesceRunName (F1)', () => {
  it('merged twin real name wins over canonical Run', () => {
    expect(coalesceRunName('Run', [
      { name: 'Morning Run', source: 'apple_health', workoutType: null },
      { name: 'AFC Half', source: 'strava', workoutType: '1' },
    ])).toBe('AFC Half');
  });
  it('prefers the Strava-sourced twin when several twins are named', () => {
    expect(coalesceRunName('Run', [
      { name: 'HK named thing', source: 'apple_health', workoutType: null },
      { name: 'Little Monday speed hit', source: 'strava', workoutType: null },
    ])).toBe('Little Monday speed hit');
  });
  it('never replaces a non-generic canonical name', () => {
    expect(coalesceRunName('My watch run title', [
      { name: 'Strava twin name', source: 'strava', workoutType: null },
    ])).toBe('My watch run title');
  });
  it('falls back to the canonical generic name when no twin has a real one', () => {
    expect(coalesceRunName('Run', [
      { name: 'Evening Run', source: 'strava', workoutType: null },
    ])).toBe('Run');
    expect(coalesceRunName(null, [])).toBe('Run');
  });
});

describe('normalizeDataWorkoutType', () => {
  it('maps Strava numeric codes', () => {
    expect(normalizeDataWorkoutType('1')).toBe('race');
    expect(normalizeDataWorkoutType(1)).toBe('race');
    expect(normalizeDataWorkoutType('2')).toBe('long');
    expect(normalizeDataWorkoutType('3')).toBe('tempo');
    expect(normalizeDataWorkoutType('0')).toBeNull();
    expect(normalizeDataWorkoutType(null)).toBeNull();
    expect(normalizeDataWorkoutType('')).toBeNull();
  });
  it('passes plan-stamped strings through lowercased', () => {
    expect(normalizeDataWorkoutType('Race')).toBe('race');
    expect(normalizeDataWorkoutType('tempo')).toBe('tempo');
  });
});

const AFC: RaceForMatch = { slug: 'afc-half-2026', name: 'AFC Half', date: '2026-08-16', distanceMi: 13.1 };

describe('matchRaceForRun (F2)', () => {
  it('matches same date + distance within 12% (GPS over-measure)', () => {
    expect(matchRaceForRun({ date: '2026-08-16', distanceMi: 13.34, workoutTypeHint: null }, [AFC])).toBe(AFC);
  });
  it('rejects a different date even with matching distance', () => {
    expect(matchRaceForRun({ date: '2026-08-15', distanceMi: 13.1, workoutTypeHint: 'race' }, [AFC])).toBeNull();
  });
  it('rejects a same-day shakeout at a non-race distance', () => {
    expect(matchRaceForRun({ date: '2026-08-16', distanceMi: 2.0, workoutTypeHint: null }, [AFC])).toBeNull();
  });
  it('workoutType=race flag matches beyond the distance band', () => {
    expect(matchRaceForRun({ date: '2026-08-16', distanceMi: 11.0, workoutTypeHint: 'race' }, [AFC])).toBe(AFC);
  });
  it('a race with an unparseable distance still matches on the race flag', () => {
    const odd: RaceForMatch = { slug: 'mystery', name: 'Mystery Miler', date: '2026-08-16', distanceMi: null };
    expect(matchRaceForRun({ date: '2026-08-16', distanceMi: 7.3, workoutTypeHint: 'race' }, [odd])).toBe(odd);
    expect(matchRaceForRun({ date: '2026-08-16', distanceMi: 7.3, workoutTypeHint: null }, [odd])).toBeNull();
  });
});

describe('badgeForRun (F3)', () => {
  it('race beats everything', () => {
    expect(badgeForRun({ isRace: true, workoutType: 'race', distanceMi: 13.3, paceSPerMi: 400, plan: null })).toBe('RACE');
  });
  it('tempo within the pace-target band earns ON TARGET', () => {
    expect(badgeForRun({
      isRace: false, workoutType: 'tempo', distanceMi: 6, paceSPerMi: 412,
      plan: { type: 'tempo', paceTargetSPerMi: 405, isQuality: true },
    })).toBe('ON TARGET');
  });
  it('tempo far off target settles at SOLID', () => {
    expect(badgeForRun({
      isRace: false, workoutType: 'tempo', distanceMi: 6, paceSPerMi: 460,
      plan: { type: 'tempo', paceTargetSPerMi: 405, isQuality: true },
    })).toBe('SOLID');
  });
  it('intervals settle at SOLID (whole-run avg pace includes recovery jog)', () => {
    expect(badgeForRun({
      isRace: false, workoutType: 'intervals', distanceMi: 7, paceSPerMi: 500,
      plan: { type: 'intervals', paceTargetSPerMi: 330, isQuality: true },
    })).toBe('SOLID');
  });
  it('race_week_tuneup is quality, never easy-null', () => {
    expect(badgeForRun({ isRace: false, workoutType: 'race_week_tuneup', distanceMi: 4, paceSPerMi: 400, plan: null })).toBe('SOLID');
  });
  it('18+ mi easy run earns LONGEST', () => {
    expect(badgeForRun({ isRace: false, workoutType: 'easy', distanceMi: 20, paceSPerMi: 540, plan: null })).toBe('LONGEST');
  });
  it('an ordinary easy run gets no badge', () => {
    expect(badgeForRun({ isRace: false, workoutType: 'easy', distanceMi: 6, paceSPerMi: 540, plan: null })).toBeNull();
  });
});

describe('resolveWorkoutType (F4)', () => {
  it('race match wins', () => {
    expect(resolveWorkoutType({ isRace: true, planType: 'easy', workoutTypeHint: null, activityType: 'run' })).toBe('race');
  });
  it('plan type beats the raw activity type', () => {
    expect(resolveWorkoutType({ isRace: false, planType: 'tempo', workoutTypeHint: null, activityType: 'run' })).toBe('tempo');
  });
  it("the run's own flag beats the bare activity type", () => {
    expect(resolveWorkoutType({ isRace: false, planType: null, workoutTypeHint: 'tempo', activityType: 'run' })).toBe('tempo');
  });
  it('falls through to the activity type', () => {
    expect(resolveWorkoutType({ isRace: false, planType: null, workoutTypeHint: null, activityType: 'run' })).toBe('run');
  });
});
