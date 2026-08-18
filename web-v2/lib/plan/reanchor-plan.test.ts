/**
 * Self-heal re-anchor — gate logic + the convergence property (a re-anchor at
 * VDOT V produces the SAME paces a fresh seed at V would).
 */
import { describe, it, expect } from 'vitest';
import {
  shouldReanchor, shouldReanchorRacePrep, refreshedPaceAndSpec, REANCHOR_VDOT_DELTA,
} from './reanchor-plan';
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

/**
 * COLD-4 · the race-prep arm's gate reads `pace_blend`, which is the vocabulary
 * `composePlan` persists — `authored_state.anchorSource` is the maintenance
 * seeder's key and does not exist on a race-prep plan.
 */
describe('shouldReanchorRacePrep — the race-prep gate', () => {
  it('ends the calibration intro on the first measured read', () => {
    const provisional = {
      season_anchor_vdot: 40,
      season_anchor_source: 'provisional_mileage',
      season_anchor_provisional: true,
    };
    expect(shouldReanchorRacePrep(provisional, 35.4)).toBe(true);
    // Either mark alone is sufficient (paceBlendAnchorIsProvisional's contract).
    expect(shouldReanchorRacePrep({ season_anchor_vdot: 40, season_anchor_provisional: true }, 35.4)).toBe(true);
  });

  it('never fires without a measured read — a provisional stays provisional', () => {
    const provisional = { season_anchor_vdot: 40, season_anchor_source: 'provisional_mileage' };
    expect(shouldReanchorRacePrep(provisional, null)).toBe(false);
  });

  it('holds a measured anchor through jitter, moves on a real shift', () => {
    const measured = {
      season_anchor_vdot: 48,
      season_anchor_source: 'measured_vdot',
      season_anchor_provisional: false,
    };
    expect(shouldReanchorRacePrep(measured, 48.6)).toBe(false);
    expect(shouldReanchorRacePrep(measured, 48 + REANCHOR_VDOT_DELTA)).toBe(true);
    expect(shouldReanchorRacePrep(measured, 45)).toBe(true);
  });

  it('a plan with NO recorded anchor takes the measurement', () => {
    // The live apple-review@faff.run plan is exactly this shape: authored
    // before the provenance column existed, anchored on the mileage estimate
    // anyway, nine weeks of tempo work priced off zero recorded runs. Without
    // this branch it gets neither the intro (needs a fresh authoring) nor the
    // self-heal, and runs the whole block on the invented pace.
    expect(shouldReanchorRacePrep(null, 48)).toBe(true);
    expect(shouldReanchorRacePrep({}, 48)).toBe(true);
    // Still gated on evidence — an absent anchor is not a licence to guess.
    expect(shouldReanchorRacePrep(null, null)).toBe(false);
    expect(shouldReanchorRacePrep({}, null)).toBe(false);
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
