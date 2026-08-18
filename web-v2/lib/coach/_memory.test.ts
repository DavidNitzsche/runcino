/**
 * lib/coach/memory.ts · pure-function tests.
 *
 * Doctrine source: Design/execution-memory-firing.md Part 2. These lock the
 * two things that make memory trustworthy rather than noisy: promotion
 * requires BOTH enough evidence and enough distinct periods, and decay is
 * measured from the LAST observation, not the first.
 */

import { describe, it, expect } from 'vitest';
import {
  isExpired,
  shouldPromote,
  DEFAULT_PROMOTION_THRESHOLDS,
  MEDIUM_TIER_DAYS,
  SHORT_TIER_DAYS,
} from './memory';

describe('shouldPromote', () => {
  it('does not promote on evidence alone — repeated same-day noise is not a pattern', () => {
    expect(shouldPromote(5, 1)).toBe(false);
  });

  it('does not promote on period spread alone — one instance per period is not enough occurrences', () => {
    expect(shouldPromote(1, 5)).toBe(false);
  });

  it('promotes once both bars are cleared', () => {
    expect(shouldPromote(3, 3)).toBe(true);
  });

  it('respects caller-supplied thresholds', () => {
    expect(shouldPromote(2, 2, { minEvidenceCount: 2, minDistinctPeriods: 2 })).toBe(true);
    expect(shouldPromote(2, 2, DEFAULT_PROMOTION_THRESHOLDS)).toBe(false); // default bar is 3/3
    expect(shouldPromote(2, 2, { minEvidenceCount: 5, minDistinctPeriods: 2 })).toBe(false);
  });
});

describe('isExpired', () => {
  it('a permanent memory never expires, however old', () => {
    expect(isExpired({ tier: 'permanent', lastObservedISO: '2020-01-01' }, '2026-08-17')).toBe(false);
  });

  it('a medium memory survives inside its window', () => {
    expect(isExpired({ tier: 'medium', lastObservedISO: '2026-07-01' }, '2026-08-17')).toBe(false);
  });

  it('a medium memory expires past its window', () => {
    expect(isExpired({ tier: 'medium', lastObservedISO: '2026-06-01' }, '2026-08-17')).toBe(true);
  });

  it('expiry is measured from the LAST observation, not the first', () => {
    // A pattern that started 200 days ago but was reinforced yesterday is
    // not stale — only the DISTANCE FROM lastObservedISO counts.
    expect(isExpired({ tier: 'medium', lastObservedISO: '2026-08-16' }, '2026-08-17')).toBe(false);
  });

  it('a short memory is stricter than medium at the same age', () => {
    const lastObservedISO = '2026-08-01';
    const todayISO = '2026-08-17'; // 16 days
    expect(isExpired({ tier: 'short', lastObservedISO }, todayISO)).toBe(true);
    expect(isExpired({ tier: 'medium', lastObservedISO }, todayISO)).toBe(false);
  });

  it('the tier ceilings are what the doctrine module documents', () => {
    expect(SHORT_TIER_DAYS).toBeLessThan(MEDIUM_TIER_DAYS);
  });
});
