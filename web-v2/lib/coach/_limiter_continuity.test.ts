/**
 * _limiter_continuity.test.ts · CONTINUOUS-LIMITER-1 · Rule 9 · the
 * training-volume finding fades in, it does not switch on.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * §4 of the limiter fired the `training_volume` finding through two booleans
 * OR'd together, and gave it a floored severity:
 *
 *   lateInBlock    = progress != null && progress >= 0.5
 *   deepShortfall  = volNow < floor * 0.7
 *   if (volNow < floor && (lateInBlock || deepShortfall))
 *     f.add('training_volume', clamp(shortfall * 1.6, 0.2, 1), ...)
 *
 * Both booleans are cliffs, and the severity floor of 0.2 makes each of them a
 * cliff in the OUTPUT rather than only in the firing:
 *
 *   · EARLY in a block, a runner at 70.1% of the tier floor gets NOTHING and a
 *     runner at 69.9% gets a 0.48-severity finding.
 *   · At progress 0.499 vs 0.501, a runner anywhere under the floor goes from
 *     nothing to at least 0.2.
 *
 * This is not a cosmetic number. `Findings.ranked()` sorts by severity and the
 * top-ranked limiter becomes THE lever the whole block's prescription reaches
 * for, so a finding appearing at 0.48 can displace the incumbent and send the
 * prescription down a different road — a categorically different plan from a
 * hair of input, which is exactly Rule 9.
 *
 * ── THE FIX ─────────────────────────────────────────────────────────────────
 *
 * The module's own reasoning already says what the right shape is: "Being under
 * the PEAK band early in a block is the plan working, not a limiter." So the
 * shortfall doctrine EXPECTS at this point in the block is subtracted, and only
 * the excess is evidence. The expectation falls linearly from the deep-shortfall
 * fraction at the start of the block to zero by the halfway point — the same two
 * constants, spent as the ends of a ramp instead of as two switches.
 *
 * Note what does NOT change: from halfway on, the expected shortfall is zero, so
 * severity is `shortfall * 1.6` — the old formula exactly, minus its 0.2 floor.
 * The floor had to go because a finding that cannot be weak cannot fade in.
 *
 * Rule 18: falsified against the unfixed engine before landing — the walk
 * reported a 0.4800 severity jump for 0.1 mi of weekly volume, and a 0.2000
 * jump for 0.002 of block progress.
 */
import { describe, it, expect } from 'vitest';
import { diagnoseLimiter, type LimiterInput } from './limiter';

function base(): LimiterInput {
  return {
    goalDistanceMi: 26.2,
    goalPaceSecPerMi: 412,
    experienceLevel: 'advanced',
    blockProgressFraction: null,
    performances: null,
    fadeObservations: null,
    thresholdPaceStartSecPerMi: null,
    thresholdPaceNowSecPerMi: null,
    thresholdWindowWeeks: null,
    weeklyMiAtWindowStart: null,
    recentWeeklyMi: null,
    observedHardDayGaps: null,
    sessionsMissingPacesInARow: null,
  };
}

/** Severity of the training_volume finding, 0 when it does not fire. */
function volSeverity(recentWeeklyMi: number, blockProgressFraction: number | null): number {
  const r = diagnoseLimiter({ ...base(), recentWeeklyMi, blockProgressFraction });
  return r?.ranked.find((x) => x.limiter === 'training_volume')?.severity ?? 0;
}

/** The tier floor this runner is measured against, found by bisection so the
 *  walk cannot drift out of the interesting region if TIER_TARGETS moves. */
function tierFloorMi(): number {
  let lo = 1;
  let hi = 200;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (volSeverity(mid, 1.0) > 0) lo = mid; else hi = mid;
  }
  return hi;
}

const FLOOR = tierFloorMi();

describe('CONTINUOUS-LIMITER-1 · the walk reaches the boundaries it is aimed at', () => {
  it('liveness · the sweep spans firing and not-firing on BOTH axes', () => {
    // A walk that never leaves one branch proves nothing (Rule 18).
    expect(FLOOR).toBeGreaterThan(10);
    expect(FLOOR).toBeLessThan(200);
    expect(volSeverity(FLOOR * 0.5, 1.0)).toBeGreaterThan(0);   // deep + late
    expect(volSeverity(FLOOR * 1.2, 1.0)).toBe(0);              // over the floor
    expect(volSeverity(FLOOR * 0.95, 0.0)).toBe(0);             // shallow + early
  });
});

describe('CONTINUOUS-LIMITER-1 · no step across the volume boundary', () => {
  const STEP = 0.1;

  it('severity is CONTINUOUS in weekly volume, at every point in the block', () => {
    for (const progress of [null, 0, 0.25, 0.45, 0.5, 0.55, 0.8, 1.0]) {
      let prev = volSeverity(FLOOR * 0.5, progress);
      let worst = 0;
      let worstAt = 0;
      for (let mi = FLOOR * 0.5 + STEP; mi <= FLOOR * 1.15; mi += STEP) {
        const cur = volSeverity(mi, progress);
        if (Math.abs(cur - prev) > worst) { worst = Math.abs(cur - prev); worstAt = mi; }
        prev = cur;
      }
      expect(
        worst,
        `training_volume severity jumped ${worst.toFixed(4)} at ${worstAt.toFixed(1)} mi ` +
        `(floor ${FLOOR.toFixed(1)} mi, progress ${progress})`,
      ).toBeLessThanOrEqual(0.02);
    }
  });

  it('a runner with MORE volume never gets a WORSE finding', () => {
    for (const progress of [null, 0, 0.3, 0.5, 0.9]) {
      let prev = volSeverity(FLOOR * 0.5, progress);
      for (let mi = FLOOR * 0.5 + STEP; mi <= FLOOR * 1.15; mi += STEP) {
        const cur = volSeverity(mi, progress);
        expect(
          cur,
          `severity ROSE from ${prev.toFixed(3)} to ${cur.toFixed(3)} as volume reached ` +
          `${mi.toFixed(1)} mi (progress ${progress})`,
        ).toBeLessThanOrEqual(prev + 1e-9);
        prev = cur;
      }
    }
  });
});

describe('CONTINUOUS-LIMITER-1 · no step across the block-progress boundary', () => {
  it('severity is CONTINUOUS in block progress, at every volume', () => {
    for (const frac of [0.6, 0.72, 0.8, 0.9, 0.99]) {
      const mi = FLOOR * frac;
      let prev = volSeverity(mi, 0);
      let worst = 0;
      let worstAt = 0;
      for (let p = 0.002; p <= 1.0; p += 0.002) {
        const cur = volSeverity(mi, Math.round(p * 1000) / 1000);
        if (Math.abs(cur - prev) > worst) { worst = Math.abs(cur - prev); worstAt = p; }
        prev = cur;
      }
      expect(
        worst,
        `training_volume severity jumped ${worst.toFixed(4)} at progress ${worstAt.toFixed(3)} ` +
        `(volume ${(frac * 100).toFixed(0)}% of floor)`,
      ).toBeLessThanOrEqual(0.02);
    }
  });

  it('later in the block never means a SOFTER finding for the same volume', () => {
    const mi = FLOOR * 0.8;
    let prev = volSeverity(mi, 0);
    for (let p = 0.002; p <= 1.0; p += 0.002) {
      const cur = volSeverity(mi, Math.round(p * 1000) / 1000);
      expect(cur, `severity FELL as the block advanced, at progress ${p.toFixed(3)}`)
        .toBeGreaterThanOrEqual(prev - 1e-9);
      prev = cur;
    }
  });
});

describe('CONTINUOUS-LIMITER-1 · the doctrine the check encodes still holds', () => {
  it('being under the peak band EARLY is still the plan working, not a limiter', () => {
    // The existing _limiter.test.ts case, restated: 55 mi at 15% through.
    expect(volSeverity(55, 0.15)).toBe(0);
  });

  it('a deep shortfall still fires even with no block progress known', () => {
    expect(volSeverity(FLOOR * 0.5, null)).toBeGreaterThan(0);
  });

  it('running AT or OVER the floor is never a volume limiter, whenever you are', () => {
    for (const progress of [null, 0, 0.5, 1.0]) {
      expect(volSeverity(FLOOR, progress), `at the floor, progress ${progress}`).toBe(0);
      expect(volSeverity(FLOOR * 1.3, progress), `over the floor, progress ${progress}`).toBe(0);
    }
  });

  it('late in the block the severity is the ORIGINAL formula · shortfall x 1.6', () => {
    // The expected shortfall is zero from halfway on, so nothing was softened
    // for the case the check was written for.
    for (const frac of [0.5, 0.7, 0.85, 0.95]) {
      const shortfall = 1 - frac;
      expect(volSeverity(FLOOR * frac, 0.9)).toBeCloseTo(Math.min(1, shortfall * 1.6), 6);
    }
  });
});
