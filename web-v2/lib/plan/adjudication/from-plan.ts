/**
 * lib/plan/adjudication/from-plan.ts · THE ADJUDICATION LAYER, WIRED.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * David, 2026-09-04, on the layer next door:
 *
 *   "Wire checkPromotion into the real plan-authoring and adaptation-promotion
 *    paths. Until that happens, this is a tested prototype, not a functioning
 *    brain safeguard."
 *
 * `adjudicate.ts` is pure and knows nothing about a composed plan. This file is
 * the bridge: it turns a block's weeks plus the runner's demonstrated history
 * into `DecisionTrace`s and asks `checkPromotion` for a verdict. It is still
 * pure — no database, no `Date.now()` — so the whole rule is falsifiable
 * without a runner (Rule 18).
 *
 * ── RULE 11 IS THE POINT OF THIS FILE, NOT A SIDE CONDITION ─────────────────
 *
 * Three facts, never one:
 *
 *   · a history that ARRIVED and says the runner has done this      → adjudicated
 *   · a history that arrived and says he has NOT                    → adjudicated
 *   · a history that DID NOT ARRIVE                                 → REFUSED
 *
 * The third is what this file exists to stop being a pass. `checkPromotion([])`
 * already blocks on "nothing was adjudicated at all", but the reason it gives
 * does not name the absent input, and a caller reading that string cannot tell
 * "the block was empty" from "we could not see the runner". Both refusals are
 * emitted, and the history one carries a stable prefix so the caller can decide
 * whether it is fatal for THAT path (see `caller-registry.ts`) without ever
 * being able to make a REAL adjudication finding non-fatal.
 *
 * ── WHAT THIS FILE CANNOT DECIDE (Rule 22, stated up front) ─────────────────
 *
 * It reads only the four quantities `DemonstratedHistory` carries and the six
 * on `PlannedWeek`. It cannot see execution quality, heart rate, readiness, or
 * whether a completed session was controlled — so a runner who has "done 18
 * miles" once, badly, and a runner who does them monthly are the same evidence
 * here. `ADAPTATION_PROGRESSION_DOCTRINE.md` owns that distinction and it is
 * not built yet. Nothing below should be read as claiming otherwise.
 */
import {
  athleteEvidenceFor, checkPromotion, classifyStep, detectStackedStress,
  expectedAbsorbed, rankOptions,
  type DemonstratedHistory, type PlannedWeek,
} from './adjudicate';
import type {
  DecisionTrace, EvidenceClass, Option, OptionAppraisal, PlanAdjudication,
} from './contract';

/* ══════════════════════════════════════════════════════════════════════════
 * 0 · THE INPUT
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * What a caller must hand over to have a block adjudicated.
 *
 * `windowDescribed` is intersected here rather than assumed on
 * `DemonstratedHistory`: a number measured over 28 representative days and the
 * same number measured over a year are different claims, and a reader of a
 * refusal has to be able to say which windows were searched before the engine
 * concluded the runner had never done this. It is a plain sentence, written by
 * whoever assembled the readings.
 */
export type DemonstratedHistoryInput = DemonstratedHistory & {
  readonly windowDescribed: string;
};

export interface AdjudicationInput {
  /** The block's weeks, in order. */
  readonly weeks: readonly PlannedWeek[];
  /** Null means the caller could not supply one. That is a refusal, not a zero. */
  readonly history: DemonstratedHistoryInput | null;
  /** Caller-supplied today (YYYY-MM-DD). Keeps this pure. */
  readonly todayISO: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · REFUSAL PREFIXES  ·  so a caller can classify without re-deciding
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The whole history was absent. Named so `validate.ts` can apply the
 * caller allowlist to THIS refusal and to nothing else.
 *
 * Deliberately a PREFIX and not a flag on the result: `PlanAdjudication`
 * belongs to `contract.ts` and a wiring file must not widen a contract it does
 * not own. The prefix is asserted in `_wired.test.ts`, so it cannot drift into
 * prose that no longer matches what is emitted.
 */
export const REFUSAL_NO_HISTORY =
  'athleteSpecificSupport · NO DEMONSTRATED HISTORY REACHED THE ADJUDICATOR';

/**
 * A demonstrated maximum this block NEEDED and did not get.
 *
 * Distinct from `REFUSAL_NO_HISTORY`: there, nothing arrived at all. Here the
 * history arrived and one of its readings is absent, so a decision that was
 * genuinely taken was taken blind.
 */
export const REFUSAL_UNKNOWN_QUANTITY =
  'athleteSpecificSupport · NO DEMONSTRATED MAXIMUM FOR A QUANTITY THIS BLOCK NEEDED';

/** The demonstrated maxima this file consumes. Also the exemption keys. */
export type AdjudicatedQuantity =
  | 'peakWeeklyMi' | 'longestRunMi' | 'maxCompletedMpMi' | 'maxStressorsInAWeek';

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE CONTRACT SEAMS
 *
 * Every `OptionAppraisal` and every `DecisionTrace` in this file is built by
 * one of the two functions below, and nowhere else. `contract.ts` is being
 * revised (`expectedAbsorbedFrac` becomes an attributed `heuristicRankScore`;
 * `DecisionTrace` gains `demand` and `earningGate`), and a wiring file that
 * spread those fields across a dozen object literals would have to be rewritten
 * every time the contract moved. Two function bodies is the whole cost.
 * ═══════════════════════════════════════════════════════════════════════ */

/** SEAM · the only `OptionAppraisal` literal in the wiring. */
function appraise(
  option: Option, describe: string, cls: EvidenceClass, risk: string,
): OptionAppraisal {
  return {
    option,
    describe,
    evidenceClass: cls,
    expectedAbsorbedFrac: expectedAbsorbed(cls),
    risk,
  };
}

/** SEAM · the only `DecisionTrace` literal in the wiring. */
function makeTrace(t: {
  decisionId: string;
  dateISO: string;
  what: string;
  athlete: DecisionTrace['athlete'];
  stacked: DecisionTrace['stacked'];
  options: readonly OptionAppraisal[];
  chosen: Option;
  because: string;
  rejected: DecisionTrace['rejected'];
  reassessOnISO: string | null;
}): DecisionTrace {
  return {
    decisionId: t.decisionId,
    dateISO: t.dateISO,
    what: t.what,
    // Every decision here is about ONE week of prescribed load.
    windowDays: 7,
    athlete: t.athlete,
    stacked: t.stacked,
    options: t.options,
    chosen: t.chosen,
    because: t.because,
    rejected: t.rejected,
    // This file raises no doctrine conflict of its own. It compares a
    // prescription against the runner, which is a different question from two
    // research tables disagreeing, and inventing an empty conflict here would
    // make `doctrineResolution` look exercised when nothing exercised it.
    conflicts: [],
    citations: [],
    reassessOnISO: t.reassessOnISO,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · WHAT THE PLAN DID  ·  not what the adjudicator would have preferred
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The option the COMPOSED WEEK represents.
 *
 * This is the distinction that makes the layer a gate rather than a second
 * planner. `rankOptions` says which option has the best expected adaptation;
 * `chosen` must say which one the block in front of us actually took, or
 * `checkPromotion`'s recoverability test — "weeks that peak in three
 * dimensions AND were still PUSHed" — can never fire, because the ranking
 * would have preferred the hold and the trace would have recorded a hold that
 * the plan did not take.
 *
 * Rule 9: the sign of a difference is not a threshold on a continuous
 * quantity, it is the definition of the three words. A week at exactly the
 * runner's demonstrated maximum is a HOLD; there is no band around zero to
 * relocate, and no input a tenth of a mile away lands in a different KIND of
 * plan — it lands in the same plan wearing the adjacent label, which is what
 * "differ in degree, not in kind" means.
 */
function whatThePlanDid(step: number | null): Option {
  if (step == null) return 'HOLD';
  if (step > 0) return 'PUSH';
  if (step < 0) return 'PULL_BACK';
  return 'HOLD';
}

/**
 * The three options, costed, for one prescribed quantity.
 *
 * PUSH is appraised at the class the prescription ACTUALLY earns; HOLD and
 * PULL_BACK are appraised at what staying at or under the demonstrated maximum
 * would earn, which is SUPPORTED by construction — he has done it.
 */
function optionsFor(cls: EvidenceClass, what: string, demonstratedMax: number | null): OptionAppraisal[] {
  const at = demonstratedMax == null ? 'his demonstrated level' : `${demonstratedMax}`;
  return [
    appraise('PUSH', `${what} as prescribed`, cls,
      cls === 'SUPPORTED' ? 'None beyond ordinary training stress.'
        : cls === 'ALLOWED' ? 'A real reach. Miss risk, and the week after it is the evidence.'
          : cls === 'UNKNOWN' ? 'Unpriceable. Nothing comparable exists to compare it against.'
            : 'A quantity he has never approached. Expected to cost more than it buys.'),
    appraise('HOLD', `${what} held at ${at}`, 'SUPPORTED',
      'He has done this. The stimulus is smaller and lands whole.'),
    appraise('PULL_BACK', `${what} below ${at}`, 'SUPPORTED',
      'Buys recovery he has not been shown to need.'),
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · ONE WEEK, ADJUDICATED
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * WHICH WEEK MUST BE SUPPORTED TODAY, AND WHICH MAY BE MARKED FOR LATER.
 *
 * `contract.ts` is explicit that conditionality is not the problem: "A
 * CONDITIONAL decision is fine — IF it is marked for reassessment. Fixing a
 * distant high-load session today, on evidence that does not exist yet, is the
 * thing being blocked."
 *
 * So the rule is a DISCRETE, honest fact about the block rather than a
 * threshold on a continuous quantity (Rule 9's strongest fix: "the decision
 * rests on a discrete honest fact, and there is no threshold on a continuous
 * quantity left to smooth"): **the next week the runner will actually execute
 * must be supported by what he has already done.** Every later week may be
 * CONDITIONAL, because it is re-adjudicated before it arrives — the block is
 * re-composed and re-validated on every authoring, and this same function runs
 * again with a history that will by then include the weeks in between.
 *
 * A day either side of a date does not flip a plan from authored to refused:
 * what flips is which week holds index 0, and that is a structural fact about
 * the block, not a hair.
 */
function reassessDateFor(week: PlannedWeek, isNextExecutable: boolean): string | null {
  return isNextExecutable ? null : week.weekStartISO;
}

interface QuantityDecision {
  readonly quantity: AdjudicatedQuantity;
  readonly what: string;
  readonly prescribed: number;
  readonly demonstratedMax: number | null;
}

function decisionsForWeek(week: PlannedWeek, hist: DemonstratedHistoryInput): QuantityDecision[] {
  const out: QuantityDecision[] = [
    {
      quantity: 'peakWeeklyMi',
      what: `${week.weeklyMi} mi in the week of ${week.weekStartISO}`,
      prescribed: week.weeklyMi,
      demonstratedMax: hist.peakWeeklyMi,
    },
    {
      quantity: 'longestRunMi',
      what: `a ${week.longestMi} mi long run`,
      prescribed: week.longestMi,
      demonstratedMax: hist.longestRunMi,
    },
  ];
  // Only when the week actually prescribes marathon-pace work. A decision
  // about a dose of zero is not a decision, and emitting one would make the
  // trace count look like coverage it is not (Rule 15).
  if (week.mpMi > 0) {
    out.push({
      quantity: 'maxCompletedMpMi',
      what: `${week.mpMi} mi at marathon pace`,
      prescribed: week.mpMi,
      demonstratedMax: hist.maxCompletedMpMi,
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · THE BLOCK
 * ═══════════════════════════════════════════════════════════════════════ */

export interface BlockAdjudication extends PlanAdjudication {
  /**
   * Demonstrated maxima the block needed and did not get, by name.
   *
   * Separate from `blockedBecause` on purpose. `classifyStep` returns UNKNOWN
   * for an absent maximum and `checkPromotion` blocks only on CONDITIONAL and
   * CONTRAINDICATED, so an UNKNOWN would otherwise travel through the gate
   * looking exactly like a pass. Rule 11 says it is not one, and the caller
   * decides — through a NAMED, ARGUED, RATCHETED exemption and never through a
   * boolean — whether a reading the app has no reader for yet is fatal.
   *
   * `maxStressorsInAWeek` is here for the same reason even though no decision
   * is sized against it directly: `detectStackedStress` needs it to ask
   * "more stressors than he has ever carried", and without it that clause is
   * silently switched off and only doctrine's flat threshold remains. A
   * missing input must never quietly disable a safety mechanism.
   */
  readonly unknownQuantities: readonly AdjudicatedQuantity[];
}

/**
 * THE ENTRY POINT. Pure.
 *
 * Weeks already run are excluded, for the reason `validateComposedPlan` §11b
 * already gives: "a week the runner has already run cannot be re-authored, and
 * refusing a rebuild over history would make the block unrepairable."
 *
 * Taper and race weeks are adjudicated for stacked stress but not for volume
 * or long-run reach, because a taper is DESIGNED to sit under the runner's
 * demonstrated maximum and grading it against that maximum would report every
 * correct taper as a PULL_BACK needing a defence. That is the same split Rule
 * 8 draws, from the other side.
 */
export function adjudicatePlanBlock(input: AdjudicationInput): BlockAdjudication {
  const { weeks, history, todayISO } = input;

  const future = weeks.filter((w) => w.weekStartISO >= todayISO
    || addDaysISO(w.weekStartISO, 6) >= todayISO);

  /* ── RULE 11 · THE REFUSAL ──────────────────────────────────────────────
   *
   * No history means the adjudication could not run. It did not pass, it did
   * not fail, it did not happen — and the one outcome that must never be
   * produced here is a `mayPromote: true` with an empty `blockedBecause`,
   * because that is indistinguishable from a block that was checked and found
   * coherent.
   *
   * `checkPromotion([])` is still called rather than hand-rolled, so the
   * verdict shape stays that function's to define and this file cannot drift
   * into a second opinion about what a promotion check is.
   */
  const noHistory = history == null || (
    history.peakWeeklyMi == null
    && history.longestRunMi == null
    && history.maxCompletedMpMi == null
    && history.maxStressorsInAWeek == null
  );
  if (noHistory) {
    // `checkPromotion` still decides the verdict SHAPE — this file does not
    // hold a second opinion about what a promotion check is. What it does not
    // get to decide is the REASON, because its own reason ("nothing was
    // adjudicated at all") describes the symptom and this branch knows the
    // cause. The two are folded into ONE entry, under the history prefix, so a
    // caller classifying the refusal cannot mistake the symptom for a separate
    // finding it has no exemption for.
    const empty = checkPromotion([]);
    return {
      ...empty,
      mayPromote: false,
      blockedBecause: [
        `${REFUSAL_NO_HISTORY} · nothing was available to size `
        + `${future.length} prescribed week(s) against: peakWeeklyMi, longestRunMi, `
        + 'maxCompletedMpMi and maxStressorsInAWeek were all absent'
        + (history == null ? ' (no history object was supplied at all)' : '')
        + `. So: ${empty.blockedBecause.join('; ')}`
        + '. An absence is not a pass (Rule 11).',
      ],
      unknownQuantities: [],
    };
  }

  const hist = history as DemonstratedHistoryInput;
  const traces: DecisionTrace[] = [];
  const unknown = new Set<AdjudicatedQuantity>();

  // The next week the runner will actually execute. Index 0 of the future
  // weeks, which is a structural fact about the block rather than a date
  // comparison anyone can land either side of.
  const nextExecutableISO = future.length > 0 ? future[0].weekStartISO : null;

  for (const week of future) {
    const isNext = week.weekStartISO === nextExecutableISO;
    const stacked = detectStackedStress(week, hist);
    let stackedAttached = false;

    // A taper or a race week is designed to sit under his maximum. Grading its
    // volume against that maximum answers a question nobody asked.
    const gradeReach = !week.isTaper && !week.isRaceWeek;

    for (const d of decisionsForWeek(week, hist)) {
      if (d.demonstratedMax == null) {
        unknown.add(d.quantity);
        continue;
      }
      if (!gradeReach && d.quantity !== 'maxCompletedMpMi') continue;

      const { cls, step } = classifyStep(d.prescribed, d.demonstratedMax);
      const athlete = athleteEvidenceFor(d.what, d.prescribed, d.demonstratedMax, hist.after);
      const options = optionsFor(cls, d.what, d.demonstratedMax);
      const ranked = rankOptions(options);
      const chosen = whatThePlanDid(step);
      const preferred = ranked[0];

      traces.push(makeTrace({
        decisionId: `${week.weekStartISO} · ${d.quantity}`,
        dateISO: week.weekStartISO,
        what: d.what,
        athlete,
        stacked: stackedAttached ? null : stacked,
        options,
        chosen,
        because: chosen === preferred.option
          ? `The block ${chosen === 'PUSH' ? 'pushes' : chosen === 'HOLD' ? 'holds' : 'pulls back'} `
            + `and that is also the highest-ranked option. ${athlete.why}`
          : `The block ${chosen === 'PUSH' ? 'pushes' : chosen === 'HOLD' ? 'holds' : 'pulls back'}; `
            + `the highest-ranked option was ${preferred.option}. ${athlete.why}`,
        rejected: ranked.slice(1).map((o) => ({ option: o.option, why: o.risk })),
        reassessOnISO: reassessDateFor(week, isNext),
      }));
      // One week, one stacked-stress record. Attaching it to all three
      // decisions would report the same week three times in `blockedBecause`,
      // which Rule 17 is explicit about: the runner, and the operator reading
      // the violation list, read a sentence once.
      if (stacked != null) stackedAttached = true;
    }
  }

  // The stacked-stress detector asked for this and did not get it. See the
  // note on `unknownQuantities`.
  if (future.length > 0 && hist.maxStressorsInAWeek == null) unknown.add('maxStressorsInAWeek');


  const verdict = checkPromotion(traces);
  // ── CONTRACT SEAM ────────────────────────────────────────────────────────
  // `checkPromotion` gains an optional second argument, `{ weeks: PlannedWeek[] }`,
  // which is what lets it evaluate `taperIntegrity` and `progression` for real
  // rather than returning the placeholder `true` / `traces.length > 0` it
  // returns today. When that argument lands, this call becomes
  // `checkPromotion(traces, { weeks: [...future] })` and nothing else in this
  // file changes. It is deliberately NOT passed early: an argument the current
  // signature does not accept would not compile, and inventing the two
  // dimensions here would give them a second owner (Rule 16).

  const unknownQuantities = [...unknown];
  const blocked = [...verdict.blockedBecause];
  if (unknownQuantities.length > 0) {
    blocked.push(
      `${REFUSAL_UNKNOWN_QUANTITY} · ${unknownQuantities.join(', ')} `
      + `· the block needed ${unknownQuantities.length === 1 ? 'this reading' : 'these readings'} `
      + 'and the runner\'s history did not carry '
      + `${unknownQuantities.length === 1 ? 'it' : 'them'}. Searched: ${hist.windowDescribed}. `
      + 'An absence is not a pass (Rule 11).',
    );
  }

  return {
    ...verdict,
    mayPromote: blocked.length === 0,
    blockedBecause: blocked,
    unknownQuantities,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · WEEK EXTRACTION  ·  a composed block, in the units the layer decides in
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The shape this file needs off a composed week. Structural rather than an
 * import of `ComposedWeek`, so `adjudication/` stays free of the 18,000-line
 * module that imports the validator that imports this.
 */
export interface ComposedWeekLike {
  readonly startISO: string;
  readonly phase: string;
  readonly weeklyMi?: number | null;
  /** `plan_weeks.is_race_week` · the GOAL race's week. Carried through so the
   *  caller's `isRaceWeek` predicate sees the same fields `weekContainsRace`
   *  reads, rather than a narrowed copy that silently answers false. */
  readonly isRaceWeek?: boolean | null;
  readonly days: readonly ComposedDayLike[];
}

export interface ComposedDayLike {
  readonly type: string;
  readonly distanceMi: number;
  readonly isQuality?: boolean;
  readonly isLong?: boolean;
  readonly subLabel?: string | null;
}

/** The named stressor a day represents, or null when the day is not one. */
function stressorOf(d: ComposedDayLike): string | null {
  if (d.type === 'race') return `race (${d.distanceMi} mi)`;
  if (d.type === 'threshold' || d.type === 'tempo') return `${d.distanceMi} mi ${d.type}`;
  if (d.type === 'intervals') return `${d.distanceMi} mi intervals`;
  // A long run counts as a stressor only when it carries intensity or is long
  // enough to be one on its own. `STACKED_STRESSOR_THRESHOLD` counts NAMES, so
  // calling every easy long run a stressor would make every week look stacked
  // and the detector would stop discriminating.
  if (d.isLong && (d.isQuality === true || d.distanceMi >= LONG_RUN_IS_A_STRESSOR_MI)) {
    return `${d.distanceMi} mi long run`;
  }
  return null;
}

/**
 * The distance above which an ordinary long run is itself a named stressor.
 *
 * `validate.ts`'s own `requiredSeparationDays` is where this number comes from,
 * and it is quoted from David's 2026-09-03 separation ruling rather than picked
 * here: "Long run of 16-18 miles → normally ONE to TWO easy/rest days depending
 * on the run's own intensity", against "Long run under approximately 16 miles
 * and fully easy → at least ONE". Sixteen is where doctrine starts treating the
 * long run as something the following days have to be planned around, which is
 * exactly what "a stressor" means here.
 *
 * Not re-derived and not a second opinion: if that ruling moves, this moves
 * with it, and `_wired.test.ts` asserts the two agree.
 */
export const LONG_RUN_IS_A_STRESSOR_MI = 16;

/**
 * Turn composed weeks into the layer's `PlannedWeek`s.
 *
 * `mpMi` reads `extractLongSegments`, the one owner of "how many miles of this
 * label are at marathon pace" (`lib/plan/spec-builder.ts`). Rule 16: a second
 * parser here would be a second chance to disagree about the dose, and the
 * dosing census and the intensity split already read that one.
 *
 * `isRaceWeek` reads `weekContainsRace`, the same predicate §10's dosing gate
 * uses, for the reason RACEWEEK-2 already gives in `validate.ts`: two callers
 * disagreeing about which weeks are race weeks is how the percentage-cap
 * exemption and the reconciliation loop drifted apart once already.
 */
export function plannedWeeksFromComposed(
  weeks: readonly ComposedWeekLike[],
  deps: {
    readonly mpMilesOf: (subLabel: string | null) => number;
    readonly isRaceWeek: (w: ComposedWeekLike) => boolean;
  },
): PlannedWeek[] {
  return weeks.map((w) => {
    const days = w.days ?? [];
    const stressors = days.map(stressorOf).filter((s): s is string => s != null);
    const longestMi = days
      .filter((d) => d.isLong === true && d.type !== 'race')
      .reduce((a, d) => Math.max(a, d.distanceMi), 0);
    const mpMi = days.reduce((a, d) => a + deps.mpMilesOf(d.subLabel ?? null), 0);
    const weeklyMi = w.weeklyMi != null && Number.isFinite(w.weeklyMi)
      ? w.weeklyMi
      : days.reduce((a, d) => a + (Number.isFinite(d.distanceMi) ? d.distanceMi : 0), 0);
    return {
      weekStartISO: w.startISO,
      weeklyMi: Math.round(weeklyMi * 10) / 10,
      longestMi: Math.round(longestMi * 10) / 10,
      stressors,
      mpMi: Math.round(mpMi * 10) / 10,
      // The composer's own phase label. `TAPER` is the only phase whose weeks
      // are designed to sit under the runner's demonstrated maximum.
      isTaper: w.phase === 'TAPER',
      isRaceWeek: deps.isRaceWeek(w),
    };
  });
}

/** Local date helper. This file opens nothing and imports no date library. */
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
