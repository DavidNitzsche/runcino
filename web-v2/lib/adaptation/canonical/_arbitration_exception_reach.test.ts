/**
 * ARBREACH-1 (2026-09-04) · is rule 2's exception REACHABLE?
 *
 * `arbitration.ts` states four rules, and says of the second:
 *
 *   "It does NOT automatically suppress a threshold-pace proposal. The word
 *    doing the work is AUTOMATICALLY: a small pace correction that preserves
 *    the intended stimulus may proceed, and only a MATERIAL demand increase is
 *    caught by rule 1. Implementing rule 1 without rule 2 gives you an engine
 *    where any hold anywhere freezes everything … A suppression rule with no
 *    exception is a freeze."
 *
 * That exception is currently UNREACHABLE for the threshold lever, and this
 * file exists to say so out loud rather than leave it as a paragraph nobody
 * re-derives.
 *
 * THE ARITHMETIC. Materiality is half the lever's own ordinary step:
 *
 *     material bar = THRESHOLD_ORDINARY_STEP_SEC_PER_MI × MATERIAL_SHARE_OF_ORDINARY_STEP
 *                  = 3 × 0.5 = 1.5 s/mi
 *
 * and the engine only ever proposes the ORDINARY step (3) or the LARGER step
 * (5). Both clear 1.5. So `s.material` is true for every threshold proposal
 * that can exist, `demandShare > 0` is true for any increase at all, and the
 * conjunct that was put there to let a small correction through never lets
 * anything through.
 *
 * MEASURED CONSEQUENCE, on the owner's real history
 * (`scripts/adaptation-real-replay`): 14 PROGRESS proposals, ONE applied. Ten of
 * the thirteen suppressions cite WEEKLY_VOLUME.
 *
 * WHY THIS IS A PIN AND NOT A FIX. The obvious repair — ask rule 1 about DEMAND
 * rather than about the proposal's own size — is blocked by a conflict inside
 * the contract itself, recorded in `contract-constants.ts`: demand-share
 * materiality was tried first and rejected because it makes the contract's own
 * acceptance sentence ("this week already contains enough total demand, so the
 * change is deferred") unreachable. Each reading kills one contract sentence.
 * Choosing between them changes how often a real runner's paces move, so it is
 * a coaching decision and is recorded in ADAPTATION-VERDICT.md rather than made
 * here.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22): it reads the CONSTANTS, not the engine's
 * behaviour on a plan. It cannot tell whether suppression is the right coaching
 * call — only whether the exception the file claims to have is reachable at all.
 */
import { describe, it, expect } from 'vitest';
import {
  THRESHOLD_ORDINARY_STEP_SEC_PER_MI,
  THRESHOLD_MAX_STEP_SEC_PER_MI,
  THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI,
  MATERIAL_SHARE_OF_ORDINARY_STEP,
} from './contract-constants';

describe('ARBREACH-1 · rule 2 says a small pace correction may proceed', () => {
  const bar = THRESHOLD_ORDINARY_STEP_SEC_PER_MI * MATERIAL_SHARE_OF_ORDINARY_STEP;

  it('the materiality bar is half the ordinary step, read from the constants', () => {
    // Read, never restated — a check that hardcodes both sides only proves the
    // test agrees with itself (Rule 18).
    expect(bar).toBe(THRESHOLD_ORDINARY_STEP_SEC_PER_MI / 2);
    expect(bar).toBeLessThan(THRESHOLD_ORDINARY_STEP_SEC_PER_MI);
  });

  it('DOCUMENTS THE DEFECT · every step the engine actually proposes is material', () => {
    // Both proposable steps clear the bar, so a proposal the engine really makes
    // can never use rule 2's exception.
    expect(THRESHOLD_ORDINARY_STEP_SEC_PER_MI).toBeGreaterThanOrEqual(bar);
    expect(THRESHOLD_MAX_STEP_SEC_PER_MI).toBeGreaterThanOrEqual(bar);
  });

  it('the exception is reachable only BELOW the meaningful-step floor\'s useful range', () => {
    /* A CORRECTION TO THIS FILE'S FIRST DRAFT, kept because the distinction is
     * the whole point. The first version asserted the exception was strictly
     * UNREACHABLE. It is not: `THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI` is 1,
     * which is below the 1.5 bar, so a 1 s/mi proposal WOULD be non-material and
     * WOULD proceed alongside a hold.
     *
     * The accurate statement is narrower and still damning: the window in which
     * the exception can fire is [1, 1.5) s/mi, and the engine's own ordinary
     * step is 3. Across the owner's entire real history the replay produced
     * fourteen threshold proposals and every one was the ordinary 3 s/mi step.
     * So the exception is reachable in principle and was reached zero times in
     * practice. */
    expect(THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI).toBeLessThan(bar);
    const windowWidth = bar - THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI;
    expect(windowWidth).toBeGreaterThan(0);
    // …and it is narrower than a single ordinary step, which is what makes it
    // a technicality rather than a working exception.
    expect(windowWidth).toBeLessThan(THRESHOLD_ORDINARY_STEP_SEC_PER_MI);
  });
});
