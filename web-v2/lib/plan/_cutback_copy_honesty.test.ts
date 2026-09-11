/**
 * lib/plan/_cutback_copy_honesty.test.ts · CUTBACKCOPY-1.
 *
 * `weekAnswers()`'s `whyMileage` / `whyCutback`, and `deriveBlockStrategy`'s
 * per-week `rationale`, used to say "the reduction is deliberate" / "Down
 * from X mi" / "Planned cutback. The reduction is the work" for EVERY week
 * whose ROLE is `CUTBACK` — driven by the persisted `is_cutback` flag,
 * `>15% drop off the week before AT AUTHORING TIME` (see
 * `lib/plan/non-building-week.ts`'s own header for the documented case where
 * that flag survives a composition that no longer matches it).
 *
 * `lib/plan/reschedule.ts`'s own load-cost model already names the case where
 * this goes wrong: a week authored as a cutback can have mileage IMPORTED
 * into it after the fact (a rescheduled session landing there), so
 * `w.afterMi > w.beforeMi` on an `isCutback` week is a real, priced,
 * already-instrumented situation ("protected import") — and that same file's
 * own recommendation prose says so honestly ("mi lands in a week authored to
 * be lighter") rather than claiming a reduction that the numbers don't show.
 * `strategy-contracts.ts` did not apply the same honesty: it read the role
 * and never checked the numbers it already had in scope (`vol` and
 * `prevVol`, `w.weeklyMi` and `prev.weeklyMi` — the Plan engine's own already-
 * composed values, not recomputed here).
 *
 * ── THE FALSIFICATION ────────────────────────────────────────────────────
 *
 * A two-week block: week 1 at 15 mi, week 2 flagged `isCutback: true` but
 * composed at 18 mi — MORE than week 1, not less. The old copy would say
 * "18 mi against 15 mi last week. The reduction is deliberate" — asserting a
 * reduction over a number that went UP. This file proves the fixed copy
 * states the actual direction instead.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_cutback_copy_honesty.test.ts
 */
import { describe, it, expect } from 'vitest';
import { deriveBlockStrategy, type BlockStrategyInputs } from './strategy-contracts';

const day = (type: string, distanceMi: number, isLong = false, isQuality = false) =>
  ({ type, distanceMi, isLong, isQuality, subLabel: null });

function inputsWithCutbackThatRose(): BlockStrategyInputs {
  return {
    weeks: [
      {
        startISO: '2026-09-01', phase: 'RECOVERY', weeklyMi: 15, isRaceWeek: false, isCutback: false,
        days: [day('easy', 5), day('easy', 5), day('long', 5, true)],
      },
      // Flagged a cutback at authoring, but a reschedule imported mileage
      // into it afterward — the composed total is HIGHER than last week's,
      // not lower. This is the exact shape `reschedule.ts`'s `protectedImport`
      // already prices (`w.afterMi > w.beforeMi` on an `isCutback` week).
      {
        startISO: '2026-09-08', phase: 'RECOVERY', weeklyMi: 18, isRaceWeek: false, isCutback: true,
        days: [day('easy', 6), day('easy', 6), day('long', 6, true)],
      },
    ],
    phases: [{ label: 'RECOVERY', weeks: 2 }],
    targetEvent: null,
    statedGoalSec: null,
    thesis: null,
  };
}

function inputsWithARealCutback(): BlockStrategyInputs {
  return {
    weeks: [
      {
        startISO: '2026-09-01', phase: 'BUILD', weeklyMi: 40, isRaceWeek: false, isCutback: false,
        days: [day('easy', 10), day('threshold', 10, false, true), day('long', 14, true)],
      },
      {
        startISO: '2026-09-08', phase: 'BUILD', weeklyMi: 30, isRaceWeek: false, isCutback: true,
        days: [day('easy', 8), day('easy', 8), day('long', 10, true)],
      },
    ],
    phases: [{ label: 'BUILD', weeks: 2 }],
    targetEvent: null,
    statedGoalSec: null,
    thesis: null,
  };
}

/** The deleted, unconditional copy — reproduced as the falsification oracle
 *  so this file can tell "fixed" from "merely reworded". */
function oldUnconditionalRationale(vol: number, prevVol: number): string {
  void vol; void prevVol; // the old code never looked at either
  return 'Planned cutback. The reduction is the work.';
}

describe('CUTBACKCOPY-1 · the deleted unconditional copy is falsified', () => {
  it('the old rationale says "the reduction is the work" regardless of direction (the oracle discriminates)', () => {
    expect(oldUnconditionalRationale(18, 15)).toBe('Planned cutback. The reduction is the work.');
  });
});

describe('CUTBACKCOPY-1 · a cutback-flagged week that actually rose is described honestly', () => {
  const strategy = deriveBlockStrategy(inputsWithCutbackThatRose());
  const week2 = strategy?.weeks[1];

  it('exists and is still typed CUTBACK (the flag, not the copy, is unchanged)', () => {
    expect(week2?.role).toBe('CUTBACK');
  });

  it('rationale does not claim "the reduction is the work" when the week rose', () => {
    expect(week2?.rationale).not.toBe('Planned cutback. The reduction is the work.');
    expect(week2?.rationale).not.toMatch(/reduction is the work/i);
  });

  it('whyMileage does not claim the reduction is deliberate when volume went up', () => {
    const why = week2?.answers.whyMileage ?? '';
    expect(why).not.toMatch(/reduction is deliberate/i);
    // States the real numbers, in the real direction.
    expect(why).toContain('18');
    expect(why).toContain('15');
  });

  it('whyCutback does not claim "Down from" a week that was not down', () => {
    const why = week2?.answers.whyCutback ?? '';
    expect(why).not.toMatch(/^Down from/i);
  });
});

describe('CUTBACKCOPY-1 · a genuine cutback still gets the deliberate-reduction copy', () => {
  const strategy = deriveBlockStrategy(inputsWithARealCutback());
  const week2 = strategy?.weeks[1];

  it('rationale keeps the deliberate-reduction line for a real drop', () => {
    expect(week2?.rationale).toBe('Planned cutback. The reduction is the work.');
  });

  it('whyMileage keeps the deliberate-reduction line for a real drop', () => {
    expect(week2?.answers.whyMileage).toMatch(/reduction is deliberate/i);
  });

  it('whyCutback keeps "Down from" for a real drop', () => {
    expect(week2?.answers.whyCutback).toMatch(/^Down from 40 mi/i);
  });
});
