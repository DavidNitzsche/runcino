/**
 * coach-goal-durability.test.ts · proves `deriveCoachGoal`'s personal-exponent
 * source is the CANONICAL `durability-anchor.ts#fitRaceExponent` read, not
 * this file's own (now-legacy) `fitPersonalExponent` two-race fit.
 *
 * docs/reports/race-prediction-consolidation-2026-09-01.md · before this
 * fix, `lib/race/coach-goal.ts` and `lib/training/durability-anchor.ts`
 * independently fitted the same physiological quantity — this runner's own
 * cross-distance Riegel exponent — from the same `races` table, with
 * different windows and different shrinkage/reject rules, and could
 * disagree. `deriveCoachGoal` now takes a `RaceExponentRead` (assembled by
 * `durability-anchor.ts#resolveRaceExponent`) and projects through it via
 * `projectWithDurabilityExponent`; it no longer computes or accepts its own
 * fit for this purpose (see coach-goal.test.ts's note where that test used
 * to live).
 */
import { describe, it, expect } from 'vitest';
import {
  deriveCoachGoal,
  projectWithDurabilityExponent,
} from './coach-goal';
import { fitRaceExponent, type DurabilityRaceObservation } from '@/lib/training/durability-anchor';
import { predictRaceTime } from '@/lib/training/vdot';
import { roundTargetSec } from './effective-race-target';

const TODAY = '2026-08-28';
const FIVEK = 3.10686;
const TENK = 6.21371;
const HM = 13.1094;

function obs(over: Partial<DurabilityRaceObservation>): DurabilityRaceObservation {
  return {
    slug: 'r', date: '2026-08-01', distanceMi: TENK, finishSec: 2500,
    priority: 'B', weight: 0.65, ...over,
  };
}

describe('projectWithDurabilityExponent · the bridge deriveCoachGoal now uses', () => {
  it('projects off the nearest supporting race, exactly as the legacy predictWithPersonalExponent did', () => {
    const read = fitRaceExponent([
      obs({ slug: '5k', date: '2026-08-10', distanceMi: FIVEK, finishSec: 1200 }),
      obs({ slug: '10k', date: '2026-08-20', distanceMi: TENK, finishSec: 2500 }),
    ], { today: TODAY });
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const proj = projectWithDurabilityExponent(read, HM);
    expect(proj).not.toBeNull();
    // Anchored on the 10K (nearer HM in log-distance than the 5K).
    const expectedSec = Math.round(2500 * Math.pow(HM / TENK, read.value));
    expect(proj!.sec).toBe(expectedSec);
    expect(proj!.anchorDistanceMi).toBe(TENK);
  });

  it('refuses when the read itself refused (Rule 11: no value on ok:false)', () => {
    const refused = fitRaceExponent([obs({})], { today: TODAY }); // 1 race
    expect(refused.ok).toBe(false);
    // The function accepts the whole `RaceExponentRead` union (same as
    // `deriveCoachGoal`'s `durabilityExponent` input) and checks `ok` itself
    // at runtime — an `ok:false` read is a normal, expected input, not a
    // type error, precisely so a caller never has to branch before calling.
    expect(projectWithDurabilityExponent(refused, HM)).toBeNull();
  });

  it('null outside Riegel\'s validity window', () => {
    const read = fitRaceExponent([
      obs({ distanceMi: FIVEK, finishSec: 1200 }),
      obs({ distanceMi: TENK, finishSec: 2500 }),
    ], { today: TODAY });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(projectWithDurabilityExponent(read, 31.07)).toBeNull(); // ultra
  });
});

describe('deriveCoachGoal · durabilityExponent is now the ONLY personal-exponent input', () => {
  it('a usable durability read drives method=personal-exponent, with its own confidence carried', () => {
    const read = fitRaceExponent([
      obs({ slug: '5k', date: '2026-08-10', distanceMi: FIVEK, finishSec: 1200 }),
      obs({ slug: '10k', date: '2026-08-20', distanceMi: TENK, finishSec: 2500 }),
    ], { today: TODAY });
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const r = deriveCoachGoal({
      statedGoalSec: null, priority: 'B', distanceMi: HM,
      vdot: 50, vdotAnchorDistanceMi: TENK, durabilityExponent: read,
      todayISO: TODAY,
    });
    expect(r?.kind).toBe('time');
    if (r?.kind !== 'time') return;
    expect(r.method).toBe('personal-exponent');
    // ONE quantity: the exponent the card reports is exactly the durability
    // anchor's own shrunk value, not a re-derived or re-fitted number.
    expect(r.personalExponent).toBe(read.value);
    expect(r.personalExponentConfidence).toBe(read.confidence);
    const proj = projectWithDurabilityExponent(read, HM)!;
    expect(r.bSec).toBe(roundTargetSec(proj.sec));
    expect(r.vdotBasis).toBeNull(); // exponent method, not the vdot fallback
  });

  it('an ok:false (or absent) durability read falls back to the Daniels-vdot method, exactly as before', () => {
    const refused = fitRaceExponent([obs({})], { today: TODAY }); // 1 race → refuses
    expect(refused.ok).toBe(false);

    const withRefusedRead = deriveCoachGoal({
      statedGoalSec: null, priority: 'B', distanceMi: TENK,
      vdot: 50, vdotAnchorDistanceMi: TENK, durabilityExponent: refused,
      todayISO: TODAY,
    });
    const withNoRead = deriveCoachGoal({
      statedGoalSec: null, priority: 'B', distanceMi: TENK,
      vdot: 50, vdotAnchorDistanceMi: TENK,
      todayISO: TODAY,
    });
    for (const r of [withRefusedRead, withNoRead]) {
      expect(r?.kind).toBe('time');
      if (r?.kind !== 'time') continue;
      expect(r.method).toBe('daniels-vdot');
      expect(r.personalExponent).toBeNull();
      expect(r.personalExponentConfidence).toBeNull();
      expect(r.vdotBasis).toBe(50);
      expect(r.bSec).toBe(roundTargetSec(predictRaceTime(50, TENK)!));
    }
  });

  it('shrinkage is real: thin evidence pulls the exponent — and therefore B — toward the population prior, not toward a raw two-race slope', () => {
    // Same two races as the coach-goal.test.ts legacy fixture (5K 20:00,
    // 10K 41:40 → raw b ≈ 1.0590). With only 2 races and no third
    // corroborating distance, durability-anchor's evidenceScore is well
    // under 1, so `read.value` sits BETWEEN the raw fit and the 1.06 prior —
    // provably NOT the raw two-race number the legacy fit would have
    // reported unshrunk.
    const read = fitRaceExponent([
      obs({ slug: '5k', date: '2026-08-10', distanceMi: FIVEK, finishSec: 1200 }),
      obs({ slug: '10k', date: '2026-08-20', distanceMi: TENK, finishSec: 2500 }),
    ], { today: TODAY });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const rawB = Math.log(2500 / 1200) / Math.log(TENK / FIVEK);
    expect(read.rawFittedExponent).toBeCloseTo(rawB, 4);
    expect(read.value).not.toBeCloseTo(rawB, 3); // shrunk away from the raw fit
    expect(read.value).toBeGreaterThan(Math.min(rawB, read.populationPrior));
    expect(read.value).toBeLessThan(Math.max(rawB, read.populationPrior));
  });
});
