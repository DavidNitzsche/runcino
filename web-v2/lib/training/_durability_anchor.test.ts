/**
 * _durability_anchor.test.ts · gate for `durability-anchor.ts`.
 *
 * ── WHAT THIS SUITE CANNOT FAIL ON (Rule 22) ─────────────────────────────
 *
 * Every fixture is synthetic, so this suite cannot catch:
 *
 *  · A LOADER BUG. `loadRaceObservationsForDurability` and
 *    `loadDecouplingObservations` execute real SQL against `races`/`runs`;
 *    nothing here runs a query. `_durability_anchor.audit.test.ts` is the
 *    suite that reads the owner's real rows and reports what the loaders
 *    actually return.
 *  · WHETHER 1.06 IS THE RIGHT POPULATION DEFAULT, OR WHETHER THIS RUNNER'S
 *    TRUE EXPONENT IS REALLY WHAT THE FIT SAYS. This suite asserts the
 *    ALGEBRA (the fit recovers a known synthetic exponent; the shrinkage
 *    moves toward 1.06 in proportion to evidence) — not a claim about human
 *    physiology.
 *  · A CORPUS THAT IS UNIFORMLY CONTAMINATED (e.g. every long run logged on
 *    the same mis-calibrated watch). Corroboration and heat-exclusion
 *    defend against specific, named contamination; they cannot detect an
 *    instrument that is wrong in the same way every time.
 *
 * ── BALANCE (Rule 22) ─────────────────────────────────────────────────────
 *
 * Cases where MORE evidence must RAISE confidence / move the shrunk value
 * toward the personal fit: 3. Cases where THIN or CONTAMINATED evidence must
 * REFUSE or fall back toward the population default: 6.
 */
import { describe, it, expect } from 'vitest';
import {
  fitRaceExponent,
  aggregateDecoupling,
  qualifyingDecouplingObservation,
  POPULATION_ENDURANCE_PRIOR,
  DURABILITY_HALF_LIFE_DAYS,
  RACE_EXPONENT_SATURATION_RACES,
  type DurabilityRaceObservation,
  type DecouplingObservation,
} from '@/lib/training/durability-anchor';
import { CORROBORATION_MIN_OBSERVATIONS } from '@/lib/training/vdot-corpus';

const TODAY = '2026-08-31';

/* ══════════════════════════════════════════════════════════════════════
 * RACE EXPONENT
 * ══════════════════════════════════════════════════════════════════ */

/** Synthetic races following T = a · D^b exactly, so the fit's recovered
 *  exponent can be checked against a KNOWN ground truth. */
function racesAtExponent(
  b: number,
  distances: number[],
  opts: {
    anchorDistanceMi?: number; anchorSec?: number; startDate?: string; spacingDays?: number;
    priority?: string; weight?: number;
  } = {},
): DurabilityRaceObservation[] {
  const anchorD = opts.anchorDistanceMi ?? 13.1;
  const anchorT = opts.anchorSec ?? 6000;
  const a = anchorT / Math.pow(anchorD, b);
  const start = Date.parse((opts.startDate ?? TODAY) + 'T12:00:00Z');
  const spacing = opts.spacingDays ?? 14;
  return distances.map((d, i) => ({
    slug: `race-${i}`,
    date: new Date(start - (distances.length - 1 - i) * spacing * 86_400_000).toISOString().slice(0, 10),
    distanceMi: d,
    finishSec: a * Math.pow(d, b),
    priority: opts.priority ?? 'A',
    weight: opts.weight ?? 1.0,
  }));
}

describe('fitRaceExponent · the fit recovers a known synthetic exponent', () => {
  it('2 races at a true exponent of 1.12 — the direct algebraic solve', () => {
    const races = racesAtExponent(1.12, [13.1, 26.2]);
    const r = fitRaceExponent(races, { today: TODAY });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rawFittedExponent).toBeCloseTo(1.12, 3);
    expect(r.races).toBe(2);
    expect(r.distinctDistances).toBe(2);
  });

  it('5 races at a true exponent of 1.10, wide spread, close together — the regression agrees with the 2-point solve', () => {
    const races = racesAtExponent(1.10, [3.1, 6.2, 13.1, 13.1, 26.2], { spacingDays: 10 });
    const r = fitRaceExponent(races, { today: TODAY });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rawFittedExponent).toBeCloseTo(1.10, 2);
  });

  it('refuses at 0 races', () => {
    const r = fitRaceExponent([], { today: TODAY });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_races');
  });

  it('refuses at 1 race — cannot fit a slope from one point', () => {
    const races = racesAtExponent(1.10, [13.1]);
    const r = fitRaceExponent(races, { today: TODAY });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('insufficient_races');
  });

  it('refuses when every race is at the same distance — no spread to fit a slope from', () => {
    const races: DurabilityRaceObservation[] = [
      { slug: 'h1', date: '2026-01-18', distanceMi: 13.1, finishSec: 5918, priority: 'A', weight: 1 },
      { slug: 'h2', date: '2026-02-01', distanceMi: 13.1, finishSec: 5694, priority: 'A', weight: 1 },
      { slug: 'h3', date: '2026-08-16', distanceMi: 13.1, finishSec: 6113, priority: 'A', weight: 1 },
    ];
    const r = fitRaceExponent(races, { today: TODAY });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('insufficient_distance_spread');
  });
});

describe('fitRaceExponent · shrinkage moves toward 1.06 in proportion to evidence (BALANCE: raise 3 / hold-back 4)', () => {
  it('RAISE 1 — 2 low-authority (C-race) results, narrow spread, far apart in time: heavy shrink toward the prior', () => {
    // Half and 10K only (narrow spread), C-priority (low evidence quality),
    // 200 days apart (poor freshness/coherence).
    const races = racesAtExponent(1.20, [6.2, 13.1], { spacingDays: 200, priority: 'C', weight: 0.35 });
    const r = fitRaceExponent(races, { today: TODAY });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // evidenceScore should be low: count at its floor (2 races), spread at
    // its floor (narrow), quality low (0.35).
    expect(r.evidenceScore).toBeLessThan(0.4);
    expect(r.confidence).toBeLessThan(0.5);
    // Shrunk value must sit CLOSER to the prior than to the raw fit.
    const distToPop = Math.abs(r.value - POPULATION_ENDURANCE_PRIOR);
    const distToRaw = Math.abs(r.value - r.rawFittedExponent);
    expect(distToPop).toBeLessThan(distToRaw);
  });

  it('QUALITY — the same 2-race shape, but A-priority instead of C, evidences MORE (higher evidenceScore)', () => {
    const cRaces = racesAtExponent(1.20, [6.2, 13.1], { spacingDays: 10, priority: 'C', weight: 0.35 });
    const aRaces = racesAtExponent(1.20, [6.2, 13.1], { spacingDays: 10, priority: 'A', weight: 1.0 });
    const rC = fitRaceExponent(cRaces, { today: TODAY });
    const rA = fitRaceExponent(aRaces, { today: TODAY });
    expect(rC.ok && rA.ok).toBe(true);
    if (!rC.ok || !rA.ok) return;
    expect(rA.evidenceScore).toBeGreaterThan(rC.evidenceScore);
    // And that quality difference alone must not depend on the clock —
    // both fixtures share the same dates, so freshness is identical; the
    // gap is entirely the quality component.
    expect(rA.confidence).toBeGreaterThan(rC.confidence);
  });

  it('CONSISTENCY — races that fit a clean power law exactly score full consistency; scattered races score lower', () => {
    // Clean: 4 races that lie EXACTLY on T = a*D^1.10 (own residual is ~0).
    const clean = racesAtExponent(1.10, [3.1, 6.2, 13.1, 26.2], { spacingDays: 10 });
    // Scattered: same distances, but perturb two finish times materially —
    // still fits SOME line, but not one that explains all four races.
    const scattered = racesAtExponent(1.10, [3.1, 6.2, 13.1, 26.2], { spacingDays: 10 })
      .map((r, i) => (i === 1 ? { ...r, finishSec: r.finishSec * 1.18 } : r));
    const rClean = fitRaceExponent(clean, { today: TODAY });
    const rScattered = fitRaceExponent(scattered, { today: TODAY });
    expect(rClean.ok && rScattered.ok).toBe(true);
    if (!rClean.ok || !rScattered.ok) return;
    expect(rClean.rmsLogResidual).not.toBeNull();
    expect(rScattered.rmsLogResidual).not.toBeNull();
    expect(rScattered.rmsLogResidual!).toBeGreaterThan(rClean.rmsLogResidual!);
    expect(rScattered.evidenceScore).toBeLessThan(rClean.evidenceScore);
  });

  it('CONSISTENCY is null/uncomputable at exactly 2 races — a 2-point fit is always "perfect" and must not fake full confidence from that', () => {
    const races = racesAtExponent(1.10, [6.2, 26.2], { spacingDays: 10 });
    const r = fitRaceExponent(races, { today: TODAY });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rmsLogResidual).toBeNull();
  });

  it('RAISE 2 — a full graded race history (5 races, 5K-to-marathon spread, run close together and recently): confidence clears half', () => {
    const races = racesAtExponent(1.10, [3.1, 6.2, 13.1, 13.1, 26.2], { spacingDays: 12 });
    const r = fitRaceExponent(races, { today: TODAY });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.confidence).toBeGreaterThan(0.5);
    const distToPop = Math.abs(r.value - POPULATION_ENDURANCE_PRIOR);
    const distToRaw = Math.abs(r.value - r.rawFittedExponent);
    expect(distToRaw).toBeLessThan(distToPop);
  });

  it('RAISE 3 — more races past saturation stop adding further confidence (no cliff, but a real ceiling)', () => {
    const distances6 = [3.1, 6.2, 10, 13.1, 20, 26.2];
    const distances3 = [3.1, 13.1, 26.2];
    expect(RACE_EXPONENT_SATURATION_RACES).toBeGreaterThan(3);
    const r6 = fitRaceExponent(racesAtExponent(1.10, distances6, { spacingDays: 10 }), { today: TODAY });
    const r3 = fitRaceExponent(racesAtExponent(1.10, distances3, { spacingDays: 10 }), { today: TODAY });
    expect(r6.ok && r3.ok).toBe(true);
    if (!r6.ok || !r3.ok) return;
    expect(r6.confidence).toBeGreaterThanOrEqual(r3.confidence);
  });

  it('HOLD BACK 1 — a stale 2-race pair (a year old) reads LESS CONFIDENT than a fresh identical pair, but the SAME `value` — decay moves confidence, never the number', () => {
    const fresh = racesAtExponent(1.14, [3.1, 26.2], { startDate: TODAY, spacingDays: 10 });
    const stale = racesAtExponent(1.14, [3.1, 26.2], { startDate: '2025-08-31', spacingDays: 10 });
    const rf = fitRaceExponent(fresh, { today: TODAY });
    const rs = fitRaceExponent(stale, { today: TODAY });
    expect(rf.ok && rs.ok).toBe(true);
    if (!rf.ok || !rs.ok) return;
    expect(rs.confidence).toBeLessThan(rf.confidence);
    // The core course-correction guard: identical races (same distances,
    // same finish times, same relative spacing), only shifted a year
    // earlier on the calendar. `value` must be BYTE-IDENTICAL — staleness
    // is not permitted to move the number, only how much it is trusted.
    expect(rs.value).toBe(rf.value);
    expect(rs.evidenceScore).toBe(rf.evidenceScore);
    expect(rs.rawFittedExponent).toBe(rf.rawFittedExponent);
  });

  it('DECAY-OF-CONFIDENCE-ONLY, restated at the whole-anchor level: evaluating the exact same evidence at two very different "today"s never changes `value`, only `confidence`', () => {
    const races = racesAtExponent(1.10, [3.1, 6.2, 13.1, 26.2], { startDate: '2025-01-01', spacingDays: 14 });
    const soon = fitRaceExponent(races, { today: '2025-02-01' });
    const muchLater = fitRaceExponent(races, { today: '2027-01-01' });
    expect(soon.ok && muchLater.ok).toBe(true);
    if (!soon.ok || !muchLater.ok) return;
    expect(muchLater.value).toBe(soon.value);
    expect(muchLater.confidence).toBeLessThan(soon.confidence);
  });

  it('HOLD BACK 2 — value is always between the population default and the raw fit (never overshoots)', () => {
    const races = racesAtExponent(1.30, [6.2, 13.1], { spacingDays: 5 });
    const r = fitRaceExponent(races, { today: TODAY });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lo = Math.min(POPULATION_ENDURANCE_PRIOR, r.rawFittedExponent);
    const hi = Math.max(POPULATION_ENDURANCE_PRIOR, r.rawFittedExponent);
    expect(r.value).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(r.value).toBeLessThanOrEqual(hi + 1e-9);
  });

  it('HOLD BACK 3 — an ungraded/hilly race supplied anyway does not raise confidence relative to omitting it (caller-level exclusion is the contract, not this pure function\'s job to police, but weight=0 must not corrupt the fit)', () => {
    const clean = racesAtExponent(1.10, [3.1, 13.1, 26.2], { spacingDays: 10 });
    const withZeroWeightIntruder: DurabilityRaceObservation[] = [
      ...clean,
      { slug: 'hilly', date: TODAY, distanceMi: 26.2, finishSec: 999999, priority: 'hilly_excluded', weight: 0 },
    ];
    const rClean = fitRaceExponent(clean, { today: TODAY });
    const rWith = fitRaceExponent(withZeroWeightIntruder, { today: TODAY });
    expect(rClean.ok && rWith.ok).toBe(true);
    if (!rClean.ok || !rWith.ok) return;
    // A zero-weight observation is filtered before the fit — same numbers.
    expect(rWith.rawFittedExponent).toBeCloseTo(rClean.rawFittedExponent, 6);
    expect(rWith.races).toBe(rClean.races);
  });

  it('HOLD BACK 4 — never negative, never above 1', () => {
    const races = racesAtExponent(1.05, [13.1, 26.2], { spacingDays: 400 });
    const r = fitRaceExponent(races, { today: TODAY });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * DECOUPLING
 * ══════════════════════════════════════════════════════════════════ */

/** n mile-splits at a fixed pace, HR climbing linearly by `hrRise` overall.
 *  Mirrors `_limiter.test.ts`'s own `run()` fixture — same shape, so a
 *  fixture proven to satisfy `computeAerobicDecoupling`'s steady-state gate
 *  is reused rather than re-derived. */
function splitsRun(miles: number, paceSec: number, hrStart: number, hrRise: number) {
  return Array.from({ length: miles }, (_, i) => ({
    mile: i + 1,
    pace: paceSec,
    hr: hrStart + Math.round((hrRise * i) / Math.max(1, miles - 1)),
  }));
}

function decouplingObs(n: number, driftPcts: number[], startDate = TODAY, spacingDays = 7): DecouplingObservation[] {
  const start = Date.parse(startDate + 'T12:00:00Z');
  return driftPcts.slice(0, n).map((d, i) => ({
    id: `run-${i}`,
    date: new Date(start - (driftPcts.length - 1 - i) * spacingDays * 86_400_000).toISOString().slice(0, 10),
    driftPct: d,
    durationMin: 70,
  }));
}

describe('qualifyingDecouplingObservation · heat exclusion actually changes the reading', () => {
  const splits = splitsRun(8, 480, 140, 20); // 8 mi @ 8:00/mi, HR 140→160

  it('a HOT run (85°F) with these exact splits is excluded', () => {
    const r = qualifyingDecouplingObservation({
      id: 'hot', date: TODAY, distanceMi: 8, splits, tempF: 85,
    });
    expect(r).toBeNull();
  });

  it('the SAME splits at 65°F are included, with the driftPct the raw math produces', () => {
    const r = qualifyingDecouplingObservation({
      id: 'cool', date: TODAY, distanceMi: 8, splits, tempF: 65,
    });
    expect(r).not.toBeNull();
    expect(r!.driftPct).toBeGreaterThan(0); // HR climbed, pace held — real drift
  });

  it('right at the doctrine threshold (77°F) is excluded — the gate is >=, not >', () => {
    const r = qualifyingDecouplingObservation({
      id: 'edge', date: TODAY, distanceMi: 8, splits, tempF: 77,
    });
    expect(r).toBeNull();
  });

  it('unknown temperature (null) is not penalized — absence is not heat', () => {
    const r = qualifyingDecouplingObservation({
      id: 'unknown-temp', date: TODAY, distanceMi: 8, splits, tempF: null,
    });
    expect(r).not.toBeNull();
  });

  it('too short a run (under the protocol duration) is excluded regardless of temperature', () => {
    const shortSplits = splitsRun(4, 300, 140, 10); // 4 mi @ 5:00/mi = 20 min
    const r = qualifyingDecouplingObservation({
      id: 'short', date: TODAY, distanceMi: 4, splits: shortSplits, tempF: 60,
    });
    expect(r).toBeNull();
  });

  it('a splits array that does not decompose its own run is refused (splits.total-vs-distance) even though the per-run math would otherwise qualify', () => {
    // 8 splits, each explicitly claiming 1 mile (8 mi of splits total), but
    // the row itself claims distanceMi 1 — the exact corruption shape
    // splits-adopt.ts documents for real production rows (12.0 mi of
    // splits on a 1.00 mile row).
    const splits = splitsRun(8, 480, 140, 20).map((s) => ({ ...s, distanceMi: 1 }));
    const r = qualifyingDecouplingObservation({
      id: 'corrupt', date: TODAY, distanceMi: 1, splits, tempF: 60,
    });
    expect(r).toBeNull();
  });

  it('a splits array with no per-split distance field is NOT refused by the reconciler (null is not a contradiction)', () => {
    // splitsRun()'s elements carry only mile/pace/hr, no distanceMi field,
    // so reconcileSplitsTotal has nothing to check and must return null,
    // not false — the run still qualifies on its own merits.
    const splits = splitsRun(8, 480, 140, 20);
    const r = qualifyingDecouplingObservation({
      id: 'no-dist-field', date: TODAY, distanceMi: 8, splits, tempF: 60,
    });
    expect(r).not.toBeNull();
  });
});

describe('aggregateDecoupling · corroboration discipline (BALANCE: raise 2 / hold-back 3)', () => {
  it('RAISE 1 — refuses below CORROBORATION_MIN_OBSERVATIONS', () => {
    const obs = decouplingObs(CORROBORATION_MIN_OBSERVATIONS - 1, [4, 5, 6, 7]);
    const r = aggregateDecoupling(obs, { today: TODAY });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('insufficient_corroboration');
    expect(r.observations).toBe(CORROBORATION_MIN_OBSERVATIONS - 1);
  });

  it('RAISE 2 — zero observations refuses with the distinct reason', () => {
    const r = aggregateDecoupling([], { today: TODAY });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_observations');
  });

  it('HOLD BACK 1 — at the minimum, ok:true and value is the mean', () => {
    const obs = decouplingObs(CORROBORATION_MIN_OBSERVATIONS, [4, 6, 8]);
    const r = aggregateDecoupling(obs, { today: TODAY });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeCloseTo(6, 6);
  });

  it('HOLD BACK 2 — tight, consistent readings carry MORE confidence than wildly scattered ones at the same count', () => {
    const tight = decouplingObs(6, [5.8, 6.0, 5.9, 6.1, 6.0, 5.9]);
    const scattered = decouplingObs(6, [1, 11, 2, 10, 3, 9]);
    const rTight = aggregateDecoupling(tight, { today: TODAY });
    const rScattered = aggregateDecoupling(scattered, { today: TODAY });
    expect(rTight.ok && rScattered.ok).toBe(true);
    if (!rTight.ok || !rScattered.ok) return;
    expect(rTight.confidence).toBeGreaterThan(rScattered.confidence);
  });

  it('HOLD BACK 3 — a stale corpus (all observations well past the anchor half-life) reads LESS CONFIDENT than a fresh one, but the SAME `value` — decay moves confidence, never the number', () => {
    const fresh = decouplingObs(5, [5, 6, 5.5, 6.5, 6], TODAY, 5);
    const stale = decouplingObs(5, [5, 6, 5.5, 6.5, 6], '2025-01-01', 5);
    const rf = aggregateDecoupling(fresh, { today: TODAY });
    const rs = aggregateDecoupling(stale, { today: TODAY });
    expect(rf.ok && rs.ok).toBe(true);
    if (!rf.ok || !rs.ok) return;
    expect(rs.confidence).toBeLessThan(rf.confidence);
    // Course-correction guard: identical drift readings, only shifted a
    // year and a half earlier. `value` (the mean) must be BYTE-IDENTICAL.
    expect(rs.value).toBe(rf.value);
    expect(rs.evidenceScore).toBe(rf.evidenceScore);
    // Sanity on the half-life constant this depends on.
    expect(DURABILITY_HALF_LIFE_DAYS).toBeGreaterThan(0);
  });
});
