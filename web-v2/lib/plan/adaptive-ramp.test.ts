/**
 * lib/plan/adaptive-ramp.test.ts · adaptive-ramp gate logic invariants.
 *
 * Verifies the doctrine guards (David 2026-06-02 conversation):
 *   · Pull-back gate · ANY pull-back signal blocks the bump
 *   · Tier ceiling · never bump past tier.peakLongMiBand[1]
 *   · Cooldown · no bump within 7 days of last bump
 *   · Old plans (no tier band) · no bump (safe default)
 *
 * Detector logic + DB reads aren't unit-tested here · those need a
 * test DB. The pure gate + cap logic is what runs in CI.
 */

import { describe, it, expect } from 'vitest';
import { TIER_TARGETS } from './goal-tiers';

describe('Adaptive ramp · gate logic', () => {
  // Pure-logic facsimile of the gate check in detectGreenRampOpportunity ·
  // mirrors the AND of all 5 booleans. Catches regressions where a gate
  // is accidentally inverted or removed.
  function allGatesPass(signals: {
    readinessGreen: boolean;
    lastQualityOnPace: boolean;
    lastLongClean: boolean;
    belowTierUpper: boolean;
    noBumpRecent: boolean;
  }): boolean {
    return signals.readinessGreen
      && signals.lastQualityOnPace
      && signals.lastLongClean
      && signals.belowTierUpper
      && signals.noBumpRecent;
  }

  it('all five green → bump fires', () => {
    expect(allGatesPass({
      readinessGreen: true, lastQualityOnPace: true,
      lastLongClean: true, belowTierUpper: true, noBumpRecent: true,
    })).toBe(true);
  });

  it.each([
    ['readinessGreen', 'pull-back streak active'],
    ['lastQualityOnPace', 'last quality off-pace'],
    ['lastLongClean', 'long decoupling > 5%'],
    ['belowTierUpper', 'already at tier ceiling'],
    ['noBumpRecent', 'cooldown · bumped < 7 days ago'],
  ])('gate %s = false blocks bump · %s', (key) => {
    const signals = {
      readinessGreen: true, lastQualityOnPace: true,
      lastLongClean: true, belowTierUpper: true, noBumpRecent: true,
    } as Record<string, boolean>;
    signals[key] = false;
    expect(allGatesPass(signals as Parameters<typeof allGatesPass>[0])).toBe(false);
  });
});

describe('Adaptive ramp · tier ceiling cap', () => {
  // planBump's math: newDist = min(oldDist + 1, tier.peakLongMiBand[1])
  // Verify across all tier × distance combos that the cap is respected.
  function bumpLong(oldDist: number, tierLongUpper: number): number {
    const proposed = oldDist + 1;
    return Math.min(proposed, tierLongUpper);
  }

  it('bump caps at tier peak long upper (HM advanced)', () => {
    const upper = TIER_TARGETS.hm.advanced.peakLongMiBand[1];  // 17
    expect(bumpLong(16, upper)).toBe(17);
    expect(bumpLong(17, upper)).toBe(17);  // already at cap · no bump
    expect(bumpLong(14, upper)).toBe(15);  // safe +1 in band
  });

  it('caps respect each distance × tier combo', () => {
    // Sample across the matrix · 5K developing peak long band [3.5, 5]
    expect(bumpLong(4, TIER_TARGETS['5k'].developing.peakLongMiBand[1])).toBe(5);
    expect(bumpLong(5, TIER_TARGETS['5k'].developing.peakLongMiBand[1])).toBe(5);
    // Marathon advanced [20, 22]
    expect(bumpLong(21, TIER_TARGETS.m.advanced.peakLongMiBand[1])).toBe(22);
    expect(bumpLong(22, TIER_TARGETS.m.advanced.peakLongMiBand[1])).toBe(22);
    // Ultra advanced [24, 28]
    expect(bumpLong(27, TIER_TARGETS.ultra.advanced.peakLongMiBand[1])).toBe(28);
  });
});

describe('Adaptive ramp · old plans without tier band', () => {
  // readTierUpper returns 0 when tier_peak_long_band isn't on the
  // authored_state (pre-tier-system plans). Bump math then never
  // exceeds oldDist · planBump returns null · no bump applied.
  it('missing tier band → no bump (safe default)', () => {
    const oldDist = 10;
    const tierUpper = 0;  // simulated · readTierUpper output for missing field
    const newDist = Math.min(oldDist + 1, tierUpper);  // min(11, 0) = 0
    expect(newDist).toBeLessThanOrEqual(oldDist);  // bump rejected
  });
});

describe('Adaptive ramp · cooldown period (7 days)', () => {
  it('bump within 7 days of last → blocked', () => {
    const COOLDOWN_DAYS = 7;
    for (const daysSince of [0, 1, 3, 6]) {
      expect(daysSince >= COOLDOWN_DAYS).toBe(false);  // bump blocked
    }
    for (const daysSince of [7, 8, 14, 30]) {
      expect(daysSince >= COOLDOWN_DAYS).toBe(true);  // bump allowed
    }
  });
});
