/**
 * _durability_phase1.test.ts · Phase 1 of the brain completion (2026-09-02):
 * representativeness spent in the exponent fit, endpoint coverage, marathon
 * rehearsals as the earned-progression evidence, the marathon-pace range, and
 * the flat move cap in the sparse threshold regime.
 *
 * What this cannot fail on (Rule 22): the representativeness assessor's own
 * pricing (its module owns that); the DB loaders (audit tests own those).
 * Falsified 2026-09-02 — see the brain handback's falsification ledger.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fitRaceExponent, qualifyingMarathonRehearsal, aggregateMarathonRehearsals,
  MARATHON_REHEARSAL_MIN_SESSIONS, RACE_EXPONENT_ENDPOINT_SATURATION, POPULATION_ENDURANCE_PRIOR,
  type DurabilityRaceObservation,
} from './durability-anchor';
import { composeDurability, applyDayToDayContinuity } from './capacity-resolver';
import { marathonPaceFromDurability } from './prescription-resolver';
import { thresholdPaceCorpus, fullAuthority, type PaceObservation } from './pace-corpus';

const race = (slug: string, date: string, mi: number, sec: number, weight = 1): DurabilityRaceObservation =>
  ({ slug, date, distanceMi: mi, finishSec: sec, priority: 'A', weight, representativenessReason: 'NOT_ASSESSED' });
const OWNER: DurabilityRaceObservation[] = [
  race('la', '2026-03-08', 26.219, 12700),
  race('afc', '2026-08-16', 13.1, 6113),
  race('sombrero', '2026-05-03', 13.16, 6057, 0.35),
  race('rose', '2026-01-18', 13.109, 5918),
  race('disney', '2026-02-01', 13.109, 5694),
];

describe('endpoint coverage · one long race cannot pose as a corroborated curve', () => {
  it('a single long-end observation scores 0 on endpoint coverage and is named', () => {
    const r = fitRaceExponent(OWNER, { today: '2026-09-01' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.endpointCounts).toEqual({ short: 4, long: 1 });
    expect(r.endpointScore).toBe(0);
    expect(r.reasons).toContain('SINGLE_LONG_END_OBSERVATION');
  });
  it('three long-end observations saturate the term', () => {
    const three = [...OWNER, race('m2', '2026-04-01', 26.2, 12600), race('m3', '2026-05-01', 26.2, 12650)];
    const r = fitRaceExponent(three, { today: '2026-09-01' });
    expect(r.ok && r.endpointScore).toBe(1);
    expect(RACE_EXPONENT_ENDPOINT_SATURATION).toBe(3);
  });
  it('the evidence score is lower with one long race than with three, so the value sits nearer the prior', () => {
    const one = fitRaceExponent(OWNER, { today: '2026-09-01' });
    const three = fitRaceExponent([...OWNER, race('m2', '2026-04-01', 26.2, 12600), race('m3', '2026-05-01', 26.2, 12650)], { today: '2026-09-01' });
    expect(one.ok && three.ok).toBe(true);
    if (!one.ok || !three.ok) return;
    expect(one.evidenceScore).toBeLessThan(three.evidenceScore);
    expect(Math.abs(one.value - POPULATION_ENDURANCE_PRIOR)).toBeLessThan(Math.abs(one.rawFittedExponent - POPULATION_ENDURANCE_PRIOR));
  });
});

describe('representativeness · weight and corrected time flow into the fit', () => {
  it('a hot, hilly half entered at its corrected time and reduced weight changes the fit; the raw entry does not', () => {
    const corrected = OWNER.map((o) => o.slug === 'afc'
      ? { ...o, weight: 0.28, finishSec: 5815, representativeness: { authority: 0.28, tier: 'unrepresentative' as const, explainedPct: 5.13, rawFinishSec: 6113, detractors: ['heat:0.47', 'course_elevation:0.2'] }, representativenessReason: 'ASSESSED' as const }
      : o);
    const raw = fitRaceExponent(OWNER, { today: '2026-09-01' });
    const fixed = fitRaceExponent(corrected, { today: '2026-09-01' });
    expect(raw.ok && fixed.ok).toBe(true);
    if (!raw.ok || !fixed.ok) return;
    expect(fixed.rawFittedExponent).not.toBeCloseTo(raw.rawFittedExponent, 3);
    expect(fixed.reasons).toContain('REPRESENTATIVENESS_APPLIED');
  });
});

/** Mile splits: `n` miles at `pace` s/mi with `hr`, preceded by `pre` easy miles. */
function splits(pre: number, n: number, pace: number, hr: number, jitterPct = 1) {
  const out: Array<{ mile: number; avgHr: number; paceSPerMi: number }> = [];
  for (let i = 0; i < pre; i++) out.push({ mile: i + 1, avgHr: hr - 30, paceSPerMi: pace + 60 });
  for (let i = 0; i < n; i++) out.push({ mile: pre + i + 1, avgHr: hr, paceSPerMi: Math.round(pace * (1 + ((i % 2 ? 1 : -1) * jitterPct) / 100)) });
  return out;
}

describe('marathon rehearsals · Research/02 §12.2 fast-finish long run and §12.4 MP tempo', () => {
  const LTHR = 168;
  it('a fast-finish long run · 10 easy then 7 held at marathon HR qualifies as fast_finish_long', () => {
    const o = qualifyingMarathonRehearsal({ id: 'a', date: '2026-11-15', distanceMi: 17, splits: splits(10, 7, 470, 153), tempF: 55, lthrBpm: LTHR });
    expect(o).not.toBeNull();
    expect(o!.kind).toBe('fast_finish_long');
    expect(o!.segmentMi).toBe(7);
    expect(o!.precedingMi).toBeGreaterThanOrEqual(8);
  });
  it('an 11-mile block at marathon HR inside a 15-mile run qualifies as mp_tempo', () => {
    const o = qualifyingMarathonRehearsal({ id: 'b', date: '2026-11-17', distanceMi: 15, splits: [...splits(2, 11, 470, 152), { mile: 14, avgHr: 130, paceSPerMi: 540 }, { mile: 15, avgHr: 128, paceSPerMi: 545 }], tempF: 55, lthrBpm: LTHR });
    expect(o?.kind).toBe('mp_tempo');
    expect(o?.segmentMi).toBe(11);
  });
  it('held at threshold heart rate, not marathon, is not a rehearsal', () => {
    expect(qualifyingMarathonRehearsal({ id: 'c', date: '2026-11-15', distanceMi: 17, splits: splits(10, 7, 440, 167), tempF: 55, lthrBpm: LTHR })).toBeNull();
  });
  it('a held opening that fades into nine slower miles is a run that went out too hard, not a tempo', () => {
    const fadeOut = [...splits(0, 9, 470, 152), ...splits(0, 9, 520, 150).map((x, i) => ({ ...x, mile: 10 + i }))];
    expect(qualifyingMarathonRehearsal({ id: 'g', date: '2026-07-25', distanceMi: 18, splits: fadeOut, tempF: 55, lthrBpm: LTHR })).toBeNull();
  });
  it('a fading finish (a mile more than 5% off the segment mean) is not a held pace', () => {
    expect(qualifyingMarathonRehearsal({ id: 'd', date: '2026-11-15', distanceMi: 17, splits: splits(10, 7, 470, 153, 9), tempF: 55, lthrBpm: LTHR })).toBeNull();
  });
  it('heat is priced out: the same segment on a hot day reads faster than its raw pace', () => {
    const cool = qualifyingMarathonRehearsal({ id: 'e', date: '2026-08-30', distanceMi: 17, splits: splits(10, 7, 470, 153), tempF: 50, lthrBpm: LTHR })!;
    const warm = qualifyingMarathonRehearsal({ id: 'f', date: '2026-08-30', distanceMi: 17, splits: splits(10, 7, 470, 153), tempF: 72, lthrBpm: LTHR })!;
    expect(Math.abs(cool.paceSecPerMi - 470)).toBeLessThanOrEqual(2);
    expect(warm.paceSecPerMi).toBeLessThan(cool.paceSecPerMi);
  });
  it('the read refuses below three rehearsals (doctrine: 3–5) and reads the median above it', () => {
    const one = qualifyingMarathonRehearsal({ id: 'a', date: '2026-11-15', distanceMi: 17, splits: splits(10, 7, 470, 153), tempF: 55, lthrBpm: LTHR })!;
    expect(aggregateMarathonRehearsals([one, one], { lthrBpm: LTHR })).toMatchObject({ ok: false, reason: 'insufficient_corroboration', observations: 2 });
    const r = aggregateMarathonRehearsals([one, { ...one, paceSecPerMi: 466 }, { ...one, paceSecPerMi: 474 }], { lthrBpm: LTHR });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.demonstratedPaceSecPerMi).toBe(one.paceSecPerMi); expect(r.observations).toBe(MARATHON_REHEARSAL_MIN_SESSIONS); }
    expect(aggregateMarathonRehearsals([one, one, one], { lthrBpm: null })).toMatchObject({ ok: false, reason: 'no_lthr' });
  });
});

describe('marathon pace · the honest range, and the rehearsal cap from the fast side only', () => {
  const fit = fitRaceExponent(OWNER, { today: '2026-09-01' });
  const decoupling = { ok: false as const, reason: 'no_observations' as const, observations: 0 };
  it('range runs from the population exponent to the raw fit and contains the spent value', () => {
    const d = composeDurability({ raceExponent: fit, decoupling });
    const mp = marathonPaceFromDurability({ thresholdPaceSecPerMi: 430, durability: d });
    expect(mp.source).toBe('exponent');
    expect(mp.rangeSecPerMi[0]).toBeLessThanOrEqual(mp.paceSecPerMi);
    expect(mp.rangeSecPerMi[1]).toBeGreaterThanOrEqual(mp.paceSecPerMi);
    expect(mp.rangeSecPerMi[1] - mp.rangeSecPerMi[0]).toBeGreaterThan(10);
  });
  it('a demonstrated rehearsal pace FASTER than the carry sets the number (earned), a slower one does not', () => {
    const base = composeDurability({ raceExponent: fit, decoupling });
    const carry = marathonPaceFromDurability({ thresholdPaceSecPerMi: 430, durability: base }).paceSecPerMi;
    const faster = composeDurability({ raceExponent: fit, decoupling, trainingDurability: { ok: true, demonstratedPaceSecPerMi: Math.round(carry) - 12, confidence: 0.6, observations: 3, supporting: [], reasons: [] } });
    const shaky = composeDurability({ raceExponent: fit, decoupling, trainingDurability: { ok: true, demonstratedPaceSecPerMi: Math.round(carry) - 12, confidence: 0.2, observations: 3, supporting: [], reasons: [] } });
    expect(marathonPaceFromDurability({ thresholdPaceSecPerMi: 430, durability: shaky }).source).toBe('exponent');
    const slower = composeDurability({ raceExponent: fit, decoupling, trainingDurability: { ok: true, demonstratedPaceSecPerMi: Math.round(carry) + 12, confidence: 0.6, observations: 3, supporting: [], reasons: [] } });
    const f = marathonPaceFromDurability({ thresholdPaceSecPerMi: 430, durability: faster });
    const s = marathonPaceFromDurability({ thresholdPaceSecPerMi: 430, durability: slower });
    expect(f.source).toBe('rehearsal');
    expect(f.paceSecPerMi).toBe(Math.round(carry) - 12);
    expect(s.source).toBe('exponent');
    expect(s.paceSecPerMi).toBeCloseTo(carry, 6);
    expect(faster.reasons).toContain('MARATHON_REHEARSALS_DEMONSTRATED');
    expect(base.reasons).toContain('EXPONENT_RESTS_ON_ONE_LONG_RACE');
  });
});

describe('sparse threshold regime · an uncorroborated session earns one day of cap, whatever the gap', () => {
  const obs = (id: string, date: string, pace: number): PaceObservation => ({
    id, date, paceSecPerMi: pace, durationSec: 1800, source: 'phases', hrBasis: 'pct_lthr', hrPct: 0.96, hrBandDistance: 0.5,
    weight: 1, completed: true, representative: true, authority: fullAuthority(),
  } as unknown as PaceObservation);
  it('K=1 · read nine days after a lone 26 s/mi faster session, the allowance is still one day\'s cap', () => {
    const r = thresholdPaceCorpus([obs('a', '2026-06-05', 456), obs('b', '2026-06-14', 430)], 1, { todayISO: '2026-06-23', windowDays: 60 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.moveCap.applied).toBe(true);
    expect(r.moveCap.allowedSecPerMi).toBe(5);
    expect(r.tPaceSecPerMi).toBe(451);
  });
  it('K=3 keeps the day-scaled allowance', () => {
    const r = thresholdPaceCorpus([obs('a', '2026-06-01', 456), obs('b', '2026-06-03', 455), obs('c', '2026-06-05', 456), obs('d', '2026-06-14', 430), obs('e', '2026-06-14', 431), obs('f', '2026-06-14', 432)], 3, { todayISO: '2026-06-23', windowDays: 60 });
    expect(r.ok && r.moveCap.allowedSecPerMi).toBe(50);
  });
});

describe('day-to-day continuity across tiers', () => {
  const est = (paceSecPerMi: number, sourceMode: 'direct' | 'race_derived', reasons: string[] = []) => ({
    paceSecPerMi, vdot: 47, confidence: 0.5, sourceMode, evidenceIds: [], reasons, resolvedAt: '', modelVersion: '1',
  }) as unknown as Parameters<typeof applyDayToDayContinuity>[0];
  it('a tier flip of 26 s/mi is held to one day\'s cap and says so', () => {
    const r = applyDayToDayContinuity(est(430, 'direct', ['SPARSE_CORROBORATION']), est(456, 'race_derived'));
    expect(r.paceSecPerMi).toBe(451);
    expect(r.reasons).toContain('DAY_TO_DAY_CONTINUITY_CAPPED');
    expect(r.continuity).toMatchObject({ applied: true, yesterdayPaceSecPerMi: 456, uncappedPaceSecPerMi: 430 });
  });
  it('a move inside the cap passes untouched, and no yesterday is reported as unavailable, not as no move', () => {
    expect(applyDayToDayContinuity(est(452, 'race_derived'), est(456, 'race_derived')).paceSecPerMi).toBe(452);
    const r = applyDayToDayContinuity(est(430, 'direct', ['SPARSE_CORROBORATION']), null);
    expect(r.paceSecPerMi).toBe(430);
    expect(r.reasons).toContain('CONTINUITY_UNAVAILABLE');
  });
});

describe('the loader actually SPENDS representativeness (source-bound · a pure test cannot see a DB loader)', () => {
  const src = readFileSync(join(__dirname, 'durability-anchor.ts'), 'utf8');
  it('the weight is multiplied by the assessor\'s authority', () => {
    expect(src).toMatch(/weight:\s*o\.weight\s*\*\s*Math\.max\(0,\s*Math\.min\(1,\s*read\.authority\)\)/);
  });
  it('the finish time has the explained seconds removed, on the downward limb only', () => {
    expect(src).toMatch(/finishSec:\s*Math\.round\(o\.finishSec\s*\/\s*\(1\s*\+\s*explained\s*\/\s*100\)\)/);
    expect(src).toMatch(/read\.direction === 'downward'\s*\?\s*Math\.max\(0,\s*read\.explainedPct\)\s*:\s*0/);
  });
  it('an assessor that cannot read a race leaves the observation untouched and says so (Rule 11)', () => {
    expect(src).toMatch(/representativenessReason:\s*'ASSESSOR_UNAVAILABLE'/);
    expect(src).toMatch(/loadRaceObservationsForDurability[\s\S]{0,4000}return applyRepresentativeness\(userUuid, out\);/);
  });
});
