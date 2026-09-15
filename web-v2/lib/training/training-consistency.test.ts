/**
 * lib/training/training-consistency.test.ts
 *
 * `resolveTrainingConsistency` is THE canonical `TRAINING_CONSISTENCY`
 * reader (see the header of `training-consistency.ts` for the full
 * consolidation record). These tests exercise the pure function only —
 * Rule 18 falsification, no database — and are written directly against
 * consult-log 2026-09-15-025 Ruling 1's stated shape:
 *
 *   · keyed on a TRAILING session-count streak, not a week count or a
 *     lifetime share;
 *   · fires at 2 (the smaller end of the doctrine's "2-3" band);
 *   · a single miss must NOT fire it (that's the existing single-miss
 *     handler's job, left untouched);
 *   · a session that lands resets the streak to 0, even if earlier misses
 *     exist further back in the window.
 */
import { describe, expect, it } from 'vitest';
import {
  NON_ADHERENCE_TRIGGER_STREAK,
  resolveTrainingConsistency,
  type ConsistencySession,
} from './training-consistency';

function session(dateISO: string, earnsProgression: boolean): ConsistencySession {
  return {
    dateISO,
    state: earnsProgression ? 'AS_PLANNED' : 'MISSED',
    earnsProgression,
  };
}

describe('resolveTrainingConsistency · no evidence', () => {
  it('reads as no signal at all when there are no representative sessions', () => {
    const v = resolveTrainingConsistency([]);
    expect(v.consecutiveMissedQuality).toBe(0);
    expect(v.triggersNonAdherenceOffer).toBe(false);
    expect(v.qualityDeliveryShare).toBeNull();
  });
});

describe('resolveTrainingConsistency · single miss (Rule 18: must not fire)', () => {
  it('one missed quality session does not trigger the offer', () => {
    const v = resolveTrainingConsistency([
      session('2026-09-01', true),
      session('2026-09-03', true),
      session('2026-09-08', false),
    ]);
    expect(v.consecutiveMissedQuality).toBe(1);
    expect(v.triggersNonAdherenceOffer).toBe(false);
  });
});

describe('resolveTrainingConsistency · the IPR-20260914-006 case', () => {
  it('fires at exactly NON_ADHERENCE_TRIGGER_STREAK consecutive misses', () => {
    expect(NON_ADHERENCE_TRIGGER_STREAK).toBe(2);
    const v = resolveTrainingConsistency([
      session('2026-08-01', true),
      session('2026-08-08', false),
      session('2026-08-15', false),
    ]);
    expect(v.consecutiveMissedQuality).toBe(2);
    expect(v.triggersNonAdherenceOffer).toBe(true);
  });

  it('three, four, six weeks of misses in a row all still fire (never un-fires from more of the same)', () => {
    const sixWeeksOfMisses = Array.from({ length: 6 }, (_, i) =>
      session(`2026-0${1 + i}-15`, false));
    const v = resolveTrainingConsistency(sixWeeksOfMisses);
    expect(v.consecutiveMissedQuality).toBe(6);
    expect(v.triggersNonAdherenceOffer).toBe(true);
  });
});

describe('resolveTrainingConsistency · Rule 18: a landed session resets the streak', () => {
  it('an earlier run of misses does not carry through a session that landed', () => {
    const v = resolveTrainingConsistency([
      session('2026-07-01', false),
      session('2026-07-08', false),
      session('2026-07-15', false),
      session('2026-07-22', true), // landed — the streak is over
      session('2026-07-29', false),
    ]);
    expect(v.consecutiveMissedQuality).toBe(1);
    expect(v.triggersNonAdherenceOffer).toBe(false);
  });

  it('keys on the TRAILING streak, never a lifetime or windowed count', () => {
    // Six misses out of eight sessions, but the two most recent both landed —
    // this must read as "not currently trending non-adherent" even though
    // the share looks bad, because the trigger is deliberately NOT the share
    // (see the doctrine citation on `qualityDeliveryShare`).
    const v = resolveTrainingConsistency([
      session('2026-06-01', false),
      session('2026-06-08', false),
      session('2026-06-15', false),
      session('2026-06-22', false),
      session('2026-06-29', false),
      session('2026-07-06', false),
      session('2026-07-13', true),
      session('2026-07-20', true),
    ]);
    expect(v.consecutiveMissedQuality).toBe(0);
    expect(v.triggersNonAdherenceOffer).toBe(false);
    expect(v.qualityDeliveryShare).toBe(0.25);
  });
});

describe('resolveTrainingConsistency · qualityDeliveryShare is narration, not the trigger', () => {
  it('a good average with a fresh 2-miss streak still fires', () => {
    // 5 of 7 landed (71% share — "looks fine on average") but the last two
    // in a row both failed. This is the exact shape IPR-20260914-006 names:
    // the share hides it, the trailing streak does not.
    const v = resolveTrainingConsistency([
      session('2026-05-01', true),
      session('2026-05-08', true),
      session('2026-05-15', true),
      session('2026-05-22', true),
      session('2026-05-29', true),
      session('2026-06-05', false),
      session('2026-06-12', false),
    ]);
    expect(v.qualityDeliveryShare).toBeCloseTo(5 / 7, 5);
    expect(v.triggersNonAdherenceOffer).toBe(true);
  });
});
