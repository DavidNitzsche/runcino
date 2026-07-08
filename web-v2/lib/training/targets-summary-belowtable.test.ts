/**
 * lib/training/targets-summary-belowtable.test.ts · AUDIT P1-13 (2026-07-07)
 * — the Targets summary sentence's honest below-table baseline copy.
 *
 * Before this fix, a runner whose best race/run implied VDOT < 30 (below
 * the Daniels table floor — see vdot.ts) fell all the way to "No baseline
 * yet. A steady quality run gives the projection something to read." even
 * though they HAD run a real, honest-effort baseline — it just doesn't map
 * onto the VDOT number this copy otherwise speaks to. This is the exact
 * "cold state tells them to race a 5K they already raced" failure named in
 * the audit (P1-13), reached via the copy layer instead of the null-VDOT
 * chain directly.
 *
 * See lib/training/_audit_goalmode.test.ts for the pre-existing baseline
 * coverage of composeTargetsSummaryLine (byte-safe, unaffected — confirmed
 * no existing test passes belowTableAnchorPaceSPerMi, so it always defaults
 * to undefined and this new branch never fires for those tests).
 */
import { describe, it, expect } from 'vitest';
import { composeTargetsSummaryLine } from './targets-summary';

const SLOW_PACE_S_PER_MI = 13 * 60 + 30; // 810 s/mi (13:30/mi)

describe('P1-13 · composeTargetsSummaryLine — below-table honest baseline', () => {
  it('speaks to the demonstrated pace instead of "No baseline yet" when belowTableAnchorPaceSPerMi is set', () => {
    const line = composeTargetsSummaryLine({
      status: 'cold', goalSec: null, projectedSec: null, goalSource: null,
      raceName: null, daysAway: null, vdot: null, lastMove: null, heldDays: 0,
      belowTableAnchorPaceSPerMi: SLOW_PACE_S_PER_MI,
    });
    expect(line).not.toContain('No baseline yet');
    expect(line).toContain('13:30/mi');
    expect(line).toContain('Building your baseline');
  });

  it('never contains a dash placeholder', () => {
    const line = composeTargetsSummaryLine({
      status: 'cold', goalSec: null, projectedSec: null, goalSource: null,
      raceName: null, daysAway: null, vdot: null, lastMove: null, heldDays: 0,
      belowTableAnchorPaceSPerMi: SLOW_PACE_S_PER_MI,
    });
    expect(line).not.toContain('—');
    expect(line.length).toBeGreaterThan(0);
  });

  it('the nudge still adapts to goalSource (fitness_goal vs generic), matching the existing "no goal" branches', () => {
    const fitnessGoalLine = composeTargetsSummaryLine({
      status: 'cold', goalSec: null, projectedSec: null, goalSource: 'fitness_goal',
      raceName: null, daysAway: null, vdot: null, lastMove: null, heldDays: 0,
      belowTableAnchorPaceSPerMi: SLOW_PACE_S_PER_MI,
    });
    expect(fitnessGoalLine).toContain('Set a time goal');

    const genericLine = composeTargetsSummaryLine({
      status: 'cold', goalSec: null, projectedSec: null, goalSource: null,
      raceName: null, daysAway: null, vdot: null, lastMove: null, heldDays: 0,
      belowTableAnchorPaceSPerMi: SLOW_PACE_S_PER_MI,
    });
    expect(genericLine).toContain('Set a goal');
  });

  it('BYTE-SAFETY: omitting belowTableAnchorPaceSPerMi entirely is unaffected (matches _audit_goalmode.test.ts baseline)', () => {
    const line = composeTargetsSummaryLine({
      status: 'cold', goalSec: null, projectedSec: null, goalSource: null,
      raceName: null, daysAway: null, vdot: null, lastMove: null, heldDays: 0,
    });
    expect(line).toContain('No baseline yet');
  });

  it('BYTE-SAFETY: a zero/negative belowTableAnchorPaceSPerMi is treated as absent (defensive, matches the null-guard convention elsewhere)', () => {
    const line = composeTargetsSummaryLine({
      status: 'cold', goalSec: null, projectedSec: null, goalSource: null,
      raceName: null, daysAway: null, vdot: null, lastMove: null, heldDays: 0,
      belowTableAnchorPaceSPerMi: 0,
    });
    expect(line).toContain('No baseline yet');
  });

  it('BYTE-SAFETY: a real VDOT still takes priority over belowTableAnchorPaceSPerMi (should never co-occur in practice, but the VDOT branch must win if it did)', () => {
    const line = composeTargetsSummaryLine({
      status: 'cold', goalSec: null, projectedSec: null, goalSource: null,
      raceName: null, daysAway: null, vdot: 45, lastMove: null, heldDays: 5,
      belowTableAnchorPaceSPerMi: SLOW_PACE_S_PER_MI,
    });
    expect(line).toContain('VDOT 45');
    expect(line).not.toContain('13:30/mi');
  });
});
