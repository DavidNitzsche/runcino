import { describe, it, expect } from 'vitest';
import { beltAverages } from './belt-averages';

describe('beltAverages', () => {
  it('weights by time, not by phase count', () => {
    // 20 min at 6.0 and 2 min at 9.0 is not 7.5 mph.
    const { speedMph } = beltAverages([
      { actualSpeedMph: 6.0, actualDurationSec: 1200 },
      { actualSpeedMph: 9.0, actualDurationSec: 120 },
    ]);
    expect(speedMph).toBeCloseTo((6.0 * 1200 + 9.0 * 120) / 1320, 10);
    expect(speedMph).not.toBeCloseTo(7.5, 3);
  });

  it('excludes a phase the runner never reached', () => {
    // David's 2026-07-23 shape: the trailing phases carry the plan's nominal
    // target and no duration, because they did not happen.
    const phases = [
      { actualSpeedMph: 6.70391061452514, actualDurationSec: 806 },
      { actualSpeedMph: 9.254498714652957, actualDurationSec: 389 },
      { actualSpeedMph: 6.70391061452514, actualDurationSec: 180 },
      { actualSpeedMph: 9.254498714652957, actualDurationSec: 389 },
      { actualSpeedMph: 6.70391061452514, actualDurationSec: 180 },
      { actualSpeedMph: 9.254498714652957, actualDurationSec: 346 },
      { actualSpeedMph: 6.70391061452514 },
      { actualSpeedMph: 9.254498714652957 },
      { actualSpeedMph: 6.70391061452514 },
    ];
    const { speedMph } = beltAverages(phases);
    const ranSec = 806 + 389 + 180 + 389 + 180 + 346;
    const expected =
      (6.70391061452514 * (806 + 180 + 180) + 9.254498714652957 * (389 + 389 + 346)) / ranSec;
    expect(speedMph).toBeCloseTo(expected, 10);

    // The plain mean over all nine — what shipped — puts a speed the belt
    // never ran at into the answer.
    const plainMean =
      phases.reduce((s, p) => s + p.actualSpeedMph, 0) / phases.length;
    expect(Math.abs((speedMph as number) - plainMean)).toBeGreaterThan(0.1);
  });

  it('reproduces the run pace it came from', () => {
    // The whole point: the mean speed and the run's distance/duration have to
    // be the same statement.
    const phases = [
      { actualSpeedMph: 6.4, actualDurationSec: 600 },
      { actualSpeedMph: 8.8, actualDurationSec: 480 },
      { actualSpeedMph: 5.4, actualDurationSec: 120 },
    ];
    const { speedMph } = beltAverages(phases);
    const totalSec = 1200;
    const totalMi = phases.reduce((s, p) => s + (p.actualDurationSec / 3600) * p.actualSpeedMph, 0);
    expect((speedMph as number) * (totalSec / 3600)).toBeCloseTo(totalMi, 10);
  });

  it('falls back to a plain mean for a payload with no durations', () => {
    const { speedMph, inclinePct } = beltAverages([
      { actualSpeedMph: 6.0, actualInclinePct: 1 },
      { actualSpeedMph: 8.0, actualInclinePct: 2 },
    ]);
    expect(speedMph).toBeCloseTo(7.0, 10);
    expect(inclinePct).toBeCloseTo(1.5, 10);
  });

  it('keeps a genuine 0% incline, and drops a 0 mph phase', () => {
    // 0 incline is a real setting; 0 speed is not a belt that ran.
    const { speedMph, inclinePct } = beltAverages([
      { actualSpeedMph: 7.0, actualInclinePct: 0, actualDurationSec: 600 },
      { actualSpeedMph: 0, actualInclinePct: 4, actualDurationSec: 600 },
    ]);
    expect(speedMph).toBeCloseTo(7.0, 10);
    expect(inclinePct).toBeCloseTo(2.0, 10);
  });

  it('says nothing rather than guessing when there is nothing to say', () => {
    expect(beltAverages(null)).toEqual({ speedMph: null, inclinePct: null });
    expect(beltAverages([])).toEqual({ speedMph: null, inclinePct: null });
    expect(beltAverages([{ label: 'work' }])).toEqual({ speedMph: null, inclinePct: null });
  });
});
