/**
 * lib/training/prescription-resolver.ts · THE PACE PRESCRIPTION OWNERSHIP LAYER.
 *
 * ONE owning service answers "given current capacity and workout purpose, what
 * intensity should be prescribed?" — `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_
 * IMPLEMENTATION.md` §1, whose sentence for this layer ends "nothing else
 * calculates training pace targets".
 *
 *     "Prescribe the stimulus the runner needs, not a pace they need to prove
 *      they can hit."                          — BRIEF 03, Pace Prescription
 *
 * ── THE ONE RULE THIS FILE IS BUILT AROUND (§7) ─────────────────────────────
 *
 * STATE MUST NOT MUTATE CAPACITY. §7 names the anti-pattern verbatim —
 * `currentFitness = baseFitness * fatiguePenalty` — and this file is
 * structurally incapable of it:
 *
 *   · `capacity` arrives as `Immutable<ResolvedCapacity>`, a recursive readonly
 *     mapping, so `capacity.threshold.paceSecPerMi = x` is a COMPILE error, not
 *     a review finding. Section 6 asserts that at the type level.
 *   · Nothing here writes anything anywhere. There is no pool, no query, no
 *     persistence, and the four capacity resolvers are not called from this
 *     module at all — the caller resolves them and hands them in.
 *   · Every state response below changes a field of the OUTPUT
 *     `WorkoutPrescription`. `capacityBasis` reports the capacity's own
 *     confidence and source mode UNTOUCHED, so a reader can always see the
 *     capacity as it was resolved, beside what state did to today's ask.
 *
 * A bad Tuesday after a huge week does not mean the runner became slower
 * (doctrine §6). It means today's demand changes. Those are different fields.
 *
 * ── GOAL ISOLATION, AND THE PURPOSE THIS FILE REFUSES TO ANSWER (§6) ────────
 *
 * `resolvePrescription` is PURE and takes no `userId`, so it cannot read a goal
 * even if it wanted one. It is the caller's job to hand it a resolved capacity
 * and a resolved state, both of which are goal-free by their own compile-time
 * assertions (`capacity-resolver.ts` §8, `runner-state.ts` §5).
 *
 * That leaves exactly one place a goal could enter, and it is worth naming
 * because the answer is a REFUSAL rather than a guard. A race-day pace target
 * is the only prescription in this app that legitimately reads a stated goal —
 * `buildWorkoutSpec`'s `race` branch takes `goalPaceSPerMi` and
 * `prescribedRacePaceSPerMi` for exactly that. So `purpose: 'race'` is DECLINED
 * here: §1 gives "what race performance does current evidence support" to Race
 * Prediction, and `lib/training/race-projection.ts` /
 * `lib/training/achievable-target.ts` already own it. A second race-pace answer
 * living in Pace Prescription would be §2's failure and §40's first merge
 * question answered wrongly.
 *
 * NO `weeksToRace`, and that is a decision rather than an omission. BRIEF 03
 * routes marathon-specific work through "threshold capacity modified
 * substantially by durability AND race-specific preparation", so a
 * race-specificity input was considered. It is not taken, because the only
 * quantity it would move — the population marathon-specificity adjustment — is
 * ALREADY OWNED elsewhere (`MARATHON_SPECIFICITY_PENALTY_PCT` in
 * `lib/training/goal-projection.ts`, `Research/02` §13.1) and is already
 * superseded here by the runner's own measured durability. See
 * `marathonPaceFromDurability` for the full argument. If a later phase finds a
 * quantity race-specificity genuinely moves in a PRESCRIPTION, the input goes
 * on `PrescriptionArgs` as an explicit narrow field supplied by plan
 * generation — never as this service reaching for goal data.
 *
 * ── WHAT IS WIRED, AND WHAT IS NOT (§21) ────────────────────────────────────
 *
 * WIRED, 2026-08-31, ON THE FLEX PATH ONLY. `composePaceAnchors` (section 8)
 * turns a resolved capacity into the six anchors a plan row can be priced at,
 * and `lib/training/load-prescription-anchors.ts` is its DB shell.
 * `lib/plan/recompute-paces.ts` and `lib/plan/reanchor-plan.ts` — the mechanism
 * that rewrites pace and distance on a LIVE block's unrun weeks — call it and
 * no longer call the VDOT cascade at all. That is the axis the 2026-08-30
 * decision reserves for adaptation: "layout, session types, dates, phases and
 * taper are FIXED once authored; pace and distance flex on the weeks not yet
 * run."
 *
 * FULLY WIRED as of 2026-09-01 (AUTHORING-CANONICAL-1). This paragraph used to
 * read "STILL NOT WIRED: `generate.ts`'s full-block authoring path", and it was
 * the honest statement of a scoped migration — but a header asserting an
 * invariant nothing verifies is documentation rather than enforcement (Rule
 * 20's prose corollary), and this one would have gone stale silently.
 *
 * `composePlan`, `composeMaintenancePlan`, `composeRecoveryPlan`,
 * `persistComposedPlan` and `loadGeneratorInputs` now price every zone from
 * `composePaceAnchors` through `load-prescription-anchors.ts`, and the whole
 * goal-to-training-pace class the old cascade carried is DELETED rather than
 * migrated. Authoring and the flex therefore agree by construction, which is
 * stronger than the convergence argument this paragraph used to make: there is
 * no longer a window in which a block is priced by one brain and rewritten by
 * another. `scripts/check-goal-pace-leak.sh` is what holds it.
 *
 * `_prescription_resolver.audit.test.ts` remains the shadow-mode report and is
 * still read-only — it is now the before/after record for this promotion rather
 * than a proposal for it.
 *
 * ── RULE 22 · WHAT THIS CANNOT FAIL ON ─────────────────────────────────────
 *
 *   · IT CANNOT BE MORE RIGHT THAN THE CAPACITY IT IS HANDED. Every number
 *     below is a transformation of a resolved capacity. The instrument blind
 *     spot `vdot-corpus.ts` names propagates through untouched.
 *   · IT HAS NO UPWARD LEVER. Nothing in this file can prescribe FASTER than
 *     the capacity supports, and every state response is neutral or reducing.
 *     That is correct for a prescription layer — progression is earned through
 *     the adaptation engine, doctrine §8 — but it means these tests cannot fail
 *     on the engine under-asking a runner, only on it over-asking one. The
 *     CLAUDE.md hero statement's asymmetry warning applies: read `proceed` as
 *     "nothing is dragging", never as "there is nothing more to give".
 *   · IT DOES NOT EVALUATE COMPLIANCE. `complianceBasis` says how a session
 *     should be judged; no judge exists yet. The field is here so the shape
 *     cannot force point-in-time policing later (doctrine §9).
 *   · IT PRESCRIBES ONE DAY. It has no view of the week, so it cannot see that
 *     two hard days sit back to back. Dosing caps and intensity distribution
 *     are the plan generator's, and stay there.
 *   · IT PRESCRIBES ONE STIMULUS PER CALL, AND A SEGMENTED SESSION HAS SEVERAL.
 *     Found by the shadow render, and named here rather than papered over: the
 *     owner's "LONG · 3.5mi @ M + 1mi @ E + 2mi @ M" is one row with three
 *     stimuli, and `purposeFromPlanRow` resolves it to its HEADLINE one. That is
 *     the right answer for a shadow comparison against a single stored pace, and
 *     the WRONG interface for wiring: a segmented session gets one call PER
 *     SEGMENT, off `parseSegments`, which is what the plan engine already
 *     decomposes those rows into. `purposeFromPlanRow` is a row-level
 *     convenience, never the wiring seam.
 *   · IT DOES NOT DECIDE WHETHER A SESSION IS PACE-CUED OR EFFORT-CUED FOR
 *     STRUCTURAL REASONS. `Research/04` §8.1 runs hill repeats by effort because
 *     they are hills, not because the capacity behind them is uncertain, and the
 *     owner's live block has two such sessions. That choice belongs to the
 *     workout library — "what structures produce this stimulus" — and this layer
 *     answers only "what intensity". A caller that authors a by-effort structure
 *     may use this prescription as the effort's reference and print no pace;
 *     this layer does not, and cannot, know to.
 */

import {
  CAPACITY_CONFIDENCE_BANDS,
  type ThresholdCapacityEstimate,
  type HighIntensityCapacityEstimate,
  type EasyCeilingEstimate,
  type DurabilityCapacityEstimate,
  type SourceMode,
} from '@/lib/training/capacity-resolver';
import { POPULATION_ENDURANCE_PRIOR } from '@/lib/training/durability-anchor';
import { TABLE_RACE_DISTANCE_MI } from '@/lib/training/vdot';
import type { RunnerState, StateDecision } from '@/lib/training/runner-state';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · IMMUTABILITY, AS A TYPE (§7)
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Recursively readonly. The mechanism that makes §7 a compiler rule.
 *
 * Arrays are mapped to `ReadonlyArray` explicitly rather than falling into the
 * object branch — a mapped type over an array produces something that still
 * accepts `push`, which would leave `capacity.threshold.evidenceIds.push(...)`
 * legal and the guarantee half-true.
 */
export type Immutable<T> =
  T extends ReadonlyArray<infer U> ? ReadonlyArray<Immutable<U>>
    : T extends object ? { readonly [K in keyof T]: Immutable<T[K]> }
      : T;

/**
 * The four resolved capacities, as one input.
 *
 * A BAG OF ALREADY-RESOLVED ESTIMATES, never a `userId`. §6's structural
 * separation is what this shape is for: a service handed four finished numbers
 * cannot re-resolve them with a goal in scope, cannot pick a different fallback
 * rung, and cannot make a fifth capacity of its own.
 */
export interface ResolvedCapacity {
  threshold: ThresholdCapacityEstimate;
  highIntensity: HighIntensityCapacityEstimate;
  easyCeiling: EasyCeilingEstimate;
  durability: DurabilityCapacityEstimate;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · WORKOUT PURPOSE — the engine's own vocabulary, routed
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The STIMULUS a session is prescribed for.
 *
 * NOT A NEW TAXONOMY. Every member is a bucket BRIEF 03's routing table already
 * names, and `purposeFromPlanRow` below maps this engine's real
 * `plan_workouts.type` vocabulary onto it — `easy · rest · long · threshold ·
 * tempo · intervals · interval · race · shakeout · race_week_tuneup ·
 * strength`, all eleven values present in the production table — crossed with
 * the zone the prescription string declares (`primaryZone`, the existing
 * canonical reader in `lib/plan/prescription-parser.ts`).
 *
 * PURPOSE IS NOT TYPE, and the gap between them is doctrine §11 stated as code:
 * "Workout labels do not define physiology ... Planned structure tells us what
 * was intended." The owner's live block contains the proof — a row typed
 * `tempo` whose prescription reads "2.5 mi WU · 11 mi @ MP · 1.5 mi CD". Its
 * TYPE says tempo; its STIMULUS is marathon-specific, and prescribing it off
 * threshold capacity because the column says "tempo" would be the exact error
 * §11 warns about.
 */
export type WorkoutPurpose =
  /** Aerobic volume. A CEILING with feel-based guidance, never a target. */
  | 'easy'
  /** Easy running, minimal dose, usually pre-race. Same ceiling as easy. */
  | 'shakeout'
  /** Long-duration aerobic running. Easy EFFORT with more volume. */
  | 'long'
  /** Marathon-effort work. Threshold capacity carried out to race distance. */
  | 'marathon_specific'
  /** Tempo, cruise intervals, sustained threshold work. */
  | 'threshold'
  /** VO2-oriented intervals. 3-5K effort. */
  | 'interval'
  /** Short repetitions. Speed and economy, ~mile effort. */
  | 'repetition'
  /** Race day. DECLINED here — see the file header. */
  | 'race'
  /** No running. */
  | 'rest';

/**
 * The engine's real row vocabulary → a stimulus.
 *
 * ONE mapping, so a caller cannot invent a second reading of the same row. The
 * zone read is `primaryZone`'s, passed in rather than parsed here: that
 * function already owns "which zone is this session's headline pace set from",
 * including the arrow and band conventions, and re-deriving it would be a
 * second answer to a question that has one (Rule 16).
 *
 * ZONE BEATS TYPE wherever they disagree, because the zone is what the session
 * is actually run at. `M` / `MP` on a row typed `tempo` or `long` makes the
 * session marathon-specific; `R` / `mile` on a row typed `intervals` makes it a
 * repetition session. That ordering is doctrine §11 and it is the whole reason
 * this function takes two arguments instead of one.
 *
 * Returns NULL for a row that is not a running prescription — `strength`,
 * `cross`, and any type this engine has not authored. Rule 11: a null here is
 * "this layer does not answer for that row", which a caller must branch on; it
 * is not a rest day and it is not an easy day.
 */
export function purposeFromPlanRow(row: {
  type: string;
  /** `primaryZone(sub_label)`'s output, or null when the row declares none. */
  zone: string | null;
}): WorkoutPurpose | null {
  const zone = row.zone;
  if (zone === 'M' || zone === 'MP') return 'marathon_specific';
  if (zone === 'R' || zone === 'mile') return 'repetition';

  switch (row.type) {
    case 'rest':
      return 'rest';
    case 'race':
      return 'race';
    case 'easy':
      return 'easy';
    case 'shakeout':
      return 'shakeout';
    case 'long':
      return 'long';
    case 'threshold':
    case 'tempo':
      // A threshold-typed row whose zone is I or 5K is an interval session
      // wearing a threshold label — the same §11 correction as MP above, in the
      // other direction. `ST` and `HM` stay threshold: both are threshold-class
      // paces in `Research/04`'s own zone table.
      return zone === 'I' || zone === '5K' || zone === '3K' || zone === '10K'
        ? 'interval'
        : 'threshold';
    case 'intervals':
    case 'interval':
      return 'interval';
    case 'race_week_tuneup':
      // `Research/08` §9.1's sharpening session. Its live prescription is
      // "5×400m @ 5K pace", which is interval-class work; a tune-up declaring a
      // threshold zone is caught by the zone branch above.
      return zone === 'T' || zone === 'ST' || zone === 'HM' ? 'threshold' : 'interval';
    default:
      return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE PRESCRIPTION SHAPE, AND THE PRECISION DOCTRINE ALLOWS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * How the prescription is expressed.
 *
 *   ceiling — "no faster than X; run whatever feels genuinely easy below that".
 *             The 2026-08-31 product decision and doctrine §9. NOT a band: a
 *             band implies a target to land inside, and easy running is not a
 *             test.
 *   window  — a fast edge and a slow edge. The general quality shape.
 *   effort  — no pace at all. The engine's existing `by_effort: true`
 *             representation (COLD-4, `Research/04` §8.1 hill repeats), used
 *             when the capacity behind the session carries no runner-specific
 *             evidence whatsoever.
 *   none    — this layer prescribes nothing for this row. Rest, and the
 *             purposes it declines or withholds.
 */
export type PrescriptionShape = 'ceiling' | 'window' | 'effort' | 'none';

/**
 * Doctrine's own pace tolerance per zone, seconds per mile.
 *
 * `Research/01-pace-zones-vdot.md` §"Pace zone width and lock-in rules", read
 * row for row out of the table:
 *
 *     | E    | ±30 sec/mi (wide)      | Never. Prescribe a window. |
 *     | M    | ±5 sec/mi              | ... window for general MP segments |
 *     | T    | ±3 sec/mi              | Yes — narrow window required for adaptation |
 *     | I    | ±3 sec per rep         | ... |
 *     | R    | ±1–2 sec per rep       | ... |
 *
 * BRIEF 03's "precision should match the workout" is this table, and its
 * warning — "do not manufacture precision because the software can display it"
 * — is why R takes the LOOSE edge of its own band (2, not 1). A prescription
 * that claims to know a rep pace to the second is claiming more than the
 * measurement behind it can support.
 *
 * E has no entry, because an easy prescription is a CEILING and a ceiling has
 * no tolerance: slower is always fine, and the fast edge is the whole
 * statement. Doctrine's ±30 for E is preserved as `WIDEST_STATED_TOLERANCE_S`
 * below, where it does real work.
 */
export const ZONE_TOLERANCE_S_PER_MI: Readonly<Record<
  'marathon_specific' | 'threshold' | 'interval' | 'repetition', number
>> = Object.freeze({
  marathon_specific: 5,
  threshold: 3,
  interval: 3,
  repetition: 2,
});

/**
 * The widest pace window doctrine states anywhere: the E row's ±30 sec/mi.
 *
 * Used as the CEILING's own uncertainty slack — see `easyPrescription`. It is
 * doctrine's own answer to "how wide is a window when we are not being precise
 * at all", which is exactly the question a low-confidence easy ceiling asks.
 */
export const WIDEST_STATED_TOLERANCE_S = 30;

/**
 * How much slower than the general easy ceiling a SHAKEOUT may be run, s/mi.
 *
 * THE 2026-08-31 PRODUCT DECISION, PRICED. That decision settled the shape —
 * "shakeout is its own purpose with its own, deliberately tighter ceiling
 * (padded meaningfully slower than the general easy ceiling), not an alias for
 * `easy`" — and deferred the number to this phase, on the grounds that "no
 * doctrine source prices this distance to a number."
 *
 * It turns out one does, and the number is READ rather than chosen (Rule 18:
 * read numbers out of the cited source, never hardcode both sides of a claim).
 *
 *   · `Research/04-workout-vocabulary.md` §1's Variations row names the session:
 *     "Recovery shakeout (15-20 min)". A shakeout is a RECOVERY run in this
 *     corpus's own vocabulary, not an easy run — §1's Pace row says "Slower than
 *     E ... or 'easier than easy'".
 *   · `Research/01-pace-zones-vdot.md` §"Hansons pace methodology" prices both
 *     bands against one shared frame, two adjacent rows of one table:
 *
 *         | Recovery | MP + 90-120 sec/mi | Minimum allowable easy pace |
 *         | Easy     | MP + 60-90  sec/mi | Routine mileage             |
 *
 *     The recovery band BEGINS where the easy band ENDS. Both fast edges are
 *     stated against the same MP anchor, so the distance between them is
 *     90 - 60 = 30 s/mi, and it is a difference of two doctrine cells rather
 *     than a preference.
 *
 * `DOCTRINE.shakeout-ceiling-is-the-recovery-band` parses those two rows out of
 * the file at run time and asserts this constant equals their difference, so
 * editing either row moves the engine or fails the build.
 *
 * WHY THIS IS THE SAFE DIRECTION. The shakeout sits on the days closest to a
 * race, where the point of the session is staying loose without spending
 * anything. A ceiling 30 s/mi slower than the ordinary easy ceiling is a real
 * guard rail on exactly those days, and it is the direction the shadow-mode
 * report flagged as the single largest divergence when shakeout was routed
 * through the shared easy ceiling. It remains a CEILING — slower is always
 * fine — so it can never ask a runner for more than an easy day does.
 *
 * NOTE THIS IS ALSO WHAT THE ENGINE ALREADY DID, one anchor over.
 * `spec-builder.ts`'s `shakeout` branch has always set the band's fast edge to
 * `easyHi` — the SLOW edge of the easy band, which is the same "the recovery
 * band starts where easy ends" rule. What changes here is only WHERE that rule
 * is anchored: on the canonical easy ceiling rather than on a VDOT-derived
 * offset from a threshold pace.
 */
export const SHAKEOUT_CEILING_PAD_S_PER_MI = 30;

/**
 * The uncertainty a value one inference removed from its evidence carries, as a
 * percentage of the value.
 *
 * `Research/02-race-time-prediction.md` §13.7's loosest published row:
 * "Cross-prediction with > 6-month-old input | ±8%". A VDOT-fallback interval
 * pace IS a cross-prediction — a pace read as a scalar and read back out of a
 * different column of a table — so this is doctrine's own price for exactly the
 * shape of inference the high-intensity ladder currently makes on every call.
 *
 * WHY A DOCTRINE ROW AND NOT A CHOSEN MULTIPLE. Rule 18: "read numbers out of
 * the cited source at run time rather than hardcoding both sides"; a widening
 * factor picked to feel right would only prove the test agrees with itself.
 * This is the widest number doctrine prints for a prediction span, used as the
 * widest a prescription window may open before it stops being a prescription.
 */
export const CROSS_PREDICTION_CI_PCT = 8;

/**
 * Where a confidence sits on this layer's declared scale, 0..1.
 *
 * 0 at `CAPACITY_CONFIDENCE_BANDS.populationPrior`, 1 at `.directCeiling` —
 * the two ends `capacity-resolver.ts` already argues. Reused rather than
 * re-derived so a confidence means the same thing in a prescription as it did
 * in the capacity it came from (Rule 16).
 *
 * CONTINUOUS AND MONOTONE (Rule 9). Every widening below is a linear function
 * of `1 - position`, so no prescription changes in KIND across a threshold on a
 * continuous quantity. The one discrete step in this file —
 * `sourceMode === 'population_prior'` selecting `effort` — hinges on WHICH RUNG
 * ANSWERED, a discrete honest fact, which is Rule 9's own preferred fix.
 */
export function confidencePosition(confidence: number): number {
  const { populationPrior, directCeiling } = CAPACITY_CONFIDENCE_BANDS;
  if (!Number.isFinite(confidence)) return 0;
  const span = directCeiling - populationPrior;
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(1, (confidence - populationPrior) / span));
}

/**
 * Pure · doctrine's window for a zone, opened in proportion to how little the
 * capacity behind it is known.
 *
 * THE ASYMMETRY IS THE POINT, and it is doctrine §27 read literally: "Low-
 * confidence estimates should use conservative prescriptions". Conservative for
 * a quality session does not mean a wider window in both directions — that
 * would LICENSE running faster than an estimate nobody trusts, which is the
 * injurious direction. So:
 *
 *   fast edge · closes toward the point estimate as confidence falls. At the
 *               bottom of the scale the prescription never asks for anything
 *               faster than the estimate itself.
 *   slow edge · opens from the zone's own tolerance toward §13.7's ±8%.
 *
 * At full confidence both edges sit at doctrine's ± and the window is exactly
 * the table's. At zero confidence it is `[pace, pace + 8%]`. Both ends are
 * doctrine-read; the interpolation between them is linear and therefore
 * monotone in confidence, which is §30's property.
 */
export function paceWindow(args: {
  paceSecPerMi: number;
  toleranceSecPerMi: number;
  confidence: number;
}): { fast: number; slow: number } {
  const position = confidencePosition(args.confidence);
  const uncertainty = 1 - position;
  const tol = Math.max(0, args.toleranceSecPerMi);
  const widest = Math.max(tol, (args.paceSecPerMi * CROSS_PREDICTION_CI_PCT) / 100);
  return {
    fast: args.paceSecPerMi - tol * position,
    slow: args.paceSecPerMi + tol + (widest - tol) * uncertainty,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · MARATHON PACE FROM THRESHOLD, THROUGH THE RUNNER'S OWN DURABILITY
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The duration a threshold effort is defined by.
 *
 * `Research/01-pace-zones-vdot.md` §Glossary, the Lactate threshold row,
 * verbatim: "The exercise intensity at which blood lactate begins accumulating
 * faster than it can be cleared. Typically 83-88% VO2max, ~88-92% HRmax,
 * SUSTAINABLE ~60 MINUTES FLAT-OUT."
 *
 * WHY A DURATION AND NOT A RACE DISTANCE. The same table's zone row gives T as
 * "15K to half-marathon race pace", which is a distance PROXY for the same
 * boundary — and a proxy that assumes every runner's threshold falls at the
 * same distance, which is precisely the population assumption this whole
 * durability layer exists to replace. An hour is the physiological definition
 * and it scales with the runner: a 7:10/mi threshold covers 8.4 miles in it, a
 * 10:00/mi threshold covers 6.0.
 *
 * WHERE IT LANDS, AND IN WHICH DIRECTION IT ERRS. For the owner (T 7:10/mi) the
 * anchor is 8.37 mi, just SHORT of the 15K fast edge of doctrine's stated band.
 * Short means a LONGER extrapolation to 26.2, which through an exponent above 1
 * means a SLOWER prescribed marathon pace. That is the direction `Research/01`
 * §"Marathon-specific correction" says the error must fall on — its own
 * adjustment only ever moves an MP prescription downward — so the residual
 * disagreement with the band is conservative rather than dangerous.
 */
export const THRESHOLD_ANCHOR_MINUTES = 60;

/**
 * Bounds on the endurance exponent this conversion will spend.
 *
 * `Research/02` §2.1 gives Riegel's exponent as "≈ 1.06 for most runners,
 * 1500m-marathon" and §14 rule 6 names 1.10 as the ultra regime ("use Cameron
 * or exponent >= 1.10"). An exponent at or below 1.0 would mean a runner gets
 * FASTER as the distance grows, which no fitted value should ever be and which
 * would make this function prescribe a marathon pace faster than threshold.
 *
 * `resolveDurability` shrinks its fit toward the population prior in proportion
 * to evidence, so a wild value is already unlikely; this is the backstop that
 * makes it impossible, in the spirit of `clampToSanePace`. Clamping is
 * continuous — it introduces a kink, never a cliff (Rule 9) — and it stamps a
 * reason code when it binds so a clamp is never silent.
 */
export const ENDURANCE_EXPONENT_BOUNDS = Object.freeze({ min: 1.0, max: 1.20 });

export interface MarathonPaceRead {
  paceSecPerMi: number;
  /** The exponent actually spent, after clamping. */
  enduranceExponent: number;
  /** The anchor distance the extrapolation started from, miles. */
  anchorDistanceMi: number;
  /** True when `ENDURANCE_EXPONENT_BOUNDS` bound the exponent. */
  exponentClamped: boolean;
  /** True when the runner's own races fitted the exponent, false when it is
   *  `POPULATION_ENDURANCE_PRIOR`. Rule 11: these are different facts and the
   *  window width downstream depends on which. */
  personallyEvidenced: boolean;
}

/**
 * Pure · marathon pace, derived from threshold capacity through the runner's
 * own endurance exponent.
 *
 * BRIEF 03's routing row, implemented: "Marathon-specific — threshold capacity
 * modified substantially by durability and race-specific preparation."
 *
 * ── THE ARITHMETIC ─────────────────────────────────────────────────────────
 *
 * Riegel's law in pace form. `Research/02` §2.1 states it in TIME —
 * `T2 = T1 × (D2/D1)^b` — and dividing both sides by their distances gives the
 * pace form exactly, with no extra assumption:
 *
 *     pace(D2) = pace(D1) × (D2 / D1)^(b - 1)
 *
 * with `D1` the distance an hour of threshold running covers
 * (`THRESHOLD_ANCHOR_MINUTES`), `D2` the marathon, and `b` the runner's own
 * `enduranceExponent` from `resolveDurability`.
 *
 * ── WHY NOT `predictRaceTimeFromAnchor` ────────────────────────────────────
 *
 * `lib/training/vdot.ts` already implements this law, and it hardcodes
 * `RIEGEL_EXPONENT = 1.06` — the POPULATION mean. Calling it would throw away
 * the one thing `resolveDurability` exists to produce. This is the personal-
 * exponent form of the identical formula, and the unit suite asserts the two
 * agree to the second when `b === POPULATION_ENDURANCE_PRIOR`, so the
 * relationship is falsified rather than asserted in prose (Rule 18).
 *
 * ── WHY NOT `fitness-model.ts` ─────────────────────────────────────────────
 *
 * Examined first, per §24's ban on duplicating an existing capability. It does
 * not have this math. `lib/fitness/fitness-model.ts` puts a CONFIDENCE BAND
 * around an already-selected VDOT point estimate; its cross-distance work is
 * `predictRaceTime` (Daniels table inversion) plus §13.7 percentage bands, and
 * its own header says "the point estimate does not move ... it re-runs no
 * selection". There is no endurance exponent anywhere in it, personal or
 * otherwise, so there was nothing to reuse — reported rather than assumed.
 *
 * ── WHY NOT ALSO THE POPULATION MARATHON-SPECIFICITY PENALTY ───────────────
 *
 * `Research/01` §"Marathon-specific correction" subtracts 1.5 VDOT points for a
 * runner without a marathon block, and `Research/02` §13.1 states the same idea
 * as a percentage — implemented as `MARATHON_SPECIFICITY_PENALTY_PCT` in
 * `goal-projection.ts`. Applying it HERE as well would be wrong twice over:
 *
 *   · Race Prediction owns it (§1). A second application in Pace Prescription
 *     is two services answering one question, which §2 forbids and §40's second
 *     merge question rejects outright.
 *   · It would DOUBLE-COUNT. That penalty is a population stand-in for "we do
 *     not know how well this runner holds pace over the distance". The personal
 *     Riegel exponent is a MEASUREMENT of that same quantity — BRIEF 06's whole
 *     purpose — so spending both prices the same uncertainty twice.
 *
 * When the exponent is NOT personally evidenced there is no measurement to
 * supersede anything, and the honest response is not to smuggle the penalty in
 * either: it is to say so. `personallyEvidenced: false` flows into a
 * `POPULATION_ENDURANCE_EXPONENT` reason code and a wider window, per §38 —
 * "Threshold based on race-derived fallback; direct evidence currently
 * insufficient" beats silently pretending confidence.
 */
export function marathonPaceFromDurability(args: {
  thresholdPaceSecPerMi: number;
  durability: Immutable<DurabilityCapacityEstimate>;
}): MarathonPaceRead {
  const t = args.thresholdPaceSecPerMi;
  const raw = args.durability.enduranceExponent;
  const { min, max } = ENDURANCE_EXPONENT_BOUNDS;
  const b = !Number.isFinite(raw) ? POPULATION_ENDURANCE_PRIOR : Math.max(min, Math.min(max, raw));
  const anchorDistanceMi = (THRESHOLD_ANCHOR_MINUTES * 60) / t;
  const paceSecPerMi = t * Math.pow(TABLE_RACE_DISTANCE_MI.marathon / anchorDistanceMi, b - 1);
  return {
    paceSecPerMi,
    enduranceExponent: b,
    anchorDistanceMi,
    exponentClamped: Number.isFinite(raw) && raw !== b,
    // The exponent is the runner's own only when the race fit produced it.
    // `resolveDurability` sets `enduranceExponent` to the population prior
    // whenever `raceExponent.present` is false, so this is the same fact read
    // off the component that owns it rather than off a value comparison — two
    // runners could legitimately fit an exponent of exactly 1.06.
    personallyEvidenced: args.durability.raceExponent.present,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · THE PRESCRIPTION
 * ═══════════════════════════════════════════════════════════════════════ */

/** Structured, never prose (§27). The caller composes the sentence; the tests,
 *  the log and any future UI explanation all read the same enum, so an
 *  explanation cannot drift from what the model did. */
export type PrescriptionReasonCode =
  // ── which capacity answered ──
  | 'EASY_CEILING_FROM_CAPACITY'
  | 'LONG_IS_EASY_EFFORT'
  | 'SHAKEOUT_CEILING_IS_THE_RECOVERY_BAND'
  | 'THRESHOLD_FROM_CAPACITY'
  | 'INTERVAL_FROM_HIGH_INTENSITY_CAPACITY'
  | 'REPETITION_FROM_HIGH_INTENSITY_CAPACITY'
  | 'MARATHON_PACE_FROM_THRESHOLD_AND_DURABILITY'
  // ── how well it was known ──
  | 'DIRECT_EVIDENCE'
  | 'DERIVED_FALLBACK'
  | 'NO_RUNNER_SPECIFIC_EVIDENCE'
  | 'PERSONAL_ENDURANCE_EXPONENT'
  | 'POPULATION_ENDURANCE_EXPONENT'
  | 'ENDURANCE_EXPONENT_CLAMPED'
  // ── what state did to today's ask ──
  | 'STATE_PROCEED'
  | 'STATE_WOULD_NOT_TIGHTEN'
  | 'STATE_REPLACED_QUALITY_WITH_EASY'
  | 'STATE_WITHHELD_PRESCRIPTION'
  | 'STATE_UNREADABLE'
  // ── refusals and contradictions (§29) ──
  | 'RACE_PACE_IS_RACE_PREDICTIONS_QUESTION'
  | 'REPETITION_PACE_UNKNOWN_OFF_TABLE'
  | 'WINDOW_CLAMPED_BY_THRESHOLD'
  | 'WINDOW_CLAMPED_BY_EASY_CEILING'
  | 'WINDOW_CLAMPED_BY_INTERVAL_PACE';

/** §31 · version the model. */
export const PRESCRIPTION_MODEL_VERSION = '1.0.0';

/**
 * How far inside a neighbouring zone a clamped prescription must land, s/mi.
 *
 * CONVENTION, and deliberately the smallest unit this app expresses a pace in
 * rather than a number with an argument behind it: doctrine states no minimum
 * separation between adjacent zones, and inventing one would be a coaching rule
 * nobody decided (§25). One second only makes the clamp STRICT — it stops a
 * clamped interval window from reporting a slow edge exactly equal to threshold
 * pace, which would read as "this session may be run at threshold" — and it is
 * below the tightest tolerance doctrine prints anywhere (R's ±1-2 s/mi), so it
 * cannot move a prescription by a coaching-relevant amount on its own.
 */
export const PRESCRIPTION_ZONE_SEPARATION_S = 1;

/**
 * How a completed session should be JUDGED. Carried on the prescription so a
 * compliance checker, if one is ever built, inherits the basis rather than
 * inventing one.
 *
 * `overall_effort` is doctrine §9 and §11's Easy Run test verbatim: "briefly
 * exceeding the easy ceiling downhill is not a compliance failure — overall
 * effort determines interpretation". A shape that reported only a per-instant
 * ceiling would force point-in-time policing on whoever built the checker; this
 * field is what stops that, and it is the reason the easy prescription is a
 * ceiling PLUS a basis rather than a bare number.
 */
export type ComplianceBasis =
  | 'overall_effort'
  | 'work_segments'
  | 'per_rep'
  | 'not_evaluated';

/** What state did to today's ask — never to capacity (§7). */
export interface StateAdjustment {
  decision: StateDecision;
  /** What actually changed in the output. `'none'` when state was `proceed`. */
  applied: 'none' | 'no_tightening' | 'replaced_with_easy' | 'withheld';
  /** The state signal that drove it, as a short line. Null when `proceed`. */
  driver: string | null;
  /** Rule 11 · false when the state could not be read at all. */
  stateReadable: boolean;
}

/** Where the number came from, reported UNCHANGED from the capacity estimate.
 *  §7's audit trail: a reader can always see the capacity as it was resolved,
 *  beside whatever state did to today's demand. */
export interface CapacityBasis {
  capacity: 'threshold' | 'high_intensity' | 'easy_ceiling' | 'threshold_and_durability' | 'none';
  sourceMode: SourceMode | null;
  confidence: number | null;
  evidenceIds: readonly string[];
}

export interface WorkoutPrescription {
  purpose: WorkoutPurpose;
  shape: PrescriptionShape;
  /**
   * The pace the prescription is built around, s/mi. Null for `ceiling`,
   * `effort` and `none` — a ceiling has no target, and an effort-cued session
   * has no pace at all. Rule 11: a caller must branch, never read a zero.
   */
  paceSecPerMi: number | null;
  /** Present only when `shape === 'window'`. Fast edge and slow edge, s/mi. */
  windowSecPerMi: { fast: number; slow: number } | null;
  /** Present only when `shape === 'ceiling'`. Never run faster than this. */
  ceilingSecPerMi: number | null;
  /** Doctrine's ± for this zone, s/mi. Null where the shape has no tolerance. */
  toleranceSecPerMi: number | null;
  complianceBasis: ComplianceBasis;
  capacityBasis: CapacityBasis;
  stateAdjustment: StateAdjustment;
  /**
   * Miles this layer prescribes for the day. Echoes `plannedMi` unchanged
   * unless state WITHHELD the session, in which case it is null.
   *
   * NO PERCENTAGE VOLUME CUT IS INVENTED HERE, and that is deliberate (§25, no
   * silent new coaching rules). This engine's own response to a red convergence
   * is to convert the session to easy running at the SAME distance — see
   * `actionsForTrigger`'s `readiness_pullback` case — and no `Research/` file
   * states a volume-reduction percentage for a readiness signal. Reducing
   * today's DEMAND is what `replaced_with_easy` does; reducing today's MILEAGE
   * without a number behind it would be a rule nobody decided.
   */
  prescribedMi: number | null;
  /** 0..1, inherited from the capacity that answered and never re-derived. */
  confidence: number;
  reasons: PrescriptionReasonCode[];
  resolvedAt: string;
  modelVersion: string;
}

export interface PrescriptionArgs {
  /** Already resolved, and structurally unwritable (§7). */
  capacity: Immutable<ResolvedCapacity>;
  /** Already resolved. Modifies today's ask, never the capacity. */
  state: Immutable<RunnerState>;
  purpose: WorkoutPurpose;
  /**
   * The day's planned mileage, when the caller has one.
   *
   * AN EXPLICIT NARROW INPUT, exactly as §6 asks for race context: this layer
   * never fetches a plan, and it can only echo or withhold a volume it was
   * handed. Optional so a caller asking a pure "what pace" question does not
   * have to invent one.
   */
  plannedMi?: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · THE RESOLVER
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Given current capacity and workout purpose, what intensity should be
 * prescribed? THE canonical answer (§1, §2).
 *
 * PURE. No clock beyond `resolvedAt`, no I/O, no database, no `userId`. Same
 * inputs, same prescription — which is what lets §12's historical replay and
 * §13's golden runners drive it without a fixture database.
 *
 * ORDER OF OPERATIONS, and it matters:
 *
 *   1. The CAPACITY answers, purpose by purpose. This step cannot see state.
 *   2. The STATE modifies the result. This step cannot see the capacity's
 *      internals, only the prescription already built from them.
 *
 * Step 1 running first and independently is the structural half of §7: there is
 * no code path in which a fatigue reading is an input to the capacity-derived
 * number, because that number is finished before state is consulted.
 */
export function resolvePrescription(args: PrescriptionArgs): WorkoutPrescription {
  const base = resolveCapacityPrescription(args);
  return applyState(base, args);
}

/**
 * The fields a CAPACITY-ONLY prescription request may carry. `state` is absent
 * by construction, which is the whole point — see `resolveCapacityPrescription`.
 */
export type CapacityPrescriptionArgs = Omit<PrescriptionArgs, 'state'>;

/**
 * Step 1, ON ITS OWN · the capacity-derived prescription, before state is
 * consulted. Exported because a caller that is NOT asking about today has a
 * legitimate need for it, and faking a `proceed` state to reach it would be a
 * lie in the shape of an argument.
 *
 * THE CALLER THIS EXISTS FOR is the plan's pace flex
 * (`lib/plan/recompute-paces.ts`), which rewrites every unrun day in a
 * fourteen-week block. Readiness answers "what is appropriate for this runner
 * TODAY" (§D of the Brain Constitution, and doctrine's hard rule "tired ≠ less
 * fit"); writing this morning's readiness into November's rows would apply a
 * one-day fact to a whole season, which is the category error §D exists to
 * prevent. So the flex reads CAPACITY and nothing else, and the day's readiness
 * modifies the day's ask at the point the day is actually served.
 *
 * ONE IMPLEMENTATION, not a copy: `resolvePrescription` is this function plus
 * `applyState`, so a capacity-only prescription and a state-adjusted one can
 * never disagree about the capacity half (Rule 16).
 */
export function resolveCapacityPrescription(args: CapacityPrescriptionArgs): WorkoutPrescription {
  const { capacity, purpose } = args;
  const plannedMi = args.plannedMi ?? null;

  switch (purpose) {
    case 'rest':
      return shell(purpose, plannedMi, {
        shape: 'none',
        complianceBasis: 'not_evaluated',
        capacityBasis: NO_CAPACITY,
        confidence: 1,
        reasons: [],
      });

    case 'race':
      // DECLINED, not failed. §1 gives race performance to Race Prediction and
      // `achievable-target.ts` already resolves what goes on a start line. This
      // is the one purpose whose honest answer requires the runner's stated
      // goal, and a service that cannot see the goal must not pretend to
      // answer it. See the file header.
      return shell(purpose, plannedMi, {
        shape: 'none',
        complianceBasis: 'not_evaluated',
        capacityBasis: NO_CAPACITY,
        confidence: 0,
        reasons: ['RACE_PACE_IS_RACE_PREDICTIONS_QUESTION'],
      });

    case 'easy':
    case 'shakeout':
    case 'long':
      return easyPrescription(purpose, capacity.easyCeiling, plannedMi);

    case 'threshold':
      return windowPrescription({
        purpose,
        plannedMi,
        paceSecPerMi: capacity.threshold.paceSecPerMi,
        toleranceSecPerMi: ZONE_TOLERANCE_S_PER_MI.threshold,
        complianceBasis: 'work_segments',
        basis: {
          capacity: 'threshold',
          sourceMode: capacity.threshold.sourceMode,
          confidence: capacity.threshold.confidence,
          evidenceIds: capacity.threshold.evidenceIds,
        },
        reasons: ['THRESHOLD_FROM_CAPACITY'],
        bounds: {
          // §29's easy contradiction. This binds only when the easy ceiling
          // came from a DIRECT read: derived from this same threshold pace it
          // sits 80 s/mi slower by construction (`easyBandFromTPace`), so a
          // widened threshold window could never reach it.
          mustStayFasterThan: {
            pace: capacity.easyCeiling.ceilingSecPerMi,
            reason: 'WINDOW_CLAMPED_BY_EASY_CEILING',
          },
          // DELIBERATELY UNBOUNDED on the fast side. The obvious candidate is
          // interval pace, and it is the wrong one: this app currently has no
          // direct high-intensity reader at all, so clamping a CORROBORATED
          // threshold read against a VDOT-fallback interval estimate would let
          // the weaker number govern the stronger. §17's whole point.
          mustStaySlowerThan: null,
        },
      });

    case 'interval':
      return windowPrescription({
        purpose,
        plannedMi,
        paceSecPerMi: capacity.highIntensity.intervalPaceSecPerMi,
        toleranceSecPerMi: ZONE_TOLERANCE_S_PER_MI.interval,
        complianceBasis: 'per_rep',
        basis: {
          capacity: 'high_intensity',
          sourceMode: capacity.highIntensity.sourceMode,
          confidence: capacity.highIntensity.confidence,
          evidenceIds: capacity.highIntensity.evidenceIds,
        },
        reasons: ['INTERVAL_FROM_HIGH_INTENSITY_CAPACITY'],
        bounds: {
          // An interval window whose slow edge reaches threshold pace is not an
          // interval session. §29's contradiction checker, and on the owner's
          // real account it BINDS: his I estimate is a VDOT fallback at
          // confidence 0.29 while his T estimate is direct, so the widening the
          // low confidence earns runs straight into the faster, better-evidenced
          // number. Clamping and saying so is the honest outcome; widening
          // through it would prescribe threshold work under an interval label.
          mustStayFasterThan: {
            pace: capacity.threshold.paceSecPerMi,
            reason: 'WINDOW_CLAMPED_BY_THRESHOLD',
          },
          mustStaySlowerThan: null,
        },
      });

    case 'repetition': {
      const r = capacity.highIntensity.repetitionPaceSecPerMi;
      if (r == null) {
        // Rule 11 · genuinely unknown, never a substituted I-pace. The
        // below-table rung has no doctrine-supported route to a mile-column
        // pace, and `HighIntensityCapacityEstimate` says so with a null.
        // `Research/04` §7.4 prescribes R work by rep TIME anyway, so an
        // effort-cued rep session is a real session, not a degraded one.
        return shell(purpose, plannedMi, {
          shape: 'effort',
          complianceBasis: 'per_rep',
          capacityBasis: {
            capacity: 'high_intensity',
            sourceMode: capacity.highIntensity.sourceMode,
            confidence: capacity.highIntensity.confidence,
            evidenceIds: capacity.highIntensity.evidenceIds,
          },
          confidence: capacity.highIntensity.confidence,
          reasons: ['REPETITION_FROM_HIGH_INTENSITY_CAPACITY', 'REPETITION_PACE_UNKNOWN_OFF_TABLE'],
        });
      }
      return windowPrescription({
        purpose,
        plannedMi,
        paceSecPerMi: r,
        toleranceSecPerMi: ZONE_TOLERANCE_S_PER_MI.repetition,
        complianceBasis: 'per_rep',
        basis: {
          capacity: 'high_intensity',
          sourceMode: capacity.highIntensity.sourceMode,
          confidence: capacity.highIntensity.confidence,
          evidenceIds: capacity.highIntensity.evidenceIds,
        },
        reasons: ['REPETITION_FROM_HIGH_INTENSITY_CAPACITY'],
        bounds: {
          // R work is faster than I work (`Research/01` §"Pace conversion":
          // "R | ~mile race pace, or ~6 sec/400m faster than I"), so a rep
          // window that slows into interval pace has stopped being rep work.
          mustStayFasterThan: {
            pace: capacity.highIntensity.intervalPaceSecPerMi,
            reason: 'WINDOW_CLAMPED_BY_INTERVAL_PACE',
          },
          mustStaySlowerThan: null,
        },
      });
    }

    case 'marathon_specific': {
      const mp = marathonPaceFromDurability({
        thresholdPaceSecPerMi: capacity.threshold.paceSecPerMi,
        durability: capacity.durability,
      });
      const reasons: PrescriptionReasonCode[] = ['MARATHON_PACE_FROM_THRESHOLD_AND_DURABILITY'];
      reasons.push(mp.personallyEvidenced ? 'PERSONAL_ENDURANCE_EXPONENT' : 'POPULATION_ENDURANCE_EXPONENT');
      if (mp.exponentClamped) reasons.push('ENDURANCE_EXPONENT_CLAMPED');

      // The prescription is only as trustworthy as the WEAKER of the two
      // capacities it multiplies together. §30: adding a second uncertain input
      // must not make an estimate look more certain, and a min is the only
      // combination rule with that property that needs no independence
      // assumption — these two are anything but independent, since both are
      // read off the same runner's same training corpus.
      const confidence = Math.min(capacity.threshold.confidence, capacity.durability.confidence);

      return windowPrescription({
        purpose,
        plannedMi,
        paceSecPerMi: mp.paceSecPerMi,
        toleranceSecPerMi: ZONE_TOLERANCE_S_PER_MI.marathon_specific,
        complianceBasis: 'work_segments',
        basis: {
          capacity: 'threshold_and_durability',
          sourceMode: weakerSourceMode(capacity.threshold.sourceMode, capacity.durability.sourceMode),
          confidence,
          evidenceIds: [...capacity.threshold.evidenceIds, ...capacity.durability.evidenceIds],
        },
        reasons,
        bounds: {
          // Marathon pace must sit strictly BETWEEN threshold and easy, and
          // the two edges point in OPPOSITE directions — which is the mistake
          // the first draft of this file made and the unit suite caught.
          //
          //   · slow edge · must stay faster than the easy ceiling. This binds
          //     for a runner whose fitted exponent is high and whose easy
          //     ceiling came from a direct read, where "marathon pace" could
          //     otherwise land slower than the pace they are told never to
          //     exceed on an easy day.
          //   · fast edge · must stay slower than threshold. Guaranteed by
          //     `b > 1` for the point estimate, but NOT for the window's fast
          //     edge, which doctrine's ±5 opens toward threshold on its own.
          mustStayFasterThan: {
            pace: capacity.easyCeiling.ceilingSecPerMi,
            reason: 'WINDOW_CLAMPED_BY_EASY_CEILING',
          },
          mustStaySlowerThan: {
            pace: capacity.threshold.paceSecPerMi,
            reason: 'WINDOW_CLAMPED_BY_THRESHOLD',
          },
        },
      });
    }
  }
}

const NO_CAPACITY: CapacityBasis = Object.freeze({
  capacity: 'none' as const,
  sourceMode: null,
  confidence: null,
  evidenceIds: Object.freeze([]) as readonly string[],
});

/** The weaker of two source modes. One ordering — `capacity-resolver.ts`'s
 *  `SOURCE_MODE_STRENGTH` — consulted, never a second opinion (Rule 16). */
function weakerSourceMode(a: SourceMode, b: SourceMode): SourceMode {
  // Imported lazily-by-value to keep this module's import list to types where
  // it can; the ordering itself lives in exactly one place.
  const strength: Record<SourceMode, number> = {
    direct: 5, inferred: 4, race_derived: 3, vdot_fallback: 2, user_prior: 1, population_prior: 0,
  };
  return strength[a] <= strength[b] ? a : b;
}

function shell(
  purpose: WorkoutPurpose,
  plannedMi: number | null,
  rest: {
    shape: PrescriptionShape;
    complianceBasis: ComplianceBasis;
    capacityBasis: CapacityBasis;
    confidence: number;
    reasons: PrescriptionReasonCode[];
  },
): WorkoutPrescription {
  return {
    purpose,
    shape: rest.shape,
    paceSecPerMi: null,
    windowSecPerMi: null,
    ceilingSecPerMi: null,
    toleranceSecPerMi: null,
    complianceBasis: rest.complianceBasis,
    capacityBasis: rest.capacityBasis,
    stateAdjustment: { decision: 'proceed', applied: 'none', driver: null, stateReadable: true },
    prescribedMi: plannedMi,
    confidence: rest.confidence,
    reasons: rest.reasons,
    resolvedAt: new Date().toISOString(),
    modelVersion: PRESCRIPTION_MODEL_VERSION,
  };
}

/**
 * Easy, shakeout and long · a CEILING with feel-based guidance.
 *
 * ALL THREE FROM ONE NUMBER, which is Rule 16 applied to a real divergence.
 * `spec-builder.ts` already states the doctrine in its own words — "LONG IS
 * EASY EFFORT, just more volume. The old 85% LTHR split between them was an
 * artifact of over-cautious Friel translation, not a doctrinal distinction" —
 * and it says that about the HR cap while the plan's PACE targets still differ
 * (the owner's live block paces every long run at 8:36/mi against an easy band
 * of 9:02-9:42, so a long run is currently prescribed FASTER than an easy day).
 * One quantity, one name: an easy day and a long run share the ceiling and
 * differ in duration.
 *
 * LOW CONFIDENCE MOVES A CEILING SLOWER, which is the opposite direction from a
 * quality window and the same principle. A ceiling is a permission — "you may
 * run up to this fast" — so being less sure of it means granting LESS
 * permission, not more. The slack runs from nothing at full confidence to
 * doctrine's own widest stated window (`WIDEST_STATED_TOLERANCE_S`, the E row's
 * ±30 s/mi) at the bottom of the scale, linearly, so it is continuous and
 * monotone (Rule 9, §30).
 *
 * SHAKEOUT IS THE ONE THAT DOES NOT SHARE THE NUMBER, and it is a purpose
 * rather than a special case: `SHAKEOUT_CEILING_PAD_S_PER_MI` moves it onto
 * doctrine's RECOVERY band, which `Research/04` §1 says a shakeout belongs to.
 * The pad is additive and constant, so the shakeout ceiling is a monotone
 * function of the easy ceiling and can never cross it (Rule 9).
 */
function easyPrescription(
  purpose: WorkoutPurpose,
  easy: Immutable<EasyCeilingEstimate>,
  plannedMi: number | null,
): WorkoutPrescription {
  const uncertainty = 1 - confidencePosition(easy.confidence);
  const pad = purpose === 'shakeout' ? SHAKEOUT_CEILING_PAD_S_PER_MI : 0;
  const ceiling = easy.ceilingSecPerMi + pad + WIDEST_STATED_TOLERANCE_S * uncertainty;

  const reasons: PrescriptionReasonCode[] = ['EASY_CEILING_FROM_CAPACITY'];
  if (purpose === 'long') reasons.push('LONG_IS_EASY_EFFORT');
  if (purpose === 'shakeout') reasons.push('SHAKEOUT_CEILING_IS_THE_RECOVERY_BAND');
  reasons.push(evidenceReason(easy.sourceMode));

  return {
    purpose,
    shape: 'ceiling',
    paceSecPerMi: null,
    windowSecPerMi: null,
    ceilingSecPerMi: ceiling,
    // A ceiling has no ± . Doctrine's "Never. Prescribe a window." for E is
    // about not locking a target, and the 2026-08-31 decision goes further:
    // there is no bottom edge at all, because "easy enough is successful".
    toleranceSecPerMi: null,
    // Doctrine §9 and §11's Easy Run test. See `ComplianceBasis`.
    complianceBasis: 'overall_effort',
    capacityBasis: {
      capacity: 'easy_ceiling',
      sourceMode: easy.sourceMode,
      confidence: easy.confidence,
      evidenceIds: easy.evidenceIds,
    },
    stateAdjustment: { decision: 'proceed', applied: 'none', driver: null, stateReadable: true },
    prescribedMi: plannedMi,
    confidence: easy.confidence,
    reasons,
    resolvedAt: new Date().toISOString(),
    modelVersion: PRESCRIPTION_MODEL_VERSION,
  };
}

/**
 * A quality prescription · doctrine's window, opened for uncertainty and then
 * clamped against the neighbouring zones it must not reach.
 *
 * `sourceMode === 'population_prior'` selects `effort` instead of a window, and
 * that is the file's ONE discrete branch. It hinges on a discrete honest fact —
 * which rung of the ladder answered — rather than on a threshold over a
 * continuous confidence, which is Rule 9's own stated preference ("the decision
 * rests on a discrete honest fact, and there is no threshold on a continuous
 * quantity left to smooth"). It also reuses the representation the engine
 * already has for exactly this case: COLD-4's `by_effort: true`, which fires
 * when the fitness anchor is `provisional_mileage`, i.e. when the number would
 * be invented out of a self-reported weekly mileage.
 */
function windowPrescription(a: {
  purpose: WorkoutPurpose;
  plannedMi: number | null;
  paceSecPerMi: number;
  toleranceSecPerMi: number;
  complianceBasis: ComplianceBasis;
  basis: CapacityBasis;
  reasons: PrescriptionReasonCode[];
  /**
   * The neighbouring zones this prescription may not reach, in SECONDS PER
   * MILE, where a LARGER number is a SLOWER pace.
   *
   * TWO DIRECTIONS, NOT ONE, and the first draft of this file collapsed them
   * and got the marathon case backwards — an MP window built off a high fitted
   * exponent was clamped against THRESHOLD as if it had to stay faster than it,
   * when marathon pace must of course be slower. The unit suite caught it,
   * which is the whole reason the walk exists. Naming each edge for the fact it
   * asserts, rather than for a comparison operator, is what stops it recurring.
   */
  bounds: {
    /** The window's SLOW edge must stay strictly faster (numerically smaller)
     *  than this. Null when unbounded. */
    mustStayFasterThan: { pace: number; reason: PrescriptionReasonCode } | null;
    /** The window's FAST edge must stay strictly slower (numerically larger)
     *  than this. Null when unbounded. */
    mustStaySlowerThan: { pace: number; reason: PrescriptionReasonCode } | null;
  };
}): WorkoutPrescription {
  const confidence = a.basis.confidence ?? CAPACITY_CONFIDENCE_BANDS.populationPrior;
  const reasons = [...a.reasons, evidenceReason(a.basis.sourceMode)];

  if (a.basis.sourceMode === 'population_prior') {
    return shell(a.purpose, a.plannedMi, {
      shape: 'effort',
      complianceBasis: a.complianceBasis,
      capacityBasis: a.basis,
      confidence,
      reasons,
    });
  }

  const win = paceWindow({
    paceSecPerMi: a.paceSecPerMi,
    toleranceSecPerMi: a.toleranceSecPerMi,
    confidence,
  });

  // ── §29 · THE CONTRADICTION CLAMPS ───────────────────────────────────────
  //
  // `PRESCRIPTION_ZONE_SEPARATION_S` of separation, so a clamped window is
  // strictly inside the neighbour it was clamped against rather than equal to
  // it. THE POINT ESTIMATE IS CLAMPED TOO, not only the edges: an output whose
  // reported centre sits outside its own window is not a conservative
  // prescription, it is an incoherent one, and it would be exactly the kind of
  // internally-inconsistent-but-well-formed number Rule 10's guards are blind
  // to by construction.
  let { fast, slow } = win;
  let pace = a.paceSecPerMi;

  const fasterBound = a.bounds.mustStayFasterThan;
  if (fasterBound != null) {
    const limit = fasterBound.pace - PRESCRIPTION_ZONE_SEPARATION_S;
    if (slow > limit) {
      slow = limit;
      pace = Math.min(pace, limit);
      reasons.push(fasterBound.reason);
    }
  }
  const slowerBound = a.bounds.mustStaySlowerThan;
  if (slowerBound != null) {
    const limit = slowerBound.pace + PRESCRIPTION_ZONE_SEPARATION_S;
    if (fast < limit) {
      fast = limit;
      pace = Math.max(pace, limit);
      reasons.push(slowerBound.reason);
    }
  }

  // A clamp must never invert the window. When two bounds close on each other
  // the window collapses to the surviving edge rather than reporting a fast
  // edge slower than its slow edge — an inverted window is unreadable, and a
  // reader would have no way to tell which edge to believe.
  if (slow < fast) fast = slow;
  pace = Math.max(fast, Math.min(slow, pace));

  return {
    purpose: a.purpose,
    shape: 'window',
    paceSecPerMi: pace,
    windowSecPerMi: { fast, slow },
    ceilingSecPerMi: null,
    toleranceSecPerMi: a.toleranceSecPerMi,
    complianceBasis: a.complianceBasis,
    capacityBasis: a.basis,
    stateAdjustment: { decision: 'proceed', applied: 'none', driver: null, stateReadable: true },
    prescribedMi: a.plannedMi,
    confidence,
    reasons,
    resolvedAt: new Date().toISOString(),
    modelVersion: PRESCRIPTION_MODEL_VERSION,
  };
}

/** One reason code per band of the ladder, so every prescription says how well
 *  the number behind it is known without a caller re-deriving it (§17). */
function evidenceReason(mode: SourceMode | null): PrescriptionReasonCode {
  if (mode === 'direct') return 'DIRECT_EVIDENCE';
  if (mode === 'population_prior' || mode == null) return 'NO_RUNNER_SPECIFIC_EVIDENCE';
  return 'DERIVED_FALLBACK';
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · STEP 2 · STATE MODIFIES TODAY'S ASK, NEVER THE CAPACITY (§7)
 * ═══════════════════════════════════════════════════════════════════════ */

/** Purposes whose demand a readiness signal can meaningfully soften. An easy
 *  day is already what a red morning would have asked for — the engine's own
 *  `readiness_pullback` makes exactly this distinction, and returns a note
 *  rather than a change when nothing hard is scheduled. */
const QUALITY_PURPOSES: ReadonlySet<WorkoutPurpose> = new Set<WorkoutPurpose>([
  'threshold', 'interval', 'repetition', 'marathon_specific',
]);

/**
 * Apply the runner's state to the capacity-derived prescription.
 *
 * EVERY BRANCH BELOW WRITES ONLY TO THE OUTPUT. `args.capacity` is
 * `Immutable<>` and is not referenced here at all beyond the easy ceiling a
 * downgrade needs — which is READ, never assigned. That is §7 as code: state
 * changes what is asked of the runner today and cannot change what the runner
 * is judged capable of.
 *
 * WHAT EACH DECISION DOES, and why it is the engine's own response rather than
 * a new rule (§25):
 *
 *   proceed              · nothing.
 *   proceed_with_caution · REFUSES TO TIGHTEN. The window keeps whatever width
 *                          the capacity earned and is never narrowed; a
 *                          ceiling is unchanged. This is what an amber
 *                          convergence already means in `detectReadinessPullback`
 *                          — "two converging domains are enough to tell the
 *                          runner and not enough to change his day" — and it is
 *                          also where an UNREADABLE state lands, per Rule 11.
 *   reduce               · a quality session becomes easy running at the same
 *                          distance. Verbatim the red-convergence action in
 *                          `actionsForTrigger`: "The session becomes easy
 *                          running ... it clears the pace target and the
 *                          quality flag". Easy days are untouched.
 *   replace              · this layer prescribes nothing. A return protocol
 *                          (`lib/plan/injury-builder.ts`, `Research/05`) owns
 *                          the substitute and BRIEF 11 is explicit that
 *                          return-to-run rebuilds tolerance rather than
 *                          recovering lost training.
 *   recover / stop       · this layer prescribes nothing. Doctrine §28:
 *                          "No fitness goal outranks safety." §19 forbids any
 *                          downstream service undoing that.
 *
 * `prescribedMi` is withheld (null) only in the last three. See
 * `WorkoutPrescription.prescribedMi` for why no percentage cut is invented.
 */
function applyState(base: WorkoutPrescription, args: PrescriptionArgs): WorkoutPrescription {
  const { state } = args;
  const adjustment: StateAdjustment = {
    decision: state.decision,
    applied: 'none',
    driver: state.driver ? `${state.driver.kind} · ${state.driver.detail}` : null,
    stateReadable: state.readable,
  };
  const reasons = [...base.reasons];
  if (!state.readable) reasons.push('STATE_UNREADABLE');

  switch (state.decision) {
    case 'proceed':
      return { ...base, stateAdjustment: adjustment, reasons: [...reasons, 'STATE_PROCEED'] };

    case 'proceed_with_caution':
      // Nothing narrows. The prescription is already at the width its own
      // evidence earned, and a cautious day is not a day to demand more
      // precision on. Recorded so the caller can say why nothing tightened.
      return {
        ...base,
        stateAdjustment: { ...adjustment, applied: 'no_tightening' },
        reasons: [...reasons, 'STATE_WOULD_NOT_TIGHTEN'],
      };

    case 'reduce': {
      if (!QUALITY_PURPOSES.has(base.purpose)) {
        return {
          ...base,
          stateAdjustment: { ...adjustment, applied: 'no_tightening' },
          reasons: [...reasons, 'STATE_WOULD_NOT_TIGHTEN'],
        };
      }
      const easy = easyPrescription(base.purpose, args.capacity.easyCeiling, base.prescribedMi);
      return {
        ...easy,
        // The PURPOSE the day was authored for is preserved, and the capacity
        // basis says the easy ceiling answered. A caller reading this can see
        // both what was asked for and what was given, which is §9's reason
        // object in the shape this layer has.
        purpose: base.purpose,
        stateAdjustment: { ...adjustment, applied: 'replaced_with_easy' },
        reasons: [...reasons, ...easy.reasons, 'STATE_REPLACED_QUALITY_WITH_EASY'],
      };
    }

    case 'replace':
    case 'recover':
    case 'stop':
      return {
        ...base,
        shape: 'none',
        paceSecPerMi: null,
        windowSecPerMi: null,
        ceilingSecPerMi: null,
        toleranceSecPerMi: null,
        complianceBasis: 'not_evaluated',
        prescribedMi: null,
        stateAdjustment: { ...adjustment, applied: 'withheld' },
        reasons: [...reasons, 'STATE_WITHHELD_PRESCRIPTION'],
      };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · THE ANCHOR SET — one prescription per zone, for a whole block
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Every pace a plan row can be priced at, resolved ONCE per block.
 *
 * WHY A SET AND NOT N CALLS AT THE ROW. `lib/plan/zone-anchors.ts` already owns
 * "what is this zone worth" — the twelve-row table out of `Research/04`
 * §"Pace zone shorthand" — and `spec-builder.ts` already prices every segment
 * of every session through it. What that table was missing was not structure
 * but INPUTS: it was fed a VDOT-derived threshold scalar and derived everything
 * else off offsets from it. This shape is those inputs, resolved through the
 * canonical owners, so the zone table stays the one answer to its own question
 * and stops being the place physiology gets invented (Constitution §5, §13).
 *
 * IT IS A PRESCRIPTION, NOT A CAPACITY. Every field is the output of
 * `resolveCapacityPrescription`, which means each carries whatever widening,
 * clamping and uncertainty slack its own capacity earned. A caller that wants
 * the raw belief calls `capacity-resolver.ts`; a caller that wants what to ask
 * of the runner calls this (Constitution §C vs §G).
 *
 * NO GOAL, ANYWHERE IN IT. The set is composed from `ResolvedCapacity` alone,
 * and `PrescriptionArgs` is compile-time sealed against goal data (section 9).
 * A race-day target still reads the runner's stated goal, and it reaches the
 * row through `buildWorkoutSpec`'s own `goalPaceSPerMi` /
 * `prescribedRacePaceSPerMi` arguments — Race Prediction's question, answered by
 * Race Prediction (§J), never smuggled in here.
 */
export interface PrescribedPaceAnchors {
  /** T and HM zones, continuous tempo blocks. */
  thresholdSecPerMi: number;
  /** I and 5K zones, strides. */
  intervalSecPerMi: number;
  /** R and mile zones. NULL when the high-intensity ladder cannot price a
   *  mile-column pace at all (Rule 11 — a caller must branch, never read a
   *  substituted I-pace). */
  repetitionSecPerMi: number | null;
  /** The fast edge of every easy, long and general-aerobic prescription.
   *  ONE number for easy and long: long is easy effort with more volume. */
  easyCeilingSecPerMi: number;
  /** The fast edge of a shakeout or recovery day — doctrine's recovery band,
   *  `SHAKEOUT_CEILING_PAD_S_PER_MI` slower than the easy ceiling. */
  shakeoutCeilingSecPerMi: number;
  /** M and MP zones, and a long run's marathon-pace finish. Derived from
   *  threshold capacity through the runner's OWN endurance exponent. */
  marathonSecPerMi: number;
  /** Provenance, for the audit stamp and for a surface that has to say how
   *  well each number is known. Never re-derived downstream (§17). */
  basis: {
    threshold: {
      sourceMode: SourceMode;
      confidence: number;
      /**
       * The threshold capacity's DERIVED VDOT, carried through unchanged.
       *
       * DERIVED DISPLAY, NOT A SOURCE — `ThresholdCapacityEstimate.vdot` is
       * `vdotFromTpace` of an already-resolved pace, and it is here for the one
       * consumer that legitimately still speaks VDOT: `achievableRaceTarget`,
       * which is Race Prediction's own input (Constitution §J). Carrying it
       * rather than letting that caller re-derive one is Rule 16 — the race
       * target and the block's paces must be read off the same fitness.
       *
       * Null for a runner outside the table's [30,85] range, which is a real
       * answer and not a failure (Rule 11).
       */
      vdot: number | null;
    };
    highIntensity: { sourceMode: SourceMode; confidence: number };
    easyCeiling: { sourceMode: SourceMode; confidence: number };
    marathon: {
      sourceMode: SourceMode;
      confidence: number;
      enduranceExponent: number;
      personallyEvidenced: boolean;
    };
  };
}

/** Why an anchor set was refused. Structured, never prose (§27). */
export type PaceAnchorRefusal =
  | 'ANCHORS_NOT_MONOTONE'
  | 'ANCHOR_NOT_FINITE';

/**
 * Rule 11 as a type. The refusal branch carries NO `anchors` field, so
 * `read.anchors` does not compile until the caller has branched — the same
 * device `NormalReading<T>` uses, and for the same reason: a caller that
 * silently fell back to the old VDOT cascade on a refusal would reintroduce
 * exactly the second truth Constitution §8 forbids.
 */
export type PaceAnchorRead =
  | { ok: true; anchors: PrescribedPaceAnchors }
  | { ok: false; reason: PaceAnchorRefusal; detail: string };

/**
 * Pure · the six anchors, composed from one resolved capacity.
 *
 * ── THE COHERENCE GATE, AND WHY IT REFUSES RATHER THAN CLAMPS ──────────────
 *
 * `Research/01` §"Pace conversion from a race time" states the zone ORDER, and
 * the ordering is the one thing about this set that is not a matter of degree:
 * a plan in which an easy day is prescribed faster than a threshold day is not
 * a conservative plan or an aggressive one, it is an incoherent one. Every
 * individual number here can be defensible while the SET is nonsense — which is
 * precisely the internally-consistent-but-wrong shape Rule 10's guards are blind
 * to by construction.
 *
 * So the set is checked as a set, and a violation REFUSES. It does not clamp,
 * because a clamp would hand the plan a well-formed set assembled out of a
 * contradiction and nothing downstream would ever know; and it does not fall
 * back, because falling back to the old cascade is the "sometimes old, sometimes
 * new" failure Constitution §8 names. A refusal leaves the plan exactly as it
 * was — which is a safe, inspectable state — and says why.
 */
export function composePaceAnchors(capacity: Immutable<ResolvedCapacity>): PaceAnchorRead {
  const rx = (purpose: WorkoutPurpose): WorkoutPrescription =>
    resolveCapacityPrescription({ capacity, purpose });

  const threshold = rx('threshold');
  const interval = rx('interval');
  const repetition = rx('repetition');
  const easy = rx('easy');
  const shakeout = rx('shakeout');
  const marathon = rx('marathon_specific');

  const mp = marathonPaceFromDurability({
    thresholdPaceSecPerMi: capacity.threshold.paceSecPerMi,
    durability: capacity.durability,
  });

  // A `window` prescription reports its centre; a `ceiling` reports its
  // ceiling; `effort` reports neither, and that is Rule 11's third state — the
  // number is genuinely unknown and must not be filled in.
  const point = (p: WorkoutPrescription): number | null =>
    p.shape === 'ceiling' ? p.ceilingSecPerMi : (p.shape === 'window' ? p.paceSecPerMi : null);

  const anchors: PrescribedPaceAnchors = {
    thresholdSecPerMi: Math.round(point(threshold) ?? capacity.threshold.paceSecPerMi),
    intervalSecPerMi: Math.round(point(interval) ?? capacity.highIntensity.intervalPaceSecPerMi),
    repetitionSecPerMi: point(repetition) != null ? Math.round(point(repetition)!) : null,
    easyCeilingSecPerMi: Math.round(point(easy) ?? capacity.easyCeiling.ceilingSecPerMi),
    shakeoutCeilingSecPerMi: Math.round(
      point(shakeout) ?? capacity.easyCeiling.ceilingSecPerMi + SHAKEOUT_CEILING_PAD_S_PER_MI,
    ),
    /**
     * MARATHON, WITH THE SAME §29 SEPARATION THE PRESCRIPTION ITSELF APPLIES.
     *
     * FOUND 2026-09-01, by wiring authoring to this function and watching it
     * REFUSE to price a 15:00/mi marathoner (`_audit_slow_runner`'s below-table
     * MARATHON persona): `marathon 999 s/mi is not faster than easy ceiling
     * 987 s/mi`.
     *
     * The cause is this line's own `??`. `resolveCapacityPrescription` clamps
     * the marathon window AND its point estimate against the easy ceiling
     * (`bounds.mustStayFasterThan`, `windowPrescription`'s §29 block) — but for
     * a runner on the POPULATION PRIOR it returns an `effort` shell with no
     * pace at all, so `point()` is null and the fallback took the RAW,
     * UNCLAMPED `marathonPaceFromDurability` value. The one runner for whom
     * the clamp matters most is the one runner it was skipped for.
     *
     * WHY IT BITES SLOW RUNNERS SPECIFICALLY. The easy band opens a FIXED
     * ~80 s/mi slower than threshold, while the Riegel carry from a ~1-hour
     * anchor distance out to 26.2 mi is a PERCENTAGE (~12% at the population
     * exponent). Those cross at roughly 800 s/mi of threshold: below that, the
     * fitted marathon pace lands inside — and then past — the easy band. The
     * ordering gate then reads a perfectly honest belief as an incoherent set
     * and refuses, and since AUTHORING-CANONICAL-1 a refusal means no plan.
     *
     * NOT A LOOSENING OF THE GATE. The gate still refuses a genuinely
     * incoherent set; what changes is that the fallback now respects the same
     * neighbour separation the clamped path already did, so the two branches
     * of one `??` stop disagreeing (Rule 16). A runner whose fitted marathon
     * pace really does sit outside their easy band is prescribed at the slow
     * edge of that band, which is the honest statement "your marathon is run
     * at easy effort" — true of a six-hour marathoner and exactly what a coach
     * would say.
     */
    marathonSecPerMi: Math.round(
      point(marathon)
      ?? Math.min(
        mp.paceSecPerMi,
        capacity.easyCeiling.ceilingSecPerMi - PRESCRIPTION_ZONE_SEPARATION_S,
      ),
    ),
    basis: {
      threshold: {
        sourceMode: capacity.threshold.sourceMode,
        confidence: capacity.threshold.confidence,
        vdot: capacity.threshold.vdot,
      },
      highIntensity: {
        sourceMode: capacity.highIntensity.sourceMode,
        confidence: capacity.highIntensity.confidence,
      },
      easyCeiling: {
        sourceMode: capacity.easyCeiling.sourceMode,
        confidence: capacity.easyCeiling.confidence,
      },
      marathon: {
        sourceMode: weakerSourceMode(capacity.threshold.sourceMode, capacity.durability.sourceMode),
        confidence: Math.min(capacity.threshold.confidence, capacity.durability.confidence),
        enduranceExponent: mp.enduranceExponent,
        personallyEvidenced: mp.personallyEvidenced,
      },
    },
  };

  const finite = [
    ['threshold', anchors.thresholdSecPerMi],
    ['interval', anchors.intervalSecPerMi],
    ['easyCeiling', anchors.easyCeilingSecPerMi],
    ['shakeoutCeiling', anchors.shakeoutCeilingSecPerMi],
    ['marathon', anchors.marathonSecPerMi],
  ] as const;
  for (const [name, v] of finite) {
    if (!Number.isFinite(v) || v <= 0) {
      return { ok: false, reason: 'ANCHOR_NOT_FINITE', detail: `${name} = ${v}` };
    }
  }
  if (anchors.repetitionSecPerMi != null
    && (!Number.isFinite(anchors.repetitionSecPerMi) || anchors.repetitionSecPerMi <= 0)) {
    return { ok: false, reason: 'ANCHOR_NOT_FINITE', detail: `repetition = ${anchors.repetitionSecPerMi}` };
  }

  // Strictly increasing seconds per mile is strictly decreasing speed:
  // R faster than I faster than T slower-than-which nothing easy may be run.
  const order: Array<[string, number]> = [];
  if (anchors.repetitionSecPerMi != null) order.push(['repetition', anchors.repetitionSecPerMi]);
  order.push(['interval', anchors.intervalSecPerMi]);
  order.push(['threshold', anchors.thresholdSecPerMi]);
  order.push(['marathon', anchors.marathonSecPerMi]);
  order.push(['easy ceiling', anchors.easyCeilingSecPerMi]);
  order.push(['shakeout ceiling', anchors.shakeoutCeilingSecPerMi]);
  for (let i = 1; i < order.length; i++) {
    if (!(order[i][1] > order[i - 1][1])) {
      return {
        ok: false,
        reason: 'ANCHORS_NOT_MONOTONE',
        detail: `${order[i - 1][0]} ${order[i - 1][1]} s/mi is not faster than ${order[i][0]} ${order[i][1]} s/mi`,
      };
    }
  }

  return { ok: true, anchors };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · THE COMPILE-TIME ASSERTIONS (§7, §10)
 *
 * Placed at the bottom so they reference the real declarations above.
 *
 * Falsify (Rule 18) by changing `capacity: Immutable<ResolvedCapacity>` to a
 * bare `ResolvedCapacity` on `PrescriptionArgs` and watching the first line go
 * red; or by adding `goalSec?: number` to `PrescriptionArgs` and watching the
 * second. Both were run against this file before it landed.
 * ═══════════════════════════════════════════════════════════════════════ */

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type AssertTrue<T extends true> = T;

/** The capacity input is deeply readonly, so §7's named anti-pattern —
 *  writing a state-adjusted number back onto a capacity estimate — cannot be
 *  expressed in this file or in any caller that shares the type. */
type _CapacityIsImmutable = AssertTrue<
  Equals<PrescriptionArgs['capacity'], Immutable<ResolvedCapacity>>
>;

/** The ONLY fields a prescription request may carry. A goal, a goal pace, a
 *  target finish time or a "runner metrics" bag that could hide one changes
 *  this union and stops the file compiling (§6). */
type _NoGoalInArgs = AssertTrue<
  Equals<keyof PrescriptionArgs, 'capacity' | 'state' | 'purpose' | 'plannedMi'>
>;

/** The capacity-only entry point carries the same fields MINUS state, and no
 *  others. `composePaceAnchors` — the seam the live plan flex now calls — goes
 *  through it, so the same goal seal covers the wired path. Adding a goal field
 *  to either shape fails here. */
type _CapacityArgsAreSealed = AssertTrue<
  Equals<keyof CapacityPrescriptionArgs, 'capacity' | 'purpose' | 'plannedMi'>
>;

/** Exported so the assertions above are not dead code an unused-locals lint
 *  could delete along with the guarantees they carry. */
export type PrescriptionArgsAreSealed =
  _CapacityIsImmutable & _NoGoalInArgs & _CapacityArgsAreSealed;
