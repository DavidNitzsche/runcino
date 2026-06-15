/**
 * Dry-run simulation — "Lillian": NEW female user, faster-5K goal (26:00),
 * runs MOSTLY ON THE TREADMILL. No real user/DB — exercises the actual VDOT +
 * pace functions the onboarding seeder calls, across the treadmill cases.
 *
 * The pivotal variable: a treadmill run may report distanceMi=0 (no GPS).
 * This documents exactly what she gets in each case so we know her experience
 * before she runs through it.
 */
import { describe, it, expect } from 'vitest';
import {
  bestRecentVdot, vdotFromRun, vdotRunFloorMi, goalDistanceMiFromCode,
  iPaceFromVdot, tPaceFromVdot,
} from './vdot';
import { conservativeVdotFromMileage } from '../plan/spec-builder';

const fmt = (s: number | null) => s == null ? 'null' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}/mi`;
const FLOOR = vdotRunFloorMi(goalDistanceMiFromCode('5k')); // 3.0 — her 5K goal sets the floor

// Her treadmill efforts: 3.1 mi at ~9:00/mi, honest (HR 168 avg / 182 max ≈ 92%).
const TT_WITH_DISTANCE = (i: number) => ({
  id: `tm${i}`, date: '2026-06-1' + i, workout_type: null,
  distance_mi: 3.1, finish_seconds: 1674, avg_hr: 168, max_hr: 182,
});
// Same effort but the treadmill reported no distance (no GPS).
const TT_NO_DISTANCE = (i: number) => ({ ...TT_WITH_DISTANCE(i), distance_mi: 0 });

describe('Lillian · 5K goal sets the run floor to 3.0mi', () => {
  it('admits her ~3.1mi treadmill efforts (would be rejected at the old 4mi floor)', () => {
    expect(FLOOR).toBe(3);
  });
});

describe('Lillian · treadmill runs WITH distance → she gets a measured VDOT', () => {
  const runs = [1, 2, 3, 4].map(TT_WITH_DISTANCE);
  const best = bestRecentVdot([], '2026-06-19', 180, runs, FLOOR).best;

  it('reads a sane VDOT off her treadmill efforts', () => {
    expect(best).not.toBeNull();
    expect(best!.vdot).toBeGreaterThanOrEqual(30);
    expect(best!.vdot).toBeLessThanOrEqual(38);
  });

  it('her paces come out ordered correctly (intervals < threshold < easy)', () => {
    const v = best!.vdot;
    const iPace = iPaceFromVdot(v)!, tPace = tPaceFromVdot(v)!, easy = tPace + 100;
    expect(iPace).toBeLessThan(tPace);
    expect(tPace).toBeLessThan(easy);
    // Intervals should be near her actual 9:00 treadmill effort, not slower.
    expect(iPace).toBeLessThanOrEqual(1674 / 3.1);
    void fmt; // (fmt kept for ad-hoc number printing during debugging)
  });
});

describe('Lillian · treadmill runs with distanceMi=0 → NO measured VDOT (the risk)', () => {
  it('vdotFromRun rejects a zero-distance treadmill run', () => {
    expect(vdotFromRun({ finishSeconds: 1674, distanceMi: 0, avgHr: 168, maxHr: 182, minDistanceMi: FLOOR })).toBeNull();
  });
  it('so bestRecentVdot finds nothing → she falls to CALIBRATION', () => {
    const best = bestRecentVdot([], '2026-06-19', 180, [1, 2, 3, 4].map(TT_NO_DISTANCE), FLOOR).best;
    expect(best).toBeNull(); // anchorVdot null → calibrating=true in the seeder
  });
});

describe('Lillian · cold start (no qualifying runs) → calibration on a conservative anchor', () => {
  it('no runs → no measured VDOT → calibration; conservative anchor is sane for a ~10mi/wk woman', () => {
    const measured = bestRecentVdot([], '2026-06-19', 180, [], FLOOR).best;
    expect(measured).toBeNull();
    const provisional = conservativeVdotFromMileage(10); // her weekly target
    expect(provisional).toBeGreaterThanOrEqual(30);
    const iPace = iPaceFromVdot(provisional)!, easy = tPaceFromVdot(provisional)! + 100;
    // During calibration her quality is THRESHOLD (not these intervals), but if it
    // were intervals they'd still be ordered ahead of easy — no inverted paces.
    expect(iPace).toBeLessThan(easy);
    void fmt;
  });
});

describe('Lillian · HR gate works for a woman off her OWN observed max (not 220-age)', () => {
  it('avg 168 vs observed max 182 = 92% → passes; no male-default assumption', () => {
    const v = vdotFromRun({ finishSeconds: 1674, distanceMi: 3.1, avgHr: 168, maxHr: 182, minDistanceMi: FLOOR });
    expect(v).not.toBeNull();
  });
  it('but a NEW user with runs and NO established max HR → gate fails closed (no read)', () => {
    // If loadEffectiveMaxHr can't resolve a max, the run candidate's max_hr is null.
    const v = vdotFromRun({ finishSeconds: 1674, distanceMi: 3.1, avgHr: 168, maxHr: null, minDistanceMi: FLOOR });
    expect(v).toBeNull(); // ← worth knowing: no maxHr ⇒ no VDOT ⇒ calibration
  });
});
