import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeRetrospective, type ActualRace } from '../retrospective';
import type { RuncinoPlan } from '../types';

const plan: RuncinoPlan = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'public', 'big-sur-3-50.runcino.json'), 'utf8')
);
const actual: ActualRace = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'fixtures', 'bigsur-actual.json'), 'utf8')
);

describe('computeRetrospective', () => {
  const retro = computeRetrospective(plan, actual);

  it('computes correct finish delta', () => {
    expect(retro.planned_finish_s).toBe(13800);
    expect(retro.actual_finish_s).toBe(13934);
    expect(retro.finish_delta_s).toBe(134);
  });

  it('produces one phase delta per plan phase', () => {
    expect(retro.phase_deltas.length).toBe(plan.phases.length);
  });

  it('phase deltas have cumulative drift that matches finish delta', () => {
    const last = retro.phase_deltas[retro.phase_deltas.length - 1];
    // Cumulative drift should roughly match finish_delta_s (within rounding)
    expect(Math.abs(last.cumulativeTimeDriftS - retro.finish_delta_s)).toBeLessThan(30);
  });

  it('climb phase (Hurricane) classified as small/large drift', () => {
    // Hurricane: planned 10:38/mi, actual 10:45/mi (645 s/mi) - should drift
    const climb = retro.phase_deltas.find(pd => pd.label === 'Hurricane Point climb');
    expect(climb).toBeDefined();
    expect(climb!.deltaSPerMi).toBeGreaterThan(0);
  });

  it('computes climb and descent coefficients', () => {
    expect(retro.calibration.climb_coefficient).toBeGreaterThan(0.9);
    expect(retro.calibration.climb_coefficient).toBeLessThan(1.2);
    expect(retro.calibration.descent_coefficient).toBeGreaterThan(0.9);
    expect(retro.calibration.descent_coefficient).toBeLessThan(1.2);
  });

  it('detects headwind sensitivity when wind > 5 mph', () => {
    // fixture has wind 11 mph, bluffs section drifted +8 sec/mi
    expect(retro.calibration.headwind_sensitivity_s_per_mi_per_mph).not.toBeNull();
    expect(retro.calibration.headwind_sensitivity_s_per_mi_per_mph!).toBeGreaterThan(0);
  });

  it('computes HR drift', () => {
    expect(typeof retro.calibration.hr_drift_bpm).toBe('number');
  });

  it('produces 1-3 takeaways', () => {
    expect(retro.takeaways.length).toBeGreaterThan(0);
    expect(retro.takeaways.length).toBeLessThanOrEqual(3);
    for (const t of retro.takeaways) {
      expect(t.title).toBeTruthy();
      expect(t.note.length).toBeGreaterThan(20);
    }
  });

  it('throws if phase count mismatch', () => {
    const badActual = { ...actual, splits: actual.splits.slice(0, 3) };
    expect(() => computeRetrospective(plan, badActual)).toThrow(/mismatch|splits|phases/i);
  });
});
