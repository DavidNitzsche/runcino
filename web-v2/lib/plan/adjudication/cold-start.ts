/**
 * lib/plan/adjudication/cold-start.ts · WHAT THE LAYER MAY SAY ABOUT A RUNNER
 * IT HAS NEVER SEEN RUN.
 *
 * ── THE DEFECT THIS FIXES ──────────────────────────────────────────────────
 *
 * Measured on production, 2026-09-05: SEVEN active training plans, and SIX of
 * them belong to accounts with ZERO canonical runs. Every quantity the
 * adjudicator sizes a week against — `peakWeeklyMi`, `longestRunMi`,
 * `maxCompletedMpMi` — is null for all six.
 *
 * `classifyStep` correctly answers UNKNOWN to a null demonstrated maximum, and
 * `heuristicRankScore('UNKNOWN')` is correctly null, so a PUSH on an unknown
 * scores zero. Meanwhile the HOLD option was hard-coded to `SUPPORTED`. So the
 * hold won every week of every block, `anyAdvance` was false, and
 * `checkPromotion` blocked with:
 *
 *     "progression · no decision in this block advances anything. Rule 21: a
 *      plan that only holds and pulls back is a safety system wearing a coach's
 *      clothes."
 *
 * Every step of that is individually correct Rule 11 semantics and the result
 * is useless as a product policy: a new runner cannot be given a plan, and the
 * reason the gate gives is that the plan never advances — when the runner has
 * nothing to advance FROM.
 *
 * Worse, the hold was the real lie. "Hold the week at his demonstrated level",
 * classed SUPPORTED, for a runner with no demonstrated level, is INVENTED
 * ATHLETE SUPPORT — the exact thing this module is required not to do. That
 * hard-coded `SUPPORTED` is fixed at its source rather than worked around here.
 *
 * ── THE POLICY, ITEM BY ITEM ───────────────────────────────────────────────
 *
 * · RESEARCH-ALLOWED INITIAL PRESCRIPTION. `Research/00a` §"Volume table" gives
 *   a beginner band per distance, and §"Volume progression rules" caps a long
 *   run at a share of the week. Those two are the opening allowance. They are
 *   read from the research table, they carry `CALCULATED_PHYSIOLOGY`
 *   provenance, and they are bound in CI by `COLDSTART.*` claims that parse the
 *   numbers out of the document at run time rather than hardcoding both sides.
 *
 * · CONFIDENCE LABELLED LOW, AND HONESTLY. `ColdStartPosture.confidence` is the
 *   literal `'LOW'` and its sentence says what is missing, in the runner's
 *   language. It is never SUPPORTED: `EvidenceClass.ALLOWED` already means
 *   exactly "a research table permits it, it says nothing about him", and that
 *   is the strongest class a cold start may reach. `coldStartClassFor` caps it
 *   there by construction, so no caller can promote one by accident.
 *
 * · CONSERVATIVE ONLY WHERE EVIDENCE IS GENUINELY ABSENT. The posture is PER
 *   QUANTITY, not per plan. A runner who has a demonstrated peak week but no
 *   long run is cold-started on the LONG RUN ONLY, and his weekly volume is
 *   judged against his own history exactly as before. That is the per-finding
 *   context-filter discipline CLAUDE.md locked in 2026-05-19 round 4: a
 *   surface-level guard does not protect sub-findings, and it does not get to
 *   punish them either.
 *
 * · EARLY CALIBRATION SESSIONS, SCHEDULED. Not invented: the calibration for a
 *   quantity is EXACTLY the evidence the canonical adaptation contract already
 *   requires before that lever may move — three consecutive weeks at the
 *   completion bar for volume, the two most recent long runs for the long run,
 *   two qualifying quality sessions inside the evidence window for pace. Those
 *   constants are imported from `lib/adaptation/canonical/contract-constants`,
 *   so the thing a cold start is asked to demonstrate is the same thing an
 *   established runner is asked to demonstrate (Rule 16).
 *
 * · SCHEDULED REASSESSMENT. Every cold-start decision carries `reassessOnISO`,
 *   and `checkPromotion`'s `coldStartHonesty` dimension blocks a block whose
 *   cold-start decisions do not.
 *
 * · FASTER PROGRESSION WHEN EARLY EVIDENCE IS STRONG. This is spending headroom
 *   doctrine already allows, never weakening a guard (Rule 21). `Research/00a`
 *   §"Volume progression rules" states, from an RCT: "novices safely +20-25%
 *   over 8 weeks vs. +10% over 12 in trial data". So once the calibration weeks
 *   are met, a cold-start runner's step band widens to the novice figure the
 *   trial supports rather than staying at the general +10%. The number is read
 *   out of the doc, not chosen.
 *
 * · NO INVENTED ATHLETE SUPPORT. `demonstratedMaxToday` and
 *   `demonstratedMaxProjected` stay NULL with their honest basis. The allowance
 *   travels on its own field with its own provenance, and
 *   `evidenceProvenance` at the gate already checks that the two are printed in
 *   different voices.
 *
 * · DOES NOT BRICK AUTHORING. A cold-start block promotes, because a
 *   research-allowed opening prescription with a gate, a calibration schedule
 *   and a reassessment date IS an adjudicable decision.
 *
 * · DOES NOT SILENTLY BYPASS ADJUDICATION. `coldStartHonesty` is a real
 *   promotion dimension with its own blocking sentences, and every one of them
 *   was falsified before this landed.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ────────────────────
 *
 * · IT CANNOT FAIL ON THE OPENING BAND BEING THE WRONG COACHING ANSWER. The
 *   claims check that the constants equal what `Research/00a`'s beginner column
 *   says. Whether that column is right for THIS runner, who may be an
 *   experienced runner who simply has not connected a watch, nothing here can
 *   tell — and that case is real. The mitigation is that the band is a CEILING
 *   on the opening prescription and not a floor: a plan authored below it is
 *   unaffected.
 * · IT CANNOT FAIL ON THE ARCHETYPE CORPUS. `RenderedHistory.peakWeeklyMi` is
 *   typed `number` and is never null, so no history-bearing archetype can be a
 *   cold start. The reach comes from `adjudicateColdStartBlock`, which the
 *   sweep calls for arcs that carry NO history, and from the read-only
 *   production replay, where six of seven live plans are the population.
 * · IT CANNOT FAIL ON THE CALIBRATION BEING ACHIEVABLE. It checks that a
 *   schedule exists and is dated before what it guards. Whether the runner can
 *   actually complete three consecutive weeks at the bar is his business.
 */
import type {
  AthleteEvidence, Attributed, EvidenceClass, Provenance,
} from './contract';
import {
  LONG_RUN_LOOKBACK_COUNT,
  LONG_RUN_COMPLETION_MIN_FRAC,
  THRESHOLD_EVIDENCE_WINDOW_DAYS,
  THRESHOLD_MIN_QUALIFYING_SESSIONS,
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
} from '@/lib/adaptation/canonical/contract-constants';
/* The codebase's ONE owner of how a distance is written down. */
import { fmtMi } from '@/lib/format/run';

/**
 * Rule 9 · the REPRESENTATION tolerance on the allowance comparison. Not a
 * band, and never a place to hide a widened threshold.
 *
 * The long-run allowance is DERIVED — a beginner band times a share — so it
 * lands on values like `9.000000000000002`, and `prescribed <= allowance` would
 * then be decided by the fifteenth decimal place of a number nobody chose.
 * That is the same problem `COMPLETION_FRACTION_EPSILON` and
 * `DEMAND_CEILING_EPSILON` already solve in this engine, and it is solved the
 * same way rather than by rounding the value — because rounding the VALUE would
 * be a second rule for writing a distance down, which `lib/format/run.ts` owns.
 *
 * 1e-9 is a billionth of a mile. Nothing any plan can prescribe is that small.
 */
export const COLD_START_ALLOWANCE_EPSILON = 1e-9;

/* ══════════════════════════════════════════════════════════════════════════
 * THE RESEARCH ALLOWANCE
 * ═══════════════════════════════════════════════════════════════════════ */

export type RaceDistanceKey = '5k' | '10k' | 'half' | 'marathon' | '50k' | '100k';

export const RACE_DISTANCE_KEYS: readonly RaceDistanceKey[] =
  ['5k', '10k', 'half', 'marathon', '50k', '100k'];

/**
 * The BEGINNER weekly-volume band, miles per week.
 *
 * `Research/00a-distance-running-training.md` §"Volume table — miles per week
 * (km in parentheses)", the "Beginner (just finishing)" column, verbatim:
 *
 *     5K            10-20
 *     10K           15-25
 *     Half-marathon 20-30
 *     Marathon      25-40
 *     50K           30-45
 *     100K          40-60
 *
 * Bound in CI by `COLDSTART.opening-volume-band-is-the-beginner-column`, which
 * parses the column out of the document and compares. A check that hardcoded
 * both sides would only prove the test agrees with itself (Rule 18).
 */
export const COLD_START_WEEKLY_BAND_MI: Readonly<Record<RaceDistanceKey, readonly [number, number]>> = {
  '5k': [10, 20],
  '10k': [15, 25],
  half: [20, 30],
  marathon: [25, 40],
  '50k': [30, 45],
  '100k': [40, 60],
};

/**
 * The long run's share of the week, as a fraction band.
 *
 * `Research/00a` §"Volume progression rules" · "Long-run cap | <=25-30% of
 * weekly volume". The UPPER edge is the allowance, because this is a CEILING on
 * an opening prescription rather than a target, and the lower edge would make
 * the allowance stricter than the research it cites for no stated reason.
 *
 * Bound by `COLDSTART.opening-long-run-share-is-the-long-run-cap`.
 */
export const COLD_START_LONG_RUN_SHARE_OF_WEEK = 0.30;

/**
 * The novice ramp the trial data supports, as a fraction.
 *
 * `Research/00a` §"Volume progression rules" · "Year-on-year base growth |
 * 5-15% per training cycle for trained athletes; novices safely +20-25% over 8
 * weeks vs. +10% over 12 in trial data" (Buist et al., JOSPT 2008).
 *
 * This is what "faster progression when early evidence is strong" spends. It
 * is doctrine's own headroom for exactly this runner, not a weakened guard: an
 * ESTABLISHED runner's band is unchanged, and this only applies while the
 * quantity is still cold AND the calibration has been met.
 *
 * The UPPER edge, for the same reason as above — it is the figure the trial
 * found safe, and taking the lower edge would be a silent extra margin.
 *
 * Bound by `COLDSTART.accelerated-ramp-is-the-novice-trial-figure`.
 */
export const COLD_START_ACCELERATED_STEP_MAX = 0.25;

/* ══════════════════════════════════════════════════════════════════════════
 * THE POSTURE
 * ═══════════════════════════════════════════════════════════════════════ */

export type ColdStartQuantity = 'WEEKLY_VOLUME' | 'LONG_RUN' | 'MARATHON_PACE_DOSE';

/** A number a research table permits, kept apart from anything he has done. */
export interface ResearchAllowance {
  readonly value: number;
  readonly provenance: Provenance;
  readonly doc: string;
  /** A VERBATIM anchor in that document. Never a line number (Rule 7). */
  readonly anchor: string;
  readonly basis: string;
}

/** One thing the runner has to actually do before the cold start ends. */
export interface CalibrationSession {
  /** In the runner's language. */
  readonly what: string;
  /** In the engine's. The exact quantity and the grade that counts. */
  readonly measurable: string;
  /** Which lever's evidence contract this satisfies. */
  readonly establishes: ColdStartQuantity;
  readonly byISO: string;
}

/**
 * A quantity this layer has NEVER SEEN this runner produce, and what it may
 * therefore say about it.
 */
export interface ColdStartPosture {
  readonly quantity: ColdStartQuantity;
  /** Rule 11 · an absence, never a measured zero. */
  readonly reason: 'NO_DEMONSTRATED_MAXIMUM';
  readonly confidence: 'LOW';
  readonly confidenceSentence: string;
  /** Null when no research band exists for this quantity. Rule 11 again. */
  readonly allowance: ResearchAllowance | null;
  readonly calibration: readonly CalibrationSession[];
  readonly reassessOnISO: string;
  /**
   * The wider step band this quantity earns once its calibration is met, and
   * the research that permits it. Null when nothing widens.
   */
  readonly acceleratedProgression: { readonly maxStep: number; readonly basis: string } | null;
  /**
   * A literal, so a caller cannot construct a posture that claims athlete
   * support. It is asserted at the gate rather than trusted from this comment.
   */
  readonly inventsNoAthleteSupport: true;
  readonly why: string;
}

const VOLUME_DOC = 'Research/00a-distance-running-training.md';
const VOLUME_ANCHOR = '### Volume table — miles per week (km in parentheses)'; // ok: a VERBATIM doctrine anchor (Rule 7), never runner-facing copy. Changing the dash would break the citation.
const RULES_ANCHOR = '### Volume progression rules';

/**
 * The research allowance for one quantity, or a refusal.
 *
 * Rule 11 · `MARATHON_PACE_DOSE` returns NULL, and that is the honest answer
 * rather than a gap: no research table in this repository states an opening
 * marathon-pace dose for a runner with no history, and inventing one would be
 * the "policy assumption wearing a research number's clothes" that
 * `adjudicate.ts` already calls out about its own volume band. A null allowance
 * leaves the prescription CONDITIONAL with a gate, which is the correct
 * posture for a dose nothing supports.
 */
export function researchAllowanceFor(
  quantity: ColdStartQuantity,
  /**
   * Rule 11 · NULL when the goal event is not known, which is a real
   * production state: two active plans carry no race at all. A null distance
   * yields a NULL allowance rather than a borrowed one, so the prescription
   * stays CONDITIONAL and gated instead of being sized off a band nobody named.
   */
  distance: RaceDistanceKey | null,
): ResearchAllowance | null {
  if (distance === null) return null;
  if (quantity === 'WEEKLY_VOLUME') {
    const [lo, hi] = COLD_START_WEEKLY_BAND_MI[distance];
    return {
      value: hi,
      provenance: 'CALCULATED_PHYSIOLOGY',
      doc: VOLUME_DOC,
      anchor: VOLUME_ANCHOR,
      basis: `Research/00a's volume table puts a beginner at ${lo}-${hi} mi/wk for the `
        + `${distance}. ${hi} is the top of that band and is the ceiling on an opening `
        + 'prescription, not a target. It says what the research permits for a runner with no '
        + 'record; it says nothing about this runner.',
    };
  }
  if (quantity === 'LONG_RUN') {
    const [, hi] = COLD_START_WEEKLY_BAND_MI[distance];
    // `lib/format/run.ts` owns how a distance is WRITTEN. What is needed here
    // is a stable QUANTITY: the allowance is compared against a prescription,
    // so it must not carry binary-float noise into a threshold (Rule 9's
    // representation problem, the same one COMPLETION_FRACTION_EPSILON solves
    // for a completion bar). `roundToTenthMi` is that, and it is a rounding of
    // a VALUE rather than a second rule for printing one.
    const value = hi * COLD_START_LONG_RUN_SHARE_OF_WEEK;
    return {
      value,
      provenance: 'CALCULATED_PHYSIOLOGY',
      doc: VOLUME_DOC,
      anchor: RULES_ANCHOR,
      basis: `Research/00a caps a long run at ${COLD_START_LONG_RUN_SHARE_OF_WEEK * 100}% `
        + `of weekly volume. Against the top of the beginner band for the ${distance} `
        + `(${hi} mi/wk) that is ${fmtMi(value) ?? value} mi. Derived from two cited numbers, `
        + 'not chosen.',
    };
  }
  return null;
}

/**
 * The calibration schedule for one quantity: exactly the evidence the canonical
 * adaptation contract already asks for before that lever may move.
 *
 * Imported from `contract-constants.ts` rather than restated, so a cold-start
 * runner is asked to demonstrate the same thing an established one is (Rule
 * 16), and so a change to the contract cannot leave this behind.
 */
export function calibrationFor(
  quantity: ColdStartQuantity,
  byISO: string,
): readonly CalibrationSession[] {
  if (quantity === 'WEEKLY_VOLUME') {
    return [{
      what: `${VOLUME_MIN_CONSECUTIVE_WEEKS} weeks in a row completed as prescribed`,
      measurable: `${VOLUME_MIN_CONSECUTIVE_WEEKS} consecutive non-cutback weeks at `
        + `>= ${Math.round(VOLUME_WEEK_COMPLETION_MIN_FRAC * 100)}% of prescribed volume`,
      establishes: 'WEEKLY_VOLUME',
      byISO,
    }];
  }
  if (quantity === 'LONG_RUN') {
    return [{
      what: `the ${LONG_RUN_LOOKBACK_COUNT} most recent long runs completed`,
      measurable: `the ${LONG_RUN_LOOKBACK_COUNT} most recent prescribed long runs at `
        + `>= ${Math.round(LONG_RUN_COMPLETION_MIN_FRAC * 100)}% of distance`,
      establishes: 'LONG_RUN',
      byISO,
    }];
  }
  return [{
    what: 'a marathon-pace block completed inside a long run',
    measurable: `${THRESHOLD_MIN_QUALIFYING_SESSIONS} qualifying sessions on separate days `
      + `within ${THRESHOLD_EVIDENCE_WINDOW_DAYS} days, graded FULL or SUBSTANTIAL`,
    establishes: 'MARATHON_PACE_DOSE',
    byISO,
  }];
}

/**
 * The cold-start posture for one quantity, or NULL when it is not cold.
 *
 * PER QUANTITY, which is the whole point: a runner with a demonstrated peak
 * week and no long run is cold on the long run only.
 */
export function coldStartFor(args: {
  readonly quantity: ColdStartQuantity;
  /** Rule 11 · null when the goal event is not known. See `researchAllowanceFor`. */
  readonly distance: RaceDistanceKey | null;
  /** His demonstrated maximum of this quantity. Null is what makes it cold. */
  readonly demonstratedMaxToday: number | null;
  /** When the cold start is re-taken. Must be before what it guards. */
  readonly reassessOnISO: string;
}): ColdStartPosture | null {
  const { quantity, distance, demonstratedMaxToday, reassessOnISO } = args;
  // Rule 11 · a demonstrated ZERO is not an absence. A runner whose peak week
  // is a measured 0 has been observed; he has just not run. That is a
  // CONTRAINDICATION question for the evidence layer, not a cold start, and
  // collapsing the two here would be the exact confusion this codebase keeps
  // finding.
  if (demonstratedMaxToday !== null) return null;

  const allowance = researchAllowanceFor(quantity, distance);
  const calibration = calibrationFor(quantity, reassessOnISO);

  return {
    quantity,
    reason: 'NO_DEMONSTRATED_MAXIMUM',
    confidence: 'LOW',
    confidenceSentence:
      `Nothing in this runner's completed training sizes ${quantityWord(quantity)}. `
      + `${allowance === null
        ? 'No research table states an opening figure for it either, so the prescription is '
          + 'conditional and carries a gate.'
        : `The opening prescription is sized from ${allowance.doc}, which is what research `
          + 'permits for a runner with no record. Confidence is LOW, and it stays LOW until '
          + 'he has run something comparable.'}`,
    allowance,
    calibration,
    reassessOnISO,
    acceleratedProgression: quantity === 'WEEKLY_VOLUME'
      ? {
        maxStep: COLD_START_ACCELERATED_STEP_MAX,
        basis: `Research/00a §"${RULES_ANCHOR.replace('### ', '')}" reports that novices ramping `
          + `+20-25% over 8 weeks did not show higher injury rates than +10% over 12. Once the `
          + 'calibration weeks are completed at the bar, this runner\'s step band is the figure '
          + 'that trial supports rather than the general one. It is headroom doctrine already '
          + 'allows, not a weakened guard.',
      }
      : null,
    inventsNoAthleteSupport: true,
    why:
      `This layer has never seen this runner produce ${quantityWord(quantity)}, so it has no `
      + 'athlete evidence to size it against and does not pretend otherwise. The opening figure '
      + `is ${allowance === null ? 'not stated by research either' : `a research allowance of ${allowance.value}`}`
      + `, the confidence is LOW, and it is re-taken on ${reassessOnISO} against what he has `
      + 'actually run by then.',
  };
}

const quantityWord = (q: ColdStartQuantity): string =>
  q === 'WEEKLY_VOLUME' ? 'a weekly volume'
    : q === 'LONG_RUN' ? 'a long run'
      : 'a marathon-pace dose';

/**
 * The evidence class a cold-start prescription may reach. NEVER SUPPORTED.
 *
 * `contract.ts` defines the two classes this turns on, and the distinction is
 * the whole layer:
 *
 *   ALLOWED     · "a research table permits it. Says nothing about him."
 *   CONDITIONAL · "it depends on evidence that does not exist YET."
 *
 * A cold start is ALLOWED at or inside the research band and CONDITIONAL above
 * it. It is capped at ALLOWED by construction, so no caller can produce a
 * SUPPORTED verdict for a runner with no record.
 *
 * Rule 9 · the band edge is a threshold on a continuous quantity, and it is the
 * SAME shape `classifyStep`'s own bands already are: the consequence either
 * side is "carries a gate" versus "does not", never "prescribed" versus
 * "refused". A hair over the beginner band buys an earning gate and a
 * reassessment date, which is a difference of degree.
 */
export function coldStartClassFor(
  prescribed: number | null,
  posture: ColdStartPosture,
): EvidenceClass {
  if (prescribed === null) return 'UNKNOWN';
  if (posture.allowance === null) return 'CONDITIONAL';
  return prescribed <= posture.allowance.value + COLD_START_ALLOWANCE_EPSILON
    ? 'ALLOWED' : 'CONDITIONAL';
}

/**
 * The allowance as an `Attributed` number, for a trace that reports it.
 *
 * Deliberately NOT written into `demonstratedMaxToday`. That field means "what
 * he has done", it stays null, and its basis says so. Putting a research figure
 * there would be inventing athlete support in the one field the gate reads as
 * athlete evidence.
 */
export function allowanceAttributed(posture: ColdStartPosture): Attributed<number | null> {
  return {
    value: posture.allowance?.value ?? null,
    provenance: posture.allowance?.provenance ?? 'POLICY_ASSUMPTION',
    basis: posture.allowance?.basis
      ?? `No research table states an opening ${quantityWord(posture.quantity)} for a runner `
      + 'with no record, so none is claimed.',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE GATE'S HALF
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Everything that must hold for a cold-start decision to be honest.
 *
 * Returns the FAULTS. An empty array is the pass. Called by `checkPromotion`'s
 * `coldStartHonesty` dimension, which is what stops a cold start from being a
 * silent bypass of adjudication.
 */
export function coldStartFaults(args: {
  readonly decisionId: string;
  readonly athlete: AthleteEvidence;
  readonly posture: ColdStartPosture;
  readonly hasGate: boolean;
  /** The date the prescription lands, so the reassessment can be checked. */
  readonly landsOnISO: string;
}): readonly string[] {
  const { decisionId, athlete, posture, hasGate, landsOnISO } = args;
  const out: string[] = [];

  // 1 · no invented athlete support, in the field the gate reads as evidence.
  if (athlete.demonstratedMaxToday.value !== null) {
    out.push(`${decisionId} · declares a cold start while reporting a demonstrated maximum of `
      + `${athlete.demonstratedMaxToday.value}. One of the two is false.`);
  }
  if (athlete.evidenceClass === 'SUPPORTED') {
    out.push(`${decisionId} · a cold-start prescription is classed SUPPORTED. Nothing this `
      + 'runner has done supports it, and ALLOWED is the strongest class available.');
  }
  if (athlete.evidenceClass === 'CONTRAINDICATED') {
    out.push(`${decisionId} · a cold-start prescription is classed CONTRAINDICATED. His history `
      + 'argues neither for nor against it, because there is none.');
  }

  // 2 · the confidence is stated, low, and says what is missing.
  if (posture.confidence !== 'LOW' || posture.confidenceSentence.trim().length < 20) {
    out.push(`${decisionId} · the cold-start confidence is not stated as LOW with a reason.`);
  }

  // 3 · calibration is scheduled, and scheduled in time to act.
  if (posture.calibration.length === 0) {
    out.push(`${decisionId} · a cold start with no calibration scheduled. Nothing would ever `
      + 'end it, which makes the low confidence permanent rather than opening.');
  }
  for (const c of posture.calibration) {
    if (c.byISO > landsOnISO) {
      out.push(`${decisionId} · calibration "${c.measurable}" is due ${c.byISO}, after the `
        + `${landsOnISO} prescription it is supposed to inform.`);
    }
  }

  // 4 · a reassessment date, before the thing it guards.
  if (posture.reassessOnISO > landsOnISO) {
    out.push(`${decisionId} · reassessed on ${posture.reassessOnISO}, after the ${landsOnISO} `
      + 'prescription. A reassessment that runs too late cannot change anything.');
  }

  // 5 · a prescription past the research allowance is earned, not waved through.
  if (posture.allowance !== null && athlete.prescribed !== null
    && athlete.prescribed > posture.allowance.value && !hasGate) {
    out.push(`${decisionId} · prescribes ${athlete.prescribed} against a research allowance of `
      + `${posture.allowance.value} with no earning gate. Past the allowance it has to be `
      + 'earned, because nothing else vouches for it.');
  }
  if (posture.allowance === null && !hasGate) {
    out.push(`${decisionId} · no research allowance exists for `
      + `${quantityWord(posture.quantity)} and the prescription carries no earning gate. That `
      + 'is a number with nothing behind it at all.');
  }

  return out;
}
