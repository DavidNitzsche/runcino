/**
 * lib/coach/firing-policy.test.ts
 *
 * Locks the firing test from Design/execution-memory-firing.md Part 3
 * against the classifier, in the doctrine's own worked examples: the
 * shape-change/stimulus-preserved SURFACE case, the third-repeated-failure
 * SURFACE case, and the positive-message threshold ("Great consistency!"
 * after four normal days vs. "four straight weeks above the previous
 * mileage ceiling").
 */
import { describe, it, expect } from 'vitest';
import {
  classifyFinding,
  escalateByRepetition,
  atLeastAsLoud,
  meetsPositiveThreshold,
  FIRING_LEVEL_RANK,
  type CoachFindingInput,
} from './firing-policy';

const base: CoachFindingInput = {
  changed: true,
  athleteNeedsToKnow: true,
};

describe('the firing test, in order', () => {
  it('nothing changed → silent, no matter what else is set', () => {
    expect(
      classifyFinding({
        ...base,
        changed: false,
        interruptCategory: 'safety_or_injury',
        usefulOnlyBecauseLooking: true,
      }),
    ).toBe('SILENT');
  });

  it('athlete does not need to know → silent (store it)', () => {
    expect(classifyFinding({ ...base, athleteNeedsToKnow: false })).toBe('SILENT');
  });

  it('qualifying interrupt category → INTERRUPT', () => {
    expect(classifyFinding({ ...base, interruptCategory: 'safety_or_injury' })).toBe('INTERRUPT');
    expect(
      classifyFinding({ ...base, interruptCategory: 'material_workout_change_before_execution' }),
    ).toBe('INTERRUPT');
    expect(
      classifyFinding({ ...base, interruptCategory: 'significant_weather_intervention' }),
    ).toBe('INTERRUPT');
    expect(classifyFinding({ ...base, interruptCategory: 'important_schedule_conflict' })).toBe(
      'INTERRUPT',
    );
    expect(classifyFinding({ ...base, interruptCategory: 'time_sensitive_race_execution' })).toBe(
      'INTERRUPT',
    );
  });

  it('interrupt category outranks usefulOnlyBecauseLooking on the same finding', () => {
    expect(
      classifyFinding({
        ...base,
        interruptCategory: 'safety_or_injury',
        usefulOnlyBecauseLooking: true,
      }),
    ).toBe('INTERRUPT');
  });

  it('useful only because looking → SURFACE', () => {
    expect(classifyFinding({ ...base, usefulOnlyBecauseLooking: true })).toBe('SURFACE');
  });

  it('explanatory depth → AVAILABLE', () => {
    expect(classifyFinding({ ...base, explanatoryDepth: true })).toBe('AVAILABLE');
  });

  it('surface outranks available when both are set on the same finding', () => {
    expect(
      classifyFinding({ ...base, usefulOnlyBecauseLooking: true, explanatoryDepth: true }),
    ).toBe('SURFACE');
  });

  it('changed + needs-to-know + no more specific home → SURFACE (the doctrine default)', () => {
    expect(classifyFinding(base)).toBe('SURFACE');
  });
});

describe('positive messages need the same threshold', () => {
  it('"Great consistency!" after four normal days → silent', () => {
    expect(
      classifyFinding({
        ...base,
        isPositive: true,
        meaningfulPositive: false,
        usefulOnlyBecauseLooking: true,
      }),
    ).toBe('SILENT');
  });

  it('four weeks above the previous mileage ceiling → surfaces', () => {
    expect(
      classifyFinding({
        ...base,
        isPositive: true,
        meaningfulPositive: true,
        usefulOnlyBecauseLooking: true,
      }),
    ).toBe('SURFACE');
  });

  it('meetsPositiveThreshold mirrors the meaningfulPositive flag exactly', () => {
    expect(meetsPositiveThreshold(false)).toBe(false);
    expect(meetsPositiveThreshold(true)).toBe(true);
  });
});

describe('episode suppression feeds the classifier', () => {
  it('already delivered this episode → silent regardless of everything else', () => {
    expect(
      classifyFinding({
        ...base,
        interruptCategory: 'safety_or_injury',
        episode: { patternEstablished: true, alreadyDeliveredThisEpisode: true },
      }),
    ).toBe('SILENT');
  });

  it('pattern not yet established → silent (an anecdote is not a pattern)', () => {
    expect(
      classifyFinding({
        ...base,
        usefulOnlyBecauseLooking: true,
        episode: { patternEstablished: false },
      }),
    ).toBe('SILENT');
  });

  it('pattern established, not yet delivered → fires at its natural level', () => {
    expect(
      classifyFinding({
        ...base,
        usefulOnlyBecauseLooking: true,
        episode: { patternEstablished: true, alreadyDeliveredThisEpisode: false },
      }),
    ).toBe('SURFACE');
  });
});

describe('escalateByRepetition', () => {
  it('never promotes SILENT', () => {
    expect(escalateByRepetition('SILENT', 10)).toBe('SILENT');
  });

  it('never manufactures INTERRUPT from repetition alone', () => {
    expect(escalateByRepetition('AVAILABLE', 999)).not.toBe('INTERRUPT');
    expect(escalateByRepetition('SURFACE', 999)).not.toBe('INTERRUPT');
  });

  it('third occurrence promotes AVAILABLE to SURFACE, matching the doc\'s worked example', () => {
    expect(escalateByRepetition('AVAILABLE', 1)).toBe('AVAILABLE');
    expect(escalateByRepetition('AVAILABLE', 2)).toBe('AVAILABLE');
    expect(escalateByRepetition('AVAILABLE', 3)).toBe('SURFACE');
  });

  it('is a no-op on levels it does not touch', () => {
    expect(escalateByRepetition('INTERRUPT', 3)).toBe('INTERRUPT');
    expect(escalateByRepetition('SURFACE', 3)).toBe('SURFACE');
  });
});

describe('level ranking', () => {
  it('orders INTERRUPT > SURFACE > AVAILABLE > SILENT', () => {
    expect(FIRING_LEVEL_RANK.INTERRUPT).toBeGreaterThan(FIRING_LEVEL_RANK.SURFACE);
    expect(FIRING_LEVEL_RANK.SURFACE).toBeGreaterThan(FIRING_LEVEL_RANK.AVAILABLE);
    expect(FIRING_LEVEL_RANK.AVAILABLE).toBeGreaterThan(FIRING_LEVEL_RANK.SILENT);
  });

  it('atLeastAsLoud is reflexive and respects the ranking', () => {
    expect(atLeastAsLoud('SURFACE', 'SURFACE')).toBe(true);
    expect(atLeastAsLoud('INTERRUPT', 'AVAILABLE')).toBe(true);
    expect(atLeastAsLoud('AVAILABLE', 'SURFACE')).toBe(false);
  });
});
