/**
 * adjudication-corpus.ts · THE ADJUDICATOR, REACHED FROM THE PRIMARY CORPUS
 * (CORPUS-ADJ-1, 2026-09-04 · CLAUDE.md Rule 15).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * The owner: "The adjudicator being unreachable from the primary plan corpus is
 * not acceptable."
 *
 * `lib/plan/adjudication/` is pure by design — "a caller hands it the runner's
 * demonstrated history and the block's weeks, and it returns traces plus a
 * promotion verdict" — and until this file the only caller that ever did so was
 * a hand-written fixture in its own two test files. `_sweep_allusers.test.ts`
 * grades 11,598 archetypes and could not reach one line of it, because nothing
 * turned an archetype into the two things the layer takes.
 *
 * That is Rule 15 one level up from the four mechanisms `history-shapes.ts` was
 * written for: "when you add a mechanism, ask which corpus case reaches it and
 * name that case in the test. If none can, the corpus needs the input, not more
 * rows." The input is here. The names are in `ADJ_REACH_BRANCHES`, and the
 * sweep asserts every one of them was actually visited.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 *
 * It is NOT a second adjudicator, and it authors no coaching judgement. It is
 * a TRANSLATION: rendered history → `DemonstratedHistory`, composed weeks →
 * `PlannedWeek[]`, and one decision per material week built by the layer's own
 * `athleteEvidenceFor` / `detectStackedStress` / `earningGateFor` /
 * `heuristicRankScore`. Every verdict below comes out of `adjudicate.ts`.
 * Re-implementing any of it here would produce a check that agrees with itself,
 * which is Rule 18's warning verbatim.
 *
 * ── WHAT A GATE OVER THIS FILE CANNOT FAIL ON (CLAUDE.md Rule 22) ──────────
 *
 * 1. WHETHER THE ENGINE SHOULD HAVE MADE THIS DECISION. The archetype corpus
 *    composes a plan; this file then asks whether that plan's decisions are
 *    ADJUDICABLE — supported by the runner's own past, gated where they are
 *    not, coherent across the block. A block whose every week is defensible
 *    and whose every week is also badly chosen passes. What it catches is a
 *    block the layer cannot justify at all.
 * 2. THE CHOSEN OPTION. `chooseFor` picks the top-ranked option out of
 *    `rankOptions`, which is the layer's own ordering. So this corpus cannot
 *    fail on the four `heuristicRankScore` weights being wrong — they are
 *    labelled POLICY_ASSUMPTION and uncalibrated, and a corpus that ranked
 *    them itself would just be agreeing with the file it is testing.
 * 3. EXECUTION QUALITY. See `history-shapes.ts` §5: no grades exist here, so
 *    `executed` is true on every comparable and an engine indifferent to how a
 *    session was run passes.
 * 4. A MISLABELLED WEEK. `isTaper` / `isRaceWeek` are read off the composed
 *    plan's own phase and flags. A taper the composer failed to mark is
 *    invisible to `taperIntegrity` from here, and belongs to the composer's
 *    own validator.
 *
 * DISTRIBUTION, counted rather than assumed (Rule 22 §2). `chooseFor` returns
 * whatever `rankOptions` puts first, so the corpus does not decide the
 * PUSH/HOLD/PULL_BACK balance — the layer does — and the sweep PRINTS the
 * resulting counts so an engine that only ever holds is visible as a number
 * rather than hidden behind a green tick.
 */
import {
  athleteEvidenceFor, detectStackedStress, detectSimultaneousStressAddition,
  earningGateFor, heuristicRankScore, rankOptions, checkPromotion,
  type DemonstratedHistory, type PlannedWeek,
} from './adjudication/adjudicate';
import type {
  ComparableSession, DecisionTrace, EvidenceClass, OptionAppraisal, PlanAdjudication,
} from './adjudication/contract';
import type { RenderedHistory } from './history-shapes';

/* ══════════════════════════════════════════════════════════════════════════
 * 0 · COUNTS ARE NUMBERS BEFORE THEY ARE ARITHMETIC
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A count, as a number, from whatever a caller actually has.
 *
 * `node-pg` returns `count(*)` as a STRING, because bigint does not fit a JS
 * number safely. `'2' + 1` is `'21'`, `'2' > 10` is false, and both are
 * silently wrong rather than loud — a live instance of exactly this shipped in
 * a script on 2026-09-04. Every count that crosses into this module goes
 * through here, and `null` is returned for anything that is not a count so a
 * caller must branch rather than receive a zero (Rule 11): "don't know" and
 * "measured zero" are two facts.
 */
export function asCount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  if (typeof v === 'bigint') return v >= 0n && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
  if (typeof v === 'string') {
    if (!/^\d+$/.test(v.trim())) return null;
    const n = Number(v.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/**
 * A measured quantity, as a number, from whatever a caller actually has.
 *
 * The sibling of `asCount` and needed for the same reason: `node-pg` returns
 * `numeric` as a STRING too, so `round(sum(distance_mi),1)` arrives as `'48.0'`
 * and `'48.0' > 47` is false. Refuses rather than coerces — `Number('')` is 0
 * and `Number(null)` is 0, and a zero invented from an absent value is the
 * Rule 11 collapse this whole layer exists to keep apart.
 */
export function asMeasure(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE TWO TRANSLATIONS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * ISO day arithmetic, local to this module so it pulls in no engine date code.
 *
 * Throws by NAME on a date it cannot read rather than returning
 * `'Invalid Date'.slice(0,10)` or silently producing NaN. A bad date that
 * travels on as a string is how a gate ends up scheduled for nowhen, and
 * `checkPromotion` would then dutifully report "not an ISO day" about a value
 * this function invented (Rule 11).
 */
function addDays(iso: string, n: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) {
    throw new Error(`adjudication-corpus: "${iso}" is not an ISO day, so no gate can be scheduled `
      + 'against it. The composed week supplied it; fix the week, do not default the date.');
  }
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The corpus runner's demonstrated history, as the adjudicator takes it.
 *
 * `maxCompletedMpMi` is NULL and stays null. No shape renders a marathon-pace
 * dose, so the honest answer is "nothing comparable exists", which classes an
 * M-dose decision UNKNOWN and forces it through a gate rather than waving it
 * through on a zero. That is the Rule 11 posture `_cim_trace.test.ts` takes on
 * the same field for the owner's real history, for the same reason.
 */
export function demonstratedHistoryFrom(
  h: RenderedHistory,
  blockStartISO: string,
  windowDescribed: string,
): DemonstratedHistory {
  const after: ComparableSession[] = h.longRunComparables.map((c) => ({
    dateISO: addDays(blockStartISO, -c.daysAgo),
    what: `${c.distanceMi} mi long run`,
    distanceMi: asMeasure(c.distanceMi),
    avgPaceSecPerMi: null,
    avgHrBpm: null,
    executed: c.executed,
    next7DaysMi: c.next7DaysMi == null ? null : asMeasure(c.next7DaysMi),
    notes: c.next7DaysMi == null
      ? 'The seven days after this run are not inside the rendered window, so what followed it is '
        + 'unknown rather than nothing.'
      : `He ran ${c.next7DaysMi} mi in the seven days after it.`,
  }));
  // RULE 11 · the measured numbers pass through UNCHANGED, zeros included. A
  // runner who has completed no week has a measured peak of 0, and that is a
  // different fact from `null`, which on this type means "not known". Mapping
  // 0 to null here would be the `x > 0 ? x : undefined` coercion CLAUDE.md
  // names as the ungated half of Rule 11, committed inside the file added to
  // reach the layer that exists to keep the three facts apart. `null` below
  // appears exactly once, on the quantity the corpus genuinely cannot render.
  // COUNTS AND MEASURES ARE VALIDATED AT THE BOUNDARY, not trusted from the
  // type. `RenderedHistory` declares these as `number` and the corpus really
  // does hand numbers, but this function is the entry point a DB-backed caller
  // will reuse — and `node-pg` hands `count(*)` back as `'2'` and `numeric` as
  // `'48.0'`. `'2' + 1` is `'21'`: that exact bug printed "a runner with 21
  // stressors in a week" in `scripts/_cim_block_adjudication.mjs` on
  // 2026-09-04, which is why the guard is here rather than in a comment asking
  // the next caller to remember.
  //
  // A value that is not a count or a measure becomes NULL — "not known" — and
  // never a zero. `detectStackedStress` and `classifyStep` both already treat
  // null as "cannot compare", which is the correct refusal.
  return {
    peakWeeklyMi: asMeasure(h.peakWeeklyMi),
    longestRunMi: asMeasure(h.longestRunMi),
    maxCompletedMpMi: null,
    maxStressorsInAWeek: asCount(h.maxStressorsInAWeek),
    after,
    windowDescribed,
  };
}

/** The composed week shape this module reads. Structural, so the bridge does
 *  not import `generate.ts` and drag the engine into every consumer. */
export interface ComposedWeekLike {
  startISO: string;
  phase: string;
  weeklyMi: number;
  isRaceWeek: boolean;
  days: readonly {
    type: string;
    distanceMi: number;
    isQuality: boolean;
    isLong: boolean;
    subLabel?: string | null;
  }[];
}

/**
 * A week's named stressors, counted the way `history-shapes.ts` counts them.
 *
 * The two must agree, because `detectStackedStress` divides one by the other.
 * Rule 16 in its plainest form: if the plan side counted the long run and the
 * history side did not, every archetype would look over-stressed and the
 * finding would be about this file.
 */
export function stressorsOfComposedWeek(w: ComposedWeekLike): string[] {
  const out: string[] = [];
  for (const d of w.days) {
    if (!(d.distanceMi > 0)) continue;
    if (d.type === 'race') { out.push(`race · ${d.distanceMi} mi`); continue; }
    if (d.isQuality) { out.push(d.subLabel?.trim() || d.type); continue; }
    if (d.isLong) out.push(`${d.distanceMi} mi long run`);
  }
  return out;
}

/**
 * Miles at marathon effort in one composed day, read off the label the engine
 * rendered.
 *
 * The same expression `_mp_doctrine.test.ts`'s `finishMiOf` uses, and
 * deliberately the same one: `DayPlan` carries no `mpMi` field, the sub-label
 * IS where the dose is stated, and `buildWorkoutSpec` parses that label
 * straight back — so this reads the engine's own answer rather than
 * reconstructing a second one (Rule 16).
 */
export function mpMiOfLabel(subLabel: string | null | undefined): number {
  const m = String(subLabel ?? '').match(/(\d+(?:\.\d+)?)mi @ (?:MP|M|HM)\b/);
  return m ? Number(m[1]) : 0;
}

/** Composed weeks → the adjudicator's `PlannedWeek[]`. */
export function plannedWeeksFrom(weeks: readonly ComposedWeekLike[]): PlannedWeek[] {
  return weeks.map((w) => ({
    weekStartISO: w.startISO,
    weeklyMi: w.weeklyMi,
    mpMi: Math.round(w.days.reduce((s, d) => s + mpMiOfLabel(d.subLabel), 0) * 10) / 10,
    // EXECUTION IDENTITY · the longest TRAINING run. On a race week the race
    // is the longest thing in it, and it is not a long run. `detectStackedStress`
    // declines to compare a race week's long run at all, and this keeps the
    // number itself honest for every other reader.
    longestMi: w.days.reduce((m, d) => (d.type !== 'race' && d.isLong && d.distanceMi > m ? d.distanceMi : m), 0),
    stressors: stressorsOfComposedWeek(w),
    isTaper: w.phase === 'TAPER',
    isRaceWeek: w.isRaceWeek,
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · ONE DECISION PER MATERIAL WEEK
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Which weeks get a decision.
 *
 * Every week that carries load. A BASE week and a taper week are decisions too
 * — a taper week is where `taperIntegrity` lives, and skipping it would make
 * that dimension unreachable from here for exactly the reason the whole file
 * exists. Only a wholly empty week is skipped, and it is skipped because there
 * is nothing to decide, not because it is convenient.
 */
const isMaterial = (w: PlannedWeek): boolean => w.weeklyMi > 0;

function optionsFor(cls: EvidenceClass, holdCls: EvidenceClass): OptionAppraisal[] {
  return [
    {
      option: 'PUSH', describe: 'author the week as composed', evidenceClass: cls,
      heuristicRankScore: heuristicRankScore(cls),
      risk: cls === 'SUPPORTED' ? 'none he has not already carried' : 'load he has not demonstrated',
    },
    {
      option: 'HOLD', describe: 'hold the week at his demonstrated level', evidenceClass: holdCls,
      heuristicRankScore: heuristicRankScore(holdCls),
      risk: 'leaves adaptation on the table',
    },
    {
      option: 'PULL_BACK', describe: 'cut a stressor out of the week', evidenceClass: holdCls,
      heuristicRankScore: heuristicRankScore(holdCls),
      risk: 'loses a session he can absorb',
    },
  ];
}

/**
 * The reasoning for one composed week, built entirely out of the layer's own
 * functions.
 *
 * The one judgement this file makes is WHICH QUANTITY the week is about:
 * weekly volume, sized against his demonstrated peak week. That is the
 * decision `_cim_trace.test.ts` traces by hand for the owner's block, and it is
 * the one every composed week has.
 */
export function traceForWeek(args: {
  readonly week: PlannedWeek;
  /** Every week composed BEFORE this one, oldest first. The one-at-a-time
   *  reader takes the trailing few and reads their max, because the single
   *  previous week is poisoned by any planned cutback. */
  readonly priorWeeks: readonly PlannedWeek[];
  readonly hist: DemonstratedHistory;
  /** What the plan builds him to by this week, if he executes it: the largest
   *  week composed before this one. Defect 1 — a November week is not run by
   *  the runner who exists today. Null for week 0, which has no runway. */
  readonly projectedPeakMi: number | null;
  readonly historyWindow: string;
}): DecisionTrace {
  const { week, priorWeeks, hist, projectedPeakMi, historyWindow } = args;
  // The largest week the block asks before this one, which is what an earning
  // gate should require and what a REDUCE should fall back to.
  const gateBaselineMi = priorWeeks.length === 0
    ? null
    : Math.max(...priorWeeks.map((w) => w.weeklyMi));

  const athlete = athleteEvidenceFor({
    what: `a ${week.weeklyMi} mi week`,
    asOfISO: week.weekStartISO,
    prescribed: week.weeklyMi,
    demonstratedMaxToday: hist.peakWeeklyMi,
    demonstratedMaxProjected: projectedPeakMi,
    comparables: hist.after,
    historyWindow,
  });

  const stacked = detectStackedStress(week, hist);
  // SIGNATURE-MERGE (2026-09-05) · this took `previous: PlannedWeek | null` when
  // this file was written. It now takes the PREFIX of weeks before this one,
  // because reading the single previous week let a planned cutback poison the
  // baseline. `priorWeeks` is that prefix; a null `previous` becomes an empty
  // one, which the function already refuses on.
  const addsBoth = detectSimultaneousStressAddition(week, priorWeeks);
  const cls = athlete.evidenceClass;
  const options = optionsFor(cls, 'SUPPORTED');
  const ranked = rankOptions(options);
  let chosen = ranked[0].option;

  // The two places the layer's own detectors say a PUSH must be argued, not
  // assumed. Neither is a coaching judgement invented here: both are read off
  // `adjudicate.ts`, and both are exactly what `checkPromotion` blocks on.
  const mustArgue = stacked?.simultaneousPeak === true || addsBoth != null;
  // Nothing is PUSHed inside a taper or a race week, ever. That is the
  // dimension, not a preference.
  if (week.isTaper || week.isRaceWeek) chosen = 'HOLD';

  /**
   * WHEN THE CALLER OWES A GATE.
   *
   * Not "when it chose to push". A CONDITIONAL, CONTRAINDICATED or UNKNOWN
   * prescription is IN THE PLAN whatever this decision preferred, and
   * `checkPromotion` blocks on it for that reason — the option ranked first is
   * advice, the composed week is the thing the runner will be handed. Gating
   * only the pushes would have left every held-but-still-prescribed week
   * ungated and read as a defect in the block rather than in the caller.
   */
  const needsGate = mustArgue
    || cls === 'CONDITIONAL' || cls === 'CONTRAINDICATED' || cls === 'UNKNOWN';

  const assessOnISO = addDays(week.weekStartISO, -7);
  const earningGate = needsGate
    ? earningGateFor({
      decisionId: `wk:${week.weekStartISO}`,
      what: `a ${week.weeklyMi} mi week`,
      prescribed: week.weeklyMi,
      demonstratedMaxToday: hist.peakWeeklyMi,
      assessOnISO,
      requires: [{
        // The requirement names the LARGEST week the block asks before this
        // one, not the immediately preceding week: a gate that asks the runner
        // to complete a planned cutback is asking for the wrong thing, and it
        // is the same defect the baseline had.
        what: gateBaselineMi == null
          ? 'the block\'s opening week completed'
          : `the ${gateBaselineMi} mi week completed`,
        measurable: `weekly mileage >= ${gateBaselineMi ?? week.weeklyMi}, `
          + 'no session graded MISSED',
        // The requirement is due when the gate runs, never after it. A gate
        // that asks about a week which has not run yet cannot be answered.
        byISO: assessOnISO,
      }],
      ifUnmet: 'REDUCE',
      reduceTo: gateBaselineMi ?? hist.peakWeeklyMi,
    })
    : null;

  return {
    decisionId: `wk:${week.weekStartISO}`,
    dateISO: week.weekStartISO,
    what: `weekly volume · ${week.weeklyMi} mi`,
    windowDays: 7,
    athlete,
    stacked,
    demand: null,
    options,
    chosen,
    because: chosen === 'PUSH'
      ? `${athlete.why} ${mustArgue ? 'The week adds more than one stressor, so it carries a gate.' : ''}`.trim()
      : `${athlete.why} Held: ${week.isTaper || week.isRaceWeek ? 'nothing is advanced inside a taper or a race week.' : 'the supported hold outranks the push.'}`,
    rejected: ranked.slice(1).map((o) => ({ option: o.option, why: o.risk })),
    conflicts: [],
    citations: [],
    reassessOnISO: needsGate ? assessOnISO : null,
    earningGate,
  };
}

/**
 * THE MARATHON-PACE DOSE · the decision this corpus genuinely cannot answer.
 *
 * `maxCompletedMpMi` is null for every archetype, because no history shape
 * renders a marathon-pace dose and inventing one would be the fixture agreeing
 * with itself. So the FIRST MP dose in a block is classified UNKNOWN — an
 * honest absence, not a zero — which is the same posture `_cim_trace.test.ts`
 * takes on the owner's real history for the identical field:
 *
 *   "No plan-linked marathon-pace dose exists in his history … Rule 11 says
 *    that is an absence, not a zero."
 *
 * Later doses ARE judged against a projection, because by then the block itself
 * has built toward one — defect 1 of David's list, and the reason a November
 * session must not be graded against a September body.
 */
function mpTraceForWeek(args: {
  readonly week: PlannedWeek;
  readonly hist: DemonstratedHistory;
  readonly projectedMpMi: number | null;
  readonly historyWindow: string;
}): DecisionTrace {
  const { week, hist, projectedMpMi, historyWindow } = args;
  const athlete = athleteEvidenceFor({
    what: `a ${week.mpMi} mi marathon-pace dose`,
    asOfISO: week.weekStartISO,
    prescribed: week.mpMi,
    demonstratedMaxToday: hist.maxCompletedMpMi,
    demonstratedMaxProjected: projectedMpMi,
    comparables: hist.after,
    historyWindow,
  });
  const cls = athlete.evidenceClass;
  const options = optionsFor(cls, 'SUPPORTED');
  const ranked = rankOptions(options);
  // `heuristicRankScore('UNKNOWN')` is null, so an unknown PUSH ranks below a
  // supported hold WITHOUT anyone writing "be careful" — which is the layer
  // working, and it is why this corpus reaches the UNKNOWN class without ever
  // reaching a PUSH on it. Stated rather than left to be inferred.
  let chosen = ranked[0].option;
  if (week.isTaper || week.isRaceWeek) chosen = 'HOLD';

  // Same rule as the volume decision: the dose is prescribed whatever this
  // decision preferred, so the gate is owed on the CLASS, not on the choice.
  const needsGate = cls === 'CONDITIONAL' || cls === 'CONTRAINDICATED' || cls === 'UNKNOWN';
  const assessOnISO = addDays(week.weekStartISO, -7);

  return {
    decisionId: `mp:${week.weekStartISO}`,
    dateISO: week.weekStartISO,
    what: `marathon-pace dose · ${week.mpMi} mi`,
    windowDays: 7,
    athlete,
    stacked: null,
    demand: null,
    options,
    chosen,
    because: athlete.why,
    rejected: ranked.slice(1).map((o) => ({ option: o.option, why: o.risk })),
    conflicts: [],
    citations: [],
    reassessOnISO: needsGate ? assessOnISO : null,
    earningGate: needsGate
      ? earningGateFor({
        decisionId: `mp:${week.weekStartISO}`,
        what: `a ${week.mpMi} mi marathon-pace dose`,
        prescribed: week.mpMi,
        demonstratedMaxToday: hist.maxCompletedMpMi,
        assessOnISO,
        requires: [{
          what: 'a marathon-pace dose completed inside a long run',
          measurable: `M miles >= ${projectedMpMi ?? week.mpMi} at grade FULL or SUBSTANTIAL`,
          byISO: assessOnISO,
        }],
        // CAUGHT BY THE NEW GATE ON ITS FIRST RUN OVER THIS CORPUS, which is
        // the falsification Rule 18 asks for and it came for free: this said
        // REDUCE with `reduceTo: projectedMpMi`, and `projectedMpMi` is NULL
        // at the block's first marathon-pace dose. "Reduce it to nothing" is
        // not an instruction, and `earningGateTiming` named it on 69 of 89
        // blocks. The honest answer when there is no earlier dose to fall back
        // to is DEFER: the session waits for the boundary rather than shrinking
        // to a number nobody chose.
        ...(projectedMpMi == null
          ? { ifUnmet: 'DEFER' as const, reduceTo: null }
          : { ifUnmet: 'REDUCE' as const, reduceTo: projectedMpMi }),
      })
      : null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE WHOLE BLOCK
 * ═══════════════════════════════════════════════════════════════════════ */

export interface CorpusAdjudication {
  readonly weeks: readonly PlannedWeek[];
  readonly hist: DemonstratedHistory;
  readonly result: PlanAdjudication;
}

/**
 * Adjudicate one composed archetype block.
 *
 * Returns null — not an empty verdict — when the archetype has no history to
 * adjudicate against. "This runner has no past in this corpus" and "this
 * runner's plan is unjustifiable" are opposite facts, and collapsing them into
 * a green tick is the failure Rule 11 names.
 */
export function adjudicateComposedBlock(args: {
  readonly rendered: RenderedHistory | null | undefined;
  readonly weeks: readonly ComposedWeekLike[];
  readonly blockStartISO: string;
  readonly windowDescribed: string;
}): CorpusAdjudication | null {
  const { rendered, weeks, blockStartISO, windowDescribed } = args;
  if (rendered == null) return null;

  const hist = demonstratedHistoryFrom(rendered, blockStartISO, windowDescribed);
  const planned = plannedWeeksFrom(weeks);
  const material = planned.filter(isMaterial);

  const traces: DecisionTrace[] = [];
  const maxOf = (xs: readonly number[]): number | null =>
    // EMPTY IS NOT ZERO. `Math.max()` of nothing is -Infinity and a
    // `reduce(…, 0)` seed is a measured zero neither the corpus nor the runner
    // ever produced. The caller needs "there is nothing to compare against",
    // which is null, and `classifyStep` already answers UNKNOWN on it.
    (xs.length === 0 ? null : xs.reduce((m, v) => (v > m ? v : m), xs[0]));

  for (let i = 0; i < material.length; i += 1) {
    const week = material[i];
    // The prefix, not the single previous week: `earlier` is empty at the
    // opening, which the reader refuses on, rather than a comparison against a
    // fabricated empty week.
    const earlier = material.slice(0, i);
    // The body the plan builds him to by this week: the largest week it has
    // asked for before this one, or null at the opening, which has no runway.
    const projectedPeakMi = maxOf(earlier.map((w) => w.weeklyMi));
    traces.push(traceForWeek({ week, priorWeeks: earlier, hist, projectedPeakMi, historyWindow: windowDescribed }));
    if (week.mpMi > 0) {
      traces.push(mpTraceForWeek({
        week,
        hist,
        // Null, not zero, at the block's FIRST marathon-pace dose: nothing has
        // built toward it yet, and "no projection" is a finding in itself
        // ("a prescription nothing prepares him for"), not a projected zero.
        // The weeks with NO dose are dropped before the max, so an absence
        // never arrives here wearing a zero's clothes (Rule 11).
        projectedMpMi: maxOf(earlier.map((w) => w.mpMi).filter((mi) => mi > 0)),
        historyWindow: windowDescribed,
      }));
    }
  }

  return { weeks: planned, hist, result: checkPromotion(traces, { weeks: planned }) };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THE BRANCH LEDGER · Rule 15's "paths reached", named
 * ═══════════════════════════════════════════════════════════════════════ */

export const ADJ_REACH_BRANCHES = [
  // ── athleteEvidenceFor / classifyStep ──
  'adj:evidence-supported',      // a week at or inside his demonstrated peak
  'adj:evidence-allowed',        // a real reach a table permits
  'adj:evidence-conditional',    // past +25% · must be earned
  'adj:evidence-unknown',        // no demonstrated max to size against (Rule 11)
  'adj:projection-used',         // judged against the body the plan builds, not today's
  'adj:projection-absent',       // the opening week · judged against today
  // ── comparables ──
  'adj:comparables-present',     // the corpus handed the layer real sessions
  'adj:comparable-window-open',  // a long run whose next-7-days window is INCOMPLETE
  // ── detectStackedStress ──
  'adj:stacked-none',
  'adj:stacked-single-reach',
  'adj:stacked-simultaneous-peak',
  'adj:raceweek-long-not-graded', // a race week, whose distance is NOT read as a long-run reach
  // ── detectSimultaneousStressAddition ──
  'adj:one-at-a-time-clean',
  'adj:one-at-a-time-violated',
  // ── the options ──
  'adj:chose-push',
  'adj:chose-hold',
  // ── earning gates ──
  'adj:gate-issued',
  'adj:gate-absent',
  // ── the promotion verdict ──
  'adj:promoted',
  'adj:blocked',
] as const;
export type AdjReachBranch = (typeof ADJ_REACH_BRANCHES)[number];

/** Which branches this block visited. Read off the layer's own outputs. */
export function adjReachOf(adj: CorpusAdjudication): Set<AdjReachBranch> {
  const got = new Set<AdjReachBranch>();
  const raceWeeks = new Set(adj.weeks.filter((w) => w.isRaceWeek).map((w) => w.weekStartISO));

  for (const t of adj.result.traces) {
    switch (t.athlete.evidenceClass) {
      case 'SUPPORTED': got.add('adj:evidence-supported'); break;
      case 'ALLOWED': got.add('adj:evidence-allowed'); break;
      case 'CONDITIONAL': got.add('adj:evidence-conditional'); break;
      case 'UNKNOWN': got.add('adj:evidence-unknown'); break;
      default: break;
    }
    got.add(t.athlete.demonstratedMaxProjected.value == null
      ? 'adj:projection-absent' : 'adj:projection-used');
    if (t.athlete.comparables.length > 0) got.add('adj:comparables-present');
    if (t.athlete.comparables.some((c) => c.next7DaysMi == null)) got.add('adj:comparable-window-open');

    if (t.stacked == null) got.add('adj:stacked-none');
    else if (t.stacked.simultaneousPeak) got.add('adj:stacked-simultaneous-peak');
    else got.add('adj:stacked-single-reach');

    if (raceWeeks.has(t.stacked?.weekStartISO ?? t.dateISO)
      && t.stacked?.longRunOverDemonstratedMax == null) {
      got.add('adj:raceweek-long-not-graded');
    }

    got.add(t.chosen === 'PUSH' ? 'adj:chose-push' : 'adj:chose-hold');
    got.add(t.earningGate == null ? 'adj:gate-absent' : 'adj:gate-issued');
  }

  // The sequence walk, run over the same weeks `checkPromotion` walks.
  let violated = false;
  for (let i = 1; i < adj.weeks.length; i += 1) {
    if (detectSimultaneousStressAddition(adj.weeks[i], adj.weeks.slice(0, i)) != null) violated = true;
  }
  got.add(violated ? 'adj:one-at-a-time-violated' : 'adj:one-at-a-time-clean');

  got.add(adj.result.mayPromote ? 'adj:promoted' : 'adj:blocked');
  return got;
}
