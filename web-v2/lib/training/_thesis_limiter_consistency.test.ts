/**
 * lib/training/_thesis_limiter_consistency.test.ts · ONE "LIMITER", TWO
 * CONSUMERS, ONE READ (Rule 16).
 *
 * This repo has two modules that put the word "limiter" in front of a runner:
 *
 *   · `lib/training/coaching-thesis.ts` — Constitution §F's "current limiter",
 *     printed on Today ("durability is the limiter right now") and on Block.
 *   · `lib/coach/limiter.ts#diagnoseLimiter` — the goal-gap's "what is
 *     preventing THIS GOAL", printed in the gap report's `whatClosesIt`.
 *
 * They answer related but different questions (the second is goal-relative
 * and reads volume and recovery too), so both survive. What may NOT survive
 * is their disagreeing about the one signal they share — the shape of the
 * runner's race curve — which on 2026-09-02 they did for the owner (thesis
 * v2: THRESHOLD; limiter.ts: endurance). This gate pins the shared arm:
 *
 *   1 · both read the SAME band constant (`CURVE_NEUTRAL_EXPONENT_BAND`, bound
 *       by `LIMITER.curve-shape-neutral-band`), by identity;
 *   2 · a raw fit above the band names durability/endurance in BOTH;
 *   3 · a raw fit below the band names speed in limiter.ts and EXCLUDES
 *       durability in the thesis (it cannot name speed; see its header);
 *   4 · inside the band neither module finds a shape limiter.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *   · limiter.ts's OTHER arms (volume floor, recovery gaps, fade) are not
 *     shared and are not checked here; the two modules can still legitimately
 *     name different things when those fire.
 *   · It is pure. Whether `goal-gap.ts` actually hands limiter.ts the SAME raw
 *     exponent the thesis reads is a wiring fact; both read
 *     `resolveRaceExponent().rawFittedExponent`, and `_thesis_golden`'s owner
 *     case prints the thesis side of it.
 */
import { describe, it, expect } from 'vitest';
import { diagnoseLimiter, CURVE_NEUTRAL_EXPONENT_BAND, type LimiterInput } from '@/lib/coach/limiter';
import { composeCoachingThesis, curveShapeFrom } from './coaching-thesis';
import type {
  DurabilityCapacityEstimate, HighIntensityCapacityEstimate, SourceMode, ThresholdCapacityEstimate,
} from './capacity-resolver';

const AT = '2026-09-02T00:00:00.000Z';
const T: ThresholdCapacityEstimate = { paceSecPerMi: 430, vdot: 47.9, confidence: 0.8, sourceMode: 'direct', evidenceIds: ['t1'], resolvedAt: AT, reasons: [], modelVersion: '1.0.0' };
const HI: HighIntensityCapacityEstimate = { intervalPaceSecPerMi: 407, repetitionPaceSecPerMi: 371, vdot: 46.8, confidence: 0.3, sourceMode: 'vdot_fallback', evidenceIds: [], resolvedAt: AT, reasons: [], modelVersion: '1.0.0' };
function dur(raw: number, sourceMode: SourceMode = 'race_derived'): DurabilityCapacityEstimate {
  return {
    enduranceExponent: raw,
    raceExponent: { present: true, value: raw, confidence: 0.6, sourceMode: 'race_derived', evidenceIds: ['a', 'b', 'c'] },
    rawFittedExponent: raw,
    decoupling: { present: false, reason: 'none', observations: 0 },
    confidence: 0.6, sourceMode, evidenceIds: ['a', 'b', 'c'], resolvedAt: AT, reasons: [], modelVersion: '1.0.0',
  };
}
function limiterInput(raw: number): LimiterInput {
  return {
    goalDistanceMi: 26.22, goalPaceSecPerMi: 412, experienceLevel: null, blockProgressFraction: null,
    curve: { exponent: raw, races: 3, provisional: false },
    fadeObservations: null,
    thresholdPaceStartSecPerMi: null, thresholdPaceNowSecPerMi: null, thresholdWindowWeeks: null,
    weeklyMiAtWindowStart: null, recentWeeklyMi: null,
    observedHardDayGaps: null, sessionsMissingPacesInARow: null,
  };
}

describe('LIMITER CONSISTENCY · the thesis and limiter.ts read the race curve the same way', () => {
  it('1 · the thesis reads limiter.ts\'s own band constant, by identity', () => {
    const shape = curveShapeFrom(dur(1.12));
    expect(shape.read).toBe('speed_biased');
    if (shape.read !== 'unavailable') expect(shape.band).toBe(CURVE_NEUTRAL_EXPONENT_BAND);
  });

  it('2 · above the band · thesis DURABILITY, limiter.ts endurance', () => {
    const raw = CURVE_NEUTRAL_EXPONENT_BAND[1] + 0.02;
    const t = composeCoachingThesis({ threshold: T, highIntensity: HI, durability: dur(raw), week: null, todayISO: '2026-09-02' });
    const l = diagnoseLimiter(limiterInput(raw));
    expect(t.primaryLimiter).toBe('DURABILITY');
    expect(t.basis).toBe('CURVE_SHAPE_EVIDENCE');
    expect(l?.primary).toBe('endurance');
  });

  it('3 · below the band · limiter.ts speed_reserve, thesis excludes durability and cannot name speed', () => {
    const raw = CURVE_NEUTRAL_EXPONENT_BAND[0] - 0.02;
    const t = composeCoachingThesis({ threshold: T, highIntensity: HI, durability: dur(raw), week: null, todayISO: '2026-09-02' });
    const l = diagnoseLimiter(limiterInput(raw));
    expect(l?.primary).toBe('speed_reserve');
    expect(t.primaryLimiter).not.toBe('DURABILITY');
    expect(t.primaryLimiter).not.toBe('HIGH_INTENSITY');
    expect(t.heldConstant.find((h) => h.capacity === 'DURABILITY')?.code).toBe('EVIDENCED_STRENGTH_BY_CURVE_SHAPE');
  });

  it('4 · inside the band · neither finds a shape limiter', () => {
    const raw = (CURVE_NEUTRAL_EXPONENT_BAND[0] + CURVE_NEUTRAL_EXPONENT_BAND[1]) / 2;
    const t = composeCoachingThesis({ threshold: T, highIntensity: HI, durability: dur(raw), week: null, todayISO: '2026-09-02' });
    const l = diagnoseLimiter(limiterInput(raw));
    expect(t.curveShape.read).toBe('neutral');
    expect(t.basis).toBe('LOWEST_CONFIDENCE_AMONG_EVIDENCED');
    expect(l?.ranked.some((r) => r.limiter === 'endurance' || r.limiter === 'speed_reserve')).toBe(false);
  });

  it('FALSIFIER · a thesis that ignored the curve (v2\'s rule) disagrees with limiter.ts on the owner-shaped case', () => {
    // v2 picked the least-confident rankable capacity. Reproduced inline so
    // this file keeps proving the disagreement it was written to close.
    const raw = 1.101;
    const d = dur(raw, 'direct');
    const v2Limiter = [{ c: 'THRESHOLD', n: T.confidence }, { c: 'DURABILITY', n: 0.90 }].sort((a, b) => a.n - b.n)[0].c;
    const l = diagnoseLimiter(limiterInput(raw));
    expect(v2Limiter).toBe('THRESHOLD');
    expect(l?.primary).toBe('endurance');
    const v3 = composeCoachingThesis({ threshold: T, highIntensity: HI, durability: { ...d, confidence: 0.9 }, week: null, todayISO: '2026-09-02' });
    expect(v3.primaryLimiter).toBe('DURABILITY');
  });
});
