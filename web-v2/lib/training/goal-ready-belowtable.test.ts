/**
 * lib/training/goal-ready-belowtable.test.ts · AUDIT P1-56 / P1-13
 * (2026-07-07) — below-table GOAL support in computeGoalReady.
 *
 * The '32+' 5K bucket (32:00, 1920s) implies a raw VDOT ~28.5 — below the
 * Daniels table floor of 30. Before this fix, computeGoalReady returned
 * null outright for this (real, reachable-via-BUCKET_SECONDS) case,
 * silently erasing a legitimate easy goal for any runner who picked it.
 *
 * See goal-ready.test.ts for the pre-existing baseline coverage (byte-safe,
 * unaffected — confirmed no existing test exercises this bucket).
 */
import { describe, expect, it } from 'vitest';
import { computeGoalReady, type VdotPoint } from './goal-ready';

const TODAY = '2026-06-10';

function weeklyPoints(n: number, vdot: number): VdotPoint[] {
  const out: VdotPoint[] = [];
  for (let i = 0; i < n; i++) {
    const daysAgo = (n - 1 - i) * 7;
    const d = new Date(new Date(TODAY + 'T12:00:00Z').getTime() - daysAgo * 86400000);
    out.push({ dateISO: d.toISOString().slice(0, 10), vdot });
  }
  return out;
}

describe('P1-56 · computeGoalReady — below-table (honest slow/easy) goal', () => {
  it('no longer returns null for a runner with measured fitness and a below-table 5K goal', () => {
    const r = computeGoalReady('5k', '32+', weeklyPoints(4, 40), TODAY);
    expect(r).not.toBeNull();
  });

  it('state is in-range (any measured VDOT already clears a below-table goal), requiredVdot is honestly null', () => {
    const r = computeGoalReady('5k', '32+', weeklyPoints(4, 40), TODAY);
    expect(r!.state).toBe('in-range');
    expect(r!.requiredVdot).toBeNull();
    expect(r!.currentVdot).toBe(40);
  });

  it('goalTimeSec + goalLabel still resolve correctly', () => {
    const r = computeGoalReady('5k', '32+', weeklyPoints(4, 40), TODAY);
    expect(r!.goalTimeSec).toBe(1920);
    expect(r!.goalLabel).toContain('5K');
  });

  it('a runner with NO measured fitness yet (cold start) still returns null — genuinely insufficient data, not an in-range fabrication', () => {
    const r = computeGoalReady('5k', '32+', [], TODAY);
    expect(r).toBeNull();
  });

  it('exact goal time path (native sends precise seconds) also honors the below-table honesty fix', () => {
    const r = computeGoalReady('5k', '32+', weeklyPoints(4, 35), TODAY, 2100); // 35:00 exact, even slower
    expect(r).not.toBeNull();
    expect(r!.state).toBe('in-range');
    expect(r!.requiredVdot).toBeNull();
    expect(r!.goalTimeSec).toBe(2100);
  });

  it('BYTE-SAFETY: an off-the-top (impossibly fast, VDOT>85) bucket-mapped goal is unaffected — should not exist in real buckets, but confirms the direction guard', () => {
    // No real bucket maps this fast, but exactly-goal-time lets us probe the
    // off-the-top direction directly: a sub-3:00 5K.
    const r = computeGoalReady('5k', 'Under 20:00', weeklyPoints(4, 40), TODAY, 175);
    expect(r).toBeNull(); // off-the-top stays null — not treated as in-range
  });

  it('BYTE-SAFETY: an ordinary in-table goal + state machine is completely unaffected', () => {
    const r = computeGoalReady('5k', 'Under 20:00', weeklyPoints(4, 51), TODAY);
    expect(r!.state).toBe('in-range');
    expect(typeof r!.requiredVdot).toBe('number');
    expect(r!.requiredVdot).not.toBeNull();
  });
});
