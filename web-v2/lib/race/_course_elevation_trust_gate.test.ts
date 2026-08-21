/**
 * 2026-08-21 · race-data source-of-truth re-audit · REGRESSION LOCK.
 *
 * THE TRUST GATE WAS DEAD. `resolveCourseElevation` computed a `confidence`,
 * returned it, and unit-tested it — and not one consumer read it. Every
 * consumer took `elevationGainFt` / `netElevationFt` bare.
 *
 * That mattered because of the `|| !hasCurated` arm of the resolver: when
 * there is no curated `course_library` row — the common case for a race the
 * runner added themselves — a LOW-confidence trace ships as the authoritative
 * value. "Low" here is not a shade of doubt, it is self-refuting. The two
 * reasons that produce it are, verbatim from `assessGeometryConfidence`:
 *
 *   "only N elevation samples per mile — too coarse for gross gain"
 *   "N m gap between consecutive points — signal dropout"
 *
 * That number then became SECONDS in the Targets goal-gap arithmetic
 * (`app/api/targets/projection/route.ts` → `computeCourseImpact`) and the
 * `course_elevation` / `net_downhill` detractors in
 * `lib/race/representativeness-inputs.ts` → `representativeness.ts`, which
 * price how much of a race's shortfall was the day rather than fitness — and
 * so decide whether that race re-anchors the whole fitness model.
 *
 * The resolver's PRECEDENCE is unchanged (a low-confidence trace still beats
 * nothing, and is still shown). The gate lives at the consumers, per CLAUDE.md
 * §"Per-finding context filters": the resolver says what the best available
 * value IS; each consumer still has to ask whether it is good enough for what
 * IT does with the value.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveCourseElevation,
  elevationIsTrustedForAdjustment,
  type StoredGeometry,
} from './course-elevation';
import { computeCourseImpact } from '@/lib/training/course-impact';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HM_MI = 13.1094;
const HM_M = HM_MI * 1609.344;
const DEG_PER_M = 1 / 111_320;

/**
 * A track down a meridian, `n` samples, climbing then descending so the
 * profile carries real gross gain. `n` controls samples-per-mile, which is the
 * single knob `assessGeometryConfidence` degrades on.
 */
function meridianTrack(n: number): StoredGeometry {
  const trackPoints = Array.from({ length: n }, (_, i) => {
    const f = i / (n - 1);
    return {
      lat: 34 + f * HM_M * DEG_PER_M,
      lon: -118,
      // 0 → 120 m → 0. Gross gain ≈ 120 m ≈ 394 ft, net ≈ 0.
      ele: 120 * (1 - Math.abs(2 * f - 1)),
    };
  });
  return { trackPoints } as StoredGeometry;
}

/** No curated row — the case that reaches the resolver's `|| !hasCurated` arm. */
const NO_LIB = null;

describe('assessGeometryConfidence · the fixtures really are what the gate is about', () => {
  it('a dense track is high confidence and measured', () => {
    const r = resolveCourseElevation({
      lib: NO_LIB, geometry: meridianTrack(2000), nominalDistanceMi: HM_MI,
    });
    expect(r.provenance).toBe('measured');
    expect(r.confidence).toBe('high');
    expect(r.elevationGainFt).not.toBeNull();
  });

  it('a SPARSE track still ships as `measured` with a real number on it', () => {
    // This is the exposure, stated plainly: the resolver hands out an
    // authoritative-looking value off a trace it has just called too coarse.
    const r = resolveCourseElevation({
      lib: NO_LIB, geometry: meridianTrack(120), nominalDistanceMi: HM_MI,
    });
    expect(r.confidence).toBe('low');
    expect(r.provenance).toBe('measured');
    expect(r.geometry?.reasons.join(' ')).toMatch(/too coarse for gross gain/);
    expect(r.elevationGainFt).not.toBeNull();
    expect(r.elevationGainFt).toBeGreaterThan(0);
  });
});

describe('elevationIsTrustedForAdjustment · the gate itself', () => {
  const cases: Array<[string, boolean]> = [
    ['high', true], ['medium', true], ['low', false], ['reject', false], ['unknown', false],
  ];
  for (const [confidence, expected] of cases) {
    it(`${confidence} → ${expected ? 'trusted' : 'NOT trusted'} for moving a number`, () => {
      expect(elevationIsTrustedForAdjustment({ confidence } as never)).toBe(expected);
    });
  }
});

describe('a low-trust course cannot quietly change a projection', () => {
  const GOAL_SEC = 3 * 3600; // 3:00 half — a round number, the arithmetic is the point

  it('UNGATED, the coarse trace really did put seconds in the goal gap', () => {
    // The pre-fix composition, written out so the regression is falsifiable
    // rather than asserted. If this ever stops producing seconds the fixture
    // has drifted and the gate below is proving nothing.
    const r = resolveCourseElevation({
      lib: NO_LIB, geometry: meridianTrack(120), nominalDistanceMi: HM_MI,
    });
    const ungated = computeCourseImpact(
      { distanceMi: HM_MI, goalSec: GOAL_SEC, elevationGainFt: r.elevationGainFt, netElevationFt: r.netElevationFt },
      'crowd',
    );
    expect(ungated.seconds).not.toBeNull();
    expect(ungated.seconds!).toBeGreaterThan(0);
  });

  it('GATED, the same trace prices at nothing rather than at a guess', () => {
    const r = resolveCourseElevation({
      lib: NO_LIB, geometry: meridianTrack(120), nominalDistanceMi: HM_MI,
    });
    const trusted = elevationIsTrustedForAdjustment(r);
    expect(trusted).toBe(false);
    const gated = computeCourseImpact(
      {
        distanceMi: HM_MI, goalSec: GOAL_SEC,
        elevationGainFt: trusted ? r.elevationGainFt : null,
        netElevationFt: trusted ? r.netElevationFt : null,
      },
      trusted ? 'crowd' : null,
    );
    // RULE THREE · a refusal is a correct answer. `seconds: null` hides the
    // chunk; it does not print a confident zero.
    expect(gated.seconds).toBeNull();
  });

  it('a TRUSTED course is still priced · the gate refuses noise, not elevation', () => {
    const r = resolveCourseElevation({
      lib: NO_LIB, geometry: meridianTrack(2000), nominalDistanceMi: HM_MI,
    });
    expect(elevationIsTrustedForAdjustment(r)).toBe(true);
    const impact = computeCourseImpact(
      { distanceMi: HM_MI, goalSec: GOAL_SEC, elevationGainFt: r.elevationGainFt, netElevationFt: r.netElevationFt },
      'crowd',
    );
    expect(impact.seconds).not.toBeNull();
    expect(impact.seconds!).toBeGreaterThan(0);
  });
});

/**
 * WIRED · the same idiom `lib/doctrine/_doctrine_gate.test.ts` uses. A gate
 * that exists and is not called at the two arithmetic consumers is exactly the
 * defect this file was written about, so the assertion has to be about the
 * call sites and not only about the function.
 */
describe('the gate is actually called where a number gets moved', () => {
  const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('representativeness-inputs gates the detractor inputs', () => {
    const s = src('lib/race/representativeness-inputs.ts');
    expect(s).toMatch(/elevationIsTrustedForAdjustment\(resolvedElev\)/);
    expect(s).toMatch(/const elevationGainFt = elevTrusted \? resolvedElev\.elevationGainFt : null;/);
    expect(s).toMatch(/const netElevationFt = elevTrusted \? resolvedElev\.netElevationFt : null;/);
  });

  it('the targets projection gates the seconds it puts in the gap', () => {
    const s = src('app/api/targets/projection/route.ts');
    expect(s).toMatch(/elevationIsTrustedForAdjustment\(resolvedElev\)/);
    expect(s).toMatch(/elevationGainFt: elevTrusted \? resolvedElev\.elevationGainFt : null/);
    expect(s).toMatch(/netElevationFt: elevTrusted \? resolvedElev\.netElevationFt : null/);
  });
});
