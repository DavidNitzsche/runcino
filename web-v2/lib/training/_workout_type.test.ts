/**
 * lib/training/_workout_type.test.ts · one spelling, one union.
 *
 * Pins the two defects closed in `workout-type.ts`:
 *   · `interval` and `intervals` are one thing, and the badge path sees it.
 *   · the two same-axis `WorkoutType` unions are now the same type, and the
 *     third one (the wire contract's coarse bucket) is deliberately not.
 */
import { describe, it, expect } from 'vitest';
import {
  SESSION_TYPES,
  canonicalSessionType,
  normalizeWorkoutTypeLoose,
  isQualitySessionType,
  type SessionType,
} from './workout-type';
import { QUALITY_TYPES, normalizeDataWorkoutType, badgeForRun } from '@/lib/runs/log-enrich';
import type { WorkoutType as PrescriptionWorkoutType } from './prescriptions';
import type { WorkoutType as PurposeWorkoutType } from '@/lib/coach/run-purpose';
import { derivePurpose } from '@/lib/coach/run-purpose';
import { prescriptionFor } from './prescriptions';

describe('SESSION TYPE · one spelling', () => {
  it('folds the singular onto the plural', () => {
    expect(canonicalSessionType('interval')).toBe('intervals');
    expect(canonicalSessionType('intervals')).toBe('intervals');
    expect(canonicalSessionType('INTERVAL')).toBe('intervals');
    expect(canonicalSessionType(' Interval ')).toBe('intervals');
  });

  it('folds the spellings the codebase already treated as one', () => {
    expect(canonicalSessionType('vo2')).toBe('intervals');
    expect(canonicalSessionType('vo2max')).toBe('intervals');
    expect(canonicalSessionType('track')).toBe('intervals');
    expect(canonicalSessionType('tune_up')).toBe('race_week_tuneup');
    expect(canonicalSessionType('race-week-tuneup')).toBe('race_week_tuneup');
  });

  it('never guesses · an unknown string is null, not a default', () => {
    expect(canonicalSessionType('elliptical')).toBeNull();
    expect(canonicalSessionType('')).toBeNull();
    expect(canonicalSessionType(null)).toBeNull();
    // `quality` is the wire contract's COARSE bucket, not a session type.
    // Mapping it to any one type would turn a tempo into a rep session.
    expect(canonicalSessionType('quality')).toBeNull();
  });

  it('keeps an unrecognised value rather than dropping it, on the loose path', () => {
    expect(normalizeWorkoutTypeLoose('elliptical')).toBe('elliptical');
    expect(normalizeWorkoutTypeLoose('interval')).toBe('intervals');
    expect(normalizeWorkoutTypeLoose(null)).toBeNull();
  });

  it('every canonical name round-trips', () => {
    for (const t of SESSION_TYPES) expect(canonicalSessionType(t)).toBe(t);
  });
});

describe('SESSION TYPE · the badge path sees one spelling', () => {
  it('normalizeDataWorkoutType folds `interval`, keeping the Strava codes', () => {
    expect(normalizeDataWorkoutType('interval')).toBe('intervals');
    expect(normalizeDataWorkoutType('1')).toBe('race');
    expect(normalizeDataWorkoutType('2')).toBe('long');
    expect(normalizeDataWorkoutType('3')).toBe('tempo');
    expect(normalizeDataWorkoutType('0')).toBeNull();
    expect(normalizeDataWorkoutType('elliptical')).toBe('elliptical');
  });

  it('a rep session stored under EITHER spelling earns its badge', () => {
    // The live defect: QUALITY_TYPES contains `intervals` and not `interval`,
    // so 214 production rows never earned SOLID.
    expect(QUALITY_TYPES.has('intervals')).toBe(true);
    for (const spelling of ['interval', 'intervals']) {
      const badge = badgeForRun({
        isRace: false,
        workoutType: spelling,
        distanceMi: 7,
        paceSPerMi: 420,
        plan: null,
      });
      expect(badge, `${spelling} did not earn a quality badge`).toBe('SOLID');
    }
  });

  it('NAILED IT still needs a steady-quality plan type', () => {
    const nailed = badgeForRun({
      isRace: false,
      workoutType: 'tempo',
      distanceMi: 7,
      paceSPerMi: 420,
      plan: { isQuality: true, type: 'tempo', paceTargetSPerMi: 421 } as never,
    });
    expect(nailed).toBe('NAILED IT');
    // An interval session's whole-run average includes the recovery jog, so it
    // settles at SOLID rather than false-negativing on the pace target.
    const reps = badgeForRun({
      isRace: false,
      workoutType: 'interval',
      distanceMi: 7,
      paceSPerMi: 420,
      plan: { isQuality: true, type: 'interval', paceTargetSPerMi: 421 } as never,
    });
    expect(reps).toBe('SOLID');
  });
});

describe('SESSION TYPE · the unions converged', () => {
  it('the two same-axis unions are now the same type', () => {
    // Assignable both ways in both directions · that is what "same type" means
    // to the compiler, and it is checked at compile time, not at run time.
    const a: PrescriptionWorkoutType = 'fartlek';
    const b: PurposeWorkoutType = a;
    const c: SessionType = b;
    const d: PrescriptionWorkoutType = c;
    expect(d).toBe('fartlek');
  });

  it('every canonical type is answerable by both consumers', () => {
    for (const type of SESSION_TYPES) {
      const purpose = derivePurpose({ type, phase: 'BUILD', raceDistanceMi: 26.2, plannedMi: 8 });
      expect(purpose.verdict.length, `derivePurpose gave up on ${type}`).toBeGreaterThan(0);
      expect(purpose.facts.length).toBeGreaterThanOrEqual(1);

      const rx = prescriptionFor(type, 40, {} as never, 8);
      expect(rx.type, `prescriptionFor gave up on ${type}`).toBe(type);
      expect(typeof rx.headline).toBe('string');
    }
  });

  it('the three types the old prescription union lacked are now admissible', () => {
    for (const type of ['fartlek', 'progression', 'recovery', 'race_week_tuneup'] as SessionType[]) {
      expect(SESSION_TYPES).toContain(type);
    }
  });

  it('classifies quality work consistently', () => {
    for (const t of ['tempo', 'threshold', 'intervals', 'interval', 'fartlek', 'progression', 'race_week_tuneup']) {
      expect(isQualitySessionType(t), `${t} should be quality`).toBe(true);
    }
    for (const t of ['easy', 'long', 'recovery', 'shakeout', 'rest', 'race', 'elliptical']) {
      expect(isQualitySessionType(t), `${t} should not be quality`).toBe(false);
    }
  });
});
