/**
 * NOPRESCRIPTION-1 · A WEEK NOBODY PRESCRIBED IS NOT A WEEK COMPLETED AT ZERO.
 *
 * This is a production defect, reproduced. On the first canonical-shadow run
 * after `DATABASE_URL_RO` was configured on Railway, the owner's live record
 * produced:
 *
 *   decision            REGRESS      46.5 mi → 44.2 mi
 *   evidence_included   []           supportingCount 0, rawConfidence 0
 *   contradictory       2026-08-24 at 91%, 2026-08-17 at 0%, 2026-08-10 at 0%
 *
 * He ran 23.2 mi in the 08-10 week and 28.4 mi in the 08-17 week. Both read as
 * ZERO PERCENT, because the active plan's first prescribed week is 08-24 and
 * the completion fraction collapsed a missing prescription to `0`:
 *
 *   frac: w.completedMi.ok && w.prescribedMi > 0 ? completed / prescribed : 0
 *
 * Rule 11, on the one axis where the collapse argues for LESS training. And the
 * most recent complete week — 08-31, 45.8 of 46.5 prescribed, 98.5% — never
 * reached the window at all.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22)
 *   · Whether the 95% completion bar is the right bar.
 *   · Whether a REGRESS on genuinely under-completed weeks is correct coaching.
 *     It is about which weeks are ADMISSIBLE, not about the verdict rule.
 *   · Whether anything downstream acts on the verdict.
 */
import { describe, it, expect } from 'vitest';
import { evaluateWeeklyVolume, type WeeklyVolumeInput } from './weekly-volume';
import { measured } from '../input';

const week = (weekStartISO: string, prescribedMi: number, completedMi: number) => ({
  weekStartISO,
  prescribedMi,
  completedMi: measured(completedMi),
  isCutback: false,
  authoredPlanMode: 'BUILD' as const,
  dataComplete: true,
});

const base = (weeks: WeeklyVolumeInput['weeks']): WeeklyVolumeInput => ({
  todayISO: '2026-09-06',
  currentWeeklyMi: 46.5,
  weeks,
  keySessions: [],
  longRuns: [],
  nextWeekPrescribedMi: 46.5,
  stepsTakenThisCycle: 0,
});

describe('NOPRESCRIPTION-1 · the owner’s real production case', () => {
  it('does NOT regress off weeks that had no prescription', () => {
    // Exactly the rows the shadow read, oldest first.
    const v = evaluateWeeklyVolume(base([
      week('2026-08-10', 0, 23.2),     // before the plan begins
      week('2026-08-17', 0, 28.4),     // before the plan begins
      week('2026-08-24', 38.0, 34.8),  // 91%
    ]));
    expect(v.decision,
      'a REGRESS was produced from two weeks the runner actually ran, because '
      + 'no prescription existed to measure them against').not.toBe('REGRESS');
    expect(v.proposedAfterValue ?? v.beforeValue).toBe(46.5);
  });

  it('says WHY those weeks did not count, rather than dropping them silently', () => {
    const v = evaluateWeeklyVolume(base([
      week('2026-08-10', 0, 23.2),
      week('2026-08-17', 0, 28.4),
      week('2026-08-24', 38.0, 34.8),
    ]));
    const codes = (v.excluded ?? []).map((e) => e.reason);
    expect(codes).toContain('NO_PRESCRIPTION_FOR_THIS_WEEK');
    const detail = (v.excluded ?? []).find((e) => e.reason === 'NO_PRESCRIPTION_FOR_THIS_WEEK')?.detail ?? '';
    expect(detail).toContain('not the same as a week the runner failed to complete');
  });

  it('an unprescribed week is never counted as a shortfall', () => {
    const v = evaluateWeeklyVolume(base([
      week('2026-08-10', 0, 23.2),
      week('2026-08-17', 0, 28.4),
      week('2026-08-24', 38.0, 34.8),
    ]));
    const contradictoryWeeks = (v.contradictory ?? []).map((c) => c.dateISO);
    expect(contradictoryWeeks).not.toContain('2026-08-10');
    expect(contradictoryWeeks).not.toContain('2026-08-17');
  });

  it('STILL regresses when three PRESCRIBED weeks were genuinely under-run', () => {
    // The guard must not have bought safety by disabling the lever. Same
    // shortfalls, but every week carries a real prescription.
    const v = evaluateWeeklyVolume(base([
      week('2026-08-10', 46.5, 23.2),
      week('2026-08-17', 46.5, 28.4),
      week('2026-08-24', 38.0, 34.8),
    ]));
    expect(v.decision).toBe('REGRESS');
    expect(v.proposedAfterValue!).toBeLessThan(46.5);
  });

  it('a decision that MOVES the belief is never made on zero admissible weeks', () => {
    const v = evaluateWeeklyVolume(base([
      week('2026-08-10', 0, 23.2),
      week('2026-08-17', 0, 28.4),
      week('2026-08-24', 0, 34.8),
    ]));
    expect(['REFUSE', 'HOLD']).toContain(v.decision);
    expect(v.reason).toContain('prescription');
  });
});
