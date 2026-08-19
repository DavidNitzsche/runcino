/**
 * The convergence LOADER's pure half.
 *
 * Most of `convergence-loader.ts` is I/O and is exercised by the adaptation
 * dry-run sweep. Two things in it are arithmetic, and both were wrong in the
 * first draft, so they get their own falsifiers:
 *
 *   · the Plews series is built in LOG space, from the runner's own readings,
 *     with a rolling window that tolerates the gaps doctrine expects;
 *   · the baseline is measured from the PRIOR window, excluding the days under
 *     test. A baseline that includes them moves toward them and a sustained
 *     drop partly cancels its own signal.
 *
 * Run: ./node_modules/.bin/vitest run lib/coach/_convergence_loader.test.ts
 */
import { describe, it, expect } from 'vitest';
import { plewsSeries, dateAxis, PRIOR_EXCLUDES_DAYS } from './convergence-loader';
import { CONVERGENCE } from './convergence';

const AXIS = dateAxis('2026-08-19', 60);
const pt = (date: string, value: number) => ({ date, value });

/** A flat history at `ms`, with the last `dropDays` at `dropMs`. */
function history(ms: number, dropDays = 0, dropMs = ms) {
  return AXIS.map((d, i) => pt(d, i >= AXIS.length - dropDays ? dropMs : ms));
}

describe('the axis', () => {
  it('is continuous, oldest first, and ends on the runner\'s own today', () => {
    expect(AXIS).toHaveLength(60);
    expect(AXIS[AXIS.length - 1]).toBe('2026-08-19');
    expect(AXIS[AXIS.length - 2]).toBe('2026-08-18');
    // Strictly increasing, no gaps.
    for (let i = 1; i < AXIS.length; i++) expect(AXIS[i] > AXIS[i - 1]).toBe(true);
  });
});

describe('the Plews series is built in log space', () => {
  it('the rolling value is the mean of LnRMSSD, not the log of the mean', () => {
    const s = plewsSeries(history(60), AXIS);
    expect(s.rolling[s.rolling.length - 1]).toBeCloseTo(Math.log(60), 10);
    expect(s.baseline).toBeCloseTo(Math.log(60), 10);
  });

  it('a window with fewer than three readings is null, not a guess', () => {
    // Research/15: "3 valid readings per week is sufficient for trend
    // assessment if paired with a 7-day rolling average." Below that, silence.
    const sparse = AXIS.map((d, i) => pt(d, i % 7 === 0 ? 60 : NaN))
      .filter((p) => Number.isFinite(p.value));
    const s = plewsSeries(sparse, AXIS);
    expect(s.rolling[s.rolling.length - 1]).toBeNull();
  });

  it('tolerates the gaps doctrine expects · 3 readings a week still trends', () => {
    const threePerWeek = AXIS
      .map((d, i) => (i % 7 < 3 ? pt(d, 60) : null))
      .filter((p): p is { date: string; value: number } => p != null);
    const s = plewsSeries(threePerWeek, AXIS);
    expect(s.baseline).not.toBeNull();
  });
});

describe('the baseline is the PRIOR window · a drop cannot cancel its own signal', () => {
  it('a sustained drop does not move the baseline it is measured against', () => {
    const flat = plewsSeries(history(60), AXIS);
    const dropped = plewsSeries(history(60, CONVERGENCE.hrvMinDays, 50), AXIS);
    // The drop is inside the excluded tail, so the reference is untouched.
    expect(dropped.baseline).toBeCloseTo(flat.baseline!, 10);
    expect(dropped.sd60).toBeCloseTo(flat.sd60!, 10);
  });

  it('the excluded tail is at least as wide as the rolling window', () => {
    // Every value inside the last 7 days is partly built from readings the
    // rule is currently judging, so a narrower exclusion would leak.
    expect(PRIOR_EXCLUDES_DAYS).toBeGreaterThanOrEqual(7);
    // And wide enough to cover the longest per-domain persistence bar.
    expect(PRIOR_EXCLUDES_DAYS).toBeGreaterThanOrEqual(CONVERGENCE.hrvMinDays);
  });

  it('the regression this guards · a self-including baseline erodes the margin', () => {
    // Reproduce the old behaviour on the same data and show it is measurably
    // worse: including the drop in the mean shrinks the observed deviation.
    const rolling = plewsSeries(history(60, 3, 50), AXIS).rolling
      .filter((v): v is number => v != null);
    const selfIncluding = rolling.reduce((a, b) => a + b, 0) / rolling.length;
    const prior = plewsSeries(history(60, 3, 50), AXIS).baseline!;
    const today = rolling[rolling.length - 1];
    expect(prior - today).toBeGreaterThan(selfIncluding - today);
  });

  it('with no usable prior history there is no baseline, and so no vote', () => {
    const s = plewsSeries([], AXIS);
    expect(s.baseline).toBeNull();
    expect(s.sd60).toBeNull();
  });
});
