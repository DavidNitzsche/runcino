/**
 * Evidence permits or modifies · doctrine §3 table.
 *
 * The plan proposes a step every week. These hold the rules that decide
 * whether the runner takes it.
 */

import { describe, it, expect } from 'vitest';
import { resolveProgressionStep, BACK_OFF_FRACTION } from './progression-gate';
import { totalWorkMinutes, type WorkShape } from '@/lib/prescription/levers';
import type { AdaptationVerdict } from '@/lib/adaptation/adaptation-model';

const T = 462; // 7:42/mi

function shape(reps: number, repMinutes: number): WorkShape {
  return { reps, repMinutes, recoveryMinutes: 1, paceSPerMi: T, zone: 'PROGRESSIVE' };
}

function verdict(
  band: AdaptationVerdict['band'],
  over: Partial<AdaptationVerdict> = {},
): AdaptationVerdict {
  return {
    band,
    confidence: 'high',
    decision: band === 'marginal' ? 'STAY' : 'PROGRESS',
    stepMultiplier: band === 'strong' ? 1.25 : band === 'normal' ? 1 : band === 'marginal' ? 0 : -0.5,
    dimensions: [],
    summary: 'summary',
    ...over,
  };
}

const base = {
  // 55 mi/wk at 7:42 holds ~42 min of threshold under Daniels' 10% cap, so
  // 3x8 leaves genuine headroom for an acceleration to reach into. A base of
  // 3x12 is already near the ceiling — realistic, and separately tested below.
  planned: shape(3, 8),
  previous: shape(3, 6),
  weeklyMi: 55,
  family: 'threshold' as const,
  lever: 'quality_duration' as const,
};

describe('the doctrine table', () => {
  it('normal takes the planned step exactly as authored', () => {
    const d = resolveProgressionStep({ ...base, verdict: verdict('normal') });
    expect(d.action).toBe('TAKE');
    expect(d.shape).toEqual(base.planned);
    expect(d.changed).toBe(false);
  });

  it('strong takes MORE than the plan drew up', () => {
    const d = resolveProgressionStep({ ...base, verdict: verdict('strong') });
    expect(d.action).toBe('ACCELERATE');
    expect(totalWorkMinutes(d.shape)).toBeGreaterThan(totalWorkMinutes(base.planned));
    expect(d.changed).toBe(true);
  });

  it('marginal repeats last week rather than adding to it', () => {
    const d = resolveProgressionStep({ ...base, verdict: verdict('marginal') });
    expect(d.action).toBe('HOLD');
    expect(d.shape).toEqual(base.previous);
    expect(d.why).toMatch(/deferred, not cancelled/i);
  });

  it('poor prescribes less than last week', () => {
    const d = resolveProgressionStep({ ...base, verdict: verdict('poor') });
    expect(d.action).toBe('BACK_OFF');
    expect(totalWorkMinutes(d.shape)).toBeLessThan(totalWorkMinutes(base.previous));
  });
});

describe('pace is never the lever the gate pulls', () => {
  it('holds, accelerates and backs off all keep the runner s demonstrated pace', () => {
    // Backing off is about dose. Deciding the runner got slower is the fitness
    // model's business and it moves on evidence, not on a bad fortnight.
    for (const band of ['strong', 'normal', 'marginal', 'poor'] as const) {
      const d = resolveProgressionStep({ ...base, verdict: verdict(band) });
      expect(d.shape.paceSPerMi).toBe(T);
    }
  });
});

describe('doctrine caps still bind a strong athlete', () => {
  it('an acceleration that would exceed the week s at-pace cap falls back to the planned step', () => {
    // 55 mi/wk holds ~42 min at this pace. A planned 3x12 is 36, and one more
    // notch of duration would be 45 — past the cap, so there is no room.
    const d = resolveProgressionStep({
      ...base, planned: shape(3, 12), previous: shape(3, 10), verdict: verdict('strong'),
    });
    expect(d.action).toBe('TAKE');
    expect(d.shape).toEqual(shape(3, 12));
    expect(d.why).toMatch(/what the week can carry/i);
  });

  it('acceleration pulls the SAME lever the plan pulled, not a different one', () => {
    const d = resolveProgressionStep({ ...base, verdict: verdict('strong') });
    // quality_duration lengthens the rep; it must not have changed rep count.
    expect(d.shape.reps).toBe(base.planned.reps);
    expect(d.shape.repMinutes).toBeGreaterThan(base.planned.repMinutes);
  });

  it('with no lever recorded there is nothing to accelerate along', () => {
    const d = resolveProgressionStep({ ...base, lever: null, verdict: verdict('strong') });
    expect(d.action).toBe('TAKE');
  });
});

describe('the first session of a block has nothing to hold', () => {
  it('marginal takes the seed rather than holding nothing', () => {
    const d = resolveProgressionStep({ ...base, previous: null, verdict: verdict('marginal') });
    expect(d.action).toBe('TAKE');
    expect(d.shape).toEqual(base.planned);
  });

  it('a runner with no history is not held back on week one', () => {
    const d = resolveProgressionStep({
      ...base,
      previous: null,
      verdict: verdict('normal', { confidence: 'low' }),
    });
    expect(d.action).toBe('TAKE');
    expect(d.why).toMatch(/not much training evidence/i);
  });
});

describe('backing off leaves a coherent session', () => {
  it('drops a rep rather than shortening every rep', () => {
    const d = resolveProgressionStep({ ...base, verdict: verdict('poor') });
    expect(d.shape.repMinutes).toBe(base.previous.repMinutes);
    expect(d.shape.reps).toBeLessThan(base.previous.reps);
  });

  it('a continuous effort has no rep to drop, so its duration is trimmed', () => {
    const continuous = shape(1, 30);
    const d = resolveProgressionStep({
      ...base,
      planned: continuous,
      previous: continuous,
      verdict: verdict('poor'),
    });
    expect(d.shape.reps).toBe(1);
    expect(d.shape.repMinutes).toBeCloseTo(30 * (1 - BACK_OFF_FRACTION), 0);
  });

  it('a reduced session is no longer asking for overload', () => {
    const d = resolveProgressionStep({ ...base, verdict: verdict('poor') });
    expect(d.shape.zone).toBe('ESTABLISHED');
  });

  it('never reduces below one rep', () => {
    const d = resolveProgressionStep({
      ...base,
      planned: shape(1, 4),
      previous: shape(1, 4),
      verdict: verdict('poor'),
    });
    expect(d.shape.reps).toBeGreaterThanOrEqual(1);
    expect(d.shape.repMinutes).toBeGreaterThanOrEqual(1);
  });
});

describe('changed reports whether anything needs writing', () => {
  it('is false when the gate lands on exactly what was authored', () => {
    expect(resolveProgressionStep({ ...base, verdict: verdict('normal') }).changed).toBe(false);
  });

  it('is false when holding and the plan had not stepped anyway', () => {
    const flat = shape(3, 10);
    const d = resolveProgressionStep({
      ...base,
      planned: flat,
      previous: flat,
      verdict: verdict('marginal'),
    });
    expect(d.action).toBe('HOLD');
    expect(d.changed).toBe(false);
  });
});
