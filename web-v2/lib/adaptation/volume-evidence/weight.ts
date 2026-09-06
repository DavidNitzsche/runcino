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
 *   TWO sessions deteriorated (Q13 "repeated")   zero capacity
 *   a Rule 8 non-normal week                     zero capacity, FATIGUE STILL
 *
 * Four genuinely CONTINUOUS quantities are ramped, because only they could
 * have a cliff in the first place: the size of the surplus, the following
 * week's completion fraction, the age of the evidence, and how badly the worst
 * session in the week fell away.
 *
 * DETERIORATION-SEVERITY-1 (2026-09-05) moved the fifth row of that first list
 * from one column to the other. It used to read "a session that deteriorated ·
 * zero capacity", and that was the defect: `docs/PROGRESSIVE_BASELINE_DOCTRINE
 * .md` Q13 says in as many words that one deteriorated session "must not
 * independently block progression unless the deterioration is extreme", and a
 * SESSION'S SEVERITY IS NOT A BOOLEAN. What stayed categorical is the part
 * that genuinely is: a COUNT of sessions (Q13's "repeated" is ≥2), and the
 * point where the severity curve has already reached zero anyway.
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
  DETERIORATION_DECOUPLING_FRAC,
  DETERIORATION_SEVERITY_EXTREME_FRAC,
  THRESHOLD_EVIDENCE_WINDOW_DAYS,
  THRESHOLD_EVIDENCE_WINDOW_DAYS_TIGHT,
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
} from './contract';

/* DETERIORATION-SEVERITY-1 · re-exported under their OWN names rather than
 * aliased, because an alias is a second name for one quantity (Rule 16). The
 * re-export is what puts them in this module's namespace, which is what the
 * `COEFFICIENTS` completeness check walks: a doctrine number this file's curves
 * depend on must carry a provenance entry like every other. */
export { DETERIORATION_DECOUPLING_FRAC, DETERIORATION_SEVERITY_EXTREME_FRAC };

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
 * so the FEWEST weeks that could ever unlock a full step is EXACTLY the
 * contract's own "≥3 consecutive non-cutback weeks", arrived at from a
 * different document. The gate asserts that identity by reading all three out
 * of their own sources; if any of them moves, the gate fails and somebody has
 * to re-argue the calibration rather than discover it.
 *
 * ── AND THE PART THAT SENTENCE USED TO GET WRONG (corrected 2026-09-05) ────
 *
 * It said the minimum "IS" three weeks, full stop. That is arithmetic about
 * this ratio and NOT a claim about the ledger, and read as a claim about the
 * ledger it is false. `accumulateCapacityEvidence` multiplies every week by
 * two more factors before summing it: `absorptionWeight`, so a week whose
 * successor has not been run yet contributes `PROVISIONAL_ABSORPTION_WEIGHT`
 * of itself, and `recencyWeight`, so a week older than
 * `EVIDENCE_FULL_CREDIT_DAYS` contributes less and one at
 * `EVIDENCE_WINDOW_DAYS` contributes nothing.
 *
 * Both bite in the ordinary case. Three 5-per-cent weeks read the day after
 * the third ends are 7, 14 and 21 days old, all inside the tight window, so
 * recency costs nothing and only the newest week's provisional absorption
 * does. Read one week later they are 14, 21 and 28 days old and the FIRST WEEK
 * HAS AGED OUT ENTIRELY, leaving two thirds of a step.
 *
 * So: three weeks is the floor, not the expectation. Both figures are now
 * asserted in `_continuous_evidence.test.ts` rather than described here, and
 * that is the point — Rule 20's corollary is that a header comment asserting
 * an invariant is documentation and not enforcement, and this paragraph is
 * only worth reading because the case underneath it can fail.
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
 * 3b · DETERIORATION · "one deteriorated session reduces confidence; it must
 *      not independently block progression unless the deterioration is
 *      extreme"
 *
 * DETERIORATION-SEVERITY-1 · THE SECOND CLIFF OF EXACTLY THE SAME SHAPE AS THE
 * FIRST, and the owner found it the same way.
 *
 * `admit.ts` condition 3 refused an entire week on `deterioratedCount > 0`,
 * while `canonical/deterioration.ts`'s own roll-up sentence read "One session
 * showed late deterioration, which reduces confidence without blocking
 * progression". Two files, one question, opposite answers (Rule 16), and the
 * doctrine both of them cite says the second one. Measured cost: it was the
 * ONLY reason 2026-06-15 — the one week on the reference account carrying a
 * real admissible surplus — contributed nothing through the live path.
 *
 * The resolution is the one CONTINUOUS-EVIDENCE-1 already used twice: the
 * DEGREE question leaves the categorical gate and becomes a curve, and the
 * gate keeps only the part that is genuinely categorical.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * How much of a week's credit survives the worst session in it, given that
 * session's Pa:HR decoupling.
 *
 *   · at or below 5%    1. `Research/03` §12: "Strong aerobic endurance;
 *                       sustainable". Doctrine's own word for that band, so a
 *                       session inside it costs nothing.
 *   · 5% to 8%          ramps 1 down to 0 across §12's "Acceptable;
 *                       approaching aerobic limit" row.
 *   · at or above 8%    0. §12: "Endurance gap; build base before
 *                       progressing". Doctrine saying, in its own words, that
 *                       a progression is not licensed here.
 *   · null              1, and that is the one place this function is NOT
 *                       conservative. See below.
 *
 * ── WHY IT IS APPLIED TO EVERY READABLE SESSION, NOT ONLY FLAGGED ONES ────
 *
 * Because the alternative is a cliff, and it is a measurable one. Q13's second
 * signal fires at "pace within ~2% but HR rises >~6 bpm". Take a session at
 * exactly 2% slower with heart rate up 6 bpm from 150: it is CLEAN. Nudge the
 * heart rate to 6.1 bpm and it is DETERIORATED, while its decoupling moved by
 * 0.03 of a percentage point. A factor gated on the VERDICT would drop from 1
 * to about 0.6 on that hair. A factor that reads only the decoupling does not
 * notice the boundary at all, which is precisely CLAUDE.md Rule 9's
 * instruction to walk the quantity rather than the verdict.
 * `_deterioration_severity.test.ts` walks that exact boundary and measures the
 * step the rejected design would have had.
 *
 * ── RULE 11 · WHY `null` IS 1 AND NOT 0 ──────────────────────────────────
 *
 * `null` means no session in the window was readable — a truncated watch file,
 * thirds that are not comparable, no heart rate. That is "we could not tell",
 * and this engine's standing answer to "could not tell" on the deterioration
 * axis is to withhold nothing and grant nothing: `admit.ts` has never blocked
 * on `unknownCount`, and `RULE_21_THRESHOLD_LEDGER` row 8 carries the
 * argument, which is that cutting a runner's plan on a session nobody could
 * read costs him the block while withholding a raise costs him a week. This
 * function therefore returns 1 and the REFUSAL is made elsewhere, by
 * `admit.ts`, in the one case where it matters: a session that is KNOWN to
 * have deteriorated but whose severity is unreadable is UNREADABLE, not mild.
 * That split is the whole of Rule 11 on this axis and it is asserted rather
 * than described.
 *
 * The function itself is with the other curves, below `absorptionWeight`.
 */

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
    name: 'DETERIORATION_DECOUPLING_FRAC',
    value: DETERIORATION_DECOUPLING_FRAC,
    provenance: 'CALCULATED_PHYSIOLOGY',
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '| Decoupling % | Meaning |',
    says:
      'The ceiling of the band Research/03 §12 calls "Strong aerobic endurance; sustainable". '
      + 'A session at or below it costs a week nothing, because doctrine says in its own '
      + 'words that it held together. It is numerically the engine\'s own '
      + 'DETERIORATION_DECOUPLING_FRAC, which is Q13\'s pace-to-HR decoupling flag, imported '
      + 'under its own name rather than re-typed.',
  },
  {
    name: 'DETERIORATION_SEVERITY_EXTREME_FRAC',
    value: DETERIORATION_SEVERITY_EXTREME_FRAC,
    provenance: 'CALCULATED_PHYSIOLOGY',
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '| Decoupling % | Meaning |',
    says:
      'The floor of the band Research/03 §12 calls "Endurance gap; build base before '
      + 'progressing". This is where Q13\'s undefined word EXTREME is actually written down: '
      + 'doctrine states that a progression is not licensed at this decoupling, so the '
      + 'confidence curve reaches zero here and one session at or past it may block on its '
      + 'own.',
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
 * How much of a week's credit survives the worst session in it.
 *
 * THE ARGUMENT IS IN SECTION 3b ABOVE and is not repeated here (Rule 17): the
 * two doctrine edges, why the factor reads every readable session rather than
 * only flagged ones, and why `null` weighs 1 rather than 0.
 *
 * ── PAHR-QUANTITY-1 (2026-09-05) · `readabilityFrac`, SECOND PARAMETER ────
 *
 * `deterioration.ts::decouplingReadabilityFrac` establishes whether §12's own
 * preconditions (duration, terrain, heat) actually held for the session that
 * produced `severityFrac`, in [0, 1]. It arrives here as a plain number
 * (rather than this function importing that machinery itself) because this
 * file's whole job is "turn a measurement into a weight", and readability is
 * ANOTHER measurement, not a curve this file owns.
 *
 * DEFAULT 1, so every pre-existing caller — the three lever files under
 * `canonical/levers/`, none of which have been migrated to supply
 * `SessionEnvironmentalContext` — gets EXACTLY today's number back. This is
 * additive, not a behaviour change to anyone who does not opt in.
 *
 * THE COMPOSITION IS MULTIPLICATIVE ON THE PENALTY, not on the weight itself:
 * `weight = 1 - readability × penalty(severity)`. At `readability = 1` this is
 * the original one-argument function, unchanged bit-for-bit. At
 * `readability = 0` the weight is exactly 1 REGARDLESS of severity — a
 * reading this file cannot vouch for costs nothing, which is Rule 11's
 * established null-severity posture (`severityFrac == null` already returns
 * 1 above) generalised from a boolean ("could not measure at all") to a
 * continuum ("measured, but under conditions doctrine's own protocol did not
 * hold"). Continuity in BOTH inputs follows from this shape without a new
 * proof: `penalty` is `rampAcross`, bounded in [0, 1] and Lipschitz with
 * constant `1 / (EXTREME − DECOUPLING)` (≈33.3, the existing bound); the
 * output is a product of that with `readability ∈ [0, 1]`, so
 * `∂weight/∂severity = -readability × penalty'(severity)` can only be
 * SMALLER in magnitude than the unweighted case, never larger — the existing
 * slope bound of 34 in `_deterioration_severity.test.ts` part 3A therefore
 * still holds for every fixed `readability ≤ 1`, and does not need
 * re-deriving upward. The readability AXIS is even shallower: holding
 * severity fixed, `∂weight/∂readability = -penalty(severity) ∈ [-1, 0]`, a
 * slope bound of 1.
 */
export function deteriorationConfidenceWeight(
  severityFrac: number | null,
  readabilityFrac: number = 1,
): number {
  if (severityFrac == null || !Number.isFinite(severityFrac)) return 1;
  const readability = Number.isFinite(readabilityFrac) ? clamp01(readabilityFrac) : 1;
  const penalty = rampAcross(
    DETERIORATION_DECOUPLING_FRAC,
    DETERIORATION_SEVERITY_EXTREME_FRAC,
    severityFrac,
  );
  return 1 - readability * penalty;
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
