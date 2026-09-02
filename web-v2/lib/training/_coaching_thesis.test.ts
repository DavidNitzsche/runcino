/**
 * lib/training/_coaching_thesis.test.ts · THE RULE 9 WALK for the Coaching
 * Thesis, plus the doctrine properties the limiter has to hold.
 *
 * The defect these tests were written against, and falsified on before the fix
 * landed (Rule 18):
 *
 *   `rankCapacities` normalized HIGH_INTENSITY's confidence against
 *   `fallbackCeiling` (0.50) because that is all it can ever score, so its
 *   RANKED value was `0.4 + 0.6 · 2^(−vdotAnchorAgeDays/28)` — a pure function
 *   of an unrelated anchor's age. The owner's primary limiter flipped
 *   HIGH_INTENSITY → THRESHOLD between 2026-08-31 and 2026-09-01 with no
 *   high-intensity session run, because a THRESHOLD run refreshed a VDOT
 *   anchor. Test 1 walks that anchor age day by day and test 2 replays the two
 *   real reads.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 *   · IT NEVER TOUCHES A DATABASE. Every case drives the pure `rankCapacities`
 *     / `priorityFor` / `composeCoachLine` exports with hand-built estimates,
 *     so it cannot catch a loader that reads an archived plan version (Rule
 *     14), a week window resolved off the wrong long-run day, or a
 *     `selection_rationale` that never reaches the row.
 *     `_coaching_thesis.audit.test.ts` is the Rule 13 render against real data.
 *   · IT CANNOT SEE WHETHER THE LIMITER IS THE RIGHT COACHING CALL. It checks
 *     that the limiter is STABLE, EVIDENCED and REFUSABLE. Whether "the
 *     evidenced capacity we know least about" is the best available reading of
 *     §F is an argument made in the module header, not a property any test
 *     here can settle.
 *   · IT IS BLIND TO THE DURABILITY DIRECTION QUESTION. The module reports the
 *     race exponent beside the population prior and derives no verdict from
 *     the pair, so there is no classification here to get wrong and no test
 *     that would notice if one appeared without one.
 *   · THE WALK IS ONE-DIMENSIONAL. It moves the VDOT anchor age and holds
 *     everything else fixed. A cliff that needs two inputs to move together is
 *     invisible to it.
 */
import { describe, it, expect } from 'vitest';

import {
  rankCapacities,
  priorityFor,
  composeCoachLine,
  isRankableSourceMode,
  RANKABLE_SOURCE_MODES,
  COACHING_THESIS_MODEL_VERSION,
  type CapacityStanding,
} from './coaching-thesis';
import {
  CAPACITY_CONFIDENCE_BANDS,
  fallbackConfidence,
  type DurabilityCapacityEstimate,
  type HighIntensityCapacityEstimate,
  type SourceMode,
  type ThresholdCapacityEstimate,
} from './capacity-resolver';

const AT = '2026-09-01T00:00:00.000Z';

function threshold(confidence: number, sourceMode: SourceMode = 'direct'): ThresholdCapacityEstimate {
  return {
    paceSecPerMi: 430, vdot: 47.9,
    confidence, sourceMode, evidenceIds: ['t1', 't2', 't3'],
    resolvedAt: AT, reasons: [], modelVersion: '1.0.0',
  };
}

function highIntensity(confidence: number, sourceMode: SourceMode = 'vdot_fallback'): HighIntensityCapacityEstimate {
  return {
    intervalPaceSecPerMi: 407, repetitionPaceSecPerMi: 371, vdot: 46.8,
    confidence, sourceMode, evidenceIds: ['hi1'],
    resolvedAt: AT, reasons: [], modelVersion: '1.0.0',
  };
}

function durability(
  confidence: number,
  sourceMode: SourceMode = 'direct',
  opts: { raceExponent?: number | null; decoupling?: number | null } = {},
): DurabilityCapacityEstimate {
  const exp = opts.raceExponent === undefined ? 1.0869051877057179 : opts.raceExponent;
  const dec = opts.decoupling === undefined ? 6.411111111111112 : opts.decoupling;
  return {
    enduranceExponent: exp ?? 1.06,
    raceExponent: exp == null
      ? { present: false, reason: 'not enough races', observations: 1 }
      : { present: true, value: exp, confidence: 0.62, sourceMode: 'race_derived', evidenceIds: ['la-marathon-2026'] },
    decoupling: dec == null
      ? { present: false, reason: 'no qualifying long runs', observations: 0 }
      : { present: true, value: dec, confidence: 0.90, sourceMode: 'direct', evidenceIds: ['d1'] },
    confidence, sourceMode, evidenceIds: ['la-marathon-2026', 'd1'],
    resolvedAt: AT, reasons: [], modelVersion: '1.0.0',
  };
}

const limiterOf = (standings: CapacityStanding[]) =>
  (standings.find((s) => s.rankable)?.capacity ?? 'UNKNOWN');

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · RULE 9 · the limiter may not move on an unrelated clock
 * ═════════════════════════════════════════════════════════════════════════ */

describe('Rule 9 · the VDOT anchor age walk', () => {
  // The owner's real THRESHOLD and DURABILITY standings on 2026-08-31, held
  // fixed while ONLY the age of the best-recent-VDOT anchor moves. That anchor
  // is what `resolveHighIntensityCapacity`'s fallback confidence decays on, and
  // it is refreshed by ANY qualifying run, threshold ones included.
  const T = threshold(0.7268354752028102);
  const D = durability(0.90);

  it('walks the anchor 0 → 30 days and the primary limiter never changes', () => {
    const today = '2026-09-01';
    const seen = new Set<string>();
    const rows: string[] = [];
    for (let age = 0; age <= 30; age++) {
      const anchor = new Date(Date.parse(`${today}T12:00:00Z`) - age * 86_400_000)
        .toISOString().slice(0, 10);
      // CONSUMED, NEVER RECOMPUTED — this is the engine's own decay curve, so
      // the walk cannot drift from what production does.
      const conf = fallbackConfidence(anchor, today);
      const standings = rankCapacities(T, highIntensity(conf), D);
      seen.add(limiterOf(standings));
      rows.push(`age ${String(age).padStart(2)}d  HI conf ${conf.toFixed(4)}  limiter ${limiterOf(standings)}`);
    }
    expect([...seen], rows.join('\n')).toEqual(['THRESHOLD']);
  });

  it('FALSIFIER · the OLD ceiling-normalized basis DOES flip across the same walk', () => {
    // Rule 18: the walk above is worth nothing unless the thing it watches was
    // once capable of moving. This reproduces the deleted basis inline —
    // confidence divided by each capacity's own reachable ceiling — and shows
    // it changing verdict inside the same 0-30 day window. If this ever stops
    // flipping, the walk above has stopped being a live check and this file is
    // lying about what it proves.
    const today = '2026-09-01';
    const oldBasisLimiter = (hiConf: number): string => {
      const scored = [
        { c: 'THRESHOLD', n: T.confidence / CAPACITY_CONFIDENCE_BANDS.directCeiling },
        { c: 'DURABILITY', n: D.confidence / CAPACITY_CONFIDENCE_BANDS.directCeiling },
        { c: 'HIGH_INTENSITY', n: hiConf / CAPACITY_CONFIDENCE_BANDS.fallbackCeiling },
      ].sort((a, b) => a.n - b.n);
      return scored[0].c;
    };
    const seen = new Set<string>();
    for (let age = 0; age <= 30; age++) {
      const anchor = new Date(Date.parse(`${today}T12:00:00Z`) - age * 86_400_000)
        .toISOString().slice(0, 10);
      seen.add(oldBasisLimiter(fallbackConfidence(anchor, today)));
    }
    expect([...seen].sort()).toEqual(['HIGH_INTENSITY', 'THRESHOLD']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE TWO REAL OWNER READS · captured from the audit, same limiter
 * ═════════════════════════════════════════════════════════════════════════ */

describe('the owner\'s 2026-08-31 and 2026-09-01 reads', () => {
  // Numbers lifted verbatim from
  // docs/reports/independent-coaching-system-audit-2026-09-01/G-real-run-traces.md
  // §0 — both dates, all three capacities, to the digit the trace reports.
  const AUG31 = {
    threshold: threshold(0.7268354752028102),
    highIntensity: highIntensity(0.2914260240653357),
    durability: durability(0.90),
  };
  const SEP01 = {
    threshold: threshold(0.7884089971986553),
    highIntensity: highIntensity(0.500),
    durability: durability(0.90),
  };

  it('produce the SAME primary limiter on both days', () => {
    const a = rankCapacities(AUG31.threshold, AUG31.highIntensity, AUG31.durability);
    const b = rankCapacities(SEP01.threshold, SEP01.highIntensity, SEP01.durability);
    expect(limiterOf(a)).toBe('THRESHOLD');
    expect(limiterOf(b)).toBe('THRESHOLD');
    expect(limiterOf(a)).toBe(limiterOf(b));
  });

  it('rank HIGH_INTENSITY as unrankable on both days, with the reason stated', () => {
    for (const day of [AUG31, SEP01]) {
      const standings = rankCapacities(day.threshold, day.highIntensity, day.durability);
      const hi = standings.find((s) => s.capacity === 'HIGH_INTENSITY')!;
      expect(hi.rankable).toBe(false);
      if (!hi.rankable) expect(hi.reason).toBe('NO_DIRECT_READER');
      // and it is LAST, never the front of the list the limiter is read from.
      expect(standings[standings.length - 1].capacity).toBe('HIGH_INTENSITY');
    }
  });

  it('carry durability\'s own sub-reads through, prior beside fit, no verdict', () => {
    const standings = rankCapacities(SEP01.threshold, SEP01.highIntensity, SEP01.durability);
    const d = standings.find((s) => s.capacity === 'DURABILITY')!;
    expect(d.durability?.raceExponent).toBeCloseTo(1.0869051877057179, 10);
    expect(d.durability?.populationPrior).toBeCloseTo(1.06, 10);
    expect(d.durability?.decouplingPct).toBeCloseTo(6.411111111111112, 10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · RULE 11 · unrankable is a refusal, not a low score
 * ═════════════════════════════════════════════════════════════════════════ */

describe('Rule 11 · unrankable capacities', () => {
  it('every fallback rung is refused and every evidenced rung is admitted', () => {
    const admitted: SourceMode[] = ['direct', 'inferred', 'race_derived'];
    const refused: SourceMode[] = ['vdot_fallback', 'user_prior', 'population_prior'];
    for (const m of admitted) expect(isRankableSourceMode(m), m).toBe(true);
    for (const m of refused) expect(isRankableSourceMode(m), m).toBe(false);
    expect([...RANKABLE_SOURCE_MODES].sort()).toEqual(['direct', 'inferred', 'race_derived']);
  });

  it('a capacity with a HIGHER confidence but a fallback rung still loses to a lower direct one', () => {
    // The exact promotion the removed normalization performed, asserted as a
    // property rather than as a number: evidence class outranks the score.
    const standings = rankCapacities(
      threshold(0.55, 'direct'),
      highIntensity(0.50, 'vdot_fallback'),
      durability(0.90, 'direct'),
    );
    expect(limiterOf(standings)).toBe('THRESHOLD');
    expect(standings[0].capacity).toBe('THRESHOLD');
  });

  it('all three unrankable resolves to UNKNOWN, and there is no confidence to spend', () => {
    const standings = rankCapacities(
      threshold(0.30, 'vdot_fallback'),
      highIntensity(0.30, 'population_prior'),
      durability(0.10, 'population_prior', { raceExponent: null, decoupling: null }),
    );
    expect(standings.every((s) => !s.rankable)).toBe(true);
    expect(limiterOf(standings)).toBe('UNKNOWN');
    expect(priorityFor('UNKNOWN')).toBe('establish_evidence_before_prioritising');
    // Rule 11 as a type: the refusal branch has no `confidence` to read, so a
    // caller cannot spend one by accident. This is the compile-time half,
    // asserted at run time so the property is visible in the report too.
    for (const s of standings) expect('confidence' in s).toBe(false);
  });

  it('a durability standing with no personal exponent says so rather than reporting the prior', () => {
    const standings = rankCapacities(
      threshold(0.72),
      highIntensity(0.29),
      durability(0.70, 'direct', { raceExponent: null }),
    );
    const d = standings.find((s) => s.capacity === 'DURABILITY')!;
    expect(d.durability?.raceExponent).toBeNull();
    expect(d.durability?.populationPrior).toBeCloseTo(1.06, 10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THE COACH LINE · one voice, and it obeys the locked voice rules
 * ═════════════════════════════════════════════════════════════════════════ */

describe('composeCoachLine', () => {
  const held = (capacity: 'THRESHOLD' | 'DURABILITY' | 'HIGH_INTENSITY', code: 'BETTER_EVIDENCED_THAN_THE_LIMITER' | 'NOT_LOOKED_AT_NO_DIRECT_READER') =>
    ({ capacity, code, note: 'n/a' } as const);

  it('says what holds, then where the work goes', () => {
    const line = composeCoachLine('THRESHOLD', [
      held('DURABILITY', 'BETTER_EVIDENCED_THAN_THE_LIMITER'),
      held('HIGH_INTENSITY', 'NOT_LOOKED_AT_NO_DIRECT_READER'),
    ]);
    expect(line).toBe(
      'Your durability is the best evidenced part of your training right now, so it holds. '
      + 'Threshold is where the work goes.',
    );
  });

  it('refuses honestly when there is no limiter', () => {
    const line = composeCoachLine('UNKNOWN', []);
    expect(line).toMatch(/not enough direct evidence/i);
    expect(line).not.toMatch(/limiter is/i);
  });

  it('never carries an em dash, an exclamation mark or an interpunct, and stays at two sentences', () => {
    const cases = [
      composeCoachLine('THRESHOLD', [held('DURABILITY', 'BETTER_EVIDENCED_THAN_THE_LIMITER')]),
      composeCoachLine('DURABILITY', [held('THRESHOLD', 'BETTER_EVIDENCED_THAN_THE_LIMITER')]),
      composeCoachLine('HIGH_INTENSITY', [held('THRESHOLD', 'BETTER_EVIDENCED_THAN_THE_LIMITER')]),
      composeCoachLine('THRESHOLD', [held('HIGH_INTENSITY', 'NOT_LOOKED_AT_NO_DIRECT_READER')]),
      composeCoachLine('UNKNOWN', []),
    ];
    for (const line of cases) {
      expect(line, line).not.toMatch(/[—!·]/);
      expect(line.split('.').filter((s) => s.trim()).length, line).toBeLessThanOrEqual(2);
    }
  });

  it('does not tell the runner about a missing engine reader', () => {
    // The "no direct high-intensity reader" fact is structural
    // (`heldConstant`), not conversational. UX simplification doctrine: it
    // changes nothing the runner does next.
    const line = composeCoachLine('THRESHOLD', [held('HIGH_INTENSITY', 'NOT_LOOKED_AT_NO_DIRECT_READER')]);
    expect(line).not.toMatch(/reader|sourceMode|confidence/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · §F's OWN MAPPING, and the model version
 * ═════════════════════════════════════════════════════════════════════════ */

describe('priority mapping', () => {
  it('follows BRAIN_CONSTITUTION §F\'s worked example', () => {
    expect(priorityFor('DURABILITY')).toBe('increase_long_run_demand');
    expect(priorityFor('THRESHOLD')).toBe('increase_threshold_demand');
    expect(priorityFor('HIGH_INTENSITY')).toBe('increase_high_intensity_demand');
  });

  it('carries a bumped model version, because the ranking basis changed', () => {
    expect(COACHING_THESIS_MODEL_VERSION).toBe('2.0.0');
  });
});
