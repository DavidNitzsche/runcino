/**
 * Self-heal re-anchor — gate logic + the convergence property.
 *
 * PRESCRIPTION-WIRE-1 (2026-08-31) · THE CONVERGENCE PROPERTY CHANGED PARTNER,
 * and this header says so rather than leaving a stale sentence (Rule 20's
 * corollary). It used to be "a re-anchor at VDOT V produces the same paces a
 * fresh SEED at V would" — convergence with `generate.ts`'s authoring path,
 * through the VDOT cascade both then shared. `refreshedPaceAndSpec` no longer
 * takes a VDOT, so that property is not merely unasserted, it is not
 * expressible.
 *
 * The property that replaces it is the one that now matters: the maintenance
 * arm and the race-prep arm must price a runner IDENTICALLY off one anchor set
 * (Rule 16 — before this they used two different derivations and a runner
 * switching modes changed physiology). Authoring convergence returns when
 * `generate.ts` is migrated, which is a separately-scoped pass.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldReanchor, shouldReanchorRacePrep, refreshedPaceAndSpec, REANCHOR_VDOT_DELTA,
} from './reanchor-plan';
import { buildWorkoutSpec } from './spec-builder';
import type { PrescribedPaceAnchors } from '@/lib/training/prescription-resolver';

/**
 * The owner's real resolved anchor set on 2026-08-31, used as a fixture because
 * a number that came out of the live resolvers is harder to write a
 * self-satisfying test around than one invented for the test.
 */
const ANCHORS: PrescribedPaceAnchors = {
  thresholdSecPerMi: 430,
  intervalSecPerMi: 407,
  repetitionSecPerMi: 371,
  easyCeilingSecPerMi: 502,
  shakeoutCeilingSecPerMi: 532,
  marathonSecPerMi: 475,
  basis: {
    threshold: { sourceMode: 'direct', confidence: 0.727, vdot: 47.9 },
    highIntensity: { sourceMode: 'vdot_fallback', confidence: 0.291 },
    easyCeiling: { sourceMode: 'direct', confidence: 0.634 },
    marathon: {
      sourceMode: 'direct', confidence: 0.727,
      enduranceExponent: 1.0869, personallyEvidenced: true,
    },
  },
};

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

describe('refreshedPaceAndSpec — prices off the anchors, and nothing else', () => {
  /** The call shape `recomputePacesForPlan` makes — the race-prep arm's engine. */
  const racePrepShape = (type: string, dist: number | null) => buildWorkoutSpec(
    type, dist, ANCHORS.thresholdSecPerMi, null, undefined, null, null,
    ANCHORS.intervalSecPerMi, ANCHORS.thresholdSecPerMi, false, null, ANCHORS,
  );

  it('the two self-heal arms produce identical paces from one anchor set (Rule 16)', () => {
    for (const [type, dist] of [
      ['easy', 5], ['long', 14], ['threshold', 8], ['intervals', 7],
      ['tempo', 6], ['shakeout', 2],
    ] as const) {
      const maintenance = refreshedPaceAndSpec(type, dist, ANCHORS);
      const racePrep = racePrepShape(type, dist);
      expect(maintenance.paceTargetSPerMi).toBe(racePrep.paceTargetSPerMi);
      expect(JSON.stringify(maintenance.spec)).toBe(JSON.stringify(racePrep.spec));
    }
  });

  it('intervals take high-intensity capacity, whatever race the runner entered', () => {
    // THE DELETED GOAL GATE. `ttDistance` used to decide whether a runner got a
    // true I-pace or the `T - 18` cruise default, so a marathoner's 800s were
    // run slower than a 5K runner's at identical fitness — a stated goal
    // reaching a training pace (Constitution §7, §G). The parameter survives for
    // call-site shape and must now change nothing at all.
    const withGoal = refreshedPaceAndSpec('intervals', 7, ANCHORS, undefined, '5k');
    const noGoal = refreshedPaceAndSpec('intervals', 7, ANCHORS, undefined, null);
    const marathon = refreshedPaceAndSpec('intervals', 7, ANCHORS, undefined, 'marathon');
    expect(withGoal.paceTargetSPerMi).toBe(ANCHORS.intervalSecPerMi);
    expect(noGoal.paceTargetSPerMi).toBe(ANCHORS.intervalSecPerMi);
    expect(marathon.paceTargetSPerMi).toBe(ANCHORS.intervalSecPerMi);
  });

  it('threshold work is priced at threshold capacity exactly', () => {
    const r = refreshedPaceAndSpec('threshold', 8, ANCHORS);
    expect(r.paceTargetSPerMi).toBe(ANCHORS.thresholdSecPerMi);
  });

  it('easy and long share one ceiling; a shakeout gets the tighter one', () => {
    const easy = refreshedPaceAndSpec('easy', 5, ANCHORS).spec as Record<string, number>;
    const long = refreshedPaceAndSpec('long', 14, ANCHORS).spec as Record<string, number>;
    const shake = refreshedPaceAndSpec('shakeout', 2, ANCHORS).spec as Record<string, number>;
    expect(easy.pace_target_s_per_mi_lo).toBe(ANCHORS.easyCeilingSecPerMi);
    // LONG IS EASY EFFORT · one quantity, one number. The live block had long
    // runs prescribed FASTER than easy days; that is what this asserts is over.
    expect(long.pace_target_s_per_mi_lo).toBe(ANCHORS.easyCeilingSecPerMi);
    expect(shake.pace_target_s_per_mi_lo).toBe(ANCHORS.shakeoutCeilingSecPerMi);
    expect(shake.pace_target_s_per_mi_lo).toBeGreaterThan(easy.pace_target_s_per_mi_lo);
  });

  it('the zone order survives every row type it prices', () => {
    // Rule 13's sanity check, as an assertion rather than an eyeball: no easy
    // day may be prescribed faster than a threshold day, on any row.
    for (const [type, dist] of [
      ['easy', 5], ['long', 14], ['shakeout', 2],
    ] as const) {
      const spec = refreshedPaceAndSpec(type, dist, ANCHORS).spec as Record<string, number>;
      expect(spec.pace_target_s_per_mi_lo).toBeGreaterThan(ANCHORS.thresholdSecPerMi);
    }
  });
});
