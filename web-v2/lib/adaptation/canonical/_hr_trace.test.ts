/**
 * HRFLATLINE-1 · a heart rate that never changes is not a heart rate.
 *
 * The fixtures are the owner's REAL 2026-09-03 hill session, read out of
 * production: 21 phases, ~460 samples, eight distinct values in the whole
 * workout, and Hill 5 sitting at 103 bpm for a full 60-second hill rep.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22): it judges VARIANCE, so a device that
 * carries a value forward with ±1 bpm of jitter defeats it entirely. That is a
 * deliberate floor — the alternative is a variance threshold, which would be a
 * physiological claim needing a citation this has no basis for. It catches the
 * shape that actually occurred, and says so rather than implying more.
 */
import { describe, it, expect } from 'vitest';
import { hrTraceIsCredible, workTraceIsCredible } from './hr-trace-credibility';

describe('HRFLATLINE-1', () => {
  it('the live case · 18 identical samples across a 60s hill rep is refused', () => {
    const hill1 = Array<number>(18).fill(134);
    const v = hrTraceIsCredible(hill1);
    expect(v.credible).toBe(false);
    expect(v.why).toMatch(/all 18 heart-rate samples read exactly 134 bpm/);
  });

  it('and the physiologically impossible one · 103 bpm through a hill rep', () => {
    expect(hrTraceIsCredible(Array<number>(18).fill(103)).credible).toBe(false);
  });

  it('a real trace with ordinary variation is credible', () => {
    expect(hrTraceIsCredible([158, 160, 161, 163, 164, 166, 167, 168]).credible).toBe(true);
    // Even a nearly-flat but genuinely varying trace passes. The test is
    // variance-exists, not variance-is-large.
    expect(hrTraceIsCredible([160, 160, 160, 160, 161]).credible).toBe(true);
  });

  it('sparse is not held · too few readings to judge is left alone', () => {
    // Rule 11 · no grounds to refuse is not grounds to refuse.
    expect(hrTraceIsCredible([134, 134]).credible).toBe(true);
    expect(hrTraceIsCredible([]).credible).toBe(true);
  });

  it('zeroes and nonsense are ignored rather than counted as variation', () => {
    // A trace of 18 held values plus a couple of dropouts is still held.
    expect(hrTraceIsCredible([...Array<number>(18).fill(134), 0, Number.NaN]).credible).toBe(false);
  });

  it('one held rep condemns the SET, because C4 reads the mean and the segments', () => {
    const v = workTraceIsCredible([
      { label: 'Hill 1 of 10', samples: [158, 160, 162, 164, 166, 168] },
      { label: 'Hill 2 of 10', samples: Array<number>(18).fill(134) },
    ]);
    expect(v.credible).toBe(false);
    expect(v.why).toMatch(/^Hill 2 of 10: all 18/);
  });

  it('a genuinely clean set passes', () => {
    expect(workTraceIsCredible([
      { label: 'Hill 1', samples: [158, 160, 162, 164, 166, 168] },
      { label: 'Hill 2', samples: [159, 161, 163, 165, 167, 169] },
    ]).credible).toBe(true);
  });
});
