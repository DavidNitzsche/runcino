/**
 * V7 · readiness ↔ V5 cross-reference relevance check.
 *
 * Cross-references are EARNED, not decorative.  These tests lock the
 * relevance check so a future agent can't quietly broaden it to "any
 * topical overlap fires a cross-ref", that would violate the V7
 * cross-reference discipline rule in coach-voice.ts.
 */
import { describe, expect, it } from 'vitest';
import { resolveCrossRef } from '../readiness-score';
import type { Z2CoverageFinding } from '../z2-coverage';

/** Minimal Z2 finding shape, only the field resolveCrossRef reads. */
function z2(shouldRender: boolean): Z2CoverageFinding {
  return {
    shouldRender,
    z2CeilingBpm: 145,
    ePaceRangeDisplay: '8:30 – 9:30',
    last7d: { easyRunCount: 5, runsInZ2: 1, easyMiles: 25, z2Miles: 5, z2SharePct: 20 },
    last28d: { z2Miles: 18, easyMiles: 95, z2SharePct: 19 },
    thresholdUnderReach: null,
  };
}

const FATIGUE_INPUT = { name: 'yesterday', delta: -15, note: 'hard session' };
const POSITIVE_INPUT = { name: 'yesterday', delta: +5, note: 'easy run' };
const NON_FATIGUE_NEGATIVE = { name: 'hr-pace-drift', delta: -10, note: 'Z2 pace slower' };

describe('resolveCrossRef · earned-not-decorative discipline', () => {
  it('green readiness → null even when V5 is firing', () => {
    // Green doesn't need explaining; cross-ref would be noise.
    const out = resolveCrossRef('green', [FATIGUE_INPUT], z2(true));
    expect(out).toBeNull();
  });

  it('yellow readiness + V5 silent → null (no V5 finding to point to)', () => {
    const out = resolveCrossRef('yellow', [FATIGUE_INPUT], z2(false));
    expect(out).toBeNull();
  });

  it('yellow readiness + V5 firing + no fatigue inputs → null', () => {
    // Topic overlap alone (both touch effort) is NOT enough. V5 must
    // be plausibly causal, a fatigue input on C6 is the link.
    const out = resolveCrossRef('yellow', [POSITIVE_INPUT], z2(true));
    expect(out).toBeNull();
  });

  it('yellow readiness + V5 firing + only non-fatigue negative input → null', () => {
    // hr-pace-drift is negative but not in the V5-causal family
    // (drift could come from many sources; V5 specifically targets
    // easy-run effort).  No earned link → no cross-ref.
    const out = resolveCrossRef('yellow', [NON_FATIGUE_NEGATIVE], z2(true));
    expect(out).toBeNull();
  });

  it('yellow readiness + V5 firing + fatigue input → cross-ref fires', () => {
    const out = resolveCrossRef('yellow', [FATIGUE_INPUT], z2(true));
    expect(out).not.toBeNull();
    expect(out?.text).toBe('consistent with the Z2 stimulus check on /overview');
    expect(out?.href).toBe('/overview#z2-stimulus-check');
  });

  it('red readiness + V5 firing + freshness-fatigue → cross-ref fires', () => {
    const freshness = { name: 'freshness', delta: -10, note: '2 hard in 3 days' };
    const out = resolveCrossRef('red', [freshness], z2(true));
    expect(out).not.toBeNull();
    expect(out?.text).toContain('Z2 stimulus check');
  });

  it('red readiness + V5 firing + load-7d-fatigue → cross-ref fires', () => {
    const load = { name: 'load-7d', delta: -10, note: '4 hard sessions in 7 days' };
    const out = resolveCrossRef('red', [load], z2(true));
    expect(out).not.toBeNull();
  });

  it('uses "consistent with" relation (default, corroboration, no overclaim)', () => {
    // The two surfaces observe elevated effort from different angles.
    // "Contributing to" would overclaim causation; "tied to" implies a
    // shared data event that doesn't exist here.  Default is correct.
    const out = resolveCrossRef('yellow', [FATIGUE_INPUT], z2(true));
    expect(out?.text.startsWith('consistent with')).toBe(true);
  });

  it('href deep-links to the V5 surface via #z2-stimulus-check anchor', () => {
    // Web: scroll target on /overview.  iPhone (future): deep-link.
    const out = resolveCrossRef('yellow', [FATIGUE_INPUT], z2(true));
    expect(out?.href).toBe('/overview#z2-stimulus-check');
  });
});
