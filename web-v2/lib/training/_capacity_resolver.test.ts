/**
 * lib/training/_capacity_resolver.test.ts · THE DOCTRINE TESTS for the runner
 * model's ownership layer (`lib/training/capacity-resolver.ts`).
 *
 * Not unit tests of arithmetic. These are the checks
 * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §10-11 asks for —
 * tests designed to catch PHILOSOPHICAL violations, which is a different thing
 * from tests that check a number:
 *
 *   1 · GOAL ISOLATION (§6, §10)         — a goal cannot reach a capacity read
 *   2 · SOURCE-MODE PRESENCE (§17)       — every estimate says which rung it is
 *   3 · LADDER FALSIFICATION (Rule 18)   — the ladder FALLS THROUGH, and a
 *                                          refusal is never dressed as an answer
 *   4 · CONFIDENCE MONOTONICITY (§30)    — more/better evidence never lowers
 *                                          confidence, all else equal
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22, stated as the rule requires) ────
 *
 *   · IT NEVER TOUCHES A DATABASE. Every test here drives the pure `compose*`
 *     functions with hand-built reads, so it cannot catch a loader that fetches
 *     the wrong rows, a query that reads an archived plan version (Rule 14), or
 *     a reader whose SQL silently returns nothing. `_capacity_resolver.audit.test.ts`
 *     is the Rule 13 render that exercises the real loaders against real data;
 *     a green run HERE is evidence about the composition logic only.
 *   · IT CANNOT SEE CALIBRATION. Confidence monotonicity is an ORDERING
 *     property. Nothing here says a 0.7 is right seven times in ten, and no
 *     test in this repo currently can.
 *   · IT IS ONE-SIDED ON THE VALUE AXIS. Every assertion about a resolved pace
 *     checks that the estimate did not become MORE aggressive than its
 *     evidence. None checks that the engine is not systematically
 *     under-reading a runner — that is the adaptation layer's failure mode
 *     (Rule 21) and it does not live in a capacity resolver.
 *   · THE GOAL SCAN IS SYNTACTIC. It reads the resolver's own source for
 *     goal-shaped identifiers. It cannot follow a goal reaching the layer three
 *     modules deep through a helper that does not say "goal" in its name — the
 *     ONE such path known today (`goalRunFloorMiForUser`, inside
 *     `loadVdotInputs`) is closed structurally by passing
 *     `CAPACITY_RUN_FLOOR_MI` explicitly, and test 1c asserts that call site
 *     rather than trusting the scan to have seen it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CAPACITY_CONFIDENCE_BANDS,
  CAPACITY_MODEL_VERSION,
  CAPACITY_RUN_FLOOR_MI,
  SOURCE_MODE_STRENGTH,
  USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS,
  priorWeeklyMi,
  combineIndependentConfidence,
  composeDurability,
  composeEasyCeiling,
  composeHighIntensityCapacity,
  composeThresholdCapacity,
  directEvidenceConfidence,
  fallbackConfidence,
  type CapacityEstimateBase,
  type DirectEvidenceQuality,
  type SourceMode,
  type ThresholdCapacityEstimate,
  type VdotFallbackRead,
} from '@/lib/training/capacity-resolver';
import { POPULATION_ENDURANCE_PRIOR } from '@/lib/training/durability-anchor';
import { tPaceFromVdot, iPaceFromVdot, easyBandFromTPace } from '@/lib/training/vdot';
import { conservativeVdotFromMileage } from '@/lib/plan/spec-builder';
import type { PaceObservation, ThresholdPaceRead, EasyPaceRead } from '@/lib/training/pace-corpus';
import type { RaceExponentRead, DecouplingRead } from '@/lib/training/durability-anchor';
import type { NormalReading } from '@/lib/training/normal-window';
import { readSelfReportedPr } from '@/lib/training/self-reported-pr';

const TODAY = '2026-08-31';
const RESOLVER_PATH = path.join(process.cwd(), 'lib/training/capacity-resolver.ts');

/* ── fixtures ───────────────────────────────────────────────────────────── */

function obs(id: string, date: string, paceSecPerMi: number): PaceObservation {
  return {
    id,
    date,
    paceSecPerMi,
    durationSec: 1800,
    source: 'splits',
    hrBasis: 'pct_lthr',
    hrPct: 0.98,
    hrBandDistance: 0.2,
  };
}

function okNormal(value: number): NormalReading<number> {
  return { ok: true, value, representativeDays: 28, excludedDays: 0 };
}

function refusedNormal(): NormalReading<number> {
  return {
    ok: false,
    representativeDays: 2,
    excludedDays: 26,
    refusal: {
      code: 'not-enough-representative-training',
      message: 'x',
      windowFromISO: '2026-08-03',
      windowToISO: TODAY,
      needDays: 7,
    },
  };
}

/** A fallback read with nothing in it — every rung below the population prior
 *  empty. The baseline every ladder test mutates one field of. */
function emptyFallback(overrides: Partial<VdotFallbackRead> = {}): VdotFallbackRead {
  return {
    measuredVdot: null,
    measuredVdotEvidenceId: null,
    measuredVdotDate: null,
    measuredVdotSource: null,
    belowTableAnchor: null,
    normalWeeklyMi: okNormal(40),
    // Full coverage by default — the baseline runner has a real training
    // history, so the self-report/PR priors are retired and every existing
    // ladder assertion reads the same number it always did.
    normalRunDays: USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS,
    selfReportedWeeklyMi: null,
    selfReportedPr: { ok: false, reason: 'NO_PR_ON_FILE', considered: 0, rejected: [] },
    ...overrides,
  };
}

const DIRECT_THRESHOLD: ThresholdPaceRead = {
  ok: true,
  tPaceSecPerMi: 430,
  vdot: 47.9,
  observations: 6,
  supporting: [
    obs('r1', '2026-08-25', 428),
    obs('r2', '2026-08-18', 430),
    obs('r3', '2026-08-11', 433),
  ],
};

const REFUSED_THRESHOLD: ThresholdPaceRead = {
  ok: false,
  reason: 'insufficient_corroboration',
  observations: 1,
};

const DIRECT_EASY: EasyPaceRead = {
  ok: true,
  ceilingSecPerMi: 491.7,
  observations: 12,
  supporting: [
    obs('e1', '2026-08-27', 480),
    obs('e2', '2026-08-20', 486),
    obs('e3', '2026-08-13', 491.7),
  ],
};

const REFUSED_EASY: EasyPaceRead = { ok: false, reason: 'no_observations', observations: 0 };

function raceExponentOk(value = 1.09, confidence = 0.6): RaceExponentRead {
  return {
    ok: true,
    value,
    confidence,
    evidenceScore: 0.5,
    rawFittedExponent: 1.12,
    populationPrior: POPULATION_ENDURANCE_PRIOR,
    rmsLogResidual: 0.02,
    races: 5,
    distinctDistances: 3,
    supporting: [
      { slug: 'afc-half', date: '2026-08-16', distanceMi: 13.1, finishSec: 6113, priority: 'A', weight: 1 },
      { slug: 'disney-half', date: '2026-02-01', distanceMi: 13.1, finishSec: 5900, priority: 'A', weight: 1 },
    ],
  };
}

function raceExponentRefused(): RaceExponentRead {
  return { ok: false, reason: 'insufficient_races', races: 1 };
}

function decouplingOk(value = 4.2, confidence = 0.5): DecouplingRead {
  return {
    ok: true,
    value,
    confidence,
    evidenceScore: 0.45,
    stddevPct: 1.4,
    observations: 6,
    supporting: [
      { id: 'l1', date: '2026-08-09', driftPct: 3.9, durationMin: 105 },
      { id: 'l2', date: '2026-07-26', driftPct: 4.4, durationMin: 112 },
    ],
  };
}

function decouplingRefused(): DecouplingRead {
  return { ok: false, reason: 'insufficient_corroboration', observations: 2 };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · GOAL ISOLATION (§6, §10)
 * ═══════════════════════════════════════════════════════════════════════ */

/** Strip block and line comments so the scan reads CODE, not the header's own
 *  (extensive, necessary) discussion of the goal boundary. */
function strippedSource(): string {
  const raw = readFileSync(RESOLVER_PATH, 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

describe('CAPACITY · goal isolation is structural, not conventional (§6)', () => {
  it('1a · the resolver\'s executable source mentions no goal-shaped identifier', () => {
    const code = strippedSource();

    // LIVENESS (Rule 18) · a scanner that read nothing must not report clean.
    // These assertions fail loudly if the comment stripper ever eats the file,
    // or if the resolver is renamed out from under this test.
    expect(code.length).toBeGreaterThan(2000);
    expect(code).toContain('export async function resolveThresholdCapacity');
    expect(code).toContain('export async function resolveDurability');

    // THE ONE ALLOWLIST, AND IT IS A RATCHET. The compile-time assertions that
    // PROVE the goal is absent are themselves named after it. They are excused
    // by exact identifier, never by a pattern — and every one of them must
    // still be present, so satisfying this scan by DELETING the guarantee
    // fails the test instead of passing it. A stale exemption fails until
    // deleted, per Rule 18's fourth clause.
    const ASSERTION_IDENTIFIERS = [
      '_GoalFreeThreshold',
      '_GoalFreeHighIntensity',
      '_GoalFreeEasy',
      '_GoalFreeDurability',
      'CapacityResolversAreGoalFree',
    ];
    for (const id of ASSERTION_IDENTIFIERS) {
      expect(code, `the goal-isolation assertion ${id} is gone`).toContain(id);
    }
    const excused = new RegExp(ASSERTION_IDENTIFIERS.join('|'), 'g');

    const hits = code.split('\n')
      .map((line, i) => ({ line: line.replace(excused, ''), n: i + 1 }))
      .filter(({ line }) => /goal/i.test(line));
    expect(
      hits.map((h) => `${h.n}: ${h.line.trim()}`),
      'a capacity resolver that can see the goal can train toward it (§6)',
    ).toEqual([]);
  });

  it('1b · POSITIVE CONTROL · the same scan does flag a goal reference', () => {
    // Falsify the check itself before trusting it (Rule 18). The matcher the
    // test above uses must actually fire on the shape it is looking for.
    const synthetic = [
      'const t = tPaceFromGoal(goalSec, distanceMi);',
      'const x = 1;',
    ].join('\n');
    const hits = synthetic.split('\n').filter((l) => /goal/i.test(l));
    expect(hits).toHaveLength(1);
  });

  it('1c · the VDOT loader is called with an EXPLICIT run floor, never the default', () => {
    const code = strippedSource();
    // The one goal leak a name-based scan cannot see: `loadVdotInputs`
    // falls back to `EVIDENCE_RUN_FLOOR_MI` when the argument is omitted
    // (formerly the goal-keyed `goalRunFloorMiForUser`, removed 2026-09-01 —
    // see docs/reports/capacity-boundary-fix-2026-09-01.md). Both are
    // evidence-only now, but this file still passes the constant explicitly
    // by value so the two halves of the ladder can never disagree.
    expect(code).toMatch(/loadVdotInputs\(\s*userId,\s*todayISO,\s*undefined,\s*CAPACITY_RUN_FLOOR_MI\s*\)/);
    expect(code).toMatch(/CAPACITY_RUN_FLOOR_MI,\s*\n\s*\)/); // threaded into bestRecentVdot too
    expect(CAPACITY_RUN_FLOOR_MI).toBe(3.0);
  });

  it('1d · the resolved estimate is a function of evidence only — same inputs, same answer', () => {
    // The behavioural half of goal isolation, expressed on the pure core: the
    // composer's output is fully determined by the reads it is handed. There
    // is no third input a goal could arrive through, and this asserts it
    // rather than assuming it from the signature.
    const a = composeThresholdCapacity({ direct: DIRECT_THRESHOLD, fallback: emptyFallback(), todayISO: TODAY });
    const b = composeThresholdCapacity({ direct: DIRECT_THRESHOLD, fallback: emptyFallback(), todayISO: TODAY });
    const strip = (e: ThresholdCapacityEstimate) => ({ ...e, resolvedAt: 'x' });
    expect(strip(a)).toEqual(strip(b));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · SOURCE-MODE PRESENCE AND EVIDENCE PROVENANCE (§10, §17)
 * ═══════════════════════════════════════════════════════════════════════ */

const ALL_MODES: SourceMode[] = [
  'direct', 'inferred', 'race_derived', 'vdot_fallback', 'user_prior', 'population_prior',
];

/** §10's evidence-provenance invariant, as one reusable assertion: every
 *  non-fallback estimate contains supporting evidence ids, and an EMPTY array
 *  is legal in exactly one state. */
function assertProvenance(e: CapacityEstimateBase, label: string) {
  expect(ALL_MODES, `${label} · sourceMode`).toContain(e.sourceMode);
  expect(e.confidence, `${label} · confidence in range`).toBeGreaterThanOrEqual(0);
  expect(e.confidence, `${label} · confidence in range`).toBeLessThanOrEqual(1);
  expect(e.reasons.length, `${label} · reasons are never empty (§27)`).toBeGreaterThan(0);
  expect(e.modelVersion, `${label} · versioned (§31)`).toBe(CAPACITY_MODEL_VERSION);
  expect(Number.isNaN(Date.parse(e.resolvedAt)), `${label} · resolvedAt is a real instant`).toBe(false);
  if (e.sourceMode !== 'population_prior') {
    expect(e.evidenceIds.length, `${label} · non-prior estimates name their evidence (§10)`).toBeGreaterThan(0);
  }
}

describe('CAPACITY · every estimate identifies its rung and its evidence (§10, §17)', () => {
  it('2a · threshold, at every rung', () => {
    assertProvenance(
      composeThresholdCapacity({ direct: DIRECT_THRESHOLD, fallback: emptyFallback(), todayISO: TODAY }),
      'threshold/direct',
    );
    assertProvenance(
      composeThresholdCapacity({
        direct: REFUSED_THRESHOLD,
        fallback: emptyFallback({ measuredVdot: 47, measuredVdotEvidenceId: 'afc-half', measuredVdotDate: '2026-08-16', measuredVdotSource: 'race' }),
        todayISO: TODAY,
      }),
      'threshold/vdot',
    );
    assertProvenance(
      composeThresholdCapacity({ direct: REFUSED_THRESHOLD, fallback: emptyFallback(), todayISO: TODAY }),
      'threshold/prior',
    );
  });

  it('2b · high-intensity, at every rung', () => {
    assertProvenance(
      composeHighIntensityCapacity({
        fallback: emptyFallback({ measuredVdot: 47, measuredVdotEvidenceId: 'afc-half', measuredVdotDate: '2026-08-16', measuredVdotSource: 'race' }),
        todayISO: TODAY,
      }),
      'hi/vdot',
    );
    assertProvenance(
      composeHighIntensityCapacity({ fallback: emptyFallback(), todayISO: TODAY }),
      'hi/prior',
    );
  });

  it('2c · easy, at both rungs', () => {
    const threshold = composeThresholdCapacity({ direct: DIRECT_THRESHOLD, fallback: emptyFallback(), todayISO: TODAY });
    assertProvenance(composeEasyCeiling({ direct: DIRECT_EASY, threshold, todayISO: TODAY }), 'easy/direct');
    assertProvenance(composeEasyCeiling({ direct: REFUSED_EASY, threshold, todayISO: TODAY }), 'easy/derived');
  });

  it('2d · durability, present and absent', () => {
    assertProvenance(composeDurability({ raceExponent: raceExponentOk(), decoupling: decouplingOk() }), 'dur/both');
    assertProvenance(
      composeDurability({ raceExponent: raceExponentRefused(), decoupling: decouplingRefused() }),
      'dur/neither',
    );
  });

  it('2e · a population-prior estimate names NO evidence, and that is the only state where it may not', () => {
    const prior = composeThresholdCapacity({ direct: REFUSED_THRESHOLD, fallback: emptyFallback(), todayISO: TODAY });
    expect(prior.sourceMode).toBe('population_prior');
    expect(prior.evidenceIds).toEqual([]);
    expect(prior.reasons).toContain('MILEAGE_POPULATION_PRIOR');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · LADDER FALSIFICATION (Rule 18, §16)
 *
 * The defect these aim at is not "the ladder picks a wrong tier". It is the
 * subtler one: TIER 1 REFUSING BEING REPORTED AS TIER 1 ANSWERING — a refusal
 * served as a fact, which is Rule 11's whole subject and this engine's most
 * productive bug shape.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('CAPACITY · the ladder falls through, it does not serve a refusal (Rule 18)', () => {
  it('3a · THRESHOLD tier 1 wins when direct evidence corroborates', () => {
    const e = composeThresholdCapacity({
      direct: DIRECT_THRESHOLD,
      // A measured VDOT sits underneath, deliberately implying a DIFFERENT
      // pace — so "tier 1 won" is provable from the number, not just the label.
      fallback: emptyFallback({ measuredVdot: 40, measuredVdotEvidenceId: 'x', measuredVdotDate: TODAY, measuredVdotSource: 'run' }),
      todayISO: TODAY,
    });
    expect(e.sourceMode).toBe('direct');
    expect(e.paceSecPerMi).toBe(430);
    expect(e.paceSecPerMi).not.toBe(tPaceFromVdot(40));
    expect(e.confidence).toBeGreaterThanOrEqual(CAPACITY_CONFIDENCE_BANDS.directFloor);
    expect(e.evidenceIds).toEqual(['r1', 'r2', 'r3']);
  });

  it('3b · THRESHOLD tier 1 refuses → tier 2 actually answers, with tier 2\'s number', () => {
    const e = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: emptyFallback({ measuredVdot: 47, measuredVdotEvidenceId: 'afc-half', measuredVdotDate: '2026-08-16', measuredVdotSource: 'race' }),
      todayISO: TODAY,
    });
    expect(e.sourceMode).toBe('vdot_fallback');
    expect(e.paceSecPerMi).toBe(tPaceFromVdot(47));
    expect(e.reasons).toContain('NO_DIRECT_EVIDENCE');
    expect(e.reasons).toContain('MEASURED_VDOT_FALLBACK');
    // And it did NOT quietly inherit tier 1's confidence band.
    expect(e.confidence).toBeLessThanOrEqual(CAPACITY_CONFIDENCE_BANDS.fallbackCeiling);
  });

  it('3c · THRESHOLD tier 3 · a demonstrated below-table pace beats the mileage prior', () => {
    const e = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: emptyFallback({
        belowTableAnchor: {
          source: 'race',
          refId: 'slow-half',
          name: 'A half',
          date: '2026-07-01',
          distance_mi: 13.1,
          finish_seconds: 13100,
          age_days: 61,
          anchor: { finishSeconds: 13100, distanceMi: 13.1, paceSPerMi: 1000 },
        },
      }),
      todayISO: TODAY,
    });
    expect(e.sourceMode).toBe('race_derived');
    expect(e.reasons).toContain('BELOW_TABLE_ANCHOR_FALLBACK');
    expect(e.evidenceIds).toEqual(['slow-half']);
    // Falsifiable requirement #3 · no prescribed pace faster than the anchor.
    expect(e.paceSecPerMi).toBeGreaterThanOrEqual(1000);
  });

  it('3d · THRESHOLD tier 4 · nothing at all still resolves, at the prior, and says so', () => {
    const e = composeThresholdCapacity({ direct: REFUSED_THRESHOLD, fallback: emptyFallback(), todayISO: TODAY });
    expect(e.sourceMode).toBe('population_prior');
    expect(e.confidence).toBe(CAPACITY_CONFIDENCE_BANDS.populationPrior);
    expect(e.paceSecPerMi).toBeGreaterThan(0);
  });

  it('3e · a REFUSED habit window is not coerced into a measurement (Rule 11)', () => {
    const measured = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: emptyFallback({ normalWeeklyMi: okNormal(0) }),
      todayISO: TODAY,
    });
    const refused = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: emptyFallback({ normalWeeklyMi: refusedNormal() }),
      todayISO: TODAY,
    });
    // Both land on the same conservative rung — but only ONE of them claims to
    // have measured a runner who ran zero miles. "The window refused" and "he
    // ran nothing" are different facts and the estimate distinguishes them.
    expect(measured.reasons).not.toContain('HABIT_WINDOW_REFUSED');
    expect(refused.reasons).toContain('HABIT_WINDOW_REFUSED');
  });

  /* ── COLD-START PRIOR (2026-09-01, REVISED after the independent audit) ────
   *
   * `docs/reports/cold-start-prior-fix-2026-09-01.md` for the original fix and
   * the audit appendix `A-authoring-migration.md` §4 for what was wrong with
   * it. Before the fix, a zero-run account's threshold pace floored straight
   * to the flat VDOT-30 population prior (~10:42/mi) no matter what the runner
   * typed at onboarding. The fix substituted the self-report on a hard
   * `real > 0` switch, which the audit walked and found to be a 188 s/mi
   * Rule 9 cliff — the sparse-history runner (1-2 logged runs, the first month
   * of every new account) landing in a WORSE bucket than the zero-run runner
   * the fix was written for. What is asserted below is the BLEND that replaced
   * it, and the typed-PR rung the fix never had. */

  /** A cold-start fallback: no measured VDOT, no below-table anchor, a real
   *  habit reading of `weeklyMi` over `runDays` representative running days.
   *  The two are supplied together on purpose — 0 mi/wk over 16 running days
   *  is not a runner, it is an incoherent fixture, and the old helper's
   *  independent defaults let exactly that shape into four tests. */
  function coldStart(
    weeklyMi: number,
    runDays: number,
    overrides: Partial<VdotFallbackRead> = {},
  ): VdotFallbackRead {
    return emptyFallback({ normalWeeklyMi: okNormal(weeklyMi), normalRunDays: runDays, ...overrides });
  }

  /** A validated typed PR, in the shape `readSelfReportedPr` returns. */
  function typedPr(distance: string, timeSec: number, whenRaced: string) {
    return readSelfReportedPr([{ distance, timeSec, whenRaced }]);
  }

  it('3e-1 · a zero-run account with an onboarding self-report gets `user_prior`, not the flat population floor', () => {
    const noSelfReport = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: coldStart(0, 0, { selfReportedWeeklyMi: null }),
      todayISO: TODAY,
    });
    const withSelfReport = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      // '25-35' bucket midpoint (HIST_AVG_MIDPOINTS, lib/onboarding/state.ts).
      fallback: coldStart(0, 0, { selfReportedWeeklyMi: 30 }),
      todayISO: TODAY,
    });
    expect(noSelfReport.sourceMode).toBe('population_prior');
    expect(noSelfReport.confidence).toBe(CAPACITY_CONFIDENCE_BANDS.populationPrior);

    expect(withSelfReport.sourceMode).toBe('user_prior');
    expect(withSelfReport.reasons).toContain('ONBOARDING_MILEAGE_USER_PRIOR');
    expect(withSelfReport.reasons).not.toContain('MILEAGE_POPULATION_PRIOR');
    // Low confidence, conservative bounds: strictly between the population
    // floor and the fallback band, never a confident precise pace.
    expect(withSelfReport.confidence).toBe(CAPACITY_CONFIDENCE_BANDS.userPrior);
    expect(withSelfReport.confidence).toBeGreaterThan(CAPACITY_CONFIDENCE_BANDS.populationPrior);
    expect(withSelfReport.confidence).toBeLessThan(CAPACITY_CONFIDENCE_BANDS.fallbackFloor);
    // The 30 mi/wk self-report resolves a materially faster (and more
    // reasonable) pace than the flat VDOT-30 floor — this is the ~35%
    // divergence closing, not just a source-mode label change.
    expect(withSelfReport.paceSecPerMi).toBeLessThan(noSelfReport.paceSecPerMi);
  });

  it('3e-2 · the self-report never crosses into direct/inferred, and is capped by the same monotonic conversion', () => {
    const e = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      // Well above the ladder's top band — `conservativeVdotFromMileage` caps
      // at VDOT 50 for anything >= 100 mi/wk, unchanged by this fix.
      fallback: coldStart(0, 0, { selfReportedWeeklyMi: 120 }),
      todayISO: TODAY,
    });
    expect(e.sourceMode).toBe('user_prior');
    expect(conservativeVdotFromMileage(120)).toBe(50);
    expect(e.paceSecPerMi).toBe(tPaceFromVdot(50));
    expect(e.evidenceIds).toEqual([]); // a self-report names no runner evidence
  });

  /* 3e-3 · REWRITTEN 2026-09-01 after the independent audit.
   *
   * The version this replaces asserted the cliff AS CORRECT — `okNormal(1)`
   * against a 40 mi/wk self-report expecting `population_prior`, under the
   * heading "ANY real logged mileage displaces the self-report automatically
   * — no special-case code needed". The PRINCIPLE (evidence precedence) was
   * right and is still asserted below. The IMPLEMENTATION it blessed was a
   * hard switch, and Rule 9 exists to stop exactly that: the runner who
   * logged one short run after typing 40 mi/wk went from a prescribed 7:34/mi
   * to 10:42/mi, a +188 s/mi step, and stayed there for weeks.
   *
   * A test that blesses a cliff is worse than no test, because it makes the
   * cliff look deliberate to the next reader. */
  it('3e-3 · real logged mileage displaces the self-report CONTINUOUSLY, in proportion to how much of it there is', () => {
    const selfReportedWeeklyMi = 40;
    const at = (weeklyMi: number, runDays: number) => composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: coldStart(weeklyMi, runDays, { selfReportedWeeklyMi }),
      todayISO: TODAY,
    });

    const zeroRun = at(0, 0);
    const oneRun = at(0.8, 1);
    const fullMonth = at(12, USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS);

    // ONE logged run moves the prior a LITTLE, not off a cliff. The old
    // behaviour jumped straight to the population floor here.
    expect(oneRun.paceSecPerMi).toBeGreaterThan(zeroRun.paceSecPerMi);
    expect(oneRun.paceSecPerMi - zeroRun.paceSecPerMi).toBeLessThan(20);
    expect(oneRun.sourceMode).toBe('user_prior');

    // A FULL MONTH of logged running retires the self-report entirely — the
    // evidence-precedence principle, reached as a limit rather than a switch.
    expect(fullMonth.sourceMode).toBe('population_prior');
    expect(fullMonth.reasons).not.toContain('ONBOARDING_MILEAGE_USER_PRIOR');
    expect(fullMonth.paceSecPerMi).toBe(tPaceFromVdot(conservativeVdotFromMileage(12)));
  });

  /* ── RULE 9 CONTINUITY WALKS · the falsifier for the cliff above ──────────
   *
   * WHAT THESE CANNOT FAIL ON (Rule 22), stated because it matters here:
   * `conservativeVdotFromMileage` is itself a STEP LADDER over weekly mileage
   * (30 → 32 at 15 mi/wk, 32 → 35 at 20, and so on), so a runner whose
   * mileage crosses one of its rungs moves by that rung's whole width no
   * matter what this file does. That is a pre-existing Rule 9 defect in a
   * doctrine-bound CONVENTION constant, it predates the self-report rung
   * entirely, and it is NOT what these walks are about — smoothing it means
   * re-pricing every cold-start plan in the corpus and belongs to whoever
   * owns that table. So the walks below measure the SUBSTITUTION, and they
   * measure it two ways:
   *
   *   · the blended MILEAGE, which this file owns outright and which must be
   *     continuous with no exception at all;
   *   · the prescribed PACE, bounded by the ladder's own worst adjacent-rung
   *     step, READ OUT OF THE LADDER at run time rather than hardcoded, so
   *     the bound cannot silently widen (Rule 18).
   *
   * Falsified before landing: against the `real > 0` switch this replaced,
   * the mileage walk reports a 40 mi/wk step and the pace walk 188 s/mi.
   * Both bounds fail by an order of magnitude. */

  /** The widest single move the mileage ladder itself can make, in s/mi —
   *  computed from the ladder, not restated. Anything at or under this is the
   *  ladder's cliff, not the substitution's. */
  function ladderWorstStepSecPerMi(): number {
    const rungs = [15, 20, 25, 30, 35, 40, 45, 70, 85, 100];
    let worst = 0;
    for (const mi of rungs) {
      const below = tPaceFromVdot(conservativeVdotFromMileage(mi - 0.001));
      const above = tPaceFromVdot(conservativeVdotFromMileage(mi));
      if (below != null && above != null) worst = Math.max(worst, Math.abs(above - below));
    }
    return worst;
  }

  it('3e-3b · RULE 9 WALK · the blended mileage moves CONTINUOUSLY as real running arrives', () => {
    // The quantity this file actually owns. No ladder involved, so the bound
    // is genuinely small: a half-mile step of real mileage may never move the
    // prior by more than a couple of miles.
    const selfReportedWeeklyMi = 40;
    let prev: number | null = null;
    let worst = 0;
    let worstAt = -1;
    for (let i = 0; i <= 80; i++) {
      const weeklyMi = i * 0.5;
      const runDays = Math.min(
        USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS,
        (weeklyMi / 40) * USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS,
      );
      // The REAL function, not a re-implementation of its formula — a walk
      // that recomputes the thing it is auditing proves only that the test
      // agrees with itself (Rule 18).
      const blended = priorWeeklyMi(okNormal(weeklyMi), selfReportedWeeklyMi, runDays).weeklyMi;
      if (prev != null && Math.abs(blended - prev) > worst) {
        worst = Math.abs(blended - prev);
        worstAt = weeklyMi;
      }
      prev = blended;
    }
    expect({ worstAt, ok: worst <= 1.0 }).toEqual({ worstAt, ok: true });
  });

  it('3e-3c · RULE 9 WALK · real habit mileage 0 → 40 against a 40 mi/wk self-report never steps further than the mileage ladder itself', () => {
    const selfReportedWeeklyMi = 40;
    const bound = ladderWorstStepSecPerMi();
    // Sanity on the bound itself: it must be a real, finite, MUCH smaller
    // number than the 188 s/mi cliff this walk exists to keep out.
    expect(bound).toBeGreaterThan(0);
    expect(bound).toBeLessThan(60);

    let prev: number | null = null;
    let worst = 0;
    let worstAt = -1;
    for (let i = 0; i <= 80; i++) {
      const weeklyMi = i * 0.5;
      const runDays = Math.min(
        USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS,
        (weeklyMi / 40) * USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS,
      );
      const e = composeThresholdCapacity({
        direct: REFUSED_THRESHOLD,
        fallback: coldStart(weeklyMi, runDays, { selfReportedWeeklyMi }),
        todayISO: TODAY,
      });
      if (prev != null) {
        const step = Math.abs(e.paceSecPerMi - prev);
        if (step > worst) { worst = step; worstAt = weeklyMi; }
      }
      prev = e.paceSecPerMi;
    }
    // `worstAt` travels in the failure message so a regression names WHERE
    // the cliff came back, not just that one did.
    expect({ worstAt, ok: worst <= bound + 1e-6 }).toEqual({ worstAt, ok: true });
  });

  it('3e-3d · RULE 9 WALK · the same walk with a typed PR on file is no worse', () => {
    const pr = typedPr('half', 5400, '<6mo'); // 1:30 half
    const bound = ladderWorstStepSecPerMi();
    let prev: number | null = null;
    let worst = 0;
    let worstAt = -1;
    for (let i = 0; i <= 80; i++) {
      const weeklyMi = i * 0.5;
      const runDays = Math.min(
        USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS,
        (weeklyMi / 40) * USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS,
      );
      const e = composeThresholdCapacity({
        direct: REFUSED_THRESHOLD,
        fallback: coldStart(weeklyMi, runDays, { selfReportedWeeklyMi: 40, selfReportedPr: pr }),
        todayISO: TODAY,
      });
      if (prev != null) {
        const step = Math.abs(e.paceSecPerMi - prev);
        if (step > worst) { worst = step; worstAt = weeklyMi; }
      }
      prev = e.paceSecPerMi;
    }
    expect({ worstAt, ok: worst <= bound + 1e-6 }).toEqual({ worstAt, ok: true });
  });

  it('3e-4 · self-report substitutes on a REFUSED habit window too, and both facts are reported', () => {
    const e = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: emptyFallback({
        normalWeeklyMi: refusedNormal(), normalRunDays: 0, selfReportedWeeklyMi: 20,
      }),
      todayISO: TODAY,
    });
    expect(e.sourceMode).toBe('user_prior');
    expect(e.reasons).toContain('ONBOARDING_MILEAGE_USER_PRIOR');
    // The window still refused — that fact does not disappear because a
    // self-report filled the gap.
    expect(e.reasons).toContain('HABIT_WINDOW_REFUSED');
  });

  it('3e-5 · HIGH-INTENSITY tier 4 mirrors the same user_prior substitution', () => {
    const noSelfReport = composeHighIntensityCapacity({
      fallback: coldStart(0, 0, { selfReportedWeeklyMi: null }),
      todayISO: TODAY,
    });
    const withSelfReport = composeHighIntensityCapacity({
      fallback: coldStart(0, 0, { selfReportedWeeklyMi: 30 }),
      todayISO: TODAY,
    });
    expect(noSelfReport.sourceMode).toBe('population_prior');
    expect(withSelfReport.sourceMode).toBe('user_prior');
    expect(withSelfReport.confidence).toBe(CAPACITY_CONFIDENCE_BANDS.userPrior);
    expect(withSelfReport.intervalPaceSecPerMi).toBeLessThan(noSelfReport.intervalPaceSecPerMi);
  });

  it('3e-6 · ANSWERED ZERO is a different fact from never having answered (Rule 11)', () => {
    const unanswered = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: coldStart(0, 0, { selfReportedWeeklyMi: null }),
      todayISO: TODAY,
    });
    const answeredZero = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: coldStart(0, 0, { selfReportedWeeklyMi: 0 }),
      todayISO: TODAY,
    });
    // Same number — a runner who says they do not run yet IS at the
    // population floor. Not the same FACT, and now distinguishable.
    expect(answeredZero.paceSecPerMi).toBe(unanswered.paceSecPerMi);
    expect(unanswered.reasons).not.toContain('ONBOARDING_MILEAGE_ANSWERED_ZERO');
    expect(answeredZero.reasons).toContain('ONBOARDING_MILEAGE_ANSWERED_ZERO');
  });

  /* ── THE TYPED-PR RUNG (2026-09-01) ───────────────────────────────────────
   * `lib/training/self-reported-pr.ts`. The audit's second blocker: legacy's
   * PARITY-1 consumed `profile.race_history` and the canonical ladder had no
   * rung for it, leaving a measured ~101 s/mi residual on a real cold-start
   * account. */

  it('3e-7 · a validated typed PR moves the prior toward it, CONSERVATIVELY, as `user_prior`', () => {
    const noPr = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: coldStart(0, 0, { selfReportedWeeklyMi: 20 }),
      todayISO: TODAY,
    });
    const withPr = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: coldStart(0, 0, {
        selfReportedWeeklyMi: 20,
        selfReportedPr: typedPr('half', 5400, '<6mo'),
      }),
      todayISO: TODAY,
    });
    expect(withPr.sourceMode).toBe('user_prior');
    expect(withPr.reasons).toContain('ONBOARDING_PR_USER_PRIOR');
    expect(withPr.confidence).toBe(CAPACITY_CONFIDENCE_BANDS.userPrior);
    expect(withPr.evidenceIds).toEqual([]); // still names no runner evidence

    // It moves the pace toward the PR — but never all the way there. The
    // shrinkage toward the mileage prior is the whole defence (Rule 22: this
    // file's validator cannot catch an ambitious lie).
    const prImplied = readSelfReportedPr([{ distance: 'half', timeSec: 5400, whenRaced: '<6mo' }]);
    expect(prImplied.ok).toBe(true);
    const prT = prImplied.ok ? prImplied.best.tPaceSecPerMi : 0;
    expect(withPr.paceSecPerMi).toBeLessThan(noPr.paceSecPerMi);
    expect(withPr.paceSecPerMi).toBeGreaterThan(prT);
  });

  it('3e-8 · an implausible typed PR is REJECTED with a reason, and prices nothing', () => {
    const absurd = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: coldStart(0, 0, {
        selfReportedWeeklyMi: 20,
        // A 40-minute marathon. 91 s/mi — inside no human's reach and
        // outside `PR_MIN_PLAUSIBLE_PACE_S_PER_MI`.
        selfReportedPr: typedPr('marathon', 2400, '<6mo'),
      }),
      todayISO: TODAY,
    });
    const clean = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: coldStart(0, 0, { selfReportedWeeklyMi: 20 }),
      todayISO: TODAY,
    });
    expect(absurd.reasons).toContain('ONBOARDING_PR_REJECTED');
    expect(absurd.reasons).not.toContain('ONBOARDING_PR_USER_PRIOR');
    // Rejected means it prices NOTHING — identical to the no-PR runner.
    expect(absurd.paceSecPerMi).toBe(clean.paceSecPerMi);
    // And "nothing on file" is not reported as a rejection.
    expect(clean.reasons).not.toContain('ONBOARDING_PR_REJECTED');
  });

  it('3e-9 · a typed PR loses authority CONTINUOUSLY with age, and holds its value (decay confidence, not value)', () => {
    const paceFor = (whenRaced: string) => composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: coldStart(0, 0, {
        selfReportedWeeklyMi: 20,
        selfReportedPr: typedPr('half', 5400, whenRaced),
      }),
      todayISO: TODAY,
    }).paceSecPerMi;

    const fresh = paceFor('<6mo');
    const midAged = paceFor('6-12mo');
    const old = paceFor('1-2yr');
    const ancient = paceFor('2+yr');
    // Monotone: older PR → less pull toward the PR's pace → slower prescribed
    // threshold. And no cliff at any bucket boundary — the legacy path CUT
    // the PR off entirely at 180 days.
    expect(midAged).toBeGreaterThan(fresh);
    expect(old).toBeGreaterThan(midAged);
    expect(ancient).toBeGreaterThan(old);
    // Even a 3-year-old PR still says "not a beginner" — it is faint, not
    // deleted, which is what a hard date cut got wrong.
    const noPr = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: coldStart(0, 0, { selfReportedWeeklyMi: 20 }),
      todayISO: TODAY,
    }).paceSecPerMi;
    expect(ancient).toBeLessThan(noPr);
  });

  it('3e-10 · a typed PR NEVER outranks a real observation of the runner running', () => {
    const measured = composeThresholdCapacity({
      direct: REFUSED_THRESHOLD,
      fallback: emptyFallback({
        measuredVdot: 42, measuredVdotEvidenceId: 'run-1',
        measuredVdotDate: '2026-08-20', measuredVdotSource: 'run',
        selfReportedPr: typedPr('half', 4500, '<6mo'), // a much faster claim
      }),
      todayISO: TODAY,
    });
    expect(measured.sourceMode).toBe('vdot_fallback');
    expect(measured.reasons).not.toContain('ONBOARDING_PR_USER_PRIOR');
    expect(measured.paceSecPerMi).toBe(tPaceFromVdot(42));
  });

  it('3e-11 · the GOAL cannot reach any of it — no input this ladder takes carries one', () => {
    // Structural, not behavioural: the fallback read has no goal-shaped field
    // at all, so an "extreme goal swap" cannot move a number because there is
    // nothing to swap. Asserted on the KEYS so a future field named
    // `goalPaceSec` fails here before it can price anything.
    const keys = Object.keys(coldStart(0, 0, { selfReportedWeeklyMi: 20 }));
    expect(keys.filter((k) => /goal/i.test(k))).toEqual([]);
  });

  it('3f · HIGH-INTENSITY always declares that its top rung is not built', () => {
    const vdotRung = composeHighIntensityCapacity({
      fallback: emptyFallback({ measuredVdot: 47, measuredVdotEvidenceId: 'afc-half', measuredVdotDate: '2026-08-16', measuredVdotSource: 'race' }),
      todayISO: TODAY,
    });
    const priorRung = composeHighIntensityCapacity({ fallback: emptyFallback(), todayISO: TODAY });
    for (const e of [vdotRung, priorRung]) {
      expect(e.reasons).toContain('NO_DIRECT_HIGH_INTENSITY_READER');
      expect(e.sourceMode).not.toBe('direct');
    }
    expect(vdotRung.intervalPaceSecPerMi).toBe(iPaceFromVdot(47));
    expect(vdotRung.repetitionPaceSecPerMi).not.toBeNull();
  });

  it('3g · HIGH-INTENSITY below-table rung reports R as NULL, never as a substitute', () => {
    const e = composeHighIntensityCapacity({
      fallback: emptyFallback({
        belowTableAnchor: {
          source: 'run',
          refId: '9001',
          name: null,
          date: '2026-07-01',
          distance_mi: 6.2,
          finish_seconds: 6200,
          age_days: 61,
          anchor: { finishSeconds: 6200, distanceMi: 6.2, paceSPerMi: 1000 },
        },
      }),
      todayISO: TODAY,
    });
    expect(e.sourceMode).toBe('inferred');
    expect(e.repetitionPaceSecPerMi).toBeNull();
    expect(e.vdot).toBeNull();
    expect(e.intervalPaceSecPerMi).toBeGreaterThanOrEqual(1000);
  });

  it('3h · EASY tier 1 wins; tier 2 derives off threshold and is never `direct`', () => {
    const thresholdDirect = composeThresholdCapacity({ direct: DIRECT_THRESHOLD, fallback: emptyFallback(), todayISO: TODAY });
    const tier1 = composeEasyCeiling({ direct: DIRECT_EASY, threshold: thresholdDirect, todayISO: TODAY });
    expect(tier1.sourceMode).toBe('direct');
    expect(tier1.ceilingSecPerMi).toBe(491.7);

    const tier2 = composeEasyCeiling({ direct: REFUSED_EASY, threshold: thresholdDirect, todayISO: TODAY });
    expect(tier2.sourceMode).toBe('inferred');
    expect(tier2.ceilingSecPerMi).toBe(easyBandFromTPace(430)!.lo);
    expect(tier2.confidence).toBeLessThanOrEqual(CAPACITY_CONFIDENCE_BANDS.fallbackCeiling);
    expect(tier2.reasons).toContain('EASY_DERIVED_FROM_THRESHOLD_CAPACITY');
  });

  it('3i · EASY tier 2 carries a weak threshold\'s weakness through, it cannot launder it', () => {
    const thresholdPrior = composeThresholdCapacity({ direct: REFUSED_THRESHOLD, fallback: emptyFallback(), todayISO: TODAY });
    const easy = composeEasyCeiling({ direct: REFUSED_EASY, threshold: thresholdPrior, todayISO: TODAY });
    expect(easy.sourceMode).toBe('population_prior');
    expect(easy.confidence).toBe(CAPACITY_CONFIDENCE_BANDS.populationPrior);
  });

  it('3j · EASY is a CEILING slower than threshold pace, always (§30 range test)', () => {
    for (const t of [360, 400, 430, 500, 600]) {
      const threshold = composeThresholdCapacity({
        direct: { ok: true, tPaceSecPerMi: t, vdot: 45, observations: 5, supporting: [obs('a', TODAY, t), obs('b', TODAY, t), obs('c', TODAY, t)] },
        fallback: emptyFallback(),
        todayISO: TODAY,
      });
      const easy = composeEasyCeiling({ direct: REFUSED_EASY, threshold, todayISO: TODAY });
      expect(easy.ceilingSecPerMi).toBeGreaterThan(threshold.paceSecPerMi);
    }
  });

  it('3k · DURABILITY reports both sub-observations, and refuses without inventing a decoupling number', () => {
    const both = composeDurability({ raceExponent: raceExponentOk(1.09), decoupling: decouplingOk(4.2) });
    expect(both.enduranceExponent).toBe(1.09);
    expect(both.raceExponent.present).toBe(true);
    expect(both.decoupling.present).toBe(true);
    expect(both.reasons).toContain('TWO_INDEPENDENT_EVIDENCE_TYPES');
    expect(both.sourceMode).toBe('direct'); // strongest present component

    const neither = composeDurability({ raceExponent: raceExponentRefused(), decoupling: decouplingRefused() });
    expect(neither.enduranceExponent).toBe(POPULATION_ENDURANCE_PRIOR);
    expect(neither.sourceMode).toBe('population_prior');
    expect(neither.raceExponent.present).toBe(false);
    expect(neither.decoupling.present).toBe(false);
    // Rule 11 as a type: the absent branch has no `value` to read at all.
    if (!neither.decoupling.present) expect('value' in neither.decoupling).toBe(false);

    const raceOnly = composeDurability({ raceExponent: raceExponentOk(), decoupling: decouplingRefused() });
    expect(raceOnly.sourceMode).toBe('race_derived');
    expect(raceOnly.reasons).toContain('NO_DECOUPLING_CORROBORATION');
    expect(raceOnly.reasons).not.toContain('TWO_INDEPENDENT_EVIDENCE_TYPES');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · CONFIDENCE MONOTONICITY AND BAND STRUCTURE (§30)
 * ═══════════════════════════════════════════════════════════════════════ */

describe('CAPACITY · confidence bands and monotonicity (§30)', () => {
  it('4a · the three bands do not overlap, and rank direct > fallback > prior', () => {
    const b = CAPACITY_CONFIDENCE_BANDS;
    expect(b.directCeiling).toBeGreaterThan(b.directFloor);
    expect(b.fallbackCeiling).toBeGreaterThan(b.fallbackFloor);
    // The load-bearing one: the best possible fallback can TIE the weakest
    // admissible direct read and can never beat it (BRIEF 01).
    expect(b.directFloor).toBeGreaterThanOrEqual(b.fallbackCeiling);
    expect(b.fallbackFloor).toBeGreaterThanOrEqual(b.populationPrior);
    // And direct evidence never claims certainty — see the constant's header.
    expect(b.directCeiling).toBeLessThan(1);
  });

  it('4a-1 · userPrior sits strictly between the fallback floor and the population prior (2026-09-01)', () => {
    const b = CAPACITY_CONFIDENCE_BANDS;
    expect(b.fallbackFloor).toBeGreaterThan(b.userPrior);
    expect(b.userPrior).toBeGreaterThan(b.populationPrior);
  });

  it('4b · the source-mode strength ordering is §16\'s ladder', () => {
    expect(SOURCE_MODE_STRENGTH.direct).toBeGreaterThan(SOURCE_MODE_STRENGTH.inferred);
    expect(SOURCE_MODE_STRENGTH.inferred).toBeGreaterThan(SOURCE_MODE_STRENGTH.race_derived);
    expect(SOURCE_MODE_STRENGTH.race_derived).toBeGreaterThan(SOURCE_MODE_STRENGTH.vdot_fallback);
    expect(SOURCE_MODE_STRENGTH.vdot_fallback).toBeGreaterThan(SOURCE_MODE_STRENGTH.user_prior);
    expect(SOURCE_MODE_STRENGTH.user_prior).toBeGreaterThan(SOURCE_MODE_STRENGTH.population_prior);
  });

  it('4c · MORE corroborating observations never lower confidence, all else equal', () => {
    const base: DirectEvidenceQuality = {
      observations: 3,
      supportingDates: ['2026-08-25', '2026-08-18', '2026-08-11'],
      supportingValues: [428, 430, 433],
      minObservations: 3,
    };
    let prev = -Infinity;
    for (let n = 3; n <= 14; n++) {
      const c = directEvidenceConfidence({ ...base, observations: n }, TODAY).confidence;
      expect(c, `observations=${n} must not be less confident than ${n - 1}`).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
    // And it genuinely MOVES — a property that is trivially satisfied by a
    // constant would pass the loop above and prove nothing (Rule 18).
    expect(directEvidenceConfidence({ ...base, observations: 12 }, TODAY).confidence)
      .toBeGreaterThan(directEvidenceConfidence(base, TODAY).confidence);
  });

  it('4d · observations that AGREE more closely never lower confidence', () => {
    const mk = (spreadSec: number): DirectEvidenceQuality => ({
      observations: 5,
      supportingDates: ['2026-08-25', '2026-08-18', '2026-08-11'],
      supportingValues: [430 - spreadSec, 430, 430 + spreadSec],
      minObservations: 3,
    });
    let prev = Infinity;
    for (const spread of [0, 5, 10, 15, 20, 30, 45]) {
      const c = directEvidenceConfidence(mk(spread), TODAY).confidence;
      expect(c, `spread=${spread}s must not be MORE confident than ${spread} tighter`).toBeLessThanOrEqual(prev);
      prev = c;
    }
    expect(directEvidenceConfidence(mk(0), TODAY).confidence)
      .toBeGreaterThan(directEvidenceConfidence(mk(45), TODAY).confidence);
  });

  it('4e · STALER evidence never raises confidence — and never moves the value', () => {
    const mk = (mostRecent: string): DirectEvidenceQuality => ({
      observations: 5,
      supportingDates: [mostRecent],
      supportingValues: [428, 430, 433],
      minObservations: 3,
    });
    const fresh = directEvidenceConfidence(mk('2026-08-30'), TODAY).confidence;
    const mid = directEvidenceConfidence(mk('2026-08-03'), TODAY).confidence;
    const old = directEvidenceConfidence(mk('2026-05-01'), TODAY).confidence;
    expect(fresh).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(old);

    // Doctrine §16 and the 2026-08-31 decision, as an assertion: the ESTIMATE
    // is identical across those three, only the confidence moved.
    const at = (date: string) => composeThresholdCapacity({
      direct: { ok: true, tPaceSecPerMi: 430, vdot: 47.9, observations: 5, supporting: [obs('a', date, 430), obs('b', date, 430), obs('c', date, 430)] },
      fallback: emptyFallback(),
      todayISO: TODAY,
    });
    expect(at('2026-08-30').paceSecPerMi).toBe(at('2026-05-01').paceSecPerMi);
    expect(at('2026-08-30').confidence).toBeGreaterThan(at('2026-05-01').confidence);
  });

  it('4f · a single supporting observation is not scored as perfect agreement', () => {
    const one = directEvidenceConfidence(
      { observations: 3, supportingDates: [TODAY], supportingValues: [430], minObservations: 3 },
      TODAY,
    );
    const three = directEvidenceConfidence(
      { observations: 3, supportingDates: [TODAY], supportingValues: [429, 430, 431], minObservations: 3 },
      TODAY,
    );
    expect(one.components.consistencyScore).toBe(0);
    expect(three.confidence).toBeGreaterThan(one.confidence);
  });

  it('4g · a fallback\'s confidence stays inside its band whatever its anchor date', () => {
    const b = CAPACITY_CONFIDENCE_BANDS;
    for (const d of [TODAY, '2026-08-01', '2026-01-01', null]) {
      const c = fallbackConfidence(d, TODAY);
      expect(c).toBeGreaterThanOrEqual(b.fallbackFloor);
      expect(c).toBeLessThanOrEqual(b.fallbackCeiling);
    }
    expect(fallbackConfidence(TODAY, TODAY)).toBeGreaterThan(fallbackConfidence('2026-01-01', TODAY));
  });

  it('4h · combining two independent evidence types is monotone in both, and capped', () => {
    expect(combineIndependentConfidence(0.5, 0)).toBeCloseTo(0.5, 10);
    expect(combineIndependentConfidence(0.5, 0.5)).toBeGreaterThan(0.5);
    expect(combineIndependentConfidence(0.5, 0.6)).toBeGreaterThan(combineIndependentConfidence(0.5, 0.5));
    expect(combineIndependentConfidence(1, 1)).toBe(CAPACITY_CONFIDENCE_BANDS.directCeiling);
  });

  it('4h2 · a durability aggregate is NEVER less confident than its strongest component', () => {
    // FOUND BY THE RULE 13 RENDER, not by this suite — which is why it is
    // written down here now. `resolveDecoupling`'s confidence reached 0.937 on
    // the owner's real account; capping only the COMBINED result pinned the
    // aggregate at 0.900, so a second corroborating evidence type made the
    // reported number go DOWN. Falsified against the unfixed code: this case
    // read confidence 0.9 against a 0.937 component before the inputs were
    // capped as well.
    const cases: Array<[number, number]> = [
      [0.937, 0.623], [0.99, 0.99], [0.95, 0], [0, 0.95], [0.4, 0.4], [1, 0.2],
    ];
    for (const [a, b] of cases) {
      const d = composeDurability({ raceExponent: raceExponentOk(1.09, a), decoupling: decouplingOk(4.2, b) });
      const strongest = Math.max(
        d.raceExponent.present ? d.raceExponent.confidence : 0,
        d.decoupling.present ? d.decoupling.confidence : 0,
      );
      expect(d.confidence, `race=${a} decoupling=${b} · aggregate below its own component`)
        .toBeGreaterThanOrEqual(strongest);
      expect(d.confidence).toBeLessThanOrEqual(CAPACITY_CONFIDENCE_BANDS.directCeiling);
    }
  });

  it('4i · durability confidence rises when a second evidence type corroborates', () => {
    const one = composeDurability({ raceExponent: raceExponentOk(1.09, 0.6), decoupling: decouplingRefused() });
    const two = composeDurability({ raceExponent: raceExponentOk(1.09, 0.6), decoupling: decouplingOk(4.2, 0.5) });
    expect(two.confidence).toBeGreaterThan(one.confidence);
    // …without the VALUE moving, because a second evidence type about a
    // different half of the trait is not evidence the exponent was wrong.
    expect(two.enduranceExponent).toBe(one.enduranceExponent);
  });
});
