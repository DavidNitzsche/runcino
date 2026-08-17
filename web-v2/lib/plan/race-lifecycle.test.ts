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
import { graduateDue, recoveryCompleteDue } from './race-lifecycle';

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

  it('F3 · no-loop: the replacement plan\'s last workout is today or later → false', () => {
    // Immediately after the rebuild, the new plan (recovery remainder or
    // race-prep) prescribes through at least today — the cron must not
    // re-fire on the next tick.
    expect(recoveryCompleteDue(today, cim, today)).toBe(false);
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
});
