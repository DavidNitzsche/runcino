/**
 * Self-heal re-anchor — gate logic + the convergence property (a re-anchor at
 * VDOT V produces the SAME paces a fresh seed at V would).
 */
import { describe, it, expect } from 'vitest';
import { shouldReanchor, refreshedPaceAndSpec, REANCHOR_VDOT_DELTA } from './reanchor-maintenance';
import { buildWorkoutSpec } from './spec-builder';
import { tPaceFromVdot, iPaceFromVdot } from '@/lib/training/vdot';

describe('shouldReanchor — when to refresh', () => {
  it('upgrades a provisional / calibrating plan the moment a measured read exists', () => {
    expect(shouldReanchor('provisional_mileage', 30, 35.4)).toBe(true);
    expect(shouldReanchor('awaiting_calibration', null, 35.4)).toBe(true);
  });
  it('does nothing without a measured read (cold start stays calibrating)', () => {
    expect(shouldReanchor('provisional_mileage', 30, null)).toBe(false);
  });
  it('holds steady on a measured anchor until fitness moves >= threshold', () => {
    expect(shouldReanchor('measured_run', 35.4, 36.0)).toBe(false);      // jitter
    expect(shouldReanchor('measured_run', 35.4, 35.4 + REANCHOR_VDOT_DELTA)).toBe(true); // real gain
    expect(shouldReanchor('measured_run', 40, 37)).toBe(true);           // real loss (≥2)
  });
});

describe('refreshedPaceAndSpec — converges with a fresh seed', () => {
  // The seeder calls buildWorkoutSpec(type, dist, tPaceSec, null, undefined, null, null, iPaceSec).
  const seedShape = (type: string, dist: number | null, vdot: number, tt: string | null) => {
    const tPaceSec = tPaceFromVdot(vdot) ?? 480;
    const iPaceSec = tt ? iPaceFromVdot(vdot) : null;
    return buildWorkoutSpec(type, dist, tPaceSec, null, undefined, null, null, iPaceSec);
  };

  it('5K-build intervals re-anchor to true I-pace (Justin: VDOT 35.4 → 8:36)', () => {
    const r = refreshedPaceAndSpec('intervals', 3, 35.4, '5k');
    expect(r.paceTargetSPerMi).toBe(iPaceFromVdot(35.4));   // ~516 s/mi = 8:36
    expect(r.paceTargetSPerMi).toBe(seedShape('intervals', 3, 35.4, '5k').paceTargetSPerMi);
  });

  it('easy/long/threshold also match a fresh seed at the new VDOT', () => {
    for (const [type, dist] of [['easy', 5], ['long', 8], ['threshold', 4]] as const) {
      const r = refreshedPaceAndSpec(type, dist, 35.4, '5k');
      const seed = seedShape(type, dist, 35.4, '5k');
      expect(r.paceTargetSPerMi).toBe(seed.paceTargetSPerMi);
    }
  });

  it('a no-goal (consistency) plan gets no I-pace — threshold stays threshold', () => {
    const r = refreshedPaceAndSpec('threshold', 4, 35.4, null);
    expect(r.paceTargetSPerMi).toBe(tPaceFromVdot(35.4));   // threshold = T pace, no I-pace
  });
});
