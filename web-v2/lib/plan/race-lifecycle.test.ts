/**
 * lib/plan/race-lifecycle.test.ts
 *
 * 2026-08-17 · race-lifecycle falsifiers for the plan-drift cron
 * boundaries (lib/plan/race-lifecycle.ts):
 *
 *   F1  graduate fires the FIRST morning after race day (race < today),
 *       not race day itself, not race+2.
 *   F2  recovery-complete fires when the recovery plan's last prescribed
 *       day has passed and the target race is still ahead.
 *   F3  no-loop: the rebuilt plan's last workout is >= today, so the
 *       predicate reads false for the replacement on the next tick.
 *   F4  a recovery plan whose race date has passed is graduate's
 *       territory, never recovery-complete's.
 */
import { describe, expect, it } from 'vitest';
import { graduateDue, planElapsed, recoveryCompleteDue } from './race-lifecycle';

describe('graduateDue — post-race graduate boundary', () => {
  it('F1 · fires the first cron AFTER race day (AFC 8/16 → due 8/17)', () => {
    expect(graduateDue('2026-08-16', '2026-08-17')).toBe(true);
  });

  it('F1 · does NOT fire on race day itself', () => {
    expect(graduateDue('2026-08-16', '2026-08-16')).toBe(false);
  });

  it('does not fire for a future race', () => {
    expect(graduateDue('2026-12-06', '2026-08-17')).toBe(false);
  });

  it('null/missing race date never fires', () => {
    expect(graduateDue(null, '2026-08-17')).toBe(false);
    expect(graduateDue(undefined, '2026-08-17')).toBe(false);
    expect(graduateDue('', '2026-08-17')).toBe(false);
  });

  it('tolerates timestamp-shaped race dates (slice to day)', () => {
    expect(graduateDue('2026-08-16T00:00:00Z', '2026-08-17')).toBe(true);
  });
});

describe('recoveryCompleteDue — recovery → next-block transition', () => {
  const today = '2026-08-31';
  const cim = '2026-12-06';

  it('F2 · fires when the recovery plan ran out yesterday and the race is ahead', () => {
    expect(recoveryCompleteDue('2026-08-30', cim, today)).toBe(true);
  });

  it('F2b · SAME-DAY ELIGIBLE (2026-08-30): fires the day the last prescribed workout IS today, not the day after', () => {
    // The whole point of the fix — a runner whose block's last day is
    // today should not have to wait for tomorrow's date to roll over.
    expect(recoveryCompleteDue(today, cim, today)).toBe(true);
  });

  it('F3 · the replacement plan\'s last workout is still ahead → false', () => {
    // A rebuilt plan (recovery remainder or race-prep) that still has
    // days left ahead of today reads false, as always.
    expect(recoveryCompleteDue('2026-09-06', cim, today)).toBe(false);
  });

  it('F4 · race date passed (or is today) → graduate territory, not recovery-complete', () => {
    expect(recoveryCompleteDue('2026-08-30', '2026-08-16', today)).toBe(false);
    expect(recoveryCompleteDue('2026-08-30', today, today)).toBe(false);
  });

  it('a plan with no workout rows is broken, not complete → false', () => {
    expect(recoveryCompleteDue(null, cim, today)).toBe(false);
    expect(recoveryCompleteDue(undefined, cim, today)).toBe(false);
  });

  it('missing race date → false (nothing to build toward)', () => {
    expect(recoveryCompleteDue('2026-08-30', null, today)).toBe(false);
  });

  /* 2026-08-28 · the null-race-date dead-end, closed. A recovery plan whose
   * race lost its date reads false here FOREVER — and until the plan_elapsed
   * branch of the cron learned to handle race-anchored and dead-anchored
   * rows, no other predicate ever fired for it either. These cases pin the
   * handoff: recoveryCompleteDue stays false (correct — there is no race to
   * build toward), and planElapsed is TRUE for the same inputs, which is the
   * predicate the cron's elapsed branch now routes through the goal-target /
   * open-block handoff. */
  describe('handoff to planElapsed when the anchor is dead', () => {
    it('race date null · recoveryCompleteDue false, planElapsed true', () => {
      expect(recoveryCompleteDue('2026-08-30', null, today)).toBe(false);
      expect(planElapsed('2026-08-30', today)).toBe(true);
    });

    it('race date already passed · same split (graduate or elapsed owns it, never recovery-complete)', () => {
      expect(recoveryCompleteDue('2026-08-30', '2026-08-16', today)).toBe(false);
      expect(planElapsed('2026-08-30', today)).toBe(true);
      expect(graduateDue('2026-08-16', today)).toBe(true);
    });
  });
});

describe('planElapsed — the end-of-plan question, race or no race', () => {
  const today = '2026-08-31';

  it('fires when the last prescribed day is behind today', () => {
    expect(planElapsed('2026-08-30', today)).toBe(true);
  });

  it('does not fire while today is still prescribed, or the plan runs on', () => {
    expect(planElapsed(today, today)).toBe(false);
    expect(planElapsed('2026-09-14', today)).toBe(false);
  });

  it('a plan with no workout rows is broken, not finished → false', () => {
    expect(planElapsed(null, today)).toBe(false);
    expect(planElapsed(undefined, today)).toBe(false);
    expect(planElapsed('', today)).toBe(false);
  });

  it('tolerates timestamp-shaped dates (slice to day)', () => {
    expect(planElapsed('2026-08-30T00:00:00Z', today)).toBe(true);
  });
});
