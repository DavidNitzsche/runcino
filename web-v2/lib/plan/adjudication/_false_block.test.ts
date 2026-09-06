/**
 * ADJ-FALSE-1 · THE FALSE-BLOCK CLASSIFIER, MADE TO FAIL.
 *
 * `false-block.ts` says a blocking sentence is FALSE when the gate is right
 * about its predicate and the predicate is not a defect of the plan. That is a
 * claim about the gate's real output, and a claim about real output cannot be
 * checked against hand-typed strings: the sentences here are produced by
 * calling `checkPromotion` itself, so a change to either sentence breaks this
 * file rather than silently retiring the classifier.
 *
 * That is the specific failure Rule 18 §2 names — "reporting clean because it
 * looked at nothing" — and a prose-keyed scanner is the easiest way in the
 * world to reach it.
 *
 * ── FALSIFICATION (Rule 18 §1) ─────────────────────────────────────────────
 *
 * Run before this landed, verbatim from the actual runs:
 *
 *   · `PROGRESSION_NO_ADVANCE_MARKER` changed to a string the gate no longer
 *     emits →
 *       "AssertionError: a block where nothing could advance was not called
 *        false: expected 'unclassified' to be 'FALSE · nothing to advance
 *        from'"
 *   · `classifyBlock` made to return the FALSE verdict unconditionally →
 *       "AssertionError: a REAL progression block — a rankable PUSH that was
 *        declined — was excused as a false block: expected 'FALSE · nothing to
 *        advance from' to be 'unclassified'"
 *   · the `traces.length > 0` guard removed → THE SUITE STAYED GREEN, which
 *     is a HOLE and not a pass. The case guarding it asked an EMPTY block for
 *     a progression sentence and an empty block does not emit one, so the
 *     assertion never ran. Rewritten to hand a real sentence to an empty trace
 *     set, and re-falsified →
 *       "AssertionError: an EMPTY trace set was reported as 'nothing to
 *        advance from', which is wholeBlockCoherence's finding wearing
 *        progression's name: expected 'FALSE · nothing to advance from' to be
 *        'unclassified'"
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · IT CANNOT TELL YOU THE TWO SHAPES ARE THE ONLY TWO. A third kind of false
 *   block, in a dimension `false-block.ts` does not name, is invisible here and
 *   will be reported `unclassified` — which is the honest default and not a
 *   pass.
 * · IT CANNOT TELL YOU A FALSE BLOCK MATTERS. Whether a plan SHOULD have been
 *   authored is a coaching question. This only says the sentence refusing it
 *   was not about a defect.
 * · IT CANNOT SEE THE OPPOSITE ERROR. A plan wrongly promoted emits no
 *   sentence, so nothing here looks at it.
 * · DISTRIBUTION: three FALSE cases against three UNCLASSIFIED ones, on
 *   purpose. A classifier tested only on the sentences it is meant to excuse
 *   would excuse everything and pass.
 */
import { describe, it, expect } from 'vitest';
import { checkPromotion, athleteEvidenceFor, heuristicRankScore, type PlannedWeek } from './adjudicate';
import { classifyBlock, resolveDisposition } from './false-block';
import type { DecisionTrace, EvidenceClass, OptionAppraisal } from './contract';

const WK: PlannedWeek = {
  weekStartISO: '2026-09-07', weeklyMi: 30, longestMi: 9,
  stressors: ['threshold'], mpMi: 0, isTaper: false, isRaceWeek: false,
};

const opt = (o: OptionAppraisal['option'], cls: EvidenceClass): OptionAppraisal => ({
  option: o, describe: o, evidenceClass: cls, heuristicRankScore: heuristicRankScore(cls), risk: '',
});

/** A HOLD, with a PUSH option whose evidence class the caller chooses. */
function held(pushClass: EvidenceClass, demonstratedMax: number | null): DecisionTrace {
  return {
    decisionId: `wk:${WK.weekStartISO}`,
    dateISO: WK.weekStartISO,
    what: 'weekly volume',
    windowDays: 7,
    athlete: athleteEvidenceFor({
      what: 'a 30 mi week', asOfISO: WK.weekStartISO, prescribed: 30,
      demonstratedMaxToday: demonstratedMax, demonstratedMaxProjected: null,
      comparables: [], historyWindow: 'the whole of 2026',
    }),
    stacked: null,
    demand: null,
    options: [opt('PUSH', pushClass), opt('HOLD', pushClass), opt('PULL_BACK', pushClass)],
    chosen: 'HOLD',
    because: 'held',
    rejected: [{ option: 'PUSH', why: 'his last two long runs deteriorated in the final third' }],
    conflicts: [],
    citations: [],
    reassessOnISO: '2026-09-01',
    earningGate: null,
  };
}

/**
 * The sibling of `held`: a PUSH the layer can actually rank, so a block built
 * from it clears `progression` and every other dimension honestly. Needed to
 * prove `disposition: 'PROMOTED'` on a real pass, not just infer it from
 * `mayPromote` never going false in the other cases below.
 */
function pushed(): DecisionTrace {
  return {
    decisionId: `wk:${WK.weekStartISO}`,
    dateISO: WK.weekStartISO,
    what: 'weekly volume',
    windowDays: 7,
    athlete: athleteEvidenceFor({
      what: 'a 30 mi week', asOfISO: WK.weekStartISO, prescribed: 30,
      demonstratedMaxToday: 40, demonstratedMaxProjected: null,
      comparables: [], historyWindow: 'the whole of 2026',
    }),
    stacked: null,
    demand: null,
    options: [opt('PUSH', 'SUPPORTED'), opt('HOLD', 'SUPPORTED'), opt('PULL_BACK', 'SUPPORTED')],
    chosen: 'PUSH',
    because: 'demonstrated max supports it',
    rejected: [],
    conflicts: [],
    citations: [],
    reassessOnISO: null,
    earningGate: null,
  };
}

/** The gate's OWN sentence for a given dimension, never a typed literal. */
function sentenceFrom(r: ReturnType<typeof checkPromotion>, dimension: string): string {
  const found = r.blockedBecause.find((b) => b.startsWith(`${dimension} ·`));
  expect(found, `the gate produced no ${dimension} sentence to classify. Blocked because: `
    + `${r.blockedBecause.join(' | ')}`).toBeDefined();
  return found as string;
}

describe('ADJ-FALSE-1 · nothing to advance from', () => {
  it('LIVENESS · the gate really does still emit a progression block on this shape', () => {
    const r = checkPromotion([held('UNKNOWN', null)], { weeks: [WK] });
    expect(r.check.progression).toBe(false);
    expect(sentenceFrom(r, 'progression')).toContain('advances anything');
  });

  it('FALSE · a block where every PUSH option was unrankable', () => {
    // `heuristicRankScore('UNKNOWN')` is null by design: an unknown may not be
    // ranked, because ranking one means inventing a number (Rule 11). So this
    // runner had nothing to advance FROM, and Rule 21's sentence is being read
    // at the wrong runner.
    const r = checkPromotion([held('UNKNOWN', null)], { weeks: [WK] });
    expect(classifyBlock(sentenceFrom(r, 'progression'), r.traces, 1),
      'a block where nothing could advance was not called false')
      .toBe('FALSE · nothing to advance from');
  });

  it('UNCLASSIFIED · a RANKABLE push that was declined is Rule 21\'s real question', () => {
    // Same gate, same sentence, opposite meaning: the layer COULD have
    // advanced this runner and chose not to. Excusing that would turn the
    // classifier into a blanket amnesty for the one dimension the app most
    // needs to keep (Rule 21).
    const r = checkPromotion([held('SUPPORTED', 40)], { weeks: [WK] });
    const progression = r.blockedBecause.find((b) => b.startsWith('progression ·'));
    expect(progression, 'the SUPPORTED-hold case produced no progression block at all')
      .toBeDefined();
    expect(classifyBlock(progression as string, r.traces, 1),
      'a REAL progression block — a rankable PUSH that was declined — was excused as a false block')
      .toBe('unclassified');
  });

  it('UNCLASSIFIED · an EMPTY trace set is wholeBlockCoherence\'s finding, not progression\'s', () => {
    /* `Array.every` on an empty array is vacuously TRUE, so without the
     * `traces.length > 0` guard an empty trace set would be reported as
     * "nothing to advance from" — one dimension's finding wearing another's
     * name, which is a Rule 16 violation inside the very tool built to name
     * findings.
     *
     * ── A HOLE, FOUND BY FALSIFYING AND FIXED (Rule 18 §1) ────────────────
     *
     * The first draft of this case asked `checkPromotion([], { weeks: [WK] })`
     * for its progression sentence and guarded on `if (progression != null)`.
     * It does not produce one: `progression`'s blocking clause is itself
     * `traces.length > 0 && !anyAdvance`, so on an empty block the dimension
     * goes false with NO sentence and the body never ran. Removing the guard
     * from `false-block.ts` left the suite GREEN, which is exactly the
     * "structurally impossible failure" this repo keeps shipping.
     *
     * So the sentence is taken from a block that really does emit one, and
     * handed to the classifier with an EMPTY trace set — which is the actual
     * shape the guard defends against, and the only way to exercise it.
     */
    const emitting = checkPromotion([held('UNKNOWN', null)], { weeks: [WK] });
    const sentence = sentenceFrom(emitting, 'progression');
    expect(classifyBlock(sentence, [], 1),
      'an EMPTY trace set was reported as "nothing to advance from", which is '
      + 'wholeBlockCoherence\'s finding wearing progression\'s name')
      .toBe('unclassified');
  });
});

describe('ADJ-FALSE-1 · no future weeks left in this block', () => {
  it('LIVENESS · the gate distinguishes an empty block from an unexamined one', () => {
    // Rule 11 at the gate's own sentence. Both block; they say different
    // things, and this is what proves the two branches are live.
    const over = checkPromotion([], { weeks: [] });
    const unexamined = checkPromotion([], { weeks: [WK] });
    expect(sentenceFrom(over, 'wholeBlockCoherence')).toContain('a block that is over');
    expect(sentenceFrom(unexamined, 'wholeBlockCoherence')).toContain('nothing was adjudicated at all');
    expect(over.mayPromote, 'a finished block must still not promote').toBe(false);
    expect(unexamined.mayPromote).toBe(false);
  });

  it('FALSE · a plan whose weeks are all behind us is finished, not incoherent', () => {
    const r = checkPromotion([], { weeks: [] });
    expect(classifyBlock(sentenceFrom(r, 'wholeBlockCoherence'), r.traces, 0))
      .toBe('FALSE · no future weeks left in this block');
  });

  it('UNCLASSIFIED · weeks handed in and NONE traced is the silent zero, and stays a defect', () => {
    const r = checkPromotion([], { weeks: [WK] });
    expect(classifyBlock(sentenceFrom(r, 'wholeBlockCoherence'), r.traces, 1),
      'the silent zero — weeks existed and nobody looked — was excused as a false block')
      .toBe('unclassified');
  });
});

/**
 * COLDSTART-PROMO-1 (2026-09-06) · THE DIAGNOSIS EARNS THE DISPOSITION.
 *
 * `classifyBlock` correctly named the zero-future-weeks case a false block
 * long before this landed — the case above proves that. What it did NOT do is
 * change what a REPORT built on `checkPromotion`'s output says for that plan,
 * which is the gap the read-only production replay found: one of seven active
 * plans is finished, `classifyBlock` says so, and the replay still printed
 * **BLOCKED** because nothing between the diagnosis and the report ever asked
 * the question. `resolveDisposition` is that question.
 *
 * It is deliberately a FREE FUNCTION a reporter calls with `checkPromotion`'s
 * own `mayPromote` / `blockedBecause` / `traces`, never a field added to
 * `PlanAdjudication` itself — see `resolveDisposition`'s own doc comment in
 * `false-block.ts` for why: `adjudicate.ts` is reachable from the live
 * `run-adaptations` cron via the volume-evidence path, and `false-block.ts`
 * is registered as never-imported-by-runtime-code. Wiring the field into
 * `checkPromotion` would have made that literally false, and
 * `_generated_content_gate.test.ts`'s staleness guard is what caught it.
 *
 * ── FALSIFICATION (Rule 18 §1), run before this landed ─────────────────────
 *
 *   · `resolveDisposition` hardcoded to `'BLOCKED'` whenever `mayPromote` is
 *     false → "AssertionError: a finished block (0 future weeks) must report
 *     TERMINAL, not BLOCKED: expected 'BLOCKED' to be 'TERMINAL'"
 *   · the `blockedBecause.every(...)` check loosened to `.some(...)` → the
 *     MIXED-SENTENCES case below (one real defect riding alongside the
 *     no-future-weeks reading) started reporting TERMINAL: "AssertionError: a
 *     real defect alongside the false block must still report BLOCKED, not
 *     TERMINAL: expected 'TERMINAL' to be 'BLOCKED'". `checkPromotion` cannot
 *     construct this shape itself today (see `resolveDisposition`'s own doc
 *     comment), so this case calls it directly rather than going through the
 *     gate — otherwise the `every`/`some` distinction would be untestable and,
 *     per Rule 18, a hypothesis rather than a proven guard.
 */
describe('COLDSTART-PROMO-1 · disposition earns what classifyBlock diagnosed', () => {
  it('TERMINAL · a plan whose weeks are all behind us, matching the false-block reading exactly', () => {
    const r = checkPromotion([], { weeks: [] });
    expect(r.mayPromote, 'disposition must never smuggle a promotion back in').toBe(false);
    expect(resolveDisposition(r.mayPromote, r.blockedBecause, r.traces, 0)).toBe('TERMINAL');
  });

  it('BLOCKED · the silent zero (weeks existed, nobody traced) is a real defect, not finished', () => {
    const r = checkPromotion([], { weeks: [WK] });
    expect(resolveDisposition(r.mayPromote, r.blockedBecause, r.traces, 1),
      'weeks existed and nobody adjudicated them — that is the defect wholeBlockCoherence '
      + 'exists to own, and TERMINAL must never cover for it')
      .toBe('BLOCKED');
  });

  it('BLOCKED · a real, non-empty progression failure is not finished either', () => {
    // Same shape `_false_block.test.ts` above calls UNCLASSIFIED: a rankable
    // PUSH that was declined. A real coaching defect, and disposition must
    // agree with `classifyBlock` rather than paper over it.
    const r = checkPromotion([held('SUPPORTED', 40)], { weeks: [WK] });
    expect(r.mayPromote).toBe(false);
    expect(resolveDisposition(r.mayPromote, r.blockedBecause, r.traces, 1)).toBe('BLOCKED');
  });

  it('PROMOTED · a block that passes every dimension reports PROMOTED', () => {
    const r = checkPromotion([pushed()], { weeks: [WK] });
    expect(r.mayPromote, `expected a clean pass, got: ${r.blockedBecause.join(' | ')}`).toBe(true);
    expect(resolveDisposition(r.mayPromote, r.blockedBecause, r.traces, 1)).toBe('PROMOTED');
  });

  it('BLOCKED · a real defect riding alongside the no-future-weeks reading must not be excused', () => {
    // `checkPromotion` cannot produce this mix today (every other clause
    // needs traces.length > 0, which is false whenever the empty-block
    // sentence fires) — called directly so the `every`, not `some`, in
    // `resolveDisposition` is actually falsifiable rather than a hypothesis.
    const overSentence = sentenceFrom(checkPromotion([], { weeks: [] }), 'wholeBlockCoherence');
    const realDefect = 'taperIntegrity · 1 decision(s) PUSH inside a taper or race week: wk:x';
    expect(resolveDisposition(false, [overSentence, realDefect], [], 0)).toBe('BLOCKED');
  });
});
