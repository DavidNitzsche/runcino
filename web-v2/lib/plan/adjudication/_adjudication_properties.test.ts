/**
 * ADJ-PROP-1 · THE FOUR CORRECTNESS PROPERTIES, AND THE DETECTOR→GATE SWEEP.
 *
 * Two jobs, because they are the same job:
 *
 * 1 · The properties the owner named on 2026-09-04 — the goal race is not a
 *     training long run, counts are numbers before arithmetic, a reassessment
 *     precedes the decision it guards, and null/unknown never becomes zero or
 *     false evidence through the WHOLE `checkPromotion` path.
 * 2 · The DETECTOR→GATE registry. The defect found earlier that day was that
 *     "disabling the promotion-level block left the whole suite green, because
 *     the DETECTOR was tested and the GATE ACTING ON IT was not." That is a
 *     structural gap, so it gets a structural check: every detector in this
 *     layer is named here beside the promotion dimension that acts on it, or
 *     beside an argued reason why nothing does. The registry is a RATCHET.
 *
 * ── FALSIFICATION (Rule 18 §1) ─────────────────────────────────────────────
 *
 * Every property below was run against the pre-fix code and failed:
 *   · the race-week clause removed from `detectStackedStress` → the long-run
 *     identity test fails with `expected 0.4555555555555555 to be null`.
 *   · `taperIntegrity` keyed on `t.stacked` → the taper cases pass a PUSH
 *     inside a taper.
 *   · `earningGateTiming`, `executionIdentity` and `evidenceProvenance`
 *     replaced with `true` → each named case fails by name.
 * The verbatim messages are in the handback for this change.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (CLAUDE.md Rule 22) ──────────────────────
 *
 * · THE REGISTRY BEING COMPLETE. It is a hand-written list checked for
 *   staleness in one direction only — an entry naming a dimension that no
 *   longer exists fails, and an entry whose reason went stale does not. A
 *   detector added tomorrow and left out of the list is invisible, and there
 *   is no import-graph scan behind it. Stated rather than implied.
 * · THE NUMBERS. Same as every file in this directory: the bands, the
 *   thresholds and the four ranking weights are all uncalibrated policy, and
 *   nothing here can tell whether they are right.
 * · WHETHER `weekly-demand.ts` IS CORRECT. It is deliberately ungated at the
 *   promotion level (see the registry) and has its own three test files.
 */
import { describe, it, expect } from 'vitest';
import {
  athleteEvidenceFor, ceilingClaimFrom, checkPromotion, classifyStep, daysBetweenISO,
  detectSimultaneousStressAddition, detectStackedStress, earningGateFor, heuristicRankScore,
  rankOptions, MIN_GATE_LEAD_DAYS,
  type DemonstratedHistory, type PlannedWeek,
} from './adjudicate';
import { MIN_COMPARABLES_FOR_CEILING_CLAIM, PROMOTION_DIMENSIONS } from './contract';
import type {
  ComparableSession, DecisionTrace, EvidenceClass, OptionAppraisal, PromotionCheck,
} from './contract';
import {
  asCount, asMeasure, demonstratedHistoryFrom, plannedWeeksFrom, stressorsOfComposedWeek,
  adjudicateComposedBlock,
} from '../adjudication-corpus';
import type { RenderedHistory } from '../history-shapes';

const WINDOW = 'the whole of 2026, canonical rows only';

const COMPARABLES: readonly ComparableSession[] = [
  { dateISO: '2026-06-07', what: '18 mi long run', distanceMi: 18, avgPaceSecPerMi: 480, avgHrBpm: 150, executed: true, next7DaysMi: 41.0, notes: '' },
  { dateISO: '2026-07-12', what: '17 mi long run', distanceMi: 17, avgPaceSecPerMi: 478, avgHrBpm: 149, executed: true, next7DaysMi: 44.2, notes: '' },
  { dateISO: '2026-08-16', what: '16 mi long run', distanceMi: 16, avgPaceSecPerMi: 470, avgHrBpm: 151, executed: true, next7DaysMi: 46.8, notes: '' },
];

const HIST: DemonstratedHistory = {
  peakWeeklyMi: 50, longestRunMi: 18, maxCompletedMpMi: 6, maxStressorsInAWeek: 3,
  after: COMPARABLES, windowDescribed: WINDOW,
};

const opt = (o: OptionAppraisal['option'], cls: EvidenceClass): OptionAppraisal => ({
  option: o, describe: '', evidenceClass: cls, heuristicRankScore: heuristicRankScore(cls), risk: '',
});

const W1: PlannedWeek = {
  weekStartISO: '2026-09-07', weeklyMi: 48, longestMi: 16,
  stressors: ['threshold', '16 mi long run'], mpMi: 0, isTaper: false, isRaceWeek: false,
};

function trace(week: PlannedWeek, over: Partial<DecisionTrace> = {}): DecisionTrace {
  return {
    decisionId: `wk:${week.weekStartISO}`, dateISO: week.weekStartISO,
    what: `weekly volume · ${week.weeklyMi} mi`, windowDays: 7,
    athlete: athleteEvidenceFor({
      what: `a ${week.weeklyMi} mi week`, asOfISO: week.weekStartISO, prescribed: week.weeklyMi,
      demonstratedMaxToday: HIST.peakWeeklyMi, demonstratedMaxProjected: week.weeklyMi,
      comparables: COMPARABLES, historyWindow: WINDOW,
    }),
    stacked: detectStackedStress(week, HIST),
    demand: null,
    options: [opt('PUSH', 'SUPPORTED'), opt('HOLD', 'SUPPORTED'), opt('PULL_BACK', 'SUPPORTED')],
    chosen: 'PUSH', because: '', rejected: [], conflicts: [], citations: [],
    reassessOnISO: null, earningGate: null,
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * PROPERTY 1 · THE GOAL RACE IS NOT A TRAINING LONG RUN
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ADJ-PROP-1 · the goal race is not graded as a training long run', () => {
  const marathonRaceWeek: PlannedWeek = {
    weekStartISO: '2026-12-07', weeklyMi: 34, longestMi: 26.2,
    stressors: ['race · 26.2 mi'], mpMi: 0, isTaper: false, isRaceWeek: true,
  };

  it('a 26.2 mi race week reports NO long-run reach over his 18 mi training longest', () => {
    const s = detectStackedStress(marathonRaceWeek, HIST);
    // Either no stacked stress at all, or stacked stress that declines to
    // compare the race against a training long run. Both are correct; grading
    // the race as +46% is not.
    if (s != null) expect(s.longRunOverDemonstratedMax).toBeNull();
  });

  it('…while the SAME week, not marked a race, is correctly a +46% reach', () => {
    // The control. Without this, "returns null" is satisfied by a detector that
    // stopped working, which is Rule 13 §3 — assert the shape of the result,
    // not the absence of the defect.
    const s = detectStackedStress({ ...marathonRaceWeek, isRaceWeek: false }, HIST);
    expect(s).not.toBeNull();
    expect(s!.longRunOverDemonstratedMax).toBeCloseTo(0.456, 3);
  });

  it('VOLUME is still compared on a race week · Rule 8\'s corollary', () => {
    // A race week is a real week of load the legs absorb. Rule 8 says a taper
    // is never his NORMAL; it does not say the week did not happen, and an
    // absorbed-load reader keeps the literal number.
    const heavy: PlannedWeek = { ...marathonRaceWeek, weeklyMi: 70 };
    const s = detectStackedStress(heavy, HIST);
    expect(s).not.toBeNull();
    expect(s!.volumeOverDemonstratedMax).toBeCloseTo(0.4, 3);
  });

  it('the CORPUS BRIDGE keeps the same identity on both sides of the comparison', () => {
    // `plannedWeeksFrom` must not report a race as the week's long run either,
    // or the two halves of `longestMi / longestRunMi` would be measuring
    // different things (Rule 16).
    const [w] = plannedWeeksFrom([{
      startISO: '2026-12-07', phase: 'RACE', weeklyMi: 34, isRaceWeek: true,
      days: [
        { type: 'race', distanceMi: 26.2, isQuality: true, isLong: true, subLabel: 'CIM' },
        { type: 'easy', distanceMi: 4, isQuality: false, isLong: false, subLabel: null },
      ],
    }]);
    expect(w.longestMi).toBe(0);
    expect(w.isRaceWeek).toBe(true);
    // …and the race still counts as a STRESSOR, because it is one.
    expect(stressorsOfComposedWeek({
      startISO: '2026-12-07', phase: 'RACE', weeklyMi: 34, isRaceWeek: true,
      days: [{ type: 'race', distanceMi: 26.2, isQuality: true, isLong: true, subLabel: 'CIM' }],
    })).toEqual(['race · 26.2 mi']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROPERTY 2 · COUNTS ARE NUMBERS BEFORE THEY ARE ARITHMETIC
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ADJ-PROP-1 · counts are numeric before arithmetic', () => {
  it('THE TRAP, stated · pg hands back a string and JS concatenates it', () => {
    // Not a check on our code. A check that the hazard is what we think it is,
    // so the guard below is guarding something real. This is the live bug from
    // `scripts/_cim_block_adjudication.mjs`, whose own comment records it:
    // "pg returns count(*) as a string. `'2' + 1` is '21', which is how this
    //  first printed a runner with 21 stressors in a week."
    const pgCount: unknown = '2';
    expect((pgCount as string) + 1).toBe('21');
    expect(Number(pgCount) + 1).toBe(3);
    // And the comparison half, which is quieter and worse.
    expect('9' > '10').toBe(true);
    expect(Number('9') > Number('10')).toBe(false);
  });

  it('asCount takes a pg count and refuses everything that is not one', () => {
    expect(asCount('2')).toBe(2);
    expect(asCount(' 12 ')).toBe(12);
    expect(asCount(0)).toBe(0);
    expect(asCount(3n)).toBe(3);
    // Refusals, every one of which `Number()` would have turned into a number.
    expect(asCount('')).toBeNull();          // Number('') === 0
    expect(asCount(null)).toBeNull();        // Number(null) === 0
    expect(asCount(undefined)).toBeNull();
    expect(asCount([])).toBeNull();          // Number([]) === 0
    expect(asCount('2.5')).toBeNull();       // a count is an integer
    expect(asCount(-1)).toBeNull();
    expect(asCount('1e3')).toBeNull();
    expect(asCount(Number.NaN)).toBeNull();
    expect(asCount('99999999999999999999')).toBeNull();  // past the safe range
  });

  it('asMeasure takes a pg numeric and refuses everything that is not one', () => {
    expect(asMeasure('48.0')).toBe(48);
    expect(asMeasure(-3.25)).toBe(-3.25);
    expect(asMeasure('')).toBeNull();
    expect(asMeasure(null)).toBeNull();
    expect(asMeasure([])).toBeNull();
    expect(asMeasure('n/a')).toBeNull();
    expect(asMeasure(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('a pg-SHAPED history crosses the boundary as numbers, and compares correctly', () => {
    // The whole point: the same object a DB-backed caller will hand in, with
    // every number as a string, must come out the other side arithmetically
    // usable. Before the guard, `peakWeeklyMi` would be `'9.0'` and a 10-mile
    // week would classify as a REDUCTION, because `'9.0' > 10` is false and
    // `10 / '9.0'` happens to work while `'9.0' + 1` does not.
    const pgish = {
      peakWeeklyMi: '48.0', longestRunMi: '18.0', maxStressorsInAWeek: '3',
      longRunComparables: [{ daysAgo: '14', distanceMi: '18.0', executed: true, next7DaysMi: '41.0' }],
    } as unknown as RenderedHistory;
    const h = demonstratedHistoryFrom(pgish, '2026-09-07', WINDOW);
    expect(typeof h.peakWeeklyMi).toBe('number');
    expect(typeof h.longestRunMi).toBe('number');
    expect(typeof h.maxStressorsInAWeek).toBe('number');
    expect(h.peakWeeklyMi).toBe(48);
    expect(h.maxStressorsInAWeek).toBe(3);
    expect(typeof h.after[0].distanceMi).toBe('number');
    expect(h.after[0].next7DaysMi).toBe(41);
    // And the arithmetic downstream is real arithmetic.
    expect(classifyStep(50, h.peakWeeklyMi).step).toBeCloseTo(50 / 48 - 1, 6);
  });

  it('a count that is NOT a count becomes null, never zero (Rule 11)', () => {
    const broken = {
      peakWeeklyMi: 48, longestRunMi: 18, maxStressorsInAWeek: 'lots',
      longRunComparables: [],
    } as unknown as RenderedHistory;
    const h = demonstratedHistoryFrom(broken, '2026-09-07', WINDOW);
    expect(h.maxStressorsInAWeek).toBeNull();
    // …and a null max stressor count means the stressor comparison is simply
    // not made, rather than every week reading as over-stressed against zero.
    const twoStressors: PlannedWeek = { ...W1, stressors: ['threshold', '16 mi long run'] };
    expect(detectStackedStress(twoStressors, h)).toBeNull();
  });

  it('ceilingClaimFrom counts its comparables as a NUMBER against the doctrine minimum', () => {
    const c3 = ceilingClaimFrom(COMPARABLES, (x) => x.distanceMi);
    expect(typeof c3!.comparableCount).toBe('number');
    expect(c3!.comparableCount).toBe(3);
    expect(c3!.comparableCount >= MIN_COMPARABLES_FOR_CEILING_CLAIM).toBe(true);
    expect(c3!.valid).toBe(true);
    // A ceiling is the MAXIMUM of the set, never the smallest member of it.
    expect(c3!.value).toBe(18);
    const c1 = ceilingClaimFrom([COMPARABLES[2]], (x) => x.distanceMi);
    expect(c1!.valid).toBe(false);
    expect(c1!.comparableCount).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROPERTY 3 · A REASSESSMENT PRECEDES THE DECISION IT GUARDS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ADJ-PROP-1 · a reassessment precedes the decision it guards, correctly', () => {
  it('daysBetweenISO returns null for a non-date, never zero', () => {
    expect(daysBetweenISO('2026-09-07', '2026-09-14')).toBe(7);
    expect(daysBetweenISO('2026-09-14', '2026-09-07')).toBe(-7);
    expect(daysBetweenISO('2026-09-07', '2026-09-07')).toBe(0);
    // The Rule 11 half. `Date.parse('soon')` is NaN and `Math.round(NaN/…)` is
    // NaN, and `NaN < 1` is FALSE — so a swallowed bad date reads as a gate
    // with plenty of lead time, which is the most dangerous possible answer.
    expect(daysBetweenISO('soon', '2026-09-07')).toBeNull();
    expect(daysBetweenISO('2026-09-07', '')).toBeNull();
    expect(daysBetweenISO('09/07/2026', '2026-09-07')).toBeNull();
    expect(daysBetweenISO('2026-9-7', '2026-09-07')).toBeNull();
  });

  it('the CORPUS BRIDGE issues gates that clear the timing dimension on every block', () => {
    // Not a unit assertion about one gate: the whole 16-week rendered block,
    // through the real engine's own week shapes. This is the property that
    // caught a live defect on its first run — the bridge emitted
    // `ifUnmet: 'REDUCE'` with `reduceTo: null` on a block's FIRST
    // marathon-pace dose, which is an instruction to reduce to nothing.
    const mondayISO = (i: number) =>
      new Date(Date.parse('2026-09-07T00:00:00Z') + i * 7 * 86_400_000).toISOString().slice(0, 10);
    const weeks = Array.from({ length: 8 }, (_, i) => ({
      startISO: mondayISO(i),
      phase: i === 7 ? 'TAPER' : 'BUILD',
      weeklyMi: 40 + i * 2,
      isRaceWeek: false,
      days: [
        { type: 'long', distanceMi: 14 + i, isQuality: false, isLong: true, subLabel: i > 2 ? `${i}mi @ M` : null },
        { type: 'threshold', distanceMi: 8, isQuality: true, isLong: false, subLabel: '4mi @ T' },
        { type: 'easy', distanceMi: 6, isQuality: false, isLong: false, subLabel: null },
      ],
    }));
    const rendered = {
      peakWeeklyMi: 50, longestRunMi: 18, maxStressorsInAWeek: 3,
      longRunComparables: [
        { daysAgo: 7, distanceMi: 18, executed: true, next7DaysMi: 41 },
        { daysAgo: 35, distanceMi: 17, executed: true, next7DaysMi: 44 },
        { daysAgo: 63, distanceMi: 16, executed: true, next7DaysMi: 46 },
      ],
    } as unknown as RenderedHistory;

    const adj = adjudicateComposedBlock({
      rendered, weeks, blockStartISO: '2026-09-07', windowDescribed: WINDOW,
    })!;
    expect(adj).not.toBeNull();
    expect(adj.result.check.earningGateTiming).toBe(true);
    // Every gate is assessable, and every requirement is answerable when it runs.
    expect(adj.result.earningGates.length).toBeGreaterThan(0);
    for (const g of adj.result.earningGates) {
      const decision = adj.result.traces.find((t) => t.earningGate?.gateId === g.gateId)!;
      const lead = daysBetweenISO(g.assessOnISO, decision.dateISO)!;
      expect(lead).toBeGreaterThanOrEqual(MIN_GATE_LEAD_DAYS);
      for (const r of g.requires) expect(daysBetweenISO(r.byISO, g.assessOnISO)!).toBeGreaterThanOrEqual(0);
      if (g.ifUnmet === 'REDUCE') expect(g.reduceTo).not.toBeNull();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PROPERTY 4 · NULL AND UNKNOWN SURVIVE THE WHOLE PATH
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ADJ-PROP-1 · unknown stays unknown, all the way through checkPromotion', () => {
  it('classifyStep · a missing demonstrated max is UNKNOWN, not a zero baseline', () => {
    expect(classifyStep(20, null).cls).toBe('UNKNOWN');
    expect(classifyStep(20, null).step).toBeNull();
    expect(classifyStep(null, 20).cls).toBe('UNKNOWN');
    // A demonstrated max of ZERO is also UNKNOWN here, and deliberately: the
    // step is a RATIO, and dividing by nothing has no answer. It is the one
    // place the two facts legitimately share an outcome, because the OUTPUT is
    // undefined rather than because the inputs were collapsed.
    expect(classifyStep(20, 0).cls).toBe('UNKNOWN');
  });

  it('heuristicRankScore · an unknown is not ranked, because ranking it invents a number', () => {
    expect(heuristicRankScore('UNKNOWN')).toBeNull();
    for (const c of ['SUPPORTED', 'ALLOWED', 'CONDITIONAL', 'CONTRAINDICATED'] as const) {
      expect(heuristicRankScore(c)!.provenance).toBe('POLICY_ASSUMPTION');
      expect(heuristicRankScore(c)!.basis.trim()).not.toBe('');
    }
  });

  it('rankOptions · an unranked option sinks, it does not win by default', () => {
    const ranked = rankOptions([opt('PUSH', 'UNKNOWN'), opt('HOLD', 'SUPPORTED'), opt('PULL_BACK', 'SUPPORTED')]);
    expect(ranked[0].option).toBe('HOLD');
    expect(ranked[ranked.length - 1].option).toBe('PUSH');
  });

  it('athleteEvidenceFor · UNKNOWN says so in the sentence, and does not read as a pass', () => {
    const e = athleteEvidenceFor({
      what: 'a 10 mi marathon-pace dose', asOfISO: '2026-09-14', prescribed: 10,
      demonstratedMaxToday: null, demonstratedMaxProjected: null,
      comparables: [], historyWindow: WINDOW,
    });
    expect(e.evidenceClass).toBe('UNKNOWN');
    expect(e.why).toMatch(/That is an absence, not a pass\./);
    expect(e.stepOverDemonstratedToday).toBeNull();
    expect(e.stepOverProjected).toBeNull();
    expect(e.demonstratedMaxToday.value).toBeNull();
  });

  it('THE WHOLE PATH · an UNKNOWN PUSH does not promote, and the message says why', () => {
    // The end-to-end statement of Rule 11 for this layer. Before CORPUS-ADJ-1
    // `checkPromotion` collected CONDITIONAL and CONTRAINDICATED only, so a
    // prescription the layer could say NOTHING about promoted in silence —
    // "the safest possible reading of the data produced the most aggressive
    // plan", verbatim.
    const unknown = athleteEvidenceFor({
      what: 'a 10 mi marathon-pace dose', asOfISO: '2026-09-07', prescribed: 10,
      demonstratedMaxToday: null, demonstratedMaxProjected: null,
      comparables: [], historyWindow: WINDOW,
    });
    const r = checkPromotion([trace(W1), trace(W1, {
      decisionId: 'mp:2026-09-07', athlete: unknown, chosen: 'PUSH',
    })], { weeks: [W1] });
    expect(r.mayPromote).toBe(false);
    expect(r.check.athleteSpecificSupport).toBe(false);
    expect(r.blockedBecause.join(' ')).toMatch(/An honest absence is not support/);
  });

  it('a CONTRAINDICATED verdict on too few comparables is downgraded to UNKNOWN, not kept', () => {
    // Defect 2 enforced at the source rather than documented: one comparison is
    // an observation, not a demonstrated capacity limit, and it may not be used
    // to refuse anything.
    const e = athleteEvidenceFor({
      what: 'a 21 mi long run', asOfISO: '2026-11-01', prescribed: 21,
      demonstratedMaxToday: 18, demonstratedMaxProjected: null,
      comparables: [COMPARABLES[0]], historyWindow: WINDOW,
      ceilingQuantity: (c) => c.distanceMi,
    });
    expect(e.ceilingClaim!.valid).toBe(false);
    expect(e.ceilingClaim!.why).toMatch(/may not be used to refuse anything/);
  });

  it('an EMPTY history of prior weeks is not a zero-mileage week · the walk refuses', () => {
    // The reader must not treat "there is no week before this one" as "a
    // previous week of zero miles", which would make every block's opening week
    // a 100% mileage addition. The signature is now the PREFIX of prior weeks,
    // so the empty case is `[]` rather than `null`.
    expect(detectSimultaneousStressAddition(W1, [])).toBeNull();
    expect(detectSimultaneousStressAddition(W1, [{ ...W1, weeklyMi: 0 }])).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE DETECTOR → GATE SWEEP
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Every detector in `lib/plan/adjudication/`, and what ACTS on it.
 *
 * `gate` names the promotion dimension that blocks on the detector's finding.
 * `noGate` is the alternative and requires an argued reason — the only entry
 * carrying one is `weekly-demand.ts`, and its reason is doctrine, not
 * convenience.
 */
const DETECTOR_GATES: readonly {
  detector: string;
  gate?: keyof PromotionCheck;
  noGate?: string;
  wasDetectorOnly?: string;
}[] = [
  {
    detector: 'classifyStep / athleteEvidenceFor',
    gate: 'athleteSpecificSupport',
  },
  {
    detector: 'ceilingClaimFrom · MIN_COMPARABLES_FOR_CEILING_CLAIM',
    gate: 'athleteSpecificSupport',
    wasDetectorOnly: 'The `badCeiling` clause existed in checkPromotion and no test reached it. '
      + 'Closed by ADJ-DIM-1 "BLOCKS a refusal resting on a ceiling claim with too few comparables". '
      + 'NOTE, still open and named rather than hidden: `classifyStep` cannot RETURN '
      + '"CONTRAINDICATED", so nothing in this layer currently produces the input the clause '
      + 'filters on. The gate is real and tested; its producer does not exist yet.',
  },
  {
    detector: 'detectStackedStress · simultaneousPeak',
    gate: 'stackedStress',
  },
  {
    detector: 'detectStackedStress · the race-week long-run identity',
    gate: 'executionIdentity',
    wasDetectorOnly: 'Neither existed before 2026-09-04. The detector graded a marathon race week\'s '
      + '26.2 as a +46% reach over the longest TRAINING run, in every marathon block; the rule was '
      + 'written down in scripts/_cim_block_adjudication.mjs and never reached the layer it scripted.',
  },
  {
    detector: 'detectSimultaneousStressAddition',
    gate: 'recoverability',
  },
  {
    detector: 'adjudicate() · doctrine conflict resolution',
    gate: 'doctrineResolution',
    wasDetectorOnly: 'The throw was tested; the promotion-level block was not, and its only clause '
      + '(`because.trim() === ""`) could not be produced by adjudicate() at all. Closed by ADJ-DIM-1, '
      + 'plus a second clause that catches a resolution handed to the WEAKER citation.',
  },
  {
    detector: 'earningGateFor · assessOnISO, requires[].byISO, ifUnmet/reduceTo',
    gate: 'earningGateTiming',
    wasDetectorOnly: 'Nothing checked the timing of an earning gate at all. Its first run over the '
      + 'archetype corpus named a live defect in its own caller: REDUCE with reduceTo null.',
  },
  {
    detector: 'heuristicRankScore / rankOptions / every Attributed number',
    gate: 'evidenceProvenance',
    wasDetectorOnly: 'Provenance was a documented contract with no check. Defect 3 of David\'s list '
      + 'was "a weight somebody chose must never be printed in the same voice as a measurement", and '
      + 'nothing could tell whether it was.',
  },
  {
    detector: 'the three-option comparison',
    gate: 'wholeBlockCoherence',
  },
  {
    detector: 'the block advances somewhere (Rule 21)',
    gate: 'progression',
  },
  {
    detector: 'a PUSH inside a taper or race week',
    gate: 'taperIntegrity',
    wasDetectorOnly: 'The gate existed and was keyed on `t.stacked`, which detectStackedStress '
      + 'returns null for on an ordinary taper week — so it could only fail on a hand-built object, '
      + 'which is what its one test supplied. Re-keyed on weekOf(t) and falsified against the old '
      + 'predicate.',
  },
  {
    detector: 'weekly-demand.ts · computeWeeklyDemand, atCeiling, the seven components',
    noGate: 'DELIBERATE, and doctrine rather than convenience. weekly-demand.ts declares itself '
      + 'OBSERVATIONAL ONLY, citing docs/PLAN_SIMPLIFICATION_DOCTRINE.md (locked 2026-09-02), and '
      + 'says in its own header: "It must not be wired into a plan mutation, and no caller may read '
      + '`atCeiling` as licence to shrink a week." A promotion block reading atCeiling would be '
      + 'exactly that licence. Its three test files gate its arithmetic, its continuity and its '
      + 'citations; DecisionTrace.demand carries it so a runner can be told what a week costs, and '
      + 'nothing decides on it. If that doctrine is ever lifted, this entry is where the decision '
      + 'gets made rather than drifting in.',
  },
];

describe('ADJ-PROP-1 · every detector has a gate acting on it, or an argued reason', () => {
  it('the registry is well formed and every named gate is a real dimension', () => {
    expect(DETECTOR_GATES.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const e of DETECTOR_GATES) {
      if (e.gate == null && e.noGate == null) bad.push(`${e.detector} · names neither a gate nor a reason`);
      if (e.gate != null && e.noGate != null) bad.push(`${e.detector} · names both`);
      if (e.gate != null && !(PROMOTION_DIMENSIONS as readonly string[]).includes(e.gate)) {
        bad.push(`${e.detector} · names "${e.gate}", which is not a promotion dimension`);
      }
      if (e.noGate != null && e.noGate.trim().length < 40) {
        bad.push(`${e.detector} · "we might need it" is not a reason`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('every promotion dimension is claimed by at least one detector', () => {
    // The other direction, and the one that catches a dimension nobody feeds:
    // a check with no detector behind it is as inert as a detector with no
    // check in front of it.
    const claimed = new Set(DETECTOR_GATES.map((e) => e.gate).filter(Boolean));
    const orphanDimensions = PROMOTION_DIMENSIONS.filter((d) => !claimed.has(d));
    expect(orphanDimensions, `promotion dimensions no detector feeds: ${orphanDimensions.join(', ')}`).toEqual([]);
  });

  it('LIVENESS · every closed detector-only gap names what was wrong', () => {
    // Rule 18 §4 · a ratchet. These entries may be DELETED when the history
    // stops being worth carrying, and they may not be blanked.
    const closed = DETECTOR_GATES.filter((e) => e.wasDetectorOnly != null);
    expect(closed.length).toBeGreaterThanOrEqual(5);
    for (const e of closed) expect(e.wasDetectorOnly!.length).toBeGreaterThan(60);
  });
});

/* ── the earning gate is not just timed, it is SHAPED ──────────────────── */

describe('ADJ-PROP-1 · an earning gate states what would earn it', () => {
  it('the explain sentence names the number, the date and the consequence', () => {
    const g = earningGateFor({
      decisionId: 'mp-dose', what: 'a 10 mile marathon-pace block', prescribed: 10,
      demonstratedMaxToday: 5, assessOnISO: '2026-11-01',
      requires: [{ what: 'an 8 mile M dose completed inside a long run', measurable: 'M miles >= 8 at grade FULL or SUBSTANTIAL', byISO: '2026-11-01' }],
      ifUnmet: 'REDUCE', reduceTo: 8,
    });
    // The runner has to be able to aim at it. Asserting the shape of what he
    // reads, not the absence of a defect (Rule 13 §3).
    expect(g.explain).toMatch(/10/);
    expect(g.explain).toMatch(/2026-11-01/);
    expect(g.explain).toMatch(/an 8 mile M dose completed inside a long run/);
    expect(g.explain).toMatch(/it is reduced to 8/);
    expect(g.forDecisionId).toBe('mp-dose');
  });

  it('a DEFER gate says it is deferred rather than silently naming a number', () => {
    const g = earningGateFor({
      decisionId: 'd', what: 'a dose', prescribed: 10, demonstratedMaxToday: null,
      assessOnISO: '2026-11-01',
      requires: [{ what: 'a dose completed', measurable: 'M miles >= 6', byISO: '2026-11-01' }],
      ifUnmet: 'DEFER', reduceTo: null,
    });
    expect(g.explain).toMatch(/deferred to the next boundary/);
    // "against the unknown he has demonstrated today" — the absence is said out
    // loud rather than printed as a zero.
    expect(g.explain).toMatch(/unknown/);
  });
});
