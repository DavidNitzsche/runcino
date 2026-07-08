/**
 * lib/training/targets-summary-ultra.test.ts
 *
 * 2026-07-07 · ultra-honesty audit P2-70 · composeTargetsSummaryLine's
 * unsupportedDistance branch. Without it, an ultra runner who set a real
 * time goal (goalSource === 'race', goalSec set) fell into the "Racing
 * <name>. Set a time goal to track a projection against it." branch —
 * wrongly implying no time goal exists — because projectedSec is honestly
 * null for any distance past the marathon (see lib/training/vdot.ts
 * DANIELS_MAX_VALID_DISTANCE_MI). This locks the fix: the unsupportedDistance
 * branch must fire before both "no goal" branches, and never before the
 * real-numbers branch when a projection genuinely exists (non-ultra).
 */
import { describe, expect, it } from 'vitest';
import { composeTargetsSummaryLine, type TargetsSummaryArgs } from './targets-summary';

const base: TargetsSummaryArgs = {
  status: 'cold',
  goalSec: null,
  projectedSec: null,
  goalSource: null,
  raceName: null,
  daysAway: null,
  vdot: null,
  lastMove: null,
  heldDays: 0,
};

describe('composeTargetsSummaryLine — unsupportedDistance (ultra) branch', () => {
  it('never says "Set a time goal" for an ultra runner who has one set', () => {
    const line = composeTargetsSummaryLine({
      ...base,
      status: 'cold',
      goalSec: 5 * 3600, // 5:00:00 50K goal — a REAL goal, not absent
      projectedSec: null, // honestly null — DANIELS_MAX_VALID_DISTANCE_MI gate
      goalSource: 'race',
      raceName: 'Javelina Jundred 100M',
      daysAway: 40,
      unsupportedDistance: true,
    });
    expect(line).not.toMatch(/set a (time )?goal/i);
    expect(line.toLowerCase()).toContain('ultra');
  });

  it('names the race and timing when present, same grammar as the no-goal race branch', () => {
    const line = composeTargetsSummaryLine({
      ...base,
      goalSource: 'race',
      raceName: 'Western States 100M',
      daysAway: 0,
      unsupportedDistance: true,
    });
    expect(line).toContain('Western States 100M');
    expect(line).toContain('today');
  });

  it('degrades cleanly with no race name (fitness-goal-mode ultra, e.g. a 50K tt_goal)', () => {
    const line = composeTargetsSummaryLine({
      ...base,
      goalSource: 'fitness_goal',
      raceName: null,
      unsupportedDistance: true,
    });
    expect(line.toLowerCase()).toContain('ultra');
    expect(line).not.toMatch(/undefined|null|NaN/);
  });

  it('fires BEFORE the no-goal nudge branches (branch ordering)', () => {
    // Same args as a genuine no-goal race EXCEPT unsupportedDistance is true —
    // must take the ultra branch, not the "Set a time goal" nudge.
    const withUltraFlag = composeTargetsSummaryLine({
      ...base,
      goalSource: 'race',
      raceName: 'Bandera 100K',
      daysAway: 10,
      unsupportedDistance: true,
    });
    const withoutUltraFlag = composeTargetsSummaryLine({
      ...base,
      goalSource: 'race',
      raceName: 'Bandera 100K',
      daysAway: 10,
      unsupportedDistance: false,
    });
    expect(withUltraFlag).not.toBe(withoutUltraFlag);
    expect(withoutUltraFlag).toMatch(/set a time goal/i);
    expect(withUltraFlag).not.toMatch(/set a time goal/i);
  });

  it('does NOT affect non-ultra output — omitting unsupportedDistance is byte-identical to false', () => {
    const argsNoFlag: TargetsSummaryArgs = {
      ...base,
      status: 'on_track',
      goalSec: 5400,
      projectedSec: 5300,
    };
    const withFalse = composeTargetsSummaryLine({ ...argsNoFlag, unsupportedDistance: false });
    const withOmitted = composeTargetsSummaryLine(argsNoFlag);
    expect(withFalse).toBe(withOmitted);
    expect(withFalse).toMatch(/on pace for/i);
  });

  it('a real (non-ultra) on-track projection still wins over the ultra branch when unsupportedDistance is false', () => {
    const line = composeTargetsSummaryLine({
      ...base,
      status: 'on_track',
      goalSec: 5400,
      projectedSec: 5300,
      unsupportedDistance: false,
    });
    expect(line).toMatch(/on pace for/i);
    expect(line.toLowerCase()).not.toContain('ultra');
  });
});
