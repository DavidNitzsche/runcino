/**
 * lib/adaptation/volume-evidence/weight.ts · CONTINUOUS-EVIDENCE-1 · THE CURVE
 * THAT REPLACED THE ADMISSION CLIFF.
 *
 * ── THE DEFECT THIS FILE EXISTS TO REMOVE ─────────────────────────────────
 *
 * The owner, on the first real-history replay of this directory:
 *
 *     "The closest historical week completed 47.3 against 45.5 prescribed but
 *      contributed zero evidence because it missed a 47.8 bar by 0.4 miles.
 *      That is another cliff."
 *
 * He is right, and it is CLAUDE.md Rule 9 in its purest form. `admit.ts` step
 * 0b compared `admissibleSurplusMi` against `prescribedMi ×
 * VOLUME_ADDITION_THRESHOLD` and returned NOT_SUPPORTED below it and the FULL
 * surplus above it. Two weeks a tenth of a mile apart produced answers that
 * differed in KIND: zero evidence, or all of it. And the signature Rule 9 names
 * was present — **the fitter runner got nothing**, because 47.3 mi of running
 * bought exactly what 45.5 did.
 *
 * ── WHAT REPLACED IT ──────────────────────────────────────────────────────
 *
 * A week's contribution is a PRODUCT OF CONTINUOUS FACTORS, each bounded in
 * [0, 1] or in fractions of prescribed volume, each named, each with a
 * provenance:
 *
 *   creditedSurplusFrac(s) = gpsNoiseGate(s) × min(s, PER_WEEK_CREDIT_CEILING)
 *   units                  = creditedSurplusFrac            what it was worth
 *   confirmedUnits         = units × absorptionWeight        what may be spent
 *   progressionFraction    = clamp01(Σ recency × confirmedUnits / PROGRESSION_UNLOCK)
 *
 * and the PROPOSAL ITSELF scales with `progressionFraction`, so there is no
 * cliff at the unlock either. Crossing a line never transforms zero evidence
 * into full evidence, because nothing here is a line: it is a ramp with two
 * doctrine-stated ends.
 *
 * ── EVERY COEFFICIENT'S PROVENANCE, AND WHY THAT IS THE POINT ─────────────
 *
 * `COEFFICIENTS` below is the ledger, and `_continuous_evidence.test.ts`
 * asserts three things about it: that every CALCULATED_PHYSIOLOGY entry
 * resolves its doc and anchor and equals the number the doc states TODAY, read
 * out at gate time (Rule 7 and Rule 18: a check that hardcodes both sides only
 * proves the test agrees with itself); that every POLICY_ASSUMPTION entry
 * carries a `says` that admits the number was chosen; and that no constant in
 * this file is missing from the ledger.
 *
 * THE HONEST WARNING, SAID HERE RATHER THAN DISCOVERED LATER:
 * `Research/00a` §"The 10% rule — reconsidered" declines to support a 10%
 * weekly cap and reports "Weekly mileage change correlated weakly with
 * injury". So doctrine gives NO licence for a steep curve on the weekly-volume
 * axis, and none of the curves here is steep. What doctrine DOES state, and
 * what every shape below is built out of, is a per-CYCLE growth band (5-15%)
 * and a per-SESSION spike threshold. The steepness lives where the evidence
 * put it, which is the single run, and that guard is `volume_overshoot`'s and
 * `RAMP.single-session-spike`'s, untouched by this file.
 *
 * ── WHAT IS CONTINUOUS HERE, AND WHAT IS DELIBERATELY NOT ─────────────────
 *
 * Rule 9 is about a HAIR OF INPUT producing a categorically different outcome.
 * A boolean input has no hair. So the categorical facts stay categorical and
 * are not dressed up as ramps:
 *
 *   a merged row (Rule 14 · `mergedIntoId`)     contributes to NEITHER channel
 *   a run the resolver could not tier            contributes to NEITHER channel
 *   pain or injury reported                      zero capacity
 *   unplanned recovery taken                     zero capacity
 *   a session that deteriorated                  zero capacity
 *   a Rule 8 non-normal week                     zero capacity, FATIGUE STILL
 *
 * Only the three genuinely CONTINUOUS quantities were ramped, because only
 * they could have a cliff in the first place: the size of the surplus, the
 * following week's completion fraction, and the age of the evidence.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ───────────────────
 *
 * · It cannot fail on a curve that is smooth and WRONG. Continuity is
 *   checkable; whether 5% of prescribed volume in one week really is a third
 *   of a training cycle's worth of evidence is a coaching judgement, and no
 *   test in this repo can settle it.
 * · It cannot fail on a doc that is itself wrong. Every CALCULATED_PHYSIOLOGY
 *   number is asserted equal to what `Research/` says today. If the research
 *   is mistaken, this file is confidently mistaken with it.
 * · It cannot fail on the SHAPE of a curve, only on its endpoints. The gate
 *   reads 5, 15, 1, 3, 21, 28 out of the docs. Nothing in any doc says the
 *   ramp between two of those numbers should be linear rather than smoothstep,
 *   and that choice is a POLICY_ASSUMPTION carried in the ledger as one.
 * · It cannot see a runner whose GPS is systematically long or short. The
 *   noise floor is a population figure from `Research/15`; this runner's own
 *   device error is not measured anywhere in this app, which is why the
 *   coefficient is population-sourced and says so rather than claiming to be
 *   ATHLETE_EVIDENCE.
 * · It cannot fail on the SEAM. Nothing here is wired to a writer.
 *   `AUTOMATIC_ADAPTATION_AUTHORITY` stays false and this file does not read
 *   it, name it, or open it.
 */
import { roundTo } from '@/lib/format/run';
// Rule 16 · the app already has ONE number for "this much extra is adding
// mileage". It is imported rather than re-typed, and its ROLE changed rather
// than its value: it was the floor a week had to clear to be admitted at all,
// and it is now the CEILING on how much credit any single week may claim. See
// `PER_WEEK_CREDIT_CEILING_FRAC` for the argument.
import { VOLUME_ADDITION_THRESHOLD } from '@/lib/plan/adjudication/adjudicate';
import {
  THRESHOLD_EVIDENCE_WINDOW_DAYS,
  THRESHOLD_EVIDENCE_WINDOW_DAYS_TIGHT,
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
} from './contract';

/* ══════════════════════════════════════════════════════════════════════════
 * THE PROVENANCE VOCABULARY
 *
 * The owner's requirement, verbatim: "Every curve and coefficient has named
 * provenance." Three kinds, and the discipline is that the third is never
 * disguised as the first.
 * ═══════════════════════════════════════════════════════════════════════ */

export type Provenance =
  /**
   * Read out of a `Research/` document at gate time and asserted equal to what
   * the document states TODAY. Never a number typed from memory, and never one
   * where both sides of the comparison are hardcoded (Rule 18).
   *
   * The name is the repo's existing vocabulary. Two entries below are
   * MEASUREMENT doctrine rather than physiology strictly — the GPS distance
   * error band is a fact about receivers, not about legs — and they say so in
   * their own `says` line rather than being quietly relabelled.
   */
  | 'CALCULATED_PHYSIOLOGY'
  /** Measured from this runner's own history. Nothing here is, yet. */
  | 'ATHLETE_EVIDENCE'
  /**
   * CHOSEN. Not derived, not cited, defensible but arguable. Every entry with
   * this provenance must say plainly in `says` that it was chosen and what
   * would change if it were chosen differently.
   */
  | 'POLICY_ASSUMPTION';

export interface Coefficient {
  readonly name: string;
  readonly value: number;
  readonly provenance: Provenance;
  /** Required for CALCULATED_PHYSIOLOGY. The doc the gate resolves. */
  readonly doc: string | null;
  /** Required for CALCULATED_PHYSIOLOGY. A VERBATIM line, never a line number. */
  readonly anchor: string | null;
  /** Plain English: what this number is and, for a chosen one, that it was chosen. */
  readonly says: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE NOISE FLOOR · "GPS noise contributes nothing"
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The lower edge of the distance error a GPS watch can produce on its own,
 * as a fraction of the distance recorded.
 *
 * `Research/15` §"Pace and GPS Accuracy" · "Coaching implications":
 * "**Race PRs** measured by GPS distance can over- or under-report by 1-3% on
 * technical courses". Below the LOWER edge, a surplus is indistinguishable
 * from the watch and contributes exactly nothing.
 */
export const GPS_DISTANCE_ERROR_LO_FRAC = 0.01;

/**
 * The upper edge of the same band. At or above it, measurement error alone can
 * no longer account for the surplus, and the noise gate is fully open.
 *
 * Between the two edges the gate RAMPS rather than steps, because 1% and 3% are
 * the ends of a range doctrine states as a range. A step at either end would be
 * the same defect this file was written to remove.
 */
export const GPS_DISTANCE_ERROR_HI_FRAC = 0.03;

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE SIZE OF THE CREDIT · "small overruns small, larger overruns more,
 *     one extreme overrun does not establish sustainable capacity"
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The most credit ONE week may claim, as a fraction of its own prescription.
 *
 * `Research/00a` §"Volume progression rules" · row "Year-on-year base growth":
 * "5-15% per training cycle for trained athletes". The doc states that band per
 * CYCLE, not per week. So the LOWER edge is the most a single week may claim
 * on its own, and a week that ran 40% over prescription claims exactly the same
 * as one that ran 5% over: saturation is what makes "one extreme overrun does
 * not establish sustainable capacity" STRUCTURAL rather than a special case.
 *
 * It is numerically `VOLUME_ADDITION_THRESHOLD`, and that identity is asserted
 * rather than assumed (`_continuous_evidence.test.ts` · "the three doctrine
 * numbers agree"). The constant that used to be the FLOOR a week had to clear
 * to be admitted at all is now the CEILING on what a week may contribute. Same
 * number, same doctrine, opposite role — which is the whole fix: a week at
 * 4.9% of prescription now earns 98 per cent of a week's credit instead of
 * zero.
 */
export const PER_WEEK_CREDIT_CEILING_FRAC = VOLUME_ADDITION_THRESHOLD;

/**
 * The accumulated evidence that unlocks a FULL doctrinal volume step.
 *
 * The UPPER edge of the same "Year-on-year base growth" cell: 15% per training
 * cycle. One cycle's worth of demonstrated growth, accumulated across weeks,
 * is what buys the full step.
 *
 * The three numbers agree, and the agreement is load-bearing rather than
 * decorative:
 *
 *   PROGRESSION_UNLOCK_FRAC / PER_WEEK_CREDIT_CEILING_FRAC
 *     = 0.15 / 0.05
 *     = 3
 *     = VOLUME_MIN_CONSECUTIVE_WEEKS
 *
 * so the minimum number of weeks that can unlock a full step is EXACTLY the
 * contract's own "≥3 consecutive non-cutback weeks", arrived at from a
 * different document. The gate asserts that identity by reading all three out
 * of their own sources; if any of them moves, the gate fails and somebody has
 * to re-argue the calibration rather than discover it.
 */
export const PROGRESSION_UNLOCK_FRAC = 0.15;

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · ABSORPTION · "evidence remains provisional until recovery indicates
 *     absorption"
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The following week's completion fraction at which absorption reads as fully
 * confirmed. The contract's own weekly-volume bar,
 * `VOLUME_WEEK_COMPLETION_MIN_FRAC`, imported rather than re-typed.
 */
export const ABSORPTION_CONFIRMED_FRAC = VOLUME_WEEK_COMPLETION_MIN_FRAC;

/**
 * The following week's completion fraction at which absorption reads as zero.
 *
 * `docs/PROGRESSIVE_BASELINE_DOCTRINE.md` Q9 · "At least **two of the
 * preceding three non-cutback weeks** completed at **≥90%**". That is
 * doctrine's OTHER weekly-completion bar: the softer one, which asks only
 * whether a week counts as having been completed at all.
 *
 * So the ramp spans the two weekly-completion bars doctrine actually states.
 * Below the softer one the week was not completed on anybody's reading and
 * absorption is zero; at the harder one it is confirmed; between them doctrine
 * is genuinely ambiguous and the engine interpolates rather than picking a side
 * and putting a cliff on it. `contract-constants.ts` notes that Q9's number is
 * "not re-typed here because this engine does not evaluate the earned peak" —
 * this file does not evaluate it either, it uses the same figure for a
 * different question, so it is declared here, under the name of the job it
 * does, with its own citation.
 *
 * This is the ONLY place this change is more permissive than what it replaced:
 * a following week at 94% used to contribute zero and now contributes 80 per
 * cent of the absorption factor. `RULE_21_THRESHOLD_LEDGER` row 9 carries the
 * argument and the bound that keeps it safe.
 */
export const ABSORPTION_FLOOR_FRAC = 0.90;

/**
 * What a surplus is worth while the week after it has not been run yet.
 *
 * CHOSEN. Not derived from anything. It must be strictly below 1, or evidence
 * whose absorption has never been observed would count the same as evidence
 * that was observed being absorbed, which is the owner's "provisional until
 * recovery indicates absorption" ignored. It must be strictly above 0, or the
 * most recent week would be silently erased, which is Rule 11's collapse of
 * "not yet known" into "no".
 *
 * A half is the midpoint of that open interval and nothing more. Choosing 0.25
 * instead would make the engine slower to respond to the newest week and
 * change no other property; choosing 0.75 would make it faster. Whoever
 * revisits this should revisit it as a coaching question, not a arithmetic one.
 */
export const PROVISIONAL_ABSORPTION_WEIGHT = 0.5;

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · RECENCY · so that evidence ageing out of the window is not a cliff
 *     in the TIME axis
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The age, in days, up to which a week's evidence counts in full.
 *
 * `docs/ADAPTATION_ENGINE_CONTRACT.md` states its evidence window as
 * "within ~21-28 days", and `contract-constants.ts` exports the tight edge
 * with the note that "a future confidence model may want to weight a 21-day
 * corroboration above a 28-day one. Nothing reads it yet". This is that
 * reader.
 *
 * THE BORROWING IS DECLARED: the contract states 21-28 for THRESHOLD PACE, and
 * this is weekly volume. The outer edge is independently correct for this
 * domain — see `EVIDENCE_WINDOW_DAYS` — but the inner edge is carried across
 * from a neighbouring lever because it is the only inner edge the app states.
 * That transfer is a POLICY_ASSUMPTION and is filed as one, even though the
 * number itself is read out of a doc.
 *
 * IMPORTED, NEVER RE-TYPED. It was a literal `21` in the first cut, which was
 * a second definition of a number the app already had, and Rule 16 says one
 * quantity gets one name. It arrives through `./contract`, this directory's
 * single door into the canonical engine's vocabulary.
 */
export const EVIDENCE_FULL_CREDIT_DAYS = THRESHOLD_EVIDENCE_WINDOW_DAYS_TIGHT;

/**
 * The age at which a week's evidence has decayed to nothing.
 *
 * `Research/00a` §"Load metrics" · row "Chronic load (28-day)": "Mean weekly
 * load over last 28 days". Twenty-eight days is the window over which this
 * domain's own doctrine integrates training volume, so it is the honest outer
 * edge for a volume-evidence ledger, and it coincides with the contract's own
 * evidence window — which is why it is IMPORTED from that one definition
 * rather than re-typed, while the citation above is what justifies using it
 * for THIS domain.
 */
export const EVIDENCE_WINDOW_DAYS = THRESHOLD_EVIDENCE_WINDOW_DAYS;

/* ══════════════════════════════════════════════════════════════════════════
 * THE LEDGER · every constant above, with its provenance, in one array the
 * gate walks. A constant absent from here fails the gate; an entry naming a
 * constant that no longer exists fails it too (Rule 18 · a ratchet in both
 * directions).
 * ═══════════════════════════════════════════════════════════════════════ */

export const COEFFICIENTS: readonly Coefficient[] = [
  {
    name: 'GPS_DISTANCE_ERROR_LO_FRAC',
    value: GPS_DISTANCE_ERROR_LO_FRAC,
    provenance: 'CALCULATED_PHYSIOLOGY',
    doc: 'Research/15-wearable-data.md',
    anchor: 'measured by GPS distance can over- or under-report by',
    says:
      'Measurement doctrine, not physiology, and it is filed as CALCULATED_PHYSIOLOGY only '
      + 'because that is this ledger\'s name for "read out of Research/ at gate time". The '
      + 'lower edge of the distance error a GPS watch produces on its own. A surplus below '
      + 'it is the watch, not the runner, and contributes nothing.',
  },
  {
    name: 'GPS_DISTANCE_ERROR_HI_FRAC',
    value: GPS_DISTANCE_ERROR_HI_FRAC,
    provenance: 'CALCULATED_PHYSIOLOGY',
    doc: 'Research/15-wearable-data.md',
    anchor: 'measured by GPS distance can over- or under-report by',
    says:
      'The upper edge of the same band. At or above it, measurement error alone cannot '
      + 'account for the surplus and the noise gate is fully open.',
  },
  {
    name: 'PER_WEEK_CREDIT_CEILING_FRAC',
    value: PER_WEEK_CREDIT_CEILING_FRAC,
    provenance: 'CALCULATED_PHYSIOLOGY',
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    says:
      'The lower edge of doctrine\'s per-CYCLE base-growth band (5-15%). Doctrine states it '
      + 'per cycle, so it is the most one week may claim on its own. This is what makes one '
      + 'extreme overrun unable to establish sustainable capacity.',
  },
  {
    name: 'PROGRESSION_UNLOCK_FRAC',
    value: PROGRESSION_UNLOCK_FRAC,
    provenance: 'CALCULATED_PHYSIOLOGY',
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    says:
      'The upper edge of the same band: one training cycle\'s worth of demonstrated growth, '
      + 'accumulated, buys a full doctrinal step. Its ratio to the per-week ceiling is '
      + 'exactly VOLUME_MIN_CONSECUTIVE_WEEKS, which the gate asserts by reading all three '
      + 'out of their own sources.',
  },
  {
    name: 'ABSORPTION_CONFIRMED_FRAC',
    value: ABSORPTION_CONFIRMED_FRAC,
    provenance: 'CALCULATED_PHYSIOLOGY',
    doc: 'docs/ADAPTATION_ENGINE_CONTRACT.md',
    anchor: 'Weekly volume',
    says:
      'The contract\'s own weekly-volume completion bar, imported from '
      + 'VOLUME_WEEK_COMPLETION_MIN_FRAC rather than re-typed. The following week completing '
      + 'at or above it reads absorption as confirmed.',
  },
  {
    name: 'ABSORPTION_FLOOR_FRAC',
    value: ABSORPTION_FLOOR_FRAC,
    provenance: 'CALCULATED_PHYSIOLOGY',
    doc: 'docs/PROGRESSIVE_BASELINE_DOCTRINE.md',
    anchor: 'completed at **≥90%**',
    says:
      'Q9\'s softer weekly-completion bar: the fraction below which a week does not count as '
      + 'completed on anybody\'s reading. Absorption reads as zero there. The ramp between '
      + 'this and ABSORPTION_CONFIRMED_FRAC spans the two weekly-completion bars doctrine '
      + 'actually states, and interpolates where doctrine is silent.',
  },
  {
    name: 'PROVISIONAL_ABSORPTION_WEIGHT',
    value: PROVISIONAL_ABSORPTION_WEIGHT,
    provenance: 'POLICY_ASSUMPTION',
    doc: null,
    anchor: null,
    says:
      'CHOSEN, and derived from nothing. What a surplus is worth while the week after it has '
      + 'not been run yet. It has to be below 1 (or unobserved absorption would count as '
      + 'observed) and above 0 (or Rule 11 collapses "not yet known" into "no"); a half is '
      + 'the midpoint of that open interval and no more than that. A different value changes '
      + 'how fast the engine responds to the newest week and changes nothing else.',
  },
  {
    name: 'EVIDENCE_FULL_CREDIT_DAYS',
    value: EVIDENCE_FULL_CREDIT_DAYS,
    provenance: 'POLICY_ASSUMPTION',
    doc: 'docs/ADAPTATION_ENGINE_CONTRACT.md',
    anchor: 'Threshold pace',
    says:
      'The NUMBER is doctrine\'s (the contract\'s "within ~21-28 days", exported as '
      + 'THRESHOLD_EVIDENCE_WINDOW_DAYS_TIGHT). The TRANSFER is chosen: the contract states '
      + 'that window for threshold pace, and this is weekly volume. Filed as a policy '
      + 'assumption because the borrowing is the arguable part, not the digits.',
  },
  {
    name: 'EVIDENCE_WINDOW_DAYS',
    value: EVIDENCE_WINDOW_DAYS,
    provenance: 'CALCULATED_PHYSIOLOGY',
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Load metrics',
    says:
      'The chronic-load window: "Chronic load (28-day) | Mean weekly load over last 28 '
      + 'days". The period over which this domain\'s own doctrine integrates training '
      + 'volume, and therefore the honest outer edge of a volume-evidence ledger.',
  },
] as const;

/* ══════════════════════════════════════════════════════════════════════════
 * THE CURVES
 *
 * Every function below is pure, total, monotone non-decreasing in its primary
 * argument, and continuous. `_continuity_walk.test.ts` walks each of them in
 * small increments and asserts all three properties rather than trusting this
 * paragraph (Rule 20 · a rule with no gate is a hypothesis).
 * ═══════════════════════════════════════════════════════════════════════ */

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * The smoothstep on [0, 1]. Continuous, monotone, and with zero derivative at
 * both ends, so a ramp built on it has no kink where it meets its own
 * endpoints.
 *
 * THE SHAPE IS A POLICY_ASSUMPTION and is not in `COEFFICIENTS` because it
 * carries no number to cite. Nothing in any `Research/` document says the ramp
 * between 1% and 3% of measurement error should be cubic rather than linear.
 * What doctrine supplies is the ENDS; the curve between them is the engine's,
 * and saying so here is the difference between an assumption and a disguise.
 */
export const smoothstep01 = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** A straight ramp from `lo` to `hi`, clamped. Continuous and monotone. */
export const rampAcross = (lo: number, hi: number, x: number): number => {
  if (!(hi > lo)) return x >= hi ? 1 : 0;
  return clamp01((x - lo) / (hi - lo));
};

/**
 * "GPS noise contributes nothing."
 *
 * Zero at or below the lower edge of the measurement-error band, one at or
 * above the upper edge, smooth between. Note the direction of the guarantee:
 * this is the ONLY hard zero on the size axis, and it is a hard zero at a
 * point where the derivative is also zero, so it is not a cliff.
 */
export function gpsNoiseGate(surplusFrac: number): number {
  return smoothstep01(
    rampAcross(GPS_DISTANCE_ERROR_LO_FRAC, GPS_DISTANCE_ERROR_HI_FRAC, surplusFrac),
  );
}

/**
 * The size of one week's credit, in fractions of that week's own prescription.
 *
 *   · below 1% of prescribed          zero. The watch, not the runner.
 *   · 1% to 3%                        ramps in.
 *   · 3% to 5%                        the surplus itself, credited in full.
 *   · above 5%                        saturated at 5%. A 40%-over week and a
 *                                     5%-over week are the same evidence about
 *                                     SUSTAINABLE capacity, which is the
 *                                     owner's own requirement.
 *
 * Monotone non-decreasing everywhere, and continuous everywhere: at the
 * saturation point the left and right limits are both
 * `PER_WEEK_CREDIT_CEILING_FRAC`.
 */
export function creditedSurplusFrac(surplusFrac: number): number {
  if (!Number.isFinite(surplusFrac) || surplusFrac <= 0) return 0;
  return gpsNoiseGate(surplusFrac) * Math.min(surplusFrac, PER_WEEK_CREDIT_CEILING_FRAC);
}

/**
 * How much the following week's completion confirms the load was absorbed.
 *
 * Zero at or below doctrine's softer weekly bar, one at or above the
 * contract's harder one, straight between. The ramp is LINEAR rather than
 * smoothstepped here on purpose: this band is five percentage points wide and
 * a cubic across it would spend most of its width nearly flat, which reads as
 * a step again at the resolution anybody would look at.
 */
export function absorptionWeight(followingWeekCompletionFrac: number): number {
  return rampAcross(ABSORPTION_FLOOR_FRAC, ABSORPTION_CONFIRMED_FRAC, followingWeekCompletionFrac);
}

/**
 * How much a week's evidence counts, given its age.
 *
 * Full credit inside the contract's tight window, decaying linearly to nothing
 * at the chronic-load window's edge. The point of the ramp is that evidence
 * ageing out is a change in TIME, and a flat window would make the fourth
 * week's contribution vanish overnight — Rule 9's cliff on a different axis.
 */
export function recencyWeight(ageDays: number): number {
  if (ageDays <= EVIDENCE_FULL_CREDIT_DAYS) return 1;
  return 1 - rampAcross(EVIDENCE_FULL_CREDIT_DAYS, EVIDENCE_WINDOW_DAYS, ageDays);
}

/**
 * Accumulated evidence, expressed as the share of a full doctrinal step it
 * buys. One at or above one training cycle's worth of demonstrated growth.
 *
 * This is what removes the LAST cliff. The unlock is not a gate the proposal
 * passes through; it is the scale the proposal is multiplied by, so a runner
 * holding a third of the evidence gets a third of the step rather than
 * nothing.
 */
export function progressionFractionFromUnits(units: number): number {
  if (!Number.isFinite(units) || units <= 0) return 0;
  return clamp01(units / PROGRESSION_UNLOCK_FRAC);
}

/** For a report or a test: the curve's own numbers, rounded once, in one place. */
export const describeWeekCredit = (surplusFrac: number): string => {
  const credited = creditedSurplusFrac(surplusFrac);
  return `${roundTo(surplusFrac * 100)} per cent over prescription credits `
    + `${roundTo(credited * 100)} points of the ${roundTo(PROGRESSION_UNLOCK_FRAC * 100)} `
    + 'a full step needs.';
};
