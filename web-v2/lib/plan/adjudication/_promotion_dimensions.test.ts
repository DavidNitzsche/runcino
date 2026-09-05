/**
 * ADJ-DIM-1 · EVERY PROMOTION DIMENSION IS INDEPENDENTLY FAILABLE.
 *
 * The owner's standard, verbatim: "No literal true, nonempty-array proxy or
 * structurally impossible failure." Two of the six dimensions were literally
 * `true` and `traces.length > 0` until 2026-09-04; a third,
 * `taperIntegrity`, was made real the same day and was STILL unfailable
 * through the supported path, because it required a `StackedStress` object
 * that `detectStackedStress` cannot produce for a taper week. Its one test
 * hand-built that object, so the gate looked covered and was not — the same
 * defect as "the DETECTOR was tested and the GATE ACTING ON IT was not", one
 * layer along.
 *
 * So this file does one thing per dimension, and does it the only way that
 * proves independence: it makes EXACTLY ONE dimension false and asserts that
 * ALL NINE OTHERS STAY TRUE. A test that only asserts `mayPromote === false`
 * cannot tell a dimension that works from a dimension that is being failed by
 * its neighbour.
 *
 * ── FALSIFICATION (CLAUDE.md Rule 18 §1) ───────────────────────────────────
 *
 * Every case below was run against a deliberately neutered `checkPromotion` —
 * the dimension's own clause replaced with `true` — and each one failed BY
 * NAME. A gate that has never failed is a hypothesis. Twelve runs, twelve
 * failures, recorded here rather than in a report nobody will open:
 *
 *   athleteSpecificSupport → 4 failed  · "athleteSpecificSupport did NOT fail
 *                                        on a case built to break exactly it"
 *   wholeBlockCoherence    → 2 failed
 *   recoverability         → 1 failed
 *   progression            → 2 failed
 *   taperIntegrity         → 2 failed
 *   doctrineResolution     → 2 failed
 *   stackedStress          → 1 failed
 *   earningGateTiming      → 5 failed
 *   executionIdentity      → 2 failed
 *   evidenceProvenance     → 5 failed
 *
 * And the two that matter most, because they are the fixes rather than the
 * new checks — the code restored to its PRE-FIX form, not stubbed:
 *
 *   taperIntegrity re-keyed on `t.stacked` (the old predicate)
 *     → 2 failed · both taper cases, exactly the hole
 *   detectStackedStress grading a race week's long run again
 *     → 1 failed · "expected 0.4555555555555555 to be null"
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (CLAUDE.md Rule 22) ──────────────────────
 *
 * 1. WHETHER THE TEN DIMENSIONS ARE THE RIGHT TEN. It walks
 *    `PROMOTION_DIMENSIONS` and proves each is reachable and separable. A
 *    seventh kind of incoherent block that no dimension names is invisible
 *    here, and always will be.
 * 2. THE THRESHOLDS. `STEP_SUPPORTED_MAX`, `STEP_ALLOWED_MAX`,
 *    `STACKED_STRESSOR_THRESHOLD`, `VOLUME_ADDITION_THRESHOLD`,
 *    `MIN_GATE_LEAD_DAYS`. Every fixture is clearly inside or clearly outside
 *    them; moving any by a few points passes this whole file.
 * 3. WHETHER A BLOCKED BLOCK SHOULD HAVE BEEN BLOCKED. These are constructed
 *    traces, not composed plans. `_sweep_allusers.test.ts` runs the same gate
 *    over 89 real archetype blocks through `adjudication-corpus.ts`, which is
 *    where "does this fire on plans the engine actually authors" is answered.
 * 4. DISTRIBUTION, stated because Rule 22 asks for it: this file is exactly
 *    balanced by construction — one failing case per dimension, plus a clean
 *    baseline that must promote. There is no hold-versus-push instinct in it
 *    to inherit, because it never asks the layer to choose anything.
 */
import { describe, it, expect } from 'vitest';
import {
  athleteEvidenceFor, checkPromotion, detectStackedStress, earningGateFor,
  heuristicRankScore, MIN_GATE_LEAD_DAYS,
  type DemonstratedHistory, type PlannedWeek,
} from './adjudicate';
import { PROMOTION_DIMENSIONS } from './contract';
import type {
  ComparableSession, DecisionTrace, DoctrineCitation, EvidenceClass, OptionAppraisal,
  PromotionCheck, StackedStress,
} from './contract';

const WINDOW = 'the whole of 2026, canonical rows only';

const COMPARABLES: readonly ComparableSession[] = [
  { dateISO: '2026-06-07', what: '18 mi long run', distanceMi: 18, avgPaceSecPerMi: 480,
    avgHrBpm: 150, executed: true, next7DaysMi: 41.0, notes: '' },
  { dateISO: '2026-07-12', what: '17 mi long run', distanceMi: 17, avgPaceSecPerMi: 478,
    avgHrBpm: 149, executed: true, next7DaysMi: 44.2, notes: '' },
  { dateISO: '2026-08-16', what: '16 mi long run', distanceMi: 16, avgPaceSecPerMi: 470,
    avgHrBpm: 151, executed: true, next7DaysMi: 46.8, notes: '' },
];

const HIST: DemonstratedHistory = {
  peakWeeklyMi: 50,
  longestRunMi: 18,
  maxCompletedMpMi: 6,
  maxStressorsInAWeek: 3,
  after: COMPARABLES,
  windowDescribed: WINDOW,
};

/** Two ordinary build weeks. Neither reaches, and the step between them is
 *  under `VOLUME_ADDITION_THRESHOLD`, so the baseline trips nothing. */
const W1: PlannedWeek = {
  weekStartISO: '2026-09-07', weeklyMi: 48, longestMi: 16,
  stressors: ['threshold', '16 mi long run'], mpMi: 0, isTaper: false, isRaceWeek: false,
};
const W2: PlannedWeek = {
  weekStartISO: '2026-09-14', weeklyMi: 50, longestMi: 17,
  stressors: ['threshold', '17 mi long run'], mpMi: 0, isTaper: false, isRaceWeek: false,
};

function opt(o: OptionAppraisal['option'], cls: EvidenceClass): OptionAppraisal {
  return {
    option: o, describe: `${o.toLowerCase()} the week`, evidenceClass: cls,
    heuristicRankScore: heuristicRankScore(cls), risk: '',
  };
}

/** A clean, promotable decision about `week`. Every case below is this, with
 *  exactly one thing changed. */
function trace(week: PlannedWeek, over: Partial<DecisionTrace> = {}): DecisionTrace {
  return {
    decisionId: `wk:${week.weekStartISO}`,
    dateISO: week.weekStartISO,
    what: `weekly volume · ${week.weeklyMi} mi`,
    windowDays: 7,
    athlete: athleteEvidenceFor({
      what: `a ${week.weeklyMi} mi week`, asOfISO: week.weekStartISO, prescribed: week.weeklyMi,
      demonstratedMaxToday: HIST.peakWeeklyMi, demonstratedMaxProjected: week.weeklyMi,
      comparables: COMPARABLES, historyWindow: WINDOW,
    }),
    stacked: detectStackedStress(week, HIST),
    demand: null,
    options: [opt('PUSH', 'SUPPORTED'), opt('HOLD', 'SUPPORTED'), opt('PULL_BACK', 'SUPPORTED')],
    chosen: 'PUSH',
    because: 'he has held this volume and the week adds one thing at a time',
    rejected: [{ option: 'PUSH' as const, why: 'his last two long runs deteriorated in the final third against pace, so the week holds' }],
    conflicts: [],
    citations: [],
    reassessOnISO: null,
    earningGate: null,
    ...over,
  };
}

/**
 * THE ASSERTION THAT MAKES THIS FILE MEAN ANYTHING.
 *
 * Not "promotion was blocked". Not "this dimension is false". Both of those
 * pass on a gate where one broken clause fails every dimension at once, which
 * is precisely the state `recoverability` was in when it carried both stacked
 * stress and the one-at-a-time walk.
 */
function expectOnly(
  r: ReturnType<typeof checkPromotion>,
  dimension: keyof PromotionCheck,
) {
  const others = PROMOTION_DIMENSIONS.filter((d) => d !== dimension);
  const wronglyFalse = others.filter((d) => r.check[d] !== true);
  expect(
    wronglyFalse,
    `making ${dimension} false also took down ${wronglyFalse.join(', ')}. These dimensions are `
    + 'not independent, so a test on one of them proves nothing about the other.',
  ).toEqual([]);
  expect(r.check[dimension], `${dimension} did NOT fail on a case built to break exactly it`).toBe(false);
  expect(r.mayPromote).toBe(false);
  const named = r.blockedBecause.some((s) => s.startsWith(`${dimension} ·`));
  expect(named, `promotion was blocked but no message names ${dimension}. `
    + `Blocked because: ${r.blockedBecause.join(' | ')}`).toBe(true);
}

describe('ADJ-DIM-1 · the baseline promotes, so every failure below is the change', () => {
  it('a clean two-week block promotes on all ten dimensions', () => {
    const r = checkPromotion([trace(W1), trace(W2)], { weeks: [W1, W2] });
    const failed = PROMOTION_DIMENSIONS.filter((d) => !r.check[d]);
    expect(failed, `the baseline is not clean: ${r.blockedBecause.join(' | ')}`).toEqual([]);
    expect(r.mayPromote).toBe(true);
    expect(r.blockedBecause).toEqual([]);
  });

  it('the type and the list agree · a dimension added to one must reach the other', () => {
    // The `satisfies` in contract.ts catches a name that is not a key. It does
    // NOT catch a key that never makes it into the list, which is the direction
    // that matters: a dimension missing from PROMOTION_DIMENSIONS is never
    // walked by the belt-and-braces loop and never reported by this file.
    const r = checkPromotion([trace(W1)], { weeks: [W1] });
    expect([...PROMOTION_DIMENSIONS].sort()).toEqual(Object.keys(r.check).sort());
    expect(PROMOTION_DIMENSIONS.length).toBe(10);
  });
});

describe('ADJ-DIM-1 · athleteSpecificSupport', () => {
  it('BLOCKS a conditional decision with no gate and no reassessment', () => {
    const r = checkPromotion([
      trace(W1),
      trace(W2, {
        athlete: athleteEvidenceFor({
          what: 'a 68 mi week', asOfISO: W2.weekStartISO, prescribed: 68,
          demonstratedMaxToday: 50, demonstratedMaxProjected: null,
          comparables: COMPARABLES, historyWindow: WINDOW,
        }),
      }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'athleteSpecificSupport');
    expect(r.blockedBecause.join(' ')).toMatch(/carry no earning gate/);
  });

  it('RULE 11 · BLOCKS a PUSH on UNKNOWN evidence, which is an absence and not support', () => {
    // The gate collected CONDITIONAL and CONTRAINDICATED only, so a decision
    // the layer could say NOTHING about promoted silently. `contract.ts` calls
    // UNKNOWN "an honest absence (Rule 11)"; advancing into it needs a gate.
    const unknown = athleteEvidenceFor({
      what: 'a 10 mi marathon-pace dose', asOfISO: W2.weekStartISO, prescribed: 10,
      demonstratedMaxToday: null, demonstratedMaxProjected: null,
      comparables: [], historyWindow: WINDOW,
    });
    expect(unknown.evidenceClass).toBe('UNKNOWN');
    const r = checkPromotion([
      trace(W1),
      trace(W2, { decisionId: 'mp:2026-09-14', athlete: unknown, chosen: 'PUSH' }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'athleteSpecificSupport');
    expect(r.blockedBecause.join(' ')).toMatch(/An honest absence is not support/);
  });

  it('…and the same UNKNOWN decision promotes once it carries a gate', () => {
    const unknown = athleteEvidenceFor({
      what: 'a 10 mi marathon-pace dose', asOfISO: W2.weekStartISO, prescribed: 10,
      demonstratedMaxToday: null, demonstratedMaxProjected: null,
      comparables: [], historyWindow: WINDOW,
    });
    const r = checkPromotion([
      trace(W1),
      trace(W2, {
        decisionId: 'mp:2026-09-14', athlete: unknown, chosen: 'PUSH',
        reassessOnISO: '2026-09-07',
        earningGate: earningGateFor({
          decisionId: 'mp:2026-09-14', what: 'a 10 mi marathon-pace dose', prescribed: 10,
          demonstratedMaxToday: null, assessOnISO: '2026-09-07',
          requires: [{ what: 'an 8 mi M dose completed inside a long run', measurable: 'M miles >= 8 at grade FULL or SUBSTANTIAL', byISO: '2026-09-07' }],
          ifUnmet: 'DEFER', reduceTo: null,
        }),
      }),
    ], { weeks: [W1, W2] });
    expect(r.blockedBecause).toEqual([]);
    expect(r.mayPromote).toBe(true);
  });

  it('BLOCKS a refusal resting on a ceiling claim with too few comparables', () => {
    // `badCeiling`. NOTE, and it is a real limit on this dimension:
    // `classifyStep` cannot currently RETURN 'CONTRAINDICATED' — nothing in
    // `adjudicate.ts` produces that class — so the only way to reach this
    // clause is a caller who builds the evidence itself. That is exactly what
    // a future caller reading a runner's history WILL do, so the gate is
    // tested here rather than deleted, and the gap is named rather than
    // papered over.
    const base = athleteEvidenceFor({
      what: 'a 21 mi long run', asOfISO: W2.weekStartISO, prescribed: 21,
      demonstratedMaxToday: 18, demonstratedMaxProjected: 18,
      comparables: [COMPARABLES[0]], historyWindow: WINDOW,
    });
    const r = checkPromotion([
      trace(W1),
      trace(W2, {
        athlete: { ...base, evidenceClass: 'CONTRAINDICATED', ceilingClaim: null },
        chosen: 'PULL_BACK',
        reassessOnISO: '2026-09-07',
        earningGate: earningGateFor({
          decisionId: 'wk:2026-09-14', what: 'a 21 mi long run', prescribed: 21,
          demonstratedMaxToday: 18, assessOnISO: '2026-09-07',
          requires: [{ what: 'a 19 mi long run completed', measurable: 'long run >= 19', byISO: '2026-09-07' }],
          ifUnmet: 'REDUCE', reduceTo: 19,
        }),
      }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'athleteSpecificSupport');
    expect(r.blockedBecause.join(' ')).toMatch(/fewer than 3 comparables/);
  });
});

describe('ADJ-DIM-1 · wholeBlockCoherence', () => {
  it('BLOCKS a decision that did not compare all three options', () => {
    const r = checkPromotion([
      trace(W1),
      trace(W2, { options: [opt('PUSH', 'SUPPORTED'), opt('HOLD', 'SUPPORTED')] }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'wholeBlockCoherence');
  });

  it('BLOCKS a block where nothing was adjudicated at all', () => {
    /**
     * THE SILENT ZERO, and the ONE case where three dimensions correctly fail
     * together. That is not the coupling `expectOnly` exists to catch, so this
     * test states the three by name instead of using it — measured, then
     * written down, rather than assumed either way.
     *
     * With zero traces there IS no athlete-specific support and there IS no
     * progression; saying otherwise would be the "nonempty-array proxy"
     * inverted, a dimension reporting true because it looked at nothing. The
     * remaining seven are vacuously true — there is no violation in an empty
     * set — and promotion is blocked regardless, which is the outcome that
     * matters.
     */
    const r = checkPromotion([], { weeks: [W1, W2] });
    expect(r.mayPromote).toBe(false);
    const failed = PROMOTION_DIMENSIONS.filter((d) => !r.check[d]);
    expect([...failed].sort()).toEqual(
      ['athleteSpecificSupport', 'progression', 'wholeBlockCoherence'],
    );
    expect(r.blockedBecause.join(' ')).toMatch(/nothing was adjudicated at all/);
  });
});

describe('ADJ-DIM-1 · recoverability · one stressor at a time, across the SEQUENCE', () => {
  it('BLOCKS a week that adds mileage AND intensity with nobody having looked', () => {
    const jump: PlannedWeek = {
      weekStartISO: '2026-09-14', weeklyMi: 58, longestMi: 17,
      stressors: ['threshold', 'intervals', '17 mi long run'],
      mpMi: 0, isTaper: false, isRaceWeek: false,
    };
    // Only the FIRST week is traced, so the jump week has no decision at all —
    // "the worst case: nobody looked."
    const r = checkPromotion([trace(W1)], { weeks: [W1, jump] });
    expectOnly(r, 'recoverability');
    expect(r.blockedBecause.join(' ')).toMatch(/add mileage AND intensity/);
  });

  it('…and clears once the week is traced and gated, because the rule asks for an argument', () => {
    const jump: PlannedWeek = {
      weekStartISO: '2026-09-14', weeklyMi: 58, longestMi: 17,
      stressors: ['threshold', 'intervals', '17 mi long run'],
      mpMi: 0, isTaper: false, isRaceWeek: false,
    };
    const r = checkPromotion([
      trace(W1),
      trace(jump, {
        reassessOnISO: '2026-09-07',
        earningGate: earningGateFor({
          decisionId: 'wk:2026-09-14', what: 'a 58 mi week', prescribed: 58,
          demonstratedMaxToday: 50, assessOnISO: '2026-09-07',
          requires: [{ what: 'the 48 mi week completed', measurable: 'weekly mileage >= 48', byISO: '2026-09-07' }],
          ifUnmet: 'REDUCE', reduceTo: 50,
        }),
      }),
    ], { weeks: [W1, jump] });
    expect(r.check.recoverability).toBe(true);
  });
});

describe('ADJ-DIM-1 · progression · Rule 21 at the gate', () => {
  it('BLOCKS a block that never advances anything', () => {
    const r = checkPromotion([
      trace(W1, { chosen: 'HOLD' }),
      trace(W2, { chosen: 'PULL_BACK' }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'progression');
    expect(r.blockedBecause.join(' ')).toMatch(/no decision in this block advances anything/);
  });
});

describe('ADJ-DIM-1 · taperIntegrity', () => {
  /**
   * THE ONE THAT WAS STRUCTURALLY UNFAILABLE.
   *
   * The old predicate was `t.chosen === 'PUSH' && t.stacked != null &&
   * taperWeeks.has(t.stacked.weekStartISO)`. `detectStackedStress` returns
   * NULL for an ordinary taper week — low volume, one stressor, a short long
   * run, so none of `overStressed` / `volReach` / `longReach` fires — which
   * means a real PUSH inside a real taper could not reach the filter. Its one
   * test hand-built a `StackedStress` the detector would never emit, so the
   * dimension read as covered while nothing the composer can produce could
   * ever fail it.
   */
  const taper: PlannedWeek = {
    weekStartISO: '2026-09-14', weeklyMi: 36, longestMi: 10,
    stressors: ['tempo'], mpMi: 0, isTaper: true, isRaceWeek: false,
  };

  it('the detector really does return null for an ordinary taper week', () => {
    // Falsifying the premise before trusting the fix. If this ever returns a
    // StackedStress, the paragraph above is wrong and the test below is
    // testing something else.
    expect(detectStackedStress(taper, HIST)).toBeNull();
  });

  it('BLOCKS a PUSH inside a taper week that carries NO stacked stress', () => {
    const r = checkPromotion([
      trace(W1),
      trace(taper, { chosen: 'PUSH' }),
    ], { weeks: [W1, taper] });
    expectOnly(r, 'taperIntegrity');
    expect(r.blockedBecause.join(' ')).toMatch(/PUSH inside a taper or race week/);
  });

  it('BLOCKS a PUSH inside a RACE week the same way', () => {
    const raceWeek: PlannedWeek = {
      weekStartISO: '2026-09-14', weeklyMi: 30, longestMi: 0,
      stressors: ['race · 26.2 mi'], mpMi: 0, isTaper: false, isRaceWeek: true,
    };
    const r = checkPromotion([
      trace(W1),
      trace(raceWeek, { chosen: 'PUSH' }),
    ], { weeks: [W1, raceWeek] });
    expectOnly(r, 'taperIntegrity');
  });
});

describe('ADJ-DIM-1 · doctrineResolution', () => {
  const hard: DoctrineCitation = {
    source: 'Research/00a', section: '§"Practical load rules"',
    says: '>110% of the longest run in the prior 30 days', force: 'HARD_CONSTRAINT',
  };
  const guide: DoctrineCitation = {
    source: 'Research/22', section: '§"Marathon — Intermediate"',
    says: 'peak long run 20-22 mi', force: 'GUIDELINE',
  };

  it('BLOCKS a conflict nobody argued', () => {
    const r = checkPromotion([
      trace(W1),
      trace(W2, { conflicts: [{ between: [hard, guide], resolvedInFavourOf: 0, because: '   ' }] }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'doctrineResolution');
  });

  it('BLOCKS a "resolution" that hands it to the WEAKER citation', () => {
    // The clause the empty-string check was standing in for, and the only one
    // the supported path can actually produce: `adjudicate()` always writes a
    // sentence and throws outright on two equal-force citations with no
    // argument, so an empty `because` needs a hand-written literal. Letting a
    // GUIDELINE beat a HARD_CONSTRAINT is exactly the cherry-picking
    // `contract.ts` says this type exists to stop.
    const r = checkPromotion([
      trace(W1),
      trace(W2, {
        conflicts: [{
          between: [hard, guide], resolvedInFavourOf: 1,
          because: 'the template says 20-22, so the long run goes to 22',
        }],
      }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'doctrineResolution');
  });
});

describe('ADJ-DIM-1 · stackedStress', () => {
  it('BLOCKS a week that peaks in volume, long run AND stressor count and is pushed', () => {
    const peak: PlannedWeek = {
      weekStartISO: '2026-09-14', weeklyMi: 66, longestMi: 21.5,
      stressors: ['6 mi at T', '9x3 min at I', '21.5 mi long run', 'strides'],
      mpMi: 0, isTaper: false, isRaceWeek: false,
    };
    const s = detectStackedStress(peak, HIST);
    expect(s?.simultaneousPeak).toBe(true);
    // Traced AND gated, so `athleteSpecificSupport` and `recoverability` are
    // both satisfied and only the stacked-peak clause is left to fire. That
    // separation is the point: a gate clears an argued one-at-a-time week, and
    // it does NOT clear a simultaneous peak, because doctrine's answer there is
    // not "argue it" but "do not do it".
    const r = checkPromotion([
      trace(W1),
      trace(peak, {
        chosen: 'PUSH',
        reassessOnISO: '2026-09-07',
        earningGate: earningGateFor({
          decisionId: 'wk:2026-09-14', what: 'a 66 mi week', prescribed: 66,
          demonstratedMaxToday: 50, assessOnISO: '2026-09-07',
          requires: [{ what: 'the 48 mi week completed', measurable: 'weekly mileage >= 48', byISO: '2026-09-07' }],
          ifUnmet: 'REDUCE', reduceTo: 50,
        }),
      }),
    ], { weeks: [W1, peak] });
    expectOnly(r, 'stackedStress');
  });
});

describe('ADJ-DIM-1 · earningGateTiming', () => {
  const gateAt = (assessOnISO: string, byISO: string, ifUnmet: 'DEFER' | 'REDUCE' | 'DROP' = 'REDUCE', reduceTo: number | null = 50) =>
    earningGateFor({
      decisionId: 'wk:2026-09-14', what: 'a 58 mi week', prescribed: 58,
      demonstratedMaxToday: 50, assessOnISO,
      requires: [{ what: 'the 48 mi week completed', measurable: 'weekly mileage >= 48', byISO }],
      ifUnmet, reduceTo,
    });

  it('BLOCKS a gate assessed ON the day it guards · it has nothing left to change', () => {
    const r = checkPromotion([
      trace(W1),
      trace(W2, { earningGate: gateAt('2026-09-14', '2026-09-14') }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'earningGateTiming');
    expect(r.blockedBecause.join(' ')).toMatch(/nothing left to defer, reduce or drop/);
  });

  it('BLOCKS a gate assessed AFTER the prescription it guards', () => {
    const r = checkPromotion([
      trace(W1),
      trace(W2, { earningGate: gateAt('2026-09-21', '2026-09-14') }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'earningGateTiming');
  });

  it('BLOCKS a gate that asks whether a week which has not yet run has completed', () => {
    // Assessed on the 7th, requiring something by the 13th. On the day it runs,
    // the answer does not exist yet.
    const r = checkPromotion([
      trace(W1),
      trace(W2, { earningGate: gateAt('2026-09-07', '2026-09-13') }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'earningGateTiming');
    expect(r.blockedBecause.join(' ')).toMatch(/has not yet run has completed/);
  });

  it('BLOCKS a REDUCE gate that names no reduced value', () => {
    const r = checkPromotion([
      trace(W1),
      trace(W2, { earningGate: gateAt('2026-09-07', '2026-09-07', 'REDUCE', null) }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'earningGateTiming');
    expect(r.blockedBecause.join(' ')).toMatch(/"REDUCE" is a word rather than an instruction/);
  });

  it('BLOCKS a gate whose dates are not dates, rather than treating them as zero days apart', () => {
    const r = checkPromotion([
      trace(W1),
      trace(W2, { earningGate: gateAt('soon', '2026-09-07') }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'earningGateTiming');
    expect(r.blockedBecause.join(' ')).toMatch(/is not an ISO day/);
  });

  it('PASSES the minimum lead · one day before the week it guards is assessable', () => {
    // `MIN_GATE_LEAD_DAYS` read from the module, not retyped, so moving the
    // constant moves this test with it instead of leaving it agreeing with an
    // old number (Rule 18: never hardcode both sides).
    expect(MIN_GATE_LEAD_DAYS).toBe(1);
    const r = checkPromotion([
      trace(W1),
      trace(W2, { earningGate: gateAt('2026-09-13', '2026-09-13') }),
    ], { weeks: [W1, W2] });
    expect(r.check.earningGateTiming).toBe(true);
    expect(r.mayPromote).toBe(true);
  });
});

describe('ADJ-DIM-1 · executionIdentity', () => {
  const raceWeek: PlannedWeek = {
    weekStartISO: '2026-09-14', weeklyMi: 34, longestMi: 26.2,
    stressors: ['race · 26.2 mi'], mpMi: 0, isTaper: false, isRaceWeek: true,
  };

  it('THE DETECTOR · the goal race is not graded as a training long run', () => {
    // 26.2 against a demonstrated longest TRAINING run of 18 is +46%, which
    // reads as an injury-grade long-run spike in every marathon block ever
    // authored. Volume is still compared, because a race week is a real week
    // of load the legs absorb (Rule 8's corollary).
    const s = detectStackedStress(raceWeek, HIST);
    if (s != null) expect(s.longRunOverDemonstratedMax).toBeNull();
    const ordinary = detectStackedStress({ ...raceWeek, isRaceWeek: false }, HIST);
    expect(ordinary).not.toBeNull();
    expect(ordinary!.longRunOverDemonstratedMax).toBeCloseTo(0.456, 2);
  });

  it('THE GATE ACTING ON IT · BLOCKS a race week whose distance IS graded that way', () => {
    // Detector and gate, both. The defect found on 2026-09-04 was that
    // disabling a promotion-level block left the suite green because only the
    // detector was tested, so every detector in this layer now has a paired
    // gate case.
    const handBuilt: StackedStress = {
      weekStartISO: raceWeek.weekStartISO,
      stressors: raceWeek.stressors,
      weeklyMi: raceWeek.weeklyMi,
      longestMi: raceWeek.longestMi,
      volumeOverDemonstratedMax: -0.32,
      longRunOverDemonstratedMax: 0.456,
      simultaneousPeak: false,
      why: 'a caller that graded the race as a long run',
    };
    const r = checkPromotion([
      trace(W1),
      trace(raceWeek, { chosen: 'HOLD', stacked: handBuilt }),
    ], { weeks: [W1, raceWeek] });
    expectOnly(r, 'executionIdentity');
    expect(r.blockedBecause.join(' ')).toMatch(/A race is not a long run/);
  });

  it('BLOCKS a decision about a week that is not in this block at all', () => {
    const r = checkPromotion([
      trace(W1),
      trace({ ...W2, weekStartISO: '2027-01-04' }, { chosen: 'HOLD' }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'executionIdentity');
    expect(r.blockedBecause.join(' ')).toMatch(/not a week of this block/);
  });
});

describe('ADJ-DIM-1 · evidenceProvenance', () => {
  it('BLOCKS a measurement printed as a policy assumption', () => {
    const base = trace(W2);
    const r = checkPromotion([
      trace(W1),
      {
        ...base,
        athlete: {
          ...base.athlete,
          demonstratedMaxToday: { ...base.athlete.demonstratedMaxToday, provenance: 'POLICY_ASSUMPTION' },
        },
      },
    ], { weeks: [W1, W2] });
    expectOnly(r, 'evidenceProvenance');
    expect(r.blockedBecause.join(' ')).toMatch(/demonstratedMaxToday is reported as POLICY_ASSUMPTION/);
  });

  it('BLOCKS a projection printed as calculated physiology', () => {
    const base = trace(W2);
    const r = checkPromotion([
      trace(W1),
      {
        ...base,
        athlete: {
          ...base.athlete,
          demonstratedMaxProjected: { ...base.athlete.demonstratedMaxProjected, provenance: 'CALCULATED_PHYSIOLOGY' },
        },
      },
    ], { weeks: [W1, W2] });
    expectOnly(r, 'evidenceProvenance');
  });

  it('BLOCKS a number with no basis · "Never empty", says the type', () => {
    const base = trace(W2);
    const r = checkPromotion([
      trace(W1),
      {
        ...base,
        athlete: {
          ...base.athlete,
          demonstratedMaxToday: { ...base.athlete.demonstratedMaxToday, basis: '  ' },
        },
      },
    ], { weeks: [W1, W2] });
    expectOnly(r, 'evidenceProvenance');
    expect(r.blockedBecause.join(' ')).toMatch(/carries no basis/);
  });

  it('BLOCKS a ranking score printed as a measurement · defect 4, at the gate', () => {
    const r = checkPromotion([
      trace(W1),
      trace(W2, {
        options: [
          { ...opt('PUSH', 'SUPPORTED'), heuristicRankScore: { value: 0.95, provenance: 'ATHLETE_EVIDENCE', basis: 'measured' } },
          opt('HOLD', 'SUPPORTED'),
          opt('PULL_BACK', 'SUPPORTED'),
        ],
      }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'evidenceProvenance');
    expect(r.blockedBecause.join(' ')).toMatch(/heuristicRankScore is reported as ATHLETE_EVIDENCE/);
  });

  it('RULE 11 · BLOCKS a ranked UNKNOWN, which is an invented number', () => {
    expect(heuristicRankScore('UNKNOWN')).toBeNull();
    const r = checkPromotion([
      trace(W1),
      trace(W2, {
        options: [
          { ...opt('PUSH', 'UNKNOWN'), heuristicRankScore: { value: 0.5, provenance: 'POLICY_ASSUMPTION', basis: 'a guess' } },
          opt('HOLD', 'SUPPORTED'),
          opt('PULL_BACK', 'SUPPORTED'),
        ],
      }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'evidenceProvenance');
    expect(r.blockedBecause.join(' ')).toMatch(/Ranking an unknown means inventing a number/);
  });

  it('BLOCKS an option that was never ranked, so the comparison was not made', () => {
    const r = checkPromotion([
      trace(W1),
      trace(W2, {
        options: [
          { ...opt('PUSH', 'SUPPORTED'), heuristicRankScore: null },
          opt('HOLD', 'SUPPORTED'),
          opt('PULL_BACK', 'SUPPORTED'),
        ],
      }),
    ], { weeks: [W1, W2] });
    expectOnly(r, 'evidenceProvenance');
    expect(r.blockedBecause.join(' ')).toMatch(/was not ranked at all/);
  });
});
