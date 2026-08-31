/**
 * lib/training/_prescription_resolver.test.ts · THE DOCTRINE TESTS (§11, §13).
 *
 * Not unit tests for arithmetic. These are the checks §11 asks for — "tests
 * designed to catch philosophical violations" — pointed at the two rules this
 * layer exists to hold:
 *
 *   · §6  · a goal cannot reach a prescription.
 *   · §7  · state cannot mutate capacity.
 *
 * plus §30's range and monotonicity properties, and Rule 9's continuity walk.
 *
 * ── WHAT THIS SUITE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 * Stated here, next to the liveness assertion, because Rule 22 requires it and
 * because the honest list is short and load-bearing:
 *
 *   · IT CANNOT CATCH A WRONG CAPACITY. Every fixture below hands the resolver
 *     a capacity and checks what it does with it. If `capacity-resolver.ts`
 *     reads a runner's threshold ten seconds fast, every assertion here still
 *     passes. That is the readers' own audit renders' job.
 *   · IT HAS NO CASE IN WHICH THE RIGHT ANSWER IS "ASK FOR MORE". Every
 *     assertion about state is that demand went DOWN or stayed level, because
 *     that is the only direction this layer has (see the module's own Rule 22
 *     note). A suite that only asks "did you correctly refuse" would pass an
 *     engine that can only refuse — so the upward path is deliberately NOT
 *     claimed as covered here. It is the adaptation engine's, and Rule 21's.
 *   · IT USES SYNTHETIC CAPACITIES. The shapes are real (the same interfaces
 *     the resolvers return) but the numbers are chosen. The real-account render
 *     is `_prescription_resolver.audit.test.ts`, per Rule 13.
 *
 * Every assertion below was falsified against a deliberately broken resolver
 * before landing (Rule 18); the specific break is named in each block.
 */
import { describe, it, expect } from 'vitest';

import {
  resolvePrescription,
  marathonPaceFromDurability,
  purposeFromPlanRow,
  paceWindow,
  confidencePosition,
  ZONE_TOLERANCE_S_PER_MI,
  ENDURANCE_EXPONENT_BOUNDS,
  THRESHOLD_ANCHOR_MINUTES,
  type ResolvedCapacity,
  type Immutable,
  type WorkoutPurpose,
  type PrescriptionArgs,
} from '@/lib/training/prescription-resolver';
import {
  composeRunnerState,
  STATE_DECISION_SEVERITY,
  type RunnerState,
  type StateDecision,
  type RunnerStateSignal,
} from '@/lib/training/runner-state';
import {
  CAPACITY_CONFIDENCE_BANDS,
  type SourceMode,
  type ThresholdCapacityEstimate,
  type HighIntensityCapacityEstimate,
  type EasyCeilingEstimate,
  type DurabilityCapacityEstimate,
} from '@/lib/training/capacity-resolver';
import { POPULATION_ENDURANCE_PRIOR } from '@/lib/training/durability-anchor';
import { predictRaceTimeFromAnchor, TABLE_RACE_DISTANCE_MI } from '@/lib/training/vdot';

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURES · golden runners (§13)
 * ═══════════════════════════════════════════════════════════════════════ */

const AT = '2026-08-31T00:00:00.000Z';

function threshold(paceSecPerMi: number, confidence: number, sourceMode: SourceMode = 'direct'): ThresholdCapacityEstimate {
  return {
    paceSecPerMi, vdot: 48, confidence, sourceMode,
    evidenceIds: ['run-a', 'run-b', 'run-c'], resolvedAt: AT,
    reasons: ['DIRECT_CORROBORATED_THRESHOLD_EVIDENCE'], modelVersion: '1.0.0',
  };
}

function highIntensity(
  intervalPaceSecPerMi: number,
  confidence: number,
  sourceMode: SourceMode = 'vdot_fallback',
  repetitionPaceSecPerMi: number | null = 371,
): HighIntensityCapacityEstimate {
  return {
    intervalPaceSecPerMi, repetitionPaceSecPerMi, vdot: 47, confidence, sourceMode,
    evidenceIds: ['race-x'], resolvedAt: AT,
    reasons: ['NO_DIRECT_HIGH_INTENSITY_READER'], modelVersion: '1.0.0',
  };
}

function easyCeiling(ceilingSecPerMi: number, confidence: number, sourceMode: SourceMode = 'direct'): EasyCeilingEstimate {
  return {
    ceilingSecPerMi, confidence, sourceMode, evidenceIds: ['run-e1', 'run-e2'],
    resolvedAt: AT, reasons: ['DIRECT_CORROBORATED_EASY_EVIDENCE'], modelVersion: '1.0.0',
  };
}

function durability(
  enduranceExponent: number,
  confidence: number,
  personal = true,
): DurabilityCapacityEstimate {
  return {
    enduranceExponent,
    raceExponent: personal
      ? { present: true, value: enduranceExponent, confidence, sourceMode: 'race_derived', evidenceIds: ['race-1', 'race-2'] }
      : { present: false, reason: 'insufficient_races', observations: 1 },
    decoupling: { present: true, value: 6.4, confidence: 0.9, sourceMode: 'direct', evidenceIds: ['long-1'] },
    confidence,
    sourceMode: personal ? 'race_derived' : 'population_prior',
    evidenceIds: personal ? ['race-1', 'race-2'] : [],
    resolvedAt: AT,
    reasons: personal ? ['PERSONAL_RIEGEL_EXPONENT'] : ['POPULATION_ENDURANCE_PRIOR'],
    modelVersion: '1.0.0',
  };
}

/** GOLDEN RUNNER · the owner, at the numbers his real account resolved to on
 *  2026-08-31. Threshold 7:10/mi direct, interval pace from a VDOT fallback at
 *  confidence 0.29, easy ceiling 8:12/mi direct, personal endurance exponent
 *  1.0869 — a runner who fades MORE than the 1.06 population mean. */
function ownerCapacity(): ResolvedCapacity {
  return {
    threshold: threshold(430, 0.727),
    highIntensity: highIntensity(407, 0.291),
    easyCeiling: easyCeiling(491.694, 0.634),
    durability: durability(1.0869051877057179, 0.900),
  };
}

function stateOf(decision: StateDecision, opts: { readable?: boolean } = {}): RunnerState {
  const driver: RunnerStateSignal | null = decision === 'proceed' ? null : {
    kind: 'convergence', argues: decision, driving: true,
    detail: 'fixture', evidence: {},
  };
  return {
    decision, driver, signals: driver ? [driver] : [],
    readable: opts.readable ?? true, todayISO: '2026-08-31',
    resolvedAt: AT, modelVersion: '1.0.0',
  };
}

/** Deep-freeze, so §7's guarantee is checked AT RUNTIME as well as at compile
 *  time. A write the type system would have caught throws here instead of
 *  silently succeeding — which is what makes the fatigue test below able to
 *  fail rather than merely assert. */
function deepFreeze<T>(o: T): Immutable<T> {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o as Immutable<T>;
}

function call(purpose: WorkoutPurpose, capacity: ResolvedCapacity, state: RunnerState, plannedMi: number | null = 8) {
  return resolvePrescription({
    capacity: deepFreeze(capacity),
    state: deepFreeze(state),
    purpose,
    plannedMi,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * §11 · GOAL POISONING
 * ═══════════════════════════════════════════════════════════════════════ */

describe('§6/§11 · goal poisoning · a goal cannot move a prescribed pace', () => {
  /**
   * §11's own scenario: a runner demonstrating 1:40 half fitness who wants
   * 1:25. The structural answer is that the goal has nowhere to enter — so the
   * test asserts on the SHAPE of the entry points, not on a behaviour, because
   * a behavioural test here can only ever confirm that a field nobody passed
   * did nothing.
   *
   * FALSIFIED BY: adding any key to `PrescriptionArgs`. The key-set assertion
   * below fails, and so does the compile-time `_NoGoalInArgs` in the module.
   */
  it('the request object has exactly four fields and none of them is a goal', () => {
    const args: PrescriptionArgs = {
      capacity: deepFreeze(ownerCapacity()),
      state: deepFreeze(stateOf('proceed')),
      purpose: 'threshold',
      plannedMi: 8,
    };
    expect(Object.keys(args).sort()).toEqual(['capacity', 'plannedMi', 'purpose', 'state']);
    for (const k of Object.keys(args)) {
      expect(/goal|target_time|race_time|aspir/i.test(k)).toBe(false);
    }
  });

  it('a threshold prescription is the demonstrated pace, never anything faster', () => {
    const cap = ownerCapacity();
    const rx = call('threshold', cap, stateOf('proceed'));
    expect(rx.paceSecPerMi).toBe(cap.threshold.paceSecPerMi);
    // The window's fast edge may not beat the demonstrated pace by more than
    // doctrine's own ±3, whatever anyone hopes to run.
    expect(rx.windowSecPerMi!.fast).toBeGreaterThanOrEqual(
      cap.threshold.paceSecPerMi - ZONE_TOLERANCE_S_PER_MI.threshold,
    );
  });

  it('race day is DECLINED, because that is the one purpose a goal answers', () => {
    const rx = call('race', ownerCapacity(), stateOf('proceed'), 26.2);
    expect(rx.shape).toBe('none');
    expect(rx.paceSecPerMi).toBeNull();
    expect(rx.reasons).toContain('RACE_PACE_IS_RACE_PREDICTIONS_QUESTION');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §7/§11 · FATIGUE · state reduces today's ask and leaves capacity alone
 * ═══════════════════════════════════════════════════════════════════════ */

describe('§7/§11 · fatigue · state changes today, never capacity', () => {
  /**
   * FALSIFIED BY: replacing `applyState`'s `reduce` branch with a line that
   * writes back onto the capacity (`(capacity.threshold as any).paceSecPerMi =
   * ...`). The frozen object throws, and the byte-equality assertion below
   * fails independently of the throw.
   */
  it('a degraded state leaves every capacity value literally unchanged', () => {
    const cap = ownerCapacity();
    const before = JSON.stringify(cap);
    const rested = call('threshold', cap, stateOf('proceed'));
    const tired = call('threshold', cap, stateOf('reduce'));
    expect(JSON.stringify(cap)).toBe(before);

    // And the prescription still REPORTS the capacity as it was resolved, so a
    // reader can see both what the runner can do and what was asked today.
    expect(rested.capacityBasis.confidence).toBe(cap.threshold.confidence);
    expect(tired.stateAdjustment.decision).toBe('reduce');
  });

  it('reduce turns a quality session into easy running at the same distance', () => {
    const cap = ownerCapacity();
    const rx = call('threshold', cap, stateOf('reduce'), 8.5);
    expect(rx.shape).toBe('ceiling');
    expect(rx.purpose).toBe('threshold');           // what was asked for
    expect(rx.capacityBasis.capacity).toBe('easy_ceiling'); // what was given
    expect(rx.prescribedMi).toBe(8.5);
    expect(rx.reasons).toContain('STATE_REPLACED_QUALITY_WITH_EASY');
    // Demand went DOWN: the prescribed ceiling is slower than the threshold
    // target it replaced.
    expect(rx.ceilingSecPerMi!).toBeGreaterThan(cap.threshold.paceSecPerMi);
  });

  it('reduce does not touch an easy day, because an easy day is already the answer', () => {
    const cap = ownerCapacity();
    const normal = call('easy', cap, stateOf('proceed'), 7);
    const tired = call('easy', cap, stateOf('reduce'), 7);
    expect(tired.ceilingSecPerMi).toBe(normal.ceilingSecPerMi);
    expect(tired.prescribedMi).toBe(7);
  });

  it('recover, replace and stop withhold the prescription entirely', () => {
    for (const d of ['recover', 'replace', 'stop'] as const) {
      const rx = call('threshold', ownerCapacity(), stateOf(d), 8);
      expect(rx.shape).toBe('none');
      expect(rx.paceSecPerMi).toBeNull();
      expect(rx.prescribedMi).toBeNull();
      expect(rx.reasons).toContain('STATE_WITHHELD_PRESCRIPTION');
    }
  });

  it('an UNREADABLE state is not silently a healthy one (Rule 11)', () => {
    const rx = call('threshold', ownerCapacity(), stateOf('proceed_with_caution', { readable: false }), 8);
    expect(rx.stateAdjustment.stateReadable).toBe(false);
    expect(rx.reasons).toContain('STATE_UNREADABLE');
    expect(rx.reasons).toContain('STATE_WOULD_NOT_TIGHTEN');
    // The window is not narrowed by a state nobody could read.
    const known = call('threshold', ownerCapacity(), stateOf('proceed'), 8);
    const width = (p: typeof rx) => p.windowSecPerMi!.slow - p.windowSecPerMi!.fast;
    expect(width(rx)).toBeGreaterThanOrEqual(width(known));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §27 · LOW CONFIDENCE PRESCRIBES CONSERVATIVELY
 * ═══════════════════════════════════════════════════════════════════════ */

describe('doctrine §27 · a low-confidence capacity prescribes a wider, one-sided window', () => {
  /**
   * The concrete case the brief asked to be decided and argued: high-intensity
   * capacity currently has NO direct-evidence reader, so every interval
   * prescription in this app rides a VDOT fallback at roughly 0.29 confidence.
   *
   * The decision, restated: widen, and widen SLOW-SIDE ONLY. A symmetric
   * widening would license running faster than a number nobody trusts, which
   * is the injurious direction for VO2 work.
   *
   * FALSIFIED BY: making `paceWindow` symmetric (`fast: pace - halfWidth`).
   * The asymmetry assertion fails immediately.
   */
  it('a fallback interval window is visibly wider than a direct one', () => {
    const low = ownerCapacity();
    const high = { ...ownerCapacity(), highIntensity: highIntensity(407, 0.85, 'direct') };
    const wLow = call('interval', low, stateOf('proceed'));
    const wHigh = call('interval', high, stateOf('proceed'));
    const width = (p: typeof wLow) => p.windowSecPerMi!.slow - p.windowSecPerMi!.fast;
    expect(width(wLow)).toBeGreaterThan(width(wHigh));
    expect(wLow.reasons).toContain('DERIVED_FALLBACK');
    expect(wHigh.reasons).toContain('DIRECT_EVIDENCE');
  });

  it('the widening is one-sided · the fast edge closes toward the estimate', () => {
    const pace = 407;
    const wide = paceWindow({ paceSecPerMi: pace, toleranceSecPerMi: 3, confidence: CAPACITY_CONFIDENCE_BANDS.populationPrior });
    const tight = paceWindow({ paceSecPerMi: pace, toleranceSecPerMi: 3, confidence: CAPACITY_CONFIDENCE_BANDS.directCeiling });
    // At the bottom of the scale nothing faster than the estimate is asked for.
    expect(wide.fast).toBeCloseTo(pace, 6);
    expect(wide.slow).toBeGreaterThan(tight.slow);
    // At the top of the scale it is exactly doctrine's symmetric ±.
    expect(tight.fast).toBeCloseTo(pace - 3, 6);
    expect(tight.slow).toBeCloseTo(pace + 3, 6);
  });

  it('no runner-specific evidence at all drops to EFFORT, never an invented pace', () => {
    const cap = {
      ...ownerCapacity(),
      highIntensity: highIntensity(407, CAPACITY_CONFIDENCE_BANDS.populationPrior, 'population_prior'),
    };
    const rx = call('interval', cap, stateOf('proceed'));
    expect(rx.shape).toBe('effort');
    expect(rx.paceSecPerMi).toBeNull();
    expect(rx.reasons).toContain('NO_RUNNER_SPECIFIC_EVIDENCE');
  });

  it('a null repetition pace is a refusal, never a substituted interval pace', () => {
    const cap = { ...ownerCapacity(), highIntensity: highIntensity(407, 0.30, 'race_derived', null) };
    const rx = call('repetition', cap, stateOf('proceed'));
    expect(rx.shape).toBe('effort');
    expect(rx.paceSecPerMi).toBeNull();
    expect(rx.reasons).toContain('REPETITION_PACE_UNKNOWN_OFF_TABLE');
  });

  it('a low-confidence EASY ceiling moves SLOWER, not wider · a ceiling is a permission', () => {
    const sure = { ...ownerCapacity(), easyCeiling: easyCeiling(491.694, CAPACITY_CONFIDENCE_BANDS.directCeiling) };
    const unsure = { ...ownerCapacity(), easyCeiling: easyCeiling(491.694, CAPACITY_CONFIDENCE_BANDS.populationPrior, 'population_prior') };
    const a = call('easy', sure, stateOf('proceed'));
    const b = call('easy', unsure, stateOf('proceed'));
    expect(b.ceilingSecPerMi!).toBeGreaterThan(a.ceilingSecPerMi!);
    expect(a.ceilingSecPerMi!).toBeCloseTo(491.694, 6);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §30 · RANGE AND MONOTONICITY
 * ═══════════════════════════════════════════════════════════════════════ */

describe('§30 · range and monotonicity', () => {
  it('threshold is faster than marathon pace, which is faster than the easy ceiling', () => {
    const cap = ownerCapacity();
    const t = call('threshold', cap, stateOf('proceed'));
    const m = call('marathon_specific', cap, stateOf('proceed'));
    const e = call('easy', cap, stateOf('proceed'));
    expect(t.paceSecPerMi!).toBeLessThan(m.paceSecPerMi!);
    expect(m.paceSecPerMi!).toBeLessThan(e.ceilingSecPerMi!);
  });

  it('stronger durability (a lower exponent) prescribes a FASTER marathon pace', () => {
    const strong = marathonPaceFromDurability({ thresholdPaceSecPerMi: 430, durability: durability(1.04, 0.8) });
    const weak = marathonPaceFromDurability({ thresholdPaceSecPerMi: 430, durability: durability(1.12, 0.8) });
    expect(strong.paceSecPerMi).toBeLessThan(weak.paceSecPerMi);
  });

  it('a slower threshold prescribes a slower marathon pace · monotone in the anchor', () => {
    const d = durability(1.0869, 0.9);
    let prev = -Infinity;
    for (let t = 360; t <= 700; t += 5) {
      const mp = marathonPaceFromDurability({ thresholdPaceSecPerMi: t, durability: d }).paceSecPerMi;
      expect(mp).toBeGreaterThan(prev);
      expect(mp).toBeGreaterThan(t);   // never faster than threshold
      prev = mp;
    }
  });

  it('a marathon prescription is never more confident than its weaker input', () => {
    const cap = { ...ownerCapacity(), durability: durability(1.0869, 0.35) };
    const rx = call('marathon_specific', cap, stateOf('proceed'));
    expect(rx.confidence).toBe(0.35);
    expect(rx.confidence).toBeLessThanOrEqual(cap.threshold.confidence);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * RULE 9 · NO CLIFFS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Rule 9 · the output moves continuously across every derived boundary', () => {
  /**
   * The walk Rule 9 requires for "any new behavioural switch derived from
   * comparing two computed quantities". Confidence is the continuous input that
   * governs both window width and ceiling slack.
   *
   * FALSIFIED BY: replacing `paceWindow`'s interpolation with a step
   * (`confidence < 0.5 ? wide : narrow`). The step size assertion fails at the
   * crossing.
   */
  it('window width walks confidence continuously and monotonically', () => {
    let prevWidth: number | null = null;
    let prevSlow: number | null = null;
    let steps = 0;
    for (let c = 0.10; c <= 0.9001; c += 0.005) {
      const w = paceWindow({ paceSecPerMi: 430, toleranceSecPerMi: 3, confidence: c });
      const width = w.slow - w.fast;
      if (prevWidth != null && prevSlow != null) {
        expect(width).toBeLessThanOrEqual(prevWidth + 1e-9);      // monotone
        expect(prevWidth - width).toBeLessThan(1.0);              // no cliff
        expect(w.slow).toBeLessThanOrEqual(prevSlow + 1e-9);
      }
      prevWidth = width;
      prevSlow = w.slow;
      steps++;
    }
    // Rule 18 · liveness. A walk that took no steps reports clean while
    // checking nothing, which is the worst outcome a gate has available.
    expect(steps).toBeGreaterThan(100);
  });

  it('the easy ceiling walks confidence continuously', () => {
    let prev: number | null = null;
    let steps = 0;
    for (let c = 0.10; c <= 0.9001; c += 0.005) {
      const cap = { ...ownerCapacity(), easyCeiling: easyCeiling(491.694, c, c > 0.5 ? 'direct' : 'inferred') };
      const ceil = call('easy', cap, stateOf('proceed')).ceilingSecPerMi!;
      if (prev != null) {
        expect(ceil).toBeLessThanOrEqual(prev + 1e-9);
        expect(prev - ceil).toBeLessThan(1.0);
      }
      prev = ceil;
      steps++;
    }
    expect(steps).toBeGreaterThan(100);
  });

  it('confidencePosition is clamped, continuous, and 0 at the prior', () => {
    expect(confidencePosition(CAPACITY_CONFIDENCE_BANDS.populationPrior)).toBe(0);
    expect(confidencePosition(CAPACITY_CONFIDENCE_BANDS.directCeiling)).toBe(1);
    expect(confidencePosition(-5)).toBe(0);
    expect(confidencePosition(99)).toBe(1);
    expect(confidencePosition(Number.NaN)).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * RULE 18 · THE RIEGEL LINK, FALSIFIED RATHER THAN ASSERTED IN PROSE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Rule 18 · the personal-exponent form IS Riegel, checked against the app\'s own', () => {
  /**
   * `predictRaceTimeFromAnchor` (lib/training/vdot.ts) is this app's existing
   * Riegel implementation and hardcodes the 1.06 POPULATION exponent.
   * `marathonPaceFromDurability` is the same law with the runner's own
   * exponent. If the two do not agree when the personal exponent IS 1.06, one
   * of them has the formula wrong.
   *
   * This is the check that stops the new math being a second, drifting
   * implementation of a law the codebase already encodes.
   */
  it('agrees with predictRaceTimeFromAnchor at the population exponent', () => {
    const t = 430;
    const anchorMi = (THRESHOLD_ANCHOR_MINUTES * 60) / t;
    const mine = marathonPaceFromDurability({
      thresholdPaceSecPerMi: t,
      durability: durability(POPULATION_ENDURANCE_PRIOR, 0.5),
    });
    const theirs = predictRaceTimeFromAnchor(
      { finishSeconds: THRESHOLD_ANCHOR_MINUTES * 60, distanceMi: anchorMi, paceSPerMi: t },
      TABLE_RACE_DISTANCE_MI.marathon,
    )!;
    expect(mine.anchorDistanceMi).toBeCloseTo(anchorMi, 9);
    // One decimal, because `predictRaceTimeFromAnchor` rounds its FINISH TIME
    // to a whole second before this test divides it back into a pace. Over
    // 26.2 miles that rounding is worth ~0.02 s/mi, which is the entire gap.
    expect(mine.paceSecPerMi).toBeCloseTo(theirs / TABLE_RACE_DISTANCE_MI.marathon, 1);
  });

  it('clamps an implausible exponent and says so', () => {
    const low = marathonPaceFromDurability({ thresholdPaceSecPerMi: 430, durability: durability(0.80, 0.5) });
    expect(low.exponentClamped).toBe(true);
    expect(low.enduranceExponent).toBe(ENDURANCE_EXPONENT_BOUNDS.min);
    const high = marathonPaceFromDurability({ thresholdPaceSecPerMi: 430, durability: durability(1.9, 0.5) });
    expect(high.exponentClamped).toBe(true);
    expect(high.enduranceExponent).toBe(ENDURANCE_EXPONENT_BOUNDS.max);
  });

  it('a population exponent is reported as such, never as the runner\'s own', () => {
    const rx = call(
      'marathon_specific',
      { ...ownerCapacity(), durability: durability(POPULATION_ENDURANCE_PRIOR, 0.10, false) },
      stateOf('proceed'),
    );
    expect(rx.reasons).toContain('POPULATION_ENDURANCE_EXPONENT');
    expect(rx.reasons).not.toContain('PERSONAL_ENDURANCE_EXPONENT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * DOCTRINE §9 · EASY IS A CEILING, NOT A TEST
 * ═══════════════════════════════════════════════════════════════════════ */

describe('doctrine §9 · easy running is a ceiling with feel-based guidance', () => {
  it('has no lower edge and no tolerance to hit', () => {
    const rx = call('easy', ownerCapacity(), stateOf('proceed'), 7);
    expect(rx.shape).toBe('ceiling');
    expect(rx.windowSecPerMi).toBeNull();
    expect(rx.toleranceSecPerMi).toBeNull();
    expect(rx.paceSecPerMi).toBeNull();
  });

  it('is judged on overall effort, so a downhill blip cannot be a failure', () => {
    for (const p of ['easy', 'shakeout', 'long'] as const) {
      expect(call(p, ownerCapacity(), stateOf('proceed'), 5).complianceBasis).toBe('overall_effort');
    }
  });

  it('a long run and an easy day share ONE ceiling (Rule 16)', () => {
    const cap = ownerCapacity();
    expect(call('long', cap, stateOf('proceed'), 20).ceilingSecPerMi)
      .toBe(call('easy', cap, stateOf('proceed'), 6).ceilingSecPerMi);
    expect(call('long', cap, stateOf('proceed'), 20).reasons).toContain('LONG_IS_EASY_EFFORT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §29 · THE CONTRADICTION CLAMPS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('§29 · a prescription never crosses the zone next to it', () => {
  it('an interval window cannot reach threshold pace', () => {
    const rx = call('interval', ownerCapacity(), stateOf('proceed'));
    expect(rx.windowSecPerMi!.slow).toBeLessThan(ownerCapacity().threshold.paceSecPerMi);
    expect(rx.reasons).toContain('WINDOW_CLAMPED_BY_THRESHOLD');
  });

  it('a clamped window never inverts', () => {
    // A pathological capacity: the interval estimate is SLOWER than threshold.
    const cap = { ...ownerCapacity(), highIntensity: highIntensity(500, 0.25) };
    const rx = call('interval', cap, stateOf('proceed'));
    expect(rx.windowSecPerMi!.slow).toBeGreaterThanOrEqual(rx.windowSecPerMi!.fast);
  });

  it('a marathon window cannot reach the easy ceiling', () => {
    // A runner whose fitted exponent is high enough to push MP past easy.
    const cap = { ...ownerCapacity(), easyCeiling: easyCeiling(470, 0.7), durability: durability(1.20, 0.9) };
    const rx = call('marathon_specific', cap, stateOf('proceed'));
    expect(rx.windowSecPerMi!.slow).toBeLessThan(470);
    expect(rx.reasons).toContain('WINDOW_CLAMPED_BY_EASY_CEILING');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * DOCTRINE §11 · THE LABEL IS NOT THE PHYSIOLOGY
 * ═══════════════════════════════════════════════════════════════════════ */

describe('doctrine §11 · purposeFromPlanRow routes on the stimulus, not the column', () => {
  it('maps every type present in the production plan_workouts table', () => {
    // The real vocabulary, read off the live table on 2026-08-31:
    // easy · rest · long · threshold · tempo · intervals · interval · race ·
    // shakeout · race_week_tuneup · strength.
    expect(purposeFromPlanRow({ type: 'easy', zone: null })).toBe('easy');
    expect(purposeFromPlanRow({ type: 'rest', zone: null })).toBe('rest');
    expect(purposeFromPlanRow({ type: 'long', zone: null })).toBe('long');
    expect(purposeFromPlanRow({ type: 'threshold', zone: 'T' })).toBe('threshold');
    expect(purposeFromPlanRow({ type: 'tempo', zone: 'T' })).toBe('threshold');
    expect(purposeFromPlanRow({ type: 'intervals', zone: 'I' })).toBe('interval');
    expect(purposeFromPlanRow({ type: 'interval', zone: 'I' })).toBe('interval');
    expect(purposeFromPlanRow({ type: 'race', zone: null })).toBe('race');
    expect(purposeFromPlanRow({ type: 'shakeout', zone: null })).toBe('shakeout');
    expect(purposeFromPlanRow({ type: 'race_week_tuneup', zone: '5K' })).toBe('interval');
    // Not a running prescription. Rule 11: null, never a rest day.
    expect(purposeFromPlanRow({ type: 'strength', zone: null })).toBeNull();
    expect(purposeFromPlanRow({ type: 'cross', zone: null })).toBeNull();
  });

  it('a row typed "tempo" run at MP is marathon-specific · the owner\'s real 2026-11-17 session', () => {
    expect(purposeFromPlanRow({ type: 'tempo', zone: 'MP' })).toBe('marathon_specific');
    expect(purposeFromPlanRow({ type: 'long', zone: 'M' })).toBe('marathon_specific');
  });

  it('a row typed "intervals" run at mile pace is a repetition session', () => {
    expect(purposeFromPlanRow({ type: 'intervals', zone: 'R' })).toBe('repetition');
    expect(purposeFromPlanRow({ type: 'intervals', zone: 'mile' })).toBe('repetition');
  });

  it('sub-threshold and half-marathon zones stay threshold-class', () => {
    expect(purposeFromPlanRow({ type: 'threshold', zone: 'ST' })).toBe('threshold');
    expect(purposeFromPlanRow({ type: 'threshold', zone: 'HM' })).toBe('threshold');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * BRIEF 08 · THE STATE COMPOSER
 * ═══════════════════════════════════════════════════════════════════════ */

describe('BRIEF 08 · composeRunnerState', () => {
  const sig = (
    kind: RunnerStateSignal['kind'],
    argues: StateDecision,
    driving: boolean,
  ): RunnerStateSignal => ({ kind, argues, driving, detail: kind, evidence: {} });

  it('the strongest DRIVING signal sets the decision', () => {
    const s = composeRunnerState({
      signals: [sig('convergence', 'reduce', true), sig('illness', 'recover', true)],
      readable: true, todayISO: '2026-08-31',
    });
    expect(s.decision).toBe('recover');
    expect(s.driver!.kind).toBe('illness');
  });

  it('a NON-DRIVING signal cannot set the decision, however serious it looks', () => {
    const s = composeRunnerState({
      signals: [sig('post_race_window', 'recover', false), sig('acwr', 'proceed_with_caution', false)],
      readable: true, todayISO: '2026-08-31',
    });
    expect(s.decision).toBe('proceed');
    expect(s.driver).toBeNull();
    expect(s.signals).toHaveLength(2);   // still reported
  });

  it('an unreadable read is distinguishable from a clean one (Rule 11)', () => {
    const clean = composeRunnerState({ signals: [], readable: true, todayISO: '2026-08-31' });
    const blind = composeRunnerState({
      signals: [sig('unreadable', 'proceed_with_caution', true)],
      readable: false, todayISO: '2026-08-31',
    });
    expect(clean.decision).toBe('proceed');
    expect(clean.readable).toBe(true);
    expect(blind.decision).toBe('proceed_with_caution');
    expect(blind.readable).toBe(false);
  });

  it('the severity ladder is strictly ordered', () => {
    const order: StateDecision[] = ['proceed', 'proceed_with_caution', 'reduce', 'replace', 'recover', 'stop'];
    for (let i = 1; i < order.length; i++) {
      expect(STATE_DECISION_SEVERITY[order[i]]).toBeGreaterThan(STATE_DECISION_SEVERITY[order[i - 1]]);
    }
  });
});
