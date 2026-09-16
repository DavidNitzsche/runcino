/**
 * lib/route/_deadline_budget.test.ts · BA-01R items 8/9 — the cooperative
 * budget that replaces racing a promise against a timer for a multi-phase
 * computation.
 *
 * Falsified per Rule 18: `expired` reversed to always return `false` fails
 * `'expires once the budget is spent'` and `'never un-expires'`; `lastStage`
 * hardcoded to a constant string fails `'lastStage names whatever was last
 * marked'`. Both confirmed against the un-fixed class before landing.
 */
import { describe, it, expect, vi } from 'vitest';
import { DeadlineBudget } from './deadline-budget';

describe('DeadlineBudget · a clock, not a race', () => {
  it('is not expired before its budget elapses', () => {
    const budget = new DeadlineBudget(10_000);
    expect(budget.expired).toBe(false);
    expect(budget.remainingMs).toBeGreaterThan(0);
  });

  it('expires once the budget is spent', () => {
    vi.useFakeTimers();
    const budget = new DeadlineBudget(1_000);
    vi.advanceTimersByTime(1_001);
    expect(budget.expired).toBe(true);
    expect(budget.remainingMs).toBe(0);
    vi.useRealTimers();
  });

  it('never un-expires', () => {
    vi.useFakeTimers();
    const budget = new DeadlineBudget(1_000);
    vi.advanceTimersByTime(2_000);
    expect(budget.expired).toBe(true);
    // Time only moves forward in the real world; there is no code path back
    // to false, and this pins that as an explicit invariant rather than an
    // accident of the implementation.
    expect(budget.expired).toBe(true);
    vi.useRealTimers();
  });

  it('starts at a default stage and reports whatever was last marked', () => {
    const budget = new DeadlineBudget(10_000);
    expect(budget.lastStage).toBe('start');
    budget.markStage('phase-one');
    expect(budget.lastStage).toBe('phase-one');
    budget.markStage('phase-two');
    expect(budget.lastStage).toBe('phase-two');
  });

  it('accepts a custom start stage', () => {
    const budget = new DeadlineBudget(10_000, 'custom-start');
    expect(budget.lastStage).toBe('custom-start');
  });
});
