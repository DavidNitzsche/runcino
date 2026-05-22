/**
 * V7 item 4 · Z2 sparkline ↔ max HR recalibration cross-reference.
 *
 * Locks the three-case window logic David specified:
 *   1. Recalibration predates window entirely → null (settled history)
 *   2. Recalibration inside window's RECENT half → hedged cross-ref
 *      ("zones recalibrated mid-window; trend reflects mixed framework data")
 *   3. Recalibration at window start or in OLDER half → clean cross-ref
 *
 * The discipline: a cross-ref that tells the runner "zones recalibrated"
 * when the sparkline window predates the recalibration is wrong, they're
 * looking at settled data.  The relevance check enforces this.
 */
import { describe, expect, it } from 'vitest';
import { resolveSparklineRecalibrationRef } from '../z2-sparkline';

// 8-week window for these tests: 2026-03-23 (Monday) → 2026-05-18 (Monday).
// Midpoint: 2026-04-20 (Monday).
const WINDOW_START = '2026-03-23';
const WINDOW_END = '2026-05-18';

describe('resolveSparklineRecalibrationRef · three-case window logic', () => {
  it('null recalibration date → null cross-ref (max HR never set)', () => {
    const out = resolveSparklineRecalibrationRef(WINDOW_START, WINDOW_END, null);
    expect(out.crossRef).toBeUndefined();
    expect(out.recalibrationHedge).toBeUndefined();
  });

  it('Case 1 · recalibration PREDATES window → null cross-ref (settled history)', () => {
    // 6 months before window start → entire window is post-recalibration
    // → settled history → no acknowledgment needed.
    const out = resolveSparklineRecalibrationRef(
      WINDOW_START,
      WINDOW_END,
      new Date('2025-12-01T12:00:00Z'),
    );
    expect(out.crossRef).toBeUndefined();
    expect(out.recalibrationHedge).toBeUndefined();
  });

  it('Case 1 · recalibration ONE DAY before window → still null (clean predate)', () => {
    const out = resolveSparklineRecalibrationRef(
      WINDOW_START,
      WINDOW_END,
      new Date('2026-03-22T12:00:00Z'),
    );
    expect(out.crossRef).toBeUndefined();
  });

  it('Case 3 · recalibration AT window start → clean cross-ref (no hedge)', () => {
    // Edge case: recalibration coincides with window start.  Entire
    // window is post-recalibration → standard 'tied to'.
    const out = resolveSparklineRecalibrationRef(
      WINDOW_START,
      WINDOW_END,
      new Date('2026-03-23T12:00:00Z'),
    );
    expect(out.crossRef).toBeDefined();
    expect(out.crossRef?.text).toBe('tied to the max HR validation on /profile');
    expect(out.crossRef?.href).toBe('/profile#max-hr-validation');
    expect(out.recalibrationHedge).toBeUndefined();
  });

  it('Case 3 · recalibration in window\'s OLDER half → clean cross-ref', () => {
    // Most of the window is post-recalibration → standard cross-ref,
    // no hedge.  Most data reflects new framework.
    const out = resolveSparklineRecalibrationRef(
      WINDOW_START,
      WINDOW_END,
      new Date('2026-04-05T12:00:00Z'),  // before midpoint (2026-04-20)
    );
    expect(out.crossRef).toBeDefined();
    expect(out.recalibrationHedge).toBeUndefined();
  });

  it('Case 2 · recalibration in window\'s RECENT half → hedged cross-ref', () => {
    // Mid-window recalibration → most of the data is OLD framework →
    // hedge is required so the runner doesn't misread the trend.
    const out = resolveSparklineRecalibrationRef(
      WINDOW_START,
      WINDOW_END,
      new Date('2026-05-01T12:00:00Z'),  // after midpoint
    );
    expect(out.crossRef).toBeDefined();
    expect(out.recalibrationHedge).toBe(
      'Zones recalibrated mid-window; the older weeks in this trend reflect mixed framework data.',
    );
  });

  it('Case 2 · recalibration AT window\'s recent end → hedged', () => {
    // Recalibration yesterday, the entire 8-week trend is OLD-framework
    // data with only a sliver of new.  Hedge essential.
    const out = resolveSparklineRecalibrationRef(
      WINDOW_START,
      WINDOW_END,
      new Date('2026-05-17T12:00:00Z'),
    );
    expect(out.crossRef).toBeDefined();
    expect(out.recalibrationHedge).toContain('mid-window');
    expect(out.recalibrationHedge).toContain('mixed framework');
  });
});

describe('resolveSparklineRecalibrationRef · relation + nav target', () => {
  it('uses "tied to" relation (structural, shared data event)', () => {
    const out = resolveSparklineRecalibrationRef(
      WINDOW_START,
      WINDOW_END,
      new Date('2026-04-05T12:00:00Z'),
    );
    expect(out.crossRef?.text.startsWith('tied to')).toBe(true);
  });

  it('href deep-links to #max-hr-validation on /profile', () => {
    const out = resolveSparklineRecalibrationRef(
      WINDOW_START,
      WINDOW_END,
      new Date('2026-04-05T12:00:00Z'),
    );
    expect(out.crossRef?.href).toBe('/profile#max-hr-validation');
  });
});
