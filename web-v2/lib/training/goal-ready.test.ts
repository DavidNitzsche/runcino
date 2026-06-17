import { describe, expect, it } from 'vitest';
import { computeGoalReady, type VdotPoint } from './goal-ready';

const TODAY = '2026-06-10';

/** n weekly points ending today, linear from startVdot to endVdot. */
function weeklyPoints(n: number, startVdot: number, endVdot: number): VdotPoint[] {
  const out: VdotPoint[] = [];
  for (let i = 0; i < n; i++) {
    const daysAgo = (n - 1 - i) * 7;
    const d = new Date(new Date(TODAY + 'T12:00:00Z').getTime() - daysAgo * 86400000);
    out.push({
      dateISO: d.toISOString().slice(0, 10),
      vdot: startVdot + (endVdot - startVdot) * (i / Math.max(1, n - 1)),
    });
  }
  return out;
}

describe('computeGoalReady', () => {
  it('returns null on unknown bucket', () => {
    expect(computeGoalReady('5k', 'not-a-bucket', [], TODAY)).toBeNull();
  });

  it('cold start → insufficient-data with the goal still resolved', () => {
    const r = computeGoalReady('5k', '22-25', [], TODAY);
    expect(r?.state).toBe('insufficient-data');
    expect(r?.goalTimeSec).toBe(1410);
    expect(r?.requiredVdot).toBeGreaterThan(30);
    expect(r?.currentVdot).toBeNull();
  });

  it('exact goal time overrides the bucket midpoint (precision fix)', () => {
    // '25-28' midpoint ≈ 26:30; her exact 26:00 = 1560s should win.
    const bucket = computeGoalReady('5k', '25-28', [], TODAY);
    const exact = computeGoalReady('5k', '25-28', [], TODAY, 1560);
    expect(exact?.goalTimeSec).toBe(1560);
    expect(bucket?.goalTimeSec).not.toBe(1560);
    // A tighter goal (26:00 < midpoint) ⇒ higher required VDOT.
    expect(exact!.requiredVdot).toBeGreaterThan(bucket!.requiredVdot);
    expect(exact?.goalLabel).toContain('26:00');
  });

  it('falls back to the bucket midpoint when no exact time (older clients)', () => {
    expect(computeGoalReady('5k', '25-28', [], TODAY, null)?.goalTimeSec)
      .toBe(computeGoalReady('5k', '25-28', [], TODAY)?.goalTimeSec);
  });

  it('too short a span → insufficient-data (engineering gate)', () => {
    // 4 points across 14 days < 21-day span gate.
    const pts: VdotPoint[] = ['2026-05-27', '2026-06-01', '2026-06-05', '2026-06-10']
      .map((dateISO, i) => ({ dateISO, vdot: 40 + i * 0.1 }));
    expect(computeGoalReady('5k', '22-25', pts, TODAY)?.state).toBe('insufficient-data');
  });

  it('current fitness at/above required → in-range', () => {
    // 'Under 20:00' 5K needs ~VDOT 49.8 · give the runner 52.
    const r = computeGoalReady('5k', 'Under 20:00', weeklyPoints(8, 51, 52), TODAY);
    expect(r?.state).toBe('in-range');
  });

  it('negative slope → trend-flat, never a date', () => {
    const r = computeGoalReady('5k', 'Under 20:00', weeklyPoints(8, 46, 45), TODAY);
    expect(r?.state).toBe('trend-flat');
    expect(r?.readyEarliestISO).toBeUndefined();
  });

  it('projects a band and clamps to the Daniels quantum', () => {
    // Hot observed trend: +3 VDOT over 7 weeks (~0.061/day) — more than
    // double the cited max (1/28 ≈ 0.036/day). Both band edges must come
    // from the CLAMPED rates, not the observed slope.
    const r = computeGoalReady('5k', 'Under 20:00', weeklyPoints(8, 44, 47), TODAY);
    expect(r?.state).toBe('projectable');
    const gap = r!.requiredVdot - r!.currentVdot!;
    const earliestDays = Math.round(
      (new Date(r!.readyEarliestISO! + 'T12:00:00Z').getTime() - new Date(TODAY + 'T12:00:00Z').getTime()) / 86400000,
    );
    const latestDays = Math.round(
      (new Date(r!.readyLatestISO! + 'T12:00:00Z').getTime() - new Date(TODAY + 'T12:00:00Z').getTime()) / 86400000,
    );
    expect(earliestDays).toBe(Math.ceil(gap * 28)); // 1pt/4wk ceiling
    expect(latestDays).toBe(Math.ceil(gap * 42));   // 1pt/6wk conservative
    expect(latestDays).toBeGreaterThan(earliestDays);
  });

  it('slow trend toward a far goal → beyond-horizon, not a fantasy date', () => {
    // +0.2 VDOT over 8 weeks vs a gap of ~12 points → centuries out.
    const r = computeGoalReady('5k', 'Under 20:00', weeklyPoints(8, 37.8, 38), TODAY);
    expect(r?.state).toBe('beyond-horizon');
  });

  it('1mi and 10k buckets resolve required VDOT', () => {
    // AUDIT #7 · was `> 55`, which encoded the raw-equation over-read of the
    // mile (5:00 → ~59.4). The published Daniels table maps 4:58 → VDOT 55, so a
    // sub-5:00 mile is ~54.6 (now table-interpolated). Corrected to `> 54`.
    expect(computeGoalReady('1mi', 'Under 5:00', [], TODAY)?.requiredVdot).toBeGreaterThan(54);
    expect(computeGoalReady('10k', '40-45', [], TODAY)?.requiredVdot).toBeGreaterThan(40);
  });
});
