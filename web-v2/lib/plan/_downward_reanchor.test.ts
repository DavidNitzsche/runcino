/**
 * DOWNWARD RE-ANCHOR INVARIANTS (2026-08-17 · coaching-loop reconciliation).
 *
 * pr_bank only ever fired on delta > +1.5 vs vdot_last_reviewed — the
 * plan had an accelerator and no brake. These tests lock the pure core of
 * the symmetric fitness_regression detector plus the cron routing of the
 * new recompute_paces action.
 *
 * Cite: Research/01-pace-zones-vdot.md:316-320 ("tempo unexpectedly hard
 * ≥2 sessions → −1 to −2 VDOT"; layoff rows) + :659-677 (freshness).
 */
import { describe, it, expect } from 'vitest';
import {
  REGRESSION_DELTA_THRESHOLD,
  fitnessRegressionFires,
  partitionActionsForCron,
  type AdaptationAction,
} from './adapt';

describe('fitnessRegressionFires', () => {
  it('fires only below anchor − threshold', () => {
    expect(fitnessRegressionFires(47, 45.4)).toBe(true);   // −1.6
    expect(fitnessRegressionFires(47, 45.5)).toBe(false);  // −1.5 exactly · boundary excluded (mirror of pr_bank's delta <= 1.5 no-fire)
    expect(fitnessRegressionFires(47, 46.9)).toBe(false);  // noise
    expect(fitnessRegressionFires(47, 49)).toBe(false);    // improvement is pr_bank's job
  });
  it('never fires on missing inputs', () => {
    expect(fitnessRegressionFires(null, 40)).toBe(false);
    expect(fitnessRegressionFires(47, null)).toBe(false);
    expect(fitnessRegressionFires(undefined, undefined)).toBe(false);
  });
  it('threshold is symmetric with pr_bank (+1.5 up · −1.5 down)', () => {
    expect(REGRESSION_DELTA_THRESHOLD).toBe(1.5);
  });
});

describe('recompute_paces cron routing', () => {
  it('race-sourced regression recompute auto-applies (David: watch time IS the result)', () => {
    const actions: AdaptationAction[] = [
      { kind: 'recompute_paces', newVdot: 44.2, why: 'race read slower', sourceTrigger: 'fitness_regression' },
    ];
    const { applyNow, proposeFirst } = partitionActionsForCron(actions);
    expect(applyNow).toHaveLength(1);
    expect(proposeFirst).toHaveLength(0);
  });
  it('pr_bank upward recompute auto-applies too (both directions share one action)', () => {
    const actions: AdaptationAction[] = [
      { kind: 'recompute_paces', newVdot: 49.1, why: 'new race fitness', sourceTrigger: 'pr_bank' },
    ];
    const { applyNow, proposeFirst } = partitionActionsForCron(actions);
    expect(applyNow).toHaveLength(1);
    expect(proposeFirst).toHaveLength(0);
  });
  it('a load-reducing downgrade still routes propose-first (unchanged)', () => {
    // Retagged 2026-09-02 · was `readiness_pullback`, which is no longer a
    // trigger. The property is DIRECTION-1 — a downgrade takes a session away
    // and so must be proposed — and it holds on any limb that emits one.
    const actions: AdaptationAction[] = [
      { kind: 'downgrade', workoutIds: ['w1'], newType: 'easy', why: 'anti-stacking', sourceTrigger: 'missed_key_workout' },
    ];
    const { applyNow, proposeFirst } = partitionActionsForCron(actions);
    expect(applyNow).toHaveLength(0);
    expect(proposeFirst).toHaveLength(1);
  });
});
