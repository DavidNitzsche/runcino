/**
 * ARBREACH-1, CLOSED (2026-09-04) · the defect this file pinned, and the proof
 * it can no longer exist.
 *
 * ── WHAT IT PINNED ─────────────────────────────────────────────────────────
 *
 * `arbitration.ts` used to state a rule 2 that read:
 *
 *   "It does NOT automatically suppress a threshold-pace proposal ... a small
 *    pace correction that preserves the intended stimulus may proceed, and only
 *    a MATERIAL demand increase is caught by rule 1 ... A suppression rule with
 *    no exception is a freeze."
 *
 * The exception was keyed to MATERIALITY, which for the threshold lever is
 *
 *     THRESHOLD_ORDINARY_STEP_SEC_PER_MI x MATERIAL_SHARE_OF_ORDINARY_STEP
 *       = 3 x 0.5 = 1.5 s/mi
 *
 * against an engine whose smallest emitted step is 1 and whose ordinary step is
 * 3. Live window: [1, 1.5) s/mi. MEASURED on the owner's whole history: 14
 * threshold proposals, every one of them the ordinary 3 s/mi, exception fired
 * ZERO times, ten suppressions citing WEEKLY_VOLUME.
 *
 * ── WHY THE FILE STILL EXISTS ──────────────────────────────────────────────
 *
 * The defect was not fixed by widening the window, which Rule 9 forbids
 * ("widening a tolerance around the same threshold relocates the cliff, it does
 * not remove it"). Rule 2 was DELETED and rule 1 was changed to ask the
 * question its own sentence poses, per the owner's reading C. So the arithmetic
 * above is no longer a defect, because nothing depends on it any more, and this
 * file's job changed from PINNING the defect to proving it cannot come back:
 *
 *   1 · the constants are unchanged, so the arithmetic that made the old
 *       exception useless is still true, and a future author cannot "fix" this
 *       by nudging a constant and calling it done;
 *   2 · materiality no longer decides suppression by a HOLD, asserted
 *       BEHAVIOURALLY on a proposal of exactly the size that used to be caught.
 *
 * Property 2 is the one that would fail if reading C were reverted, and it is
 * asserted against the engine rather than against the constants, which is what
 * ARBREACH-1 could never do. `_arbitration_reading_c.test.ts` carries the rest.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · Whether reading C is the right coaching answer. It proves the old
 *   predicate is gone, not that the new one is wise.
 * · The materiality bar being the right number for rule 3, which is now the
 *   only thing that reads it. Both halves below construct proposals far from
 *   the bar on purpose.
 * · Anything about the ceiling, which is the other half of the new rule 1 and
 *   is covered in `_arbitration_reading_c.test.ts` instead.
 */
import { describe, it, expect } from 'vitest';
import {
  THRESHOLD_ORDINARY_STEP_SEC_PER_MI,
  THRESHOLD_MAX_STEP_SEC_PER_MI,
  THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI,
  MATERIAL_SHARE_OF_ORDINARY_STEP,
} from './contract-constants';
import { evaluateAdaptation } from './evaluate';
import {
  baseInput, week, longRun, decayingThirds, twoFasterThresholdSessions,
  baseWeekWithHeadroom,
} from './_fixtures';

describe('ARBREACH-1 · the arithmetic that made the old exception useless is unchanged', () => {
  const bar = THRESHOLD_ORDINARY_STEP_SEC_PER_MI * MATERIAL_SHARE_OF_ORDINARY_STEP;

  it('the materiality bar is still half the ordinary step, read from the constants', () => {
    // Read, never restated. A check that hardcodes both sides only proves the
    // test agrees with itself (Rule 18).
    expect(bar).toBe(THRESHOLD_ORDINARY_STEP_SEC_PER_MI / 2);
    expect(bar).toBeLessThan(THRESHOLD_ORDINARY_STEP_SEC_PER_MI);
  });

  it('every step the engine can propose is still MATERIAL', () => {
    // This was the defect when materiality gated suppression. It is now merely
    // a fact about rule 3, and it is asserted so nobody "closes" ARBREACH-1 by
    // moving a constant instead of moving the rule.
    expect(THRESHOLD_ORDINARY_STEP_SEC_PER_MI).toBeGreaterThanOrEqual(bar);
    expect(THRESHOLD_MAX_STEP_SEC_PER_MI).toBeGreaterThanOrEqual(bar);
    const oldWindowWidth = bar - THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI;
    expect(oldWindowWidth).toBeGreaterThan(0);
    expect(oldWindowWidth).toBeLessThan(THRESHOLD_ORDINARY_STEP_SEC_PER_MI);
  });
});

describe('ARBREACH-1 · CLOSED · materiality no longer decides suppression by a HOLD', () => {
  it('a FULL ordinary-step pace correction proceeds alongside two load HOLDs', () => {
    /* The exact case ARBREACH-1 said was impossible. Both load levers hold, the
     * threshold proposal is the ordinary 3 s/mi step, which is twice the old
     * materiality bar, and the week has room. Under the old rule this was
     * suppressed every time; ten of the owner's thirteen real suppressions were
     * this shape.
     *
     * Rule 15 · the case that reaches the mechanism is named here rather than
     * assumed: a runner with one short week (so volume HOLDS), a deteriorating
     * long run (so the long run HOLDS), and two corroborating faster threshold
     * sessions. */
    const out = evaluateAdaptation(baseInput({
      weeks: [
        week('2026-08-17', 47, 47.2),
        week('2026-08-24', 48, 43),
        week('2026-08-31', 48, 47.9),
      ],
      longRuns: [
        longRun('lr-1', '2026-08-23', 16, 16),
        longRun('lr-2', '2026-08-30', 16, 16, { thirds: decayingThirds() }),
      ],
      qualitySessions: twoFasterThresholdSessions(),
      athleteCeilingWeeklyDemand: baseWeekWithHeadroom(),
    }));

    expect(out.records.find((r) => r.lever === 'WEEKLY_VOLUME')!.decision).toBe('HOLD');
    expect(out.records.find((r) => r.lever === 'LONG_RUN')!.decision).toBe('HOLD');

    const pace = out.records.find((r) => r.lever === 'THRESHOLD_PACE')!;
    expect(pace.decision).toBe('PROGRESS');
    const moved = Math.abs(pace.magnitude!.value);
    // Material by the old bar, and applied anyway.
    expect(moved).toBeGreaterThanOrEqual(
      THRESHOLD_ORDINARY_STEP_SEC_PER_MI * MATERIAL_SHARE_OF_ORDINARY_STEP,
    );
    expect(pace.suppressedBy).toBeNull();
    expect(pace.planDiff.entries.length).toBeGreaterThan(0);
  });
});
