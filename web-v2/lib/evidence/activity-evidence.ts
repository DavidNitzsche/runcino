/**
 * lib/evidence/activity-evidence.ts · THE EVIDENCE ENGINE'S OWNERSHIP LAYER.
 *
 * ONE owning service answers "what did THIS completed activity demonstrate?".
 * That is `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §1's
 * Evidence Engine row and `docs/PRODUCT_COACHING_DOCTRINE_BRIEFS.md` BRIEF 02,
 * and this file is it.
 *
 *     "Collect everything. Infer selectively. Not every run should update
 *      fitness."                                     — BRIEF 02, Evidence Engine
 *
 * Graded against two locked reference cases, which are simultaneously the spec
 * and the regression fixtures:
 *
 *   · `docs/reference-cases/easy-run-warm-conditions-2026-08-31.md` — an
 *     ordinary continuous easy run in the heat. The lesson is RESTRAINT: learn
 *     something without deciding fitness changed.
 *   · `docs/reference-cases/structured-long-run-2026-08-30.md` — an UNLABELLED
 *     long run with embedded quality blocks. The lesson is STRUCTURE: find the
 *     shape without being told where it is, and let evidence CHALLENGE a belief
 *     without updating it.
 *
 * ── THE OWNERSHIP BOUNDARY, STATED SO IT CANNOT DRIFT ───────────────────────
 *
 * This layer classifies ONE activity in isolation. It sits between the raw
 * activity and the capacity resolvers, and it is the piece §8's pipeline was
 * missing:
 *
 *     raw activity → DATA QUALITY → EVIDENCE CLASSIFICATION → evidence
 *     observation → evidence ledger → capacity resolver → adaptation decision
 *                   ╰──────── this file ────────╯
 *
 * It therefore does NOT:
 *
 *   · call `lib/training/capacity-resolver.ts`. Forming a belief from evidence
 *     is the Runner Model's question, and the Runner Model aggregates ACROSS
 *     activities. This file is handed exactly one activity and has no way to
 *     see another. Where a current belief is needed — for the belief-tension
 *     signal in section 13 — it arrives as an ARGUMENT (`ClassifyContext
 *     .currentBelief`), exactly as the planned workout does. Comparing against
 *     a belief you were handed is not the same as resolving one.
 *   · decide whether anything adapts. That is the Adaptation Engine's question.
 *     What this file emits is `anchorMoveCandidate` — a STATEMENT about whether
 *     this activity contains anything an adaptation engine could legitimately
 *     act on, not a decision that it should. §8's whole point is that raw
 *     activities never directly change the plan; a classifier returning
 *     "adapt: yes" would be the same shortcut with a longer name.
 *   · prescribe a pace, touch a plan, or produce a race prediction.
 *   · consume a VDOT. Deliberate, and load-bearing: a VDOT is a fitness BELIEF,
 *     and letting the evidence read depend on the estimate it informs is a
 *     circularity, not a refinement. The heat model's ability-tier input is
 *     therefore always the honest population default. This costs a little
 *     precision in the environmental read and buys the guarantee that evidence
 *     never quietly confirms itself.
 *
 * Everything else arrives as an argument, which is why the whole file is pure.
 * The database shell lives in `lib/evidence/load-activity-evidence.ts`.
 *
 * ── TWO STAGES (BRIEF 02) ───────────────────────────────────────────────────
 *
 *   Stage 1 · ELIGIBILITY — is there enough trustworthy information here to
 *   infer anything? Corrupted GPS, broken HR, insufficient duration, major
 *   interruptions, implausible data.
 *
 *   Stage 2 · WEIGHT — for admissible evidence, how strongly should each
 *   signal inform the output.
 *
 * Stage 1 is NOT one boolean. The easy-run reference case §4 grades data
 * quality PER SIGNAL on a single activity — pace HIGH, power HIGH, heart rate
 * MODERATE-HIGH, continuity MODERATE — and an activity can be excellent
 * evidence about one thing and useless about another. A pass/fail eligibility
 * check collapses exactly the distinction that fixture exists to teach. So
 * Stage 1 returns a per-signal grading plus a whole-activity admissibility
 * verdict, and only the pathological cases (no usable distance, no usable
 * duration, a sensor not merely noisy but contradicting itself) reject the
 * activity outright.
 *
 * ── RULE 11 IS ENFORCED BY THE TYPE SYSTEM, NOT BY DISCIPLINE ───────────────
 *
 * "Don't know", "measured zero" and "the read failed" are three facts. This
 * file's outputs are discriminated unions whose no-value branches carry NO
 * value field, in the shape `NormalReading<T>` (`lib/training/normal-window.ts`)
 * established for Rule 8. `CapacityEvidence` has three arms:
 *
 *   · `kind: 'evidence'`      — the activity demonstrated something. Carries a
 *                               weight.
 *   · `kind: 'no_evidence'`   — the activity demonstrably contained NONE of
 *                               this. A 6-mile easy run genuinely produced no
 *                               high-intensity evidence; that is a measurement,
 *                               not a gap. No weight field.
 *   · `kind: 'indeterminate'` — we could not tell. No weight field.
 *
 * `reading.weight` does not compile until the caller has branched, so a
 * downstream weighting cannot accidentally spend a zero that meant "we could
 * not see". `InternalCostRead` and `BeliefTensionRead` follow the same shape.
 *
 * ── RULE 9 · LABELS ARE DISCRETE, DECISIONS ARE CONTINUOUS ──────────────────
 *
 * Every band in this file (`EvidenceStrength`, `ConfidenceBand`,
 * `EnvironmentalLoad`, `SignalQuality`) is a LABEL over a continuous quantity
 * that is also exported. Downstream weighting reads the number; the label
 * exists so a human and a test can talk about it. The genuinely discrete
 * decisions are structural rather than numeric — a recovery segment is
 * recovery because it SITS BETWEEN two quality blocks, not because its pace
 * crossed a line by a tenth of a second — and `anchorMoveCandidate` is gated
 * on an evidence TIER as well as a weight, so no hair can promote an easy run
 * into an anchor-moving observation.
 *
 * ── RULE 16 · EVERY PHYSIOLOGICAL NUMBER HERE IS BORROWED, NOT RE-DERIVED ───
 *
 * This file introduces NO new heat model, NO new zone table, NO new decoupling
 * math. It calls:
 *
 *   · `heatEffort` / `estimateDewpointF` (`lib/training/heat-model.ts`) — THE
 *     heat calculation for every surface in the app, Research/06 §§1-2-12,
 *     already continuous in temperature and dewpoint. Per Enforcement §18 the
 *     environmental layer here is SUPPORTING: it changes how confidently the
 *     observed HR response is read. It does NOT produce a corrected pace, and
 *     nothing downstream may read one out of this file — see
 *     `EnvironmentalContext`'s own doc comment.
 *   · `friel7Zones` / `zoneIdxForBpm` (`lib/training/zones.ts`) — the runner's
 *     own HR zones off their own LTHR. The SEVEN-zone table specifically,
 *     because Friel's 1.03×LTHR edge is the only place doctrine separates
 *     "working at threshold" from "working above it", and that distinction is
 *     the whole reason the structured long run produces threshold evidence and
 *     not high-intensity evidence.
 *   · `DECOUPLING_PROTOCOL_MIN_MINUTES` (Research/03 §12) as the point where a
 *     drift read becomes protocol-grade rather than merely indicative.
 *   · `splitTimesReliable` (`lib/runs/split-coverage.ts`) — the ONE definition
 *     of whether a splits array reconciles with its run.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * It cannot catch a wrong LTHR, a wrong temperature, or splits that are
 * internally consistent but describe a different run — it reads its inputs as
 * given and only checks them against each other.
 *
 * It cannot see anything longitudinal. Corroboration, trend, and "is this
 * normal FOR THIS RUNNER" are all Runner Model questions, and every one of
 * them would change the reading. The belief-tension signal in section 13 is
 * the closest this file comes, and it only ever compares against a belief it
 * was HANDED.
 *
 * GRANULARITY IS THE HARD CEILING, and it is worth naming precisely because
 * both reference cases turn on it. Segment detection here operates at
 * PER-SPLIT granularity — one mile at a time on both fixtures. At that
 * resolution:
 *
 *   · a 40-second crosswalk stop inside an 8-minute mile moves the mile's mean
 *     HR by two or three beats and may never look like an interruption;
 *   · a set of 400m repetitions is averaged into the mile that contains them
 *     and cannot be resolved as intervals at all — which is why this file will
 *     never report high-intensity evidence off mile splits, and says so rather
 *     than quietly reporting none;
 *   · a segment boundary can only ever fall on a mile marker, so a block that
 *     began 300m into a mile is reported as beginning at the mile.
 *
 * None of that is fixable by tuning a threshold; it needs finer samples. Where
 * they exist (`runs.data.phases[].hrSamples` carries a ~5-second HR series on
 * `watch`-source rows) a future pass can feed the same functions a finer split
 * set, because every function below takes `EvidenceSplit[]` and nothing in it
 * assumes a mile.
 */
import { heatEffort, estimateDewpointF } from '@/lib/training/heat-model';
import { DECOUPLING_PROTOCOL_MIN_MINUTES } from '@/lib/training/aerobic-decoupling';
import { friel7Zones, zoneIdxForBpm, type ZoneTable } from '@/lib/training/zones';
import { splitTimesReliable, splitsSumSeconds } from '@/lib/runs/split-coverage';
import { reconcileSplitsTotal, MAX_SPLIT_SUM_DRIFT_MI } from '@/lib/runs/coherence';
import type { RunData } from '@/lib/runs/run-shape';
// ONE rounding rule (`lib/format/_format_lint.test.ts`). This layer emits
// numbers rather than strings, but it still rounds them for the ledger and for
// human-readable renders, and a second hand-rolled `.toFixed` here is exactly
// the 3.05 → "3.0" / "3.1" split that lint exists for.
import { roundTo } from '@/lib/format/run';

/* ══════════════════════════════════════════════════════════════════════════
 * 0 · VERSION
 * ══════════════════════════════════════════════════════════════════════ */

/** Enforcement §31 · version the model. Bump on any change that would move a
 *  previously-emitted classification, so a stored ledger entry can say which
 *  reasoning produced it. */
export const ACTIVITY_EVIDENCE_MODEL_VERSION = '1.0.0';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · INPUTS
 * ══════════════════════════════════════════════════════════════════════ */

/** One per-mile (or per-lap) split, in the normalised shape this layer reads.
 *  Deliberately narrow: the six historical shapes in `runs.data.splits` are
 *  normalised by the loader, not here, so the classifier stays testable
 *  without a database and cannot grow a seventh private opinion about split
 *  shape (`lib/runs/run-shape.ts` owns that question). Nothing below assumes a
 *  split is a mile — feed it finer segments and every function still holds. */
export interface EvidenceSplit {
  /** 1-based index within the activity. */
  index: number;
  distanceMi: number;
  paceSecPerMi: number;
  /** Mean heart rate over the split, bpm. Null when the split carries none. */
  hrBpm: number | null;
  /** Mean running power over the split, watts. Null when absent. */
  powerW?: number | null;
}

/** What the ingest layer recorded about whether the splits reconcile with the
 *  activity clock. Shape mirrors `runs.data.splits_validation`. */
export interface SplitsReconciliation {
  splitsSumS: number;
  durationS: number;
  /** `splitsSumS - durationS`. */
  deltaS: number;
  /** How many splits the reconciliation looked at. */
  count: number;
}

export interface RawActivityInput {
  activityId: string;
  /** ISO date, runner-local. */
  date: string;
  distanceMi: number | null;
  /** MOVING seconds — the clock the source counted as running. */
  activeSec: number | null;
  /**
   * TOTAL wall-clock seconds from start to finish, when the source records it
   * separately from moving time AND it genuinely exceeds it. Null when the
   * source stores only one clock, which is the common case for HealthKit
   * workouts — and per Rule 11 that null means "there is no second clock to
   * reconcile against", NOT "the run was continuous".
   */
  elapsedSec?: number | null;
  avgHrBpm: number | null;
  maxHrBpm?: number | null;
  avgPowerW?: number | null;
  avgCadenceSpm?: number | null;
  /** Running dynamics · stored, never coached from off one activity
   *  (easy-run reference case §18, Enforcement §26). */
  groundContactMs?: number | null;
  verticalOscillationCm?: number | null;
  strideLengthM?: number | null;
  elevationGainFt?: number | null;
  splits?: EvidenceSplit[] | null;
  /** Present when ingest reconciled the splits against the activity clock. */
  splitsReconciliation?: SplitsReconciliation | null;
  /** Ingest's verdict that the stored splits array should not be trusted. */
  splitsUnreliable?: boolean | null;
  /** For a completed run, the PEAK air temperature the run fought through —
   *  the quantity `HeatConditions.tempF` documents itself as wanting. */
  tempF?: number | null;
  humidityPct?: number | null;
  dewpointF?: number | null;
  cloudCoverPct?: number | null;
  conditions?: string | null;
  indoor?: boolean | null;
  /** The runner's threshold heart rate. Without it no zone reading is
   *  possible and every HR-derived lane refuses rather than guessing. */
  lthrBpm: number | null;
}

/** What was INTENDED. Never merged with what happened. */
export type PlannedIntent =
  | 'RECOVERY' | 'EASY' | 'LONG' | 'STEADY' | 'THRESHOLD'
  | 'INTERVALS' | 'REPETITION' | 'RACE' | 'TIME_TRIAL' | 'OTHER';

export interface PlannedWorkoutContext {
  intent: PlannedIntent;
  /** The raw `plan_workouts.type` this intent came from, for provenance. */
  sourceType?: string | null;
  plannedDistanceMi?: number | null;
  plannedDurationSec?: number | null;
  quality?: boolean | null;
}

/** Subjective input, from the sources that ACTUALLY exist in this app. See
 *  `lib/evidence/load-activity-evidence.ts` for where each one is read. */
export interface SubjectiveReport {
  /** `post_run_rpe.rpe`, 1-10. The only per-activity subjective field this app
   *  currently stores. */
  rpe?: number | null;
  notes?: string | null;
  /** `subjective_checkins.rating` for the day, 1-10. A DAY rating, not an
   *  activity rating — kept separate for exactly that reason. */
  dayRating?: number | null;
  /**
   * Apple's post-workout effort rating (HKWorkoutEffortScore, 1-10, surfaced
   * in the Workout app as Easy/Moderate/Hard/All Out).
   *
   * NOT CURRENTLY STORED ANYWHERE IN THIS APP. The easy-run reference case
   * cites it ("Apple post-run effort rating 4/Moderate") because the runner
   * read it off his own watch; `/api/ingest/workout` has no field for it,
   * `post_run_rpe` has no column for it, and no row in production carries it.
   * It is declared here rather than omitted so the classifier already knows
   * what to do with it the day HealthKitImporter starts sending it, and so
   * the gap is visible in the type rather than only in a report. Per Rule 20
   * this sentence is documentation, not enforcement.
   */
  appleEffortRating?: number | null;
  feltHarderOverTime?: boolean | null;
  heatPerceived?: boolean | null;
}

/**
 * A capacity belief this activity may be compared against — HANDED IN, never
 * resolved here. See the ownership note in the file header.
 *
 * Every field optional: a comparison that cannot be made is simply not made,
 * and the belief-tension read refuses with a reason rather than inventing a
 * baseline.
 */
export interface CurrentCapacityBelief {
  /** The currently believed threshold pace, seconds per mile. */
  thresholdPaceSecPerMi?: number | null;
  /** 0-1, how confident the Runner Model currently is in that number. */
  thresholdConfidence?: number | null;
  /** ISO date the belief was last resolved. Reported back on the tension so a
   *  consumer can see how old the thing being challenged is. */
  asOf?: string | null;
}

export interface ClassifyContext {
  plannedWorkout?: PlannedWorkoutContext | null;
  subjectiveReport?: SubjectiveReport | null;
  currentBelief?: CurrentCapacityBelief | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · DOCTRINE CONSTANTS
 *
 * Every constant below either cites a Research/ passage or is labelled
 * CONVENTION. A number with neither is the shape Rule 7 exists to stop.
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Minutes of the activity's opening during which heart rate is still settling
 * and must not be read as drift.
 *
 * CONVENTION, anchored on Research/03's own protocols: every HR field test
 * there opens with a warm-up before any reading is taken ("10–15 min warm-up +
 * strides", "15 min warm-up + strides", "10 min warm-up"). The FLOOR of that
 * range is used, because excluding less is the direction that keeps more real
 * data — over-excluding manufactures a refusal, under-excluding manufactures
 * drift.
 *
 * Easy-run reference case §24 item 2: "Opening HR stabilization not mistaken
 * for massive aerobic drift."
 */
export const HR_SETTLING_MINUTES = 10;

/**
 * Research/03 §2's confounder table: "| Cardiac drift (>30 min steady) |
 * Rises | +5–15% over 60 min |".
 *
 * Two doctrine facts in one row, and this layer uses BOTH:
 *   · drift is only a meaningful reading past 30 minutes of steady running —
 *     `DRIFT_SCOPE_MIN_MINUTES`, which doubles as the point past which work is
 *     "under accumulated load" for the durability read;
 *   · a rise of 5-15% per 60 minutes is the EXPECTED, NORMAL response for a
 *     healthy runner, not a finding — `DRIFT_NORMAL_BAND_PCT_PER_60MIN`.
 *
 * The second is what stops this layer repeating the error the easy-run
 * reference case names in §8: "Do NOT apply `decoupling > 5% → durability
 * problem`." §12's 5/8/10 interpretation ladder describes a 60-90 MINUTE
 * protocol run; a 52-minute easy run in the heat is outside that instrument's
 * scope, and quoting its bands there is quoting a table outside its own scope
 * — exactly the defect `aerobic-decoupling.ts`'s own header records for the
 * old six-mile gate.
 */
export const DRIFT_SCOPE_MIN_MINUTES = 30;
export const DRIFT_NORMAL_BAND_PCT_PER_60MIN: readonly [number, number] = [5, 15];

/**
 * Fraction of an activity's clock that may be unaccounted for before the
 * activity is treated as too discontinuous to read a physiological trend from
 * at all. CONVENTION, sized against Research/03 §12's protocol: a 60-minute
 * drift run with a fifth of its clock missing is not a 60-minute drift run.
 */
export const CONTINUITY_UNUSABLE_FRACTION = 0.20;

/** Continuity grade edges, as a fraction of the activity clock unaccounted
 *  for. CONVENTION · LABELS ONLY. `ContinuityRead.weight` is the continuous
 *  quantity every downstream calculation reads. */
export const CONTINUITY_HIGH_MAX_FRACTION = 0.02;
export const CONTINUITY_MODERATE_MAX_FRACTION = 0.10;

/**
 * The heart-rate separation, in bpm, that counts as a MEANINGFUL physiological
 * difference between two stretches of one run.
 *
 * ONE constant for one quantity (Rule 16). It is the bar for all three of:
 * a split looking interruption-shaped; a faster stretch being corroborated as
 * genuine quality rather than a downhill; and a closing stretch carrying
 * residual cardiovascular load. All three ask the same question — "did the
 * cardiovascular system actually do something different here" — and giving
 * them three numbers would be three answers to one question.
 *
 * CONVENTION at 8 bpm: roughly 5% of an easy-run heart rate, large enough that
 * ordinary beat-to-beat noise and a mile's averaging do not produce it, small
 * enough to catch a real zone change.
 */
export const MEANINGFUL_HR_SEPARATION_BPM = 8;

/**
 * The external-output change, in seconds per mile, that makes an HR change
 * EXPLAINED rather than structurally interesting. Same band
 * `computeAerobicDecoupling` uses for its steady-state filter (±20 s/mi,
 * "~4% at 8-min pace"), reused rather than re-picked so that "did external
 * effort actually change" has one answer in this codebase.
 */
export const OUTPUT_CHANGE_EXPLAINS_HR_SEC_PER_MI = 20;

/** Splits shorter than this are fragments, not comparable units, and are
 *  excluded from every stability, segment and drift read. CONVENTION — a
 *  0.18-mile tail whose mean HR covers ninety seconds is not a data point
 *  about the same quantity the whole miles are. */
export const SPLIT_FRAGMENT_MIN_MI = 0.5;

/** Coefficient-of-variation edges for calling external output STABLE.
 *  CONVENTION. Pace is held tighter than power because power on a wrist-based
 *  estimate is the noisier instrument of the two. */
export const PACE_STABILITY_HIGH_CV = 0.03;
export const PACE_STABILITY_MODERATE_CV = 0.06;
export const POWER_STABILITY_HIGH_CV = 0.04;
export const POWER_STABILITY_MODERATE_CV = 0.08;

/**
 * How much faster than the activity's OWN easy baseline a stretch must run
 * before it is a candidate quality segment. CONVENTION at 5%.
 *
 * Pace alone never promotes a segment — `MEANINGFUL_HR_SEPARATION_BPM` must
 * agree, which is what the structured-long-run reference case means by
 * "physiological support where available" and is what keeps a downhill mile,
 * a tailwind, or a GPS wobble from becoming an interval. On the 2026-08-30
 * fixture, mile 3 (7:50/mi, 6.9% faster than baseline) is rejected on exactly
 * this second clause: its heart rate, 147, is the same as the easy miles
 * around it.
 */
export const QUALITY_PACE_LIFT_FRAC = 0.05;

/** Minimum duration for a stretch to be reported as its own segment.
 *  CONVENTION. "Do not turn every pace fluctuation into a workout block."
 *  At per-mile granularity one split always clears this; the constant exists
 *  so a finer split set gets the guard it needs. */
export const SEGMENT_MIN_MINUTES = 3;

/**
 * The environmental cost, in slowdown %, at doctrine's own hard-bail
 * conditions — used to normalise how much of an observed HR elevation the
 * conditions could explain.
 *
 * Read off the SAME model rather than a different table, so the numerator and
 * denominator are the same quantity. Research/06 §11's bail row is "Td ≥80°F"
 * and §3's black flag sits at WBGT 86°F; `heatEffort` at Tair 90°F / Td 80°F
 * over a long effort composes to ~15%. That is the point past which doctrine
 * stops prescribing pace at all, so conditions explaining "all of it" is
 * exactly what a weight of 1.0 should mean.
 */
export const ENV_COST_SATURATION_PCT = 15;

/** Environmental-load LABEL edges, as fractions of `ENV_COST_SATURATION_PCT`.
 *  CONVENTION on the fractions; the scale underneath them is doctrine's.
 *  `slowdownPct` and `hrConfoundWeight` are the continuous quantities. */
export const ENV_LOAD_LOW_MAX_FRAC = 0.10;
export const ENV_LOAD_MODERATE_MAX_FRAC = 0.35;
export const ENV_LOAD_HIGH_MAX_FRAC = 0.70;

/**
 * Confidence-band edges for a single-activity physiological read.
 *
 * CONVENTION, and deliberately hard to reach at the top. Doctrine §15 — "one
 * run should rarely rewrite the runner" — means HIGH confidence in a
 * single-activity reading should require a clean, uninterrupted, temperate,
 * protocol-length effort with every signal intact. Anything with a missing
 * clock, a warm morning, or a sub-protocol duration is MODERATE at best.
 */
export const CONFIDENCE_MODERATE_MIN = 0.40;
export const CONFIDENCE_HIGH_MIN = 0.80;

/** Evidence-strength LABEL edges over the continuous capacity weight.
 *  CONVENTION. */
export const STRENGTH_LOW_TO_MODERATE_MIN = 0.15;
export const STRENGTH_MODERATE_MIN = 0.35;
export const STRENGTH_STRONG_MIN = 0.60;

/**
 * The hard ceiling on how much evidence weight ONE ordinary activity may
 * carry, and the structural form of Enforcement §10's "no single-run
 * overwrite" invariant.
 *
 * Set below `STRENGTH_STRONG_MIN` on purpose: an ordinary training session
 * cannot reach the strength band that `ANCHOR_MOVE_MIN_WEIGHT` requires, so
 * "one workout cannot move an anchor" is arithmetic here rather than a rule
 * somebody has to remember. Doctrine §15 in one number.
 *
 * `ANCHOR_CAPABLE_INTENTS` is §10's "explicit exceptional-evidence path" — a
 * race or a properly executed time trial is exempt from this ceiling, because
 * those are precisely the observations doctrine says SHOULD be able to move a
 * belief on their own.
 */
export const SINGLE_ACTIVITY_EVIDENCE_CEILING = 0.55;

/** The weight below which a single activity may not be a candidate for moving
 *  a capacity anchor, however clean it is. */
export const ANCHOR_MOVE_MIN_WEIGHT = STRENGTH_STRONG_MIN;

/** Intents whose activities can, in principle, carry anchor-moving evidence.
 *  Brief 02's evidence hierarchy: "Generally strongest: races, properly
 *  executed time trials, clean sustained threshold work, substantial
 *  structured intervals". Easy, long, recovery and steady aerobic running are
 *  explicitly in the weaker group and never reach this gate. */
export const ANCHOR_CAPABLE_INTENTS: ReadonlySet<PlannedIntent> = new Set<PlannedIntent>([
  'RACE', 'TIME_TRIAL', 'THRESHOLD', 'INTERVALS', 'REPETITION',
]);

/** Minutes of accumulated threshold-like work before an activity can produce
 *  threshold evidence at all. Research/04's cruise-interval and tempo
 *  vocabulary puts the shortest genuine threshold stimulus around 20 minutes
 *  of accumulated T work; below that, pace and HR existing together is not
 *  threshold evidence — easy-run reference case §9: "Do not derive threshold
 *  from this run merely because pace and HR exist." CONVENTION on the 20,
 *  cited in spirit to Research/04. */
export const THRESHOLD_MIN_SUSTAINED_MINUTES = 20;

/** Minutes of accumulated work above Friel's 1.03×LTHR edge before an
 *  activity can produce high-intensity evidence. CONVENTION — a stride, a
 *  hill, or one surge across a junction is not a high-intensity stimulus. */
export const HIGH_INTENSITY_MIN_MINUTES = 4;

/**
 * The margin, in percent of pace, inside which an observation is treated as
 * MATCHING a believed capacity rather than agreeing with it or contradicting
 * it outright.
 *
 * Research/03 §12's own first band: "< 5% = strong aerobic endurance;
 * sustainable". Five percent is the width doctrine itself uses for "this is
 * the same effort, held sustainably", so it is the honest width for "this
 * observation and this belief are describing the same capability."
 */
export const BELIEF_MATCH_MARGIN_PCT = 5;

/** Fractional pace slowdown across the closing stretch, relative to the
 *  opening easy stretch, past which a run is called a late-run pacing
 *  collapse. CONVENTION — 15% is roughly the 8:00 → 9:12 collapse a runner
 *  would describe as falling apart, and well outside ordinary long-run fade. */
export const LATE_COLLAPSE_PACE_FRAC = 0.15;

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · OUTPUT TYPES
 * ══════════════════════════════════════════════════════════════════════ */

export type SignalName = 'distance' | 'duration' | 'pace' | 'hr' | 'power' | 'dynamics';

/** Per-signal data quality. `absent` and `unusable` are different facts
 *  (Rule 11): the sensor was not there, versus it was there and lying. */
export type SignalQuality = 'high' | 'moderate_high' | 'moderate' | 'low' | 'unusable' | 'absent';

/** How much a signal of each quality is worth as a multiplier. CONVENTION. */
export const SIGNAL_QUALITY_WEIGHT: Readonly<Record<SignalQuality, number>> = Object.freeze({
  high: 1.0, moderate_high: 0.8, moderate: 0.6, low: 0.3, unusable: 0, absent: 0,
});

export type EligibilityRejectionCode =
  | 'NO_USABLE_DISTANCE'
  | 'NO_USABLE_DURATION'
  | 'IMPLAUSIBLE_PACE'
  | 'HR_SENSOR_IMPLAUSIBLE'
  | 'SPLITS_CONTRADICT_ACTIVITY'
  | 'DURATION_BELOW_ANY_INFERENCE_FLOOR';

export type SignalReasonCode =
  | 'PACE_STABILITY_UNVERIFIABLE_WITHOUT_SPLITS'
  | 'POWER_STABILITY_UNVERIFIABLE_WITHOUT_SPLITS'
  | 'PACE_STABILITY_CONFIRMED_BY_SPLITS'
  | 'POWER_STABILITY_CONFIRMED_BY_SPLITS'
  | 'HR_CURVE_ABSENT'
  | 'HR_DOWNGRADED_BY_DISCONTINUITY'
  | 'HR_DOWNGRADED_BY_INTERRUPTION_SHAPED_SPLITS'
  | 'SPLITS_DROPPED_AT_INGEST'
  | 'NO_POWER_RECORDED'
  | 'DYNAMICS_PRESENT_NOT_SURFACED';

export type ContinuityGrain = 'per_split' | 'whole_activity' | 'none';

export type ContinuityReasonCode =
  | 'ELAPSED_EXCEEDS_MOVING'
  | 'SPLIT_TIMES_LEAVE_ACTIVITY_TIME_UNACCOUNTED'
  | 'SPLITS_OVERCLAIM_ACTIVITY_CLOCK'
  | 'INTERRUPTION_SHAPED_SPLITS_DETECTED'
  | 'NO_INTERRUPTION_SHAPED_SPLITS_AT_THIS_GRANULARITY'
  | 'SPLITS_DROPPED_SO_COVERAGE_UNKNOWN'
  | 'NO_CONTINUITY_SIGNAL_AVAILABLE';

/**
 * How continuously the activity was actually run.
 *
 * `grade` is a label; `weight` is the number every downstream calculation
 * reads. `unaccountedFraction` is null — not zero — when no continuity signal
 * exists at all, because "the clock reconciled" and "there is no second clock
 * to reconcile against" are different facts.
 */
export interface ContinuityRead {
  grain: ContinuityGrain;
  grade: 'high' | 'moderate' | 'low' | 'unknown';
  weight: number;
  unaccountedSec: number | null;
  unaccountedFraction: number | null;
  /** 1-based `EvidenceSplit.index` values judged interruption-shaped. Excluded
   *  from every drift, segment and stability read downstream. */
  interruptedSplitIndices: number[];
  reasons: ContinuityReasonCode[];
}

export interface EligibilityResult {
  /** False only for the pathological cases. A merely noisy activity is
   *  admissible with downgraded signals — see the file header. */
  admissible: boolean;
  signals: Record<SignalName, SignalQuality>;
  signalReasons: SignalReasonCode[];
  continuity: ContinuityRead;
  rejections: EligibilityRejectionCode[];
}

export type EnvironmentalLoad = 'none' | 'low' | 'moderate' | 'high' | 'extreme' | 'unknown';

export type EnvReasonCode =
  | 'NO_WEATHER_RECORDED'
  | 'NO_USABLE_CLOCK_FOR_HEAT_EXPOSURE'
  | 'INDOOR_ACTIVITY'
  | 'DEWPOINT_ESTIMATED_FROM_HUMIDITY'
  | 'CONDITIONS_MAKE_ELEVATED_HR_PLAUSIBLE'
  | 'CONDITIONS_BENIGN';

/**
 * Environmental context.
 *
 * Enforcement §18, and the easy-run reference case §5 in its own words: "The
 * system does not need to invent an exact 'heat-adjusted pace' — it needs to
 * change how confidently it interprets the observed HR response."
 *
 * So this interface deliberately carries NO adjusted pace, NO corrected
 * distance, and NO normalised performance number of any kind. What it carries
 * is `hrConfoundWeight` — 0 to 1, how much of an observed elevation in
 * cardiovascular cost the conditions could plausibly account for — which every
 * confidence calculation in this file multiplies through. `slowdownPct` is
 * reported because it is the doctrine quantity the weight is derived FROM and
 * hiding it would make the weight unexplainable, but it is a diagnostic, not a
 * correction to apply to anything.
 */
export interface EnvironmentalContext {
  tempF: number | null;
  humidityPct: number | null;
  dewpointF: number | null;
  /** Research/06's composed slowdown for this effort, %. Diagnostic only. */
  slowdownPct: number | null;
  load: EnvironmentalLoad;
  /** 0-1 · how much of an observed HR elevation the conditions could explain.
   *  Continuous in temperature and dewpoint — no threshold here that a tenth
   *  of a degree can cross (Rule 9). */
  hrConfoundWeight: number;
  hrCostPlausiblyElevated: boolean;
  reasons: EnvReasonCode[];
}

/** What the activity, or a stretch of it, actually was physiologically.
 *  Never merged with `PlannedIntent`. */
export type ObservedExecution =
  | 'RECOVERY' | 'EASY' | 'EASY_TO_AEROBIC_STEADY' | 'AEROBIC_STEADY'
  | 'STEADY_TO_THRESHOLD' | 'THRESHOLD' | 'HIGH_INTENSITY'
  | 'MIXED' | 'INDETERMINATE';

/** The structured-long-run reference case's own segment vocabulary (Part 1,
 *  `physiological_classification`). */
export type SegmentClassification =
  | 'recovery' | 'easy_aerobic' | 'steady_aerobic'
  | 'threshold_like' | 'high_intensity' | 'unknown';

export type SegmentReasonCode =
  | 'PACE_LIFT_CORROBORATED_BY_HR'
  | 'PACE_LIFT_NOT_CORROBORATED_BY_HR'
  | 'SITS_BETWEEN_QUALITY_BLOCKS'
  | 'RESIDUAL_HR_ABOVE_OPENING_EASY'
  | 'OUTPUT_AT_EASY_BASELINE_DESPITE_ELEVATED_HR'
  | 'UNDER_ACCUMULATED_LOAD'
  | 'BELOW_SEGMENT_MIN_DURATION'
  | 'NO_POWER_RECORDED_FOR_THIS_ACTIVITY';

/**
 * One stretch of an activity that behaves as a unit.
 *
 * The `power` field of the reference case's suggested shape is present and
 * NULL for both fixtures, because neither carries per-split power — the
 * 2026-08-30 long run stores only a whole-run `avgPowerW`. Reported as null
 * with a reason rather than back-filled from the run average, which would be
 * fabricating a per-segment measurement out of an average (Enforcement §38).
 */
export interface ObservedSegment {
  /** 1-based, in activity order. */
  index: number;
  /** `EvidenceSplit.index` values this segment covers. */
  splitIndices: number[];
  startSec: number;
  endSec: number;
  spanSec: number;
  distanceMi: number;
  meanPaceSecPerMi: number;
  meanHrBpm: number | null;
  meanPowerW: number | null;
  /** Friel 7-zone index of `meanHrBpm`, or null without a zone table. */
  hrZoneIdx: number | null;
  /** Pace relative to the activity's own easy baseline. 1.0 = at baseline,
   *  1.08 = eight percent faster. Continuous. */
  relativeIntensity: number;
  classification: SegmentClassification;
  /** 0-1. Do not fake certainty (reference case Part 1). */
  confidence: number;
  /** Minutes of running completed BEFORE this segment began — what makes
   *  sequence matter, and the field the structured-long-run reference case
   *  Part 2 item 3 names as an implementation requirement. */
  accumulatedMinutesBefore: number;
  /** True when this segment began past `DRIFT_SCOPE_MIN_MINUTES`. */
  underAccumulatedLoad: boolean;
  reasons: SegmentReasonCode[];
}

export type ExecutionQuality = 'controlled' | 'variable' | 'indeterminate';
export type StabilityGrade = 'high' | 'moderate' | 'low' | 'unknown';

export interface ExternalOutputRead {
  paceStability: StabilityGrade;
  paceCv: number | null;
  powerStability: StabilityGrade;
  powerCv: number | null;
  verdict: 'stable' | 'variable' | 'unknown';
}

export type ConfidenceBand = 'low' | 'moderate' | 'high';

export type InternalCostRefusal =
  | 'no_hr_curve'
  | 'below_drift_scope'
  | 'external_output_not_steady'
  | 'insufficient_analysable_splits'
  | 'continuity_unusable'
  | 'activity_is_structured';

export type DriftMagnitude = 'minimal' | 'moderate' | 'large';

/**
 * Did the cardiovascular cost of holding the same external output rise?
 *
 * Rule 11 by construction: the refusal arm carries NO numbers, so
 * `read.risePct` does not compile until the caller has branched on `ok`. A
 * drift of zero and a drift we could not measure are opposite facts, and the
 * easy-run reference case turns on exactly that distinction.
 *
 * Refuses with `activity_is_structured` on a run that segmentation found
 * multiple physiological blocks in. That is not a limitation, it is the
 * structured-long-run reference case's instruction: "Whole-run averages are
 * secondary... understand the pattern before interpreting the average." A
 * first-half/second-half drift read on a run that deliberately mixes easy and
 * quality running is the same error as computing a VDOT from its 7:37 average.
 */
export type InternalCostRead =
  | {
      ok: true;
      detected: boolean;
      risePct: number;
      /** The same rise per 60 minutes — the unit Research/03 §2's "+5–15% over
       *  60 min" band is stated in. */
      risePctPer60Min: number;
      magnitude: DriftMagnitude;
      /** True when `risePctPer60Min` sits inside Research/03 §2's own expected
       *  band, i.e. this is the NORMAL response, not a finding. */
      withinDoctrineNormalBand: boolean;
      confidence: number;
      confidenceBand: ConfidenceBand;
      analysedMinutes: number;
      firstHalfHr: number;
      secondHalfHr: number;
      firstHalfPaceSec: number;
      secondHalfPaceSec: number;
      splitsAnalysed: number;
      splitsExcludedSettling: number;
      splitsExcludedInterruption: number;
      splitsExcludedFragment: number;
    }
  | { ok: false; reason: InternalCostRefusal };

export type QualityUnderLoadRefusal =
  | 'no_quality_segments'
  | 'no_segments_under_accumulated_load'
  | 'activity_not_structured';

/**
 * Quality under accumulated load — the structured-long-run reference case
 * Part 2 item 3: "A 7:00-ish effort at minute 15 and a 7:00-ish effort after
 * an hour of running are NOT equivalent observations."
 */
export type QualityUnderLoadRead =
  | {
      ok: true;
      qualityBlocks: number;
      totalQualityMinutes: number;
      /** Minutes of quality work that fell past `DRIFT_SCOPE_MIN_MINUTES`. */
      qualityMinutesUnderLoad: number;
      /** Accumulated minutes before the LAST quality block began. */
      latestBlockStartMinutes: number;
      /** Later block mean pace ÷ earlier block mean pace. 1.0 = held exactly;
       *  above 1.0 = the later block was slower. Null with one block. */
      lateVsEarlyPaceRatio: number | null;
      /** Closing easy stretch pace ÷ opening easy stretch pace. */
      closingVsOpeningPaceRatio: number | null;
      lateRunPacingCollapse: boolean;
      /** The nuance the pacing-only read misses: HR staying elevated through
       *  the closing easy miles. */
      residualHrElevationBpm: number | null;
      residualCardiovascularLoad: boolean;
    }
  | { ok: false; reason: QualityUnderLoadRefusal };

export type CapacityName = 'high_intensity' | 'threshold' | 'durability' | 'easy_ceiling';
export type EvidenceStrength = 'low' | 'low_to_moderate' | 'moderate' | 'strong';
export type EvidenceReliability = 'low' | 'low_to_moderate' | 'moderate' | 'high';
export type AnchorEffect = 'supporting_evidence_only' | 'candidate_anchor_move';

export type CapacityReasonCode =
  | 'NO_HIGH_INTENSITY_WORK_PERFORMED'
  | 'GRANULARITY_CANNOT_RESOLVE_INTERVALS'
  | 'NO_SUSTAINED_THRESHOLD_SEGMENT'
  | 'PACE_AND_HR_EXIST_BUT_DEMONSTRATE_NOTHING'
  | 'SUSTAINED_THRESHOLD_LIKE_WORK_PRESENT'
  | 'STABLE_OUTPUT_WITH_RISING_INTERNAL_COST'
  | 'QUALITY_SURVIVED_ACCUMULATED_LOAD'
  | 'REPEATED_QUALITY_BLOCKS_WITHIN_ONE_ACTIVITY'
  | 'NO_LATE_RUN_PACING_COLLAPSE'
  | 'RESIDUAL_CARDIOVASCULAR_LOAD_INTO_CLOSE'
  | 'DURATION_BELOW_PROTOCOL'
  | 'ENVIRONMENTALLY_AFFECTED'
  | 'ACTIVITY_INTERRUPTED'
  | 'SINGLE_ACTIVITY_BELOW_ANCHOR_MOVE_TIER'
  | 'SINGLE_ACTIVITY_CEILING_APPLIED'
  | 'SINGLE_ACTIVITY_DOES_NOT_RESET_EASY_CEILING'
  | 'NO_HR_CURVE_TO_READ_INTERNAL_COST'
  | 'NO_ZONE_TABLE_WITHOUT_LTHR'
  | 'MIXED_INTENSITY_ACTIVITY_AVERAGE_NOT_EVIDENCE'
  | 'ACTIVITY_INADMISSIBLE';

/**
 * What one activity demonstrated about one capacity. Three arms, per Rule 11
 * — and only the first carries a weight, so "we could not tell" cannot be
 * spent as if it were "there was none".
 */
export type CapacityEvidence =
  | {
      capacity: CapacityName;
      kind: 'evidence';
      strength: EvidenceStrength;
      /** 0-1 continuous. THIS is what a downstream weighting reads;
       *  `strength` is its label. */
      weight: number;
      reliability: EvidenceReliability;
      anchorEffect: AnchorEffect;
      reasons: CapacityReasonCode[];
    }
  | {
      capacity: CapacityName;
      /** The activity demonstrably contained none of this. A measurement. */
      kind: 'no_evidence';
      reasons: CapacityReasonCode[];
    }
  | {
      capacity: CapacityName;
      /** We could not tell. Not the same fact. */
      kind: 'indeterminate';
      reasons: CapacityReasonCode[];
    };

export type BeliefTensionRefusal =
  | 'no_belief_supplied'
  | 'no_comparable_observation'
  | 'observation_consistent_with_belief';

export type BeliefTensionReasonCode =
  | 'SUSTAINED_WORK_MATCHED_BELIEF_UNDER_ACCUMULATED_LOAD'
  | 'SUSTAINED_WORK_FASTER_THAN_BELIEF'
  | 'GRADED_EFFORT_SLOWER_THAN_BELIEF_WHILE_FRESH'
  | 'NOT_CORROBORATED_BY_THIS_ACTIVITY_ALONE';

/**
 * THE THIRD OUTCOME · evidence can challenge a belief without updating it.
 *
 * The structured-long-run reference case Part 3, which calls this the most
 * important lesson of that run:
 *
 *   > Evidence doesn't only update fitness. Evidence can tell the model that
 *   > its existing belief deserves re-examination.
 *
 * A naive system either ignores a strong single observation (one run is not
 * corroboration) or overreacts to it (resets the anchor off one point).
 * Neither is right. The correct behaviour is a third, NAMED outcome: the
 * belief is not changed, and the tension is recorded so that the NEXT
 * corroborating observation resolves decisively instead of re-clearing the
 * corroboration bar from zero.
 *
 * `anchorEffect` is hard-typed to the single literal
 * `'no_change_flag_for_reexamination'` — this shape CANNOT express an anchor
 * move, so a consumer cannot mistake it for one and a future edit cannot
 * quietly widen it without changing the type.
 *
 * NOT CONSUMED YET. Nothing in `capacity-resolver.ts` reads
 * `reexaminationWeight` today; lowering a future corroboration bar is a Runner
 * Model behaviour and is named as an explicit follow-up rather than built
 * here, because it changes how a deployed resolver weighs its corpus. The
 * SIGNAL is genuinely computed — see `readBeliefTension` — not stubbed.
 */
export type BeliefTensionRead =
  | {
      ok: true;
      capacity: CapacityName;
      code: 'CONTRADICTS_CURRENT_ESTIMATE';
      /**
       * WHICH WAY THE BELIEF LOOKS WRONG — not the sign of the pace
       * difference, and the two genuinely come apart.
       *
       * `observation_stronger_than_belief` can carry a NEGATIVE
       * `magnitudeSecPerMi` (the observed work was slower than the believed
       * threshold pace) and still be correct, because the comparison is
       * against what the belief PREDICTS for the circumstances: a threshold
       * pace is what a runner holds fresh, so running within
       * `BELIEF_MATCH_MARGIN_PCT` of it forty-seven minutes into a long run
       * is not what a correct belief predicts. `reasons` names which clause
       * fired, and the raw numbers are all reported so a consumer can see the
       * arithmetic rather than take the direction on trust.
       */
      direction: 'observation_stronger_than_belief' | 'observation_weaker_than_belief';
      believedPaceSecPerMi: number;
      observedPaceSecPerMi: number;
      /** Signed: positive = the observation ran FASTER than the belief. Can be
       *  negative on the `stronger` arm — see `direction`. */
      magnitudeSecPerMi: number;
      magnitudePct: number;
      observedMinutes: number;
      /** Accumulated minutes of running before the compared work began. */
      accumulatedMinutesBefore: number;
      beliefAsOf: string | null;
      /** Structurally incapable of expressing an anchor move. */
      anchorEffect: 'no_change_flag_for_reexamination';
      /** 0-1 · how much this tension should lower the corroboration bar for
       *  the NEXT confirming observation. A signal for the Runner Model. */
      reexaminationWeight: number;
      reasons: BeliefTensionReasonCode[];
    }
  | { ok: false; reason: BeliefTensionRefusal };

export type LedgerEntryKind =
  | 'AEROBIC_DURABILITY_OBSERVATION'
  | 'QUALITY_UNDER_LOAD_OBSERVATION'
  | 'ENVIRONMENTAL_RESPONSE_OBSERVATION'
  | 'RESIDUAL_CARDIOVASCULAR_LOAD_OBSERVATION';

/**
 * One row for the evidence ledger. Shape mirrors the easy-run reference
 * case's §10 "evidence ledger entry (conceptual shape)" field for field,
 * because that is a document this layer is graded against and a ledger whose
 * fields do not line up with the worked example cannot be checked against it.
 *
 * `anchorEffect` is on every entry and is the explicit, inspectable form of
 * "this observation enters the ledger but does not move the anchor" — not an
 * implication left to be inferred from a low confidence number.
 */
export interface EvidenceLedgerEntry {
  kind: LedgerEntryKind;
  activityId: string;
  date: string;
  modelVersion: string;
  activeDurationSec: number | null;
  distanceMi: number | null;
  intent: PlannedIntent | null;
  observedExecution: ObservedExecution;
  externalLoad: 'stable' | 'variable' | 'unknown';
  paceStability: StabilityGrade;
  powerStability: StabilityGrade;
  cardiovascularDrift: DriftMagnitude | 'not_measured';
  subjectiveEffort: number | null;
  environment: EnvironmentalLoad;
  interruptionsPresent: boolean;
  reliability: EvidenceReliability;
  anchorEffect: AnchorEffect;
  reasons: CapacityReasonCode[];
}

export type TrainingStimulus =
  | 'aerobic_development' | 'aerobic_maintenance' | 'threshold_development'
  | 'high_intensity_development' | 'mixed_aerobic_and_quality' | 'recovery' | 'none';

export interface TrainingLoadRead {
  /** Easy-run reference case §12: "Training stimulus and fitness evidence are
   *  different concepts — a workout doesn't need to update a fitness anchor to
   *  be valuable." This field lets the classifier say a run was worthwhile in
   *  the same breath as saying it taught us nothing. */
  stimulus: TrainingStimulus;
  aerobicMinutes: number | null;
  distanceMi: number | null;
  primaryValue: string;
}

export interface RunningDynamicsRead {
  cadenceSpm: number | null;
  groundContactMs: number | null;
  verticalOscillationCm: number | null;
  strideLengthM: number | null;
  /** Easy-run reference case §18 / Enforcement §26: stored, never coached from
   *  off one activity. Always false from this layer. */
  surfaced: false;
  reason: 'insufficient_evidence_from_one_activity';
}

export interface ActivityEvidenceResult {
  modelVersion: string;
  activityId: string;
  date: string;

  /** Stage 1. */
  eligibility: EligibilityResult;
  environment: EnvironmentalContext;

  /** Never collapsed into one field. */
  plannedIntent: PlannedIntent | null;
  observedExecution: ObservedExecution;
  /** True when observed execution differs from intent. NOT a failure verdict —
   *  "Do not rewrite the workout label. Do not call it a failure." */
  executionDivergedFromIntent: boolean;
  executionQuality: ExecutionQuality;

  /** True when segmentation found more than one physiological block. When
   *  true, the whole-run averages describe none of them honestly and
   *  `internalCost` refuses. */
  structured: boolean;
  segments: ObservedSegment[];
  /** The activity's own easy-pace reference, seconds per mile — the baseline
   *  segmentation measured relative intensity against. Null without splits. */
  easyPaceBaselineSecPerMi: number | null;

  externalOutput: ExternalOutputRead;
  internalCost: InternalCostRead;
  qualityUnderLoad: QualityUnderLoadRead;

  capacities: Record<CapacityName, CapacityEvidence>;
  /** The third outcome: challenges a belief without updating it. */
  beliefTension: BeliefTensionRead;

  ledger: EvidenceLedgerEntry[];
  trainingLoad: TrainingLoadRead;
  runningDynamics: RunningDynamicsRead;

  /**
   * Does this activity contain anything a capacity anchor could legitimately
   * move on?
   *
   * A STATEMENT, not a decision. False is the common, correct answer, and the
   * easy-run reference case's whole lesson (§11, §14, §22) is that saying so
   * out loud is the system working.
   */
  anchorMoveCandidate: boolean;
  anchorMoveReasons: CapacityReasonCode[];

  /** Every reason code the classification produced, flattened, so a caller can
   *  render an explanation without walking the tree (Enforcement §27). */
  reasons: string[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · SMALL PURE HELPERS
 * ══════════════════════════════════════════════════════════════════════ */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function mean(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * The mean of a set that may be empty.
 *
 * NOT a zero-erasure: an empty set has no mean, so `null` here is the only
 * correct value rather than a measurement being flattened. Written once so the
 * three call sites that need it cannot each decide separately what the mean of
 * nothing is.
 */
function meanOrNull(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return mean(xs);
}

/**
 * ONE narrowing of the classifier's scalar inputs, so the same judgement is
 * not re-made at nine call sites (`lib/audit/coercion-scan.ts`'s exact
 * concern, and the deduplication its registry's own precedent asks for).
 *
 * A distance, a clock or a threshold heart rate of ZERO is not a measurement —
 * a run cannot last no time, cover no ground, or be paced off a heart rate of
 * nothing. So zero, absent and unreadable genuinely ARE one outcome here, and
 * the fact is never lost: the eligibility layer states `NO_USABLE_DISTANCE` /
 * `NO_USABLE_DURATION` beside the null, and the capacity layer states
 * `NO_ZONE_TABLE_WITHOUT_LTHR`. The null narrows; the reason code carries the
 * fact (Rule 11).
 */
function usableMeasurement(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function coefficientOfVariation(xs: readonly number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  if (!(m > 0)) return null;
  const variance = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length;
  return Math.sqrt(variance) / m;
}

/** Geometric mean of independent 0-1 quality factors. Chosen over the
 *  arithmetic mean deliberately: one dead factor should drag the whole read
 *  down rather than being averaged away by three healthy ones, which is what
 *  "when pace, duration, structure and HR agree, confidence increases; when
 *  they disagree, uncertainty increases" (Doctrine §14) actually implies. */
function geometricMean(factors: readonly number[]): number {
  const usable = factors.filter((f) => Number.isFinite(f));
  if (usable.length === 0) return 0;
  if (usable.some((f) => f <= 0)) return 0;
  return Math.exp(usable.reduce((s, f) => s + Math.log(f), 0) / usable.length);
}

function confidenceBandOf(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_HIGH_MIN) return 'high';
  if (confidence >= CONFIDENCE_MODERATE_MIN) return 'moderate';
  return 'low';
}

function strengthOf(weight: number): EvidenceStrength {
  if (weight >= STRENGTH_STRONG_MIN) return 'strong';
  if (weight >= STRENGTH_MODERATE_MIN) return 'moderate';
  if (weight >= STRENGTH_LOW_TO_MODERATE_MIN) return 'low_to_moderate';
  return 'low';
}

function reliabilityOf(weight: number): EvidenceReliability {
  if (weight >= STRENGTH_STRONG_MIN) return 'high';
  if (weight >= STRENGTH_MODERATE_MIN) return 'moderate';
  if (weight >= STRENGTH_LOW_TO_MODERATE_MIN) return 'low_to_moderate';
  return 'low';
}

function stabilityOf(cv: number | null, highMax: number, moderateMax: number): StabilityGrade {
  if (cv == null || !Number.isFinite(cv)) return 'unknown';
  if (cv <= highMax) return 'high';
  if (cv <= moderateMax) return 'moderate';
  return 'low';
}

/** Splits that are whole comparable units — fragments and zero-length rows
 *  removed. Everything downstream analyses this set, never the raw array. */
export function analysableSplits(splits: readonly EvidenceSplit[]): EvidenceSplit[] {
  return splits.filter(
    (s) =>
      Number.isFinite(s.distanceMi) && s.distanceMi >= SPLIT_FRAGMENT_MIN_MI &&
      Number.isFinite(s.paceSecPerMi) && s.paceSecPerMi > 0,
  );
}

function splitSeconds(s: EvidenceSplit): number {
  return s.paceSecPerMi * s.distanceMi;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · CONTINUITY / INTERRUPTION DETECTION
 *
 * The easy-run reference case's §24 item 1 and the one technical requirement
 * it names explicitly: "brief stops and crosswalk pauses should be identified
 * BEFORE calculating HR drift or aerobic decoupling."
 *
 * TWO LANES, because the answer depends on what granularity exists and the two
 * see different things:
 *
 *   · WHOLE-ACTIVITY — is there time inside the activity that the running
 *     clock does not account for? Either an elapsed clock that exceeds the
 *     moving clock, or split times that leave activity time unexplained ONCE
 *     THE UN-SPLIT TAIL IS PRICED. That second clause is load-bearing: a
 *     6.18-mile run whose splits cover 6.0 miles legitimately falls ~one
 *     tail's worth of seconds short, and reading that as an interruption is
 *     precisely the false positive `split-coverage.ts` was written to end.
 *   · PER-SPLIT — which splits look like they contain a stop. A split is
 *     interruption-shaped when it is a LOCAL MINIMUM in heart rate — abruptly
 *     below BOTH neighbours — while external output did not change to explain
 *     it. The V shape matters: a crosswalk stop dips and recovers, whereas a
 *     runner settling down after a hard block declines monotonically. Without
 *     the V test, the 2026-08-30 long run's mile 12 (HR 168 → 161 at unchanged
 *     pace, an ordinary post-block settle) reads as a pause.
 *
 * They are reported separately rather than merged. At per-mile granularity the
 * per-split lane routinely sees NOTHING on a run that certainly had crosswalk
 * stops, because a 40-second stand-still inside an 8-minute mile moves the
 * mean by two or three beats. Reporting "no interruptions" off that would be
 * the Rule 11 collapse again — "none detected at this granularity" is not
 * "none happened", and the reason codes say which one is being claimed.
 *
 * CROSS-CUTTING, deliberately not acted on here:
 * `lib/training/durability-anchor.ts#qualifyingDecouplingObservation` runs
 * `computeAerobicDecoupling` over raw splits with NO interruption filtering
 * and no `splits_unreliable` check. It would benefit from this detector.
 * Changing the durability anchor's corpus is a behaviour change to a deployed
 * reader and belongs in its own commit with its own falsification, so it is
 * named here rather than done.
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Pure · which splits look like they contain a pause.
 *
 * Flags a split only when its heart rate sits at least
 * `MEANINGFUL_HR_SEPARATION_BPM` below BOTH neighbours (a V, not a decline)
 * AND external output did not slow enough to explain the drop. The first and
 * last splits can never be flagged, because a V needs two shoulders — a real
 * limitation, stated rather than papered over.
 */
export function detectInterruptedSplits(splits: readonly EvidenceSplit[]): number[] {
  const usable = analysableSplits(splits).filter((s) => s.hrBpm != null && Number.isFinite(s.hrBpm));
  if (usable.length < 3) return [];
  const flagged: number[] = [];
  for (let i = 1; i < usable.length - 1; i++) {
    const prev = usable[i - 1];
    const cur = usable[i];
    const next = usable[i + 1];
    const dropFromPrev = (prev.hrBpm as number) - (cur.hrBpm as number);
    const dropFromNext = (next.hrBpm as number) - (cur.hrBpm as number);
    if (dropFromPrev < MEANINGFUL_HR_SEPARATION_BPM) continue;
    if (dropFromNext < MEANINGFUL_HR_SEPARATION_BPM) continue;
    // Did external output change enough to explain it? Slowing legitimately
    // lowers HR; running FASTER makes the drop stranger, not more explained,
    // so only the slowing direction excuses it.
    const slowedBy = cur.paceSecPerMi - prev.paceSecPerMi;
    if (slowedBy > OUTPUT_CHANGE_EXPLAINS_HR_SEC_PER_MI) continue;
    flagged.push(cur.index);
  }
  return flagged;
}

/** Pure · the continuity read for one activity, at whatever granularity it has. */
export function readContinuity(input: {
  /** ALREADY NARROWED by `usableMeasurement` — null means "no usable clock",
   *  and this function does not re-decide that. */
  activeSec: number | null;
  elapsedSec?: number | null;
  distanceMi?: number | null;
  splits?: readonly EvidenceSplit[] | null;
  splitsReconciliation?: SplitsReconciliation | null;
  splitsDropped?: boolean;
}): ContinuityRead {
  const reasons: ContinuityReasonCode[] = [];
  const moving = input.activeSec;
  const splits = input.splits ?? [];
  const analysable = analysableSplits(splits);

  // ── whole-activity lane ────────────────────────────────────────────────
  let unaccountedSec: number | null = null;
  let clockBasis: number | null = null;

  if (moving != null && input.elapsedSec != null && input.elapsedSec > moving) {
    unaccountedSec = input.elapsedSec - moving;
    clockBasis = input.elapsedSec;
    reasons.push('ELAPSED_EXCEEDS_MOVING');
  } else if (moving != null && analysable.length > 0) {
    // Price the un-split tail before calling anything unaccounted.
    const coveredMi = analysable.reduce((s, r) => s + r.distanceMi, 0);
    const splitSec = analysable.reduce((s, r) => s + splitSeconds(r), 0);
    const meanPace = coveredMi > 0 ? splitSec / coveredMi : null;
    const totalMi = input.distanceMi != null && input.distanceMi > 0 ? input.distanceMi : coveredMi;
    const tailSec = meanPace != null ? Math.max(0, totalMi - coveredMi) * meanPace : 0;
    const gap = moving - splitSec - tailSec;
    if (gap > 0) {
      unaccountedSec = gap;
      clockBasis = moving;
      reasons.push('SPLIT_TIMES_LEAVE_ACTIVITY_TIME_UNACCOUNTED');
    } else if (splitSec - moving > 5) {
      unaccountedSec = splitSec - moving;
      clockBasis = moving;
      reasons.push('SPLITS_OVERCLAIM_ACTIVITY_CLOCK');
    }
  } else if (input.splitsDropped === true && input.splitsReconciliation != null) {
    // The stored reconciliation records a delta, but with the splits gone we
    // cannot know how much of the distance they covered — so we cannot tell an
    // interruption from a legitimate un-split tail. Rule 11: refuse, do not
    // guess in either direction.
    reasons.push('SPLITS_DROPPED_SO_COVERAGE_UNKNOWN');
  }

  // ── per-split lane ─────────────────────────────────────────────────────
  const interruptedSplitIndices = splits.length > 0 ? detectInterruptedSplits(splits) : [];
  if (splits.length > 0) {
    reasons.push(
      interruptedSplitIndices.length > 0
        ? 'INTERRUPTION_SHAPED_SPLITS_DETECTED'
        : 'NO_INTERRUPTION_SHAPED_SPLITS_AT_THIS_GRANULARITY',
    );
  }

  const grain: ContinuityGrain =
    analysable.length > 0 ? 'per_split' : unaccountedSec != null ? 'whole_activity' : 'none';

  if (grain === 'none') {
    reasons.push('NO_CONTINUITY_SIGNAL_AVAILABLE');
    return {
      grain, grade: 'unknown',
      // An activity with no continuity signal is not assumed continuous —
      // that would be the "measured zero" collapse — and not assumed broken.
      // A neutral 0.6 says "we cannot confirm this". CONVENTION.
      weight: 0.6,
      unaccountedSec: null, unaccountedFraction: null,
      interruptedSplitIndices: [], reasons,
    };
  }

  const unaccountedFraction =
    unaccountedSec != null && clockBasis != null && clockBasis > 0 ? unaccountedSec / clockBasis : null;

  const flaggedShare = analysable.length > 0 ? interruptedSplitIndices.length / analysable.length : 0;
  const clockPenalty =
    unaccountedFraction != null ? clamp01(unaccountedFraction / CONTINUITY_UNUSABLE_FRACTION) : 0;
  const weight = clamp01(1 - Math.max(clockPenalty, flaggedShare));

  const effectiveFraction = Math.max(unaccountedFraction ?? 0, flaggedShare);
  let grade: ContinuityRead['grade'];
  if (unaccountedFraction == null && analysable.length === 0) grade = 'unknown';
  else if (effectiveFraction <= CONTINUITY_HIGH_MAX_FRACTION) grade = 'high';
  else if (effectiveFraction <= CONTINUITY_MODERATE_MAX_FRACTION) grade = 'moderate';
  else grade = 'low';

  return { grain, grade, weight, unaccountedSec, unaccountedFraction, interruptedSplitIndices, reasons };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · ENVIRONMENTAL CONTEXT (Enforcement §18 · supporting layer)
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Pure · the conditions, read as an interpretation modifier and nothing else.
 *
 * Reuses `heatEffort` — THE heat calculation in this app, Research/06 §§1/2/12,
 * continuous in temperature and dewpoint. Three deliberate posture choices:
 *
 * 1 · SKY UNKNOWN IS NOT FULL SUN. `heat-model.ts#solarEffectiveBumpF` already
 *     defaults to overcast and says why: `heat-gate.ts` assumes full sun
 *     because its failure mode is a runner doing intervals at black-flag WBGT,
 *     whereas pricing should not invent a penalty from a field nobody filled
 *     in. For EVIDENCE the same logic points the same way and harder — an
 *     invented solar bump manufactures an EXCUSE for an HR reading, crediting
 *     the conditions with cost the runner may have paid himself.
 *     Under-crediting heat makes this layer read a warm run as slightly more
 *     meaningful than it was; over-crediting it makes the layer unable to ever
 *     see a real problem. The first error is recoverable.
 *
 * 2 · NO CLIFF AT 77°F. `HEAT_HR_CONFOUNDER.thresholdF` is a step, and the
 *     easy-run fixture sat at 76.2°F — eight tenths of a degree below it —
 *     while Research/06 §11 independently says the dewpoint table applies
 *     "whenever (Tair + Td) > 110°F or Td > 60°F", which those exact
 *     conditions satisfy twice over. A step there would report "no heat" about
 *     a morning doctrine explicitly calls adjustment-worthy. The confound
 *     weight is derived from the CONTINUOUS slowdown percentage instead.
 *
 * 3 · NO VDOT. The ability tier is always the honest population default; see
 *     the file header on circularity.
 */
export function readEnvironment(input: {
  tempF?: number | null;
  humidityPct?: number | null;
  dewpointF?: number | null;
  cloudCoverPct?: number | null;
  conditions?: string | null;
  indoor?: boolean | null;
  /** How long the runner was IN these conditions, seconds — already
   *  reconciled by the caller (`runFacts`) and already narrowed by
   *  `usableMeasurement`, never a raw `runs.data` clock key. Named
   *  `effortSec` rather than `activeSec` so it reads as the exposure window
   *  it is. */
  effortSec?: number | null;
}): EnvironmentalContext {
  const reasons: EnvReasonCode[] = [];

  if (input.indoor === true) {
    reasons.push('INDOOR_ACTIVITY');
    return {
      tempF: null, humidityPct: null, dewpointF: null, slowdownPct: null,
      load: 'unknown', hrConfoundWeight: 0, hrCostPlausiblyElevated: false, reasons,
    };
  }

  const tempF = input.tempF != null && Number.isFinite(input.tempF) ? input.tempF : null;
  if (tempF == null) {
    reasons.push('NO_WEATHER_RECORDED');
    return {
      tempF: null, humidityPct: input.humidityPct ?? null, dewpointF: null, slowdownPct: null,
      // Rule 11: no weather recorded is NOT benign weather.
      load: 'unknown', hrConfoundWeight: 0, hrCostPlausiblyElevated: false, reasons,
    };
  }

  const humidityPct =
    input.humidityPct != null && Number.isFinite(input.humidityPct) ? input.humidityPct : null;
  let dewpointF = input.dewpointF != null && Number.isFinite(input.dewpointF) ? input.dewpointF : null;
  if (dewpointF == null && humidityPct != null) {
    dewpointF = estimateDewpointF(tempF, humidityPct);
    reasons.push('DEWPOINT_ESTIMATED_FROM_HUMIDITY');
  }

  // A MISSING CLOCK IS NOT A ZERO-COST CLOCK, and it is not a full-marathon
  // one either. `heatEffort`'s `durationHeatScale` returns 1.0 when duration
  // is null, which charges the whole marathon-anchored Maughan penalty — so a
  // row with no usable clock would be handed the LARGEST heat number there is,
  // and this layer would then credit the conditions with cost the runner may
  // have paid himself. `lib/conservation/_reader_lint.test.ts` has a check for
  // exactly this shape and names the production damage it did elsewhere.
  // Rule 11: refuse.
  const effortSec = input.effortSec ?? null;
  if (effortSec == null) {
    reasons.push('NO_USABLE_CLOCK_FOR_HEAT_EXPOSURE');
    return {
      tempF, humidityPct, dewpointF, slowdownPct: null,
      load: 'unknown', hrConfoundWeight: 0, hrCostPlausiblyElevated: false, reasons,
    };
  }
  const effort = heatEffort({
    tempF, dewpointF, humidityPct,
    conditions: input.conditions ?? null,
    cloudCoverPct: input.cloudCoverPct ?? null,
    durationS: effortSec,
    // No `vdot`, no `tier` — the population default, on purpose.
  });
  const slowdownPct = effort?.slowdownPct ?? 0;
  const hrConfoundWeight = clamp01(slowdownPct / ENV_COST_SATURATION_PCT);

  let load: EnvironmentalLoad;
  if (slowdownPct <= 0) load = 'none';
  else if (slowdownPct <= ENV_COST_SATURATION_PCT * ENV_LOAD_LOW_MAX_FRAC) load = 'low';
  else if (slowdownPct <= ENV_COST_SATURATION_PCT * ENV_LOAD_MODERATE_MAX_FRAC) load = 'moderate';
  else if (slowdownPct <= ENV_COST_SATURATION_PCT * ENV_LOAD_HIGH_MAX_FRAC) load = 'high';
  else load = 'extreme';

  const hrCostPlausiblyElevated = load !== 'none' && load !== 'low';
  reasons.push(hrCostPlausiblyElevated ? 'CONDITIONS_MAKE_ELEVATED_HR_PLAUSIBLE' : 'CONDITIONS_BENIGN');

  return {
    tempF, humidityPct,
    dewpointF: effort?.dewpointF ?? dewpointF,
    slowdownPct, load, hrConfoundWeight, hrCostPlausiblyElevated, reasons,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · STAGE 1 · ELIGIBILITY
 * ══════════════════════════════════════════════════════════════════════ */

/** Paces outside which an activity's stated numbers are not a run. CONVENTION
 *  — 2:00/mi is faster than any human has covered a mile and 30:00/mi is
 *  slower than walking, so anything outside is a distance or clock error. */
const IMPLAUSIBLE_PACE_FAST_SEC = 120;
const IMPLAUSIBLE_PACE_SLOW_SEC = 1800;

/** Heart rates outside which the sensor is not reporting a human at exercise.
 *  CONVENTION. Used only to REJECT, never to correct. */
const IMPLAUSIBLE_HR_LOW = 25;
const IMPLAUSIBLE_HR_HIGH = 235;

/** Below this an activity is too short for any physiological inference —
 *  Brief 02's "insufficient duration". CONVENTION, set well under Research/03
 *  §2's 30-minute drift scope so a genuine short shakeout is
 *  admissible-but-uninformative rather than rejected. */
const MIN_INFERENCE_DURATION_SEC = 300;

/** Pure · Stage 1. Per-signal grading plus a whole-activity admissibility
 *  verdict. */
export function assessEligibility(activity: RawActivityInput): EligibilityResult {
  const rejections: EligibilityRejectionCode[] = [];
  const signalReasons: SignalReasonCode[] = [];
  const signals: Record<SignalName, SignalQuality> = {
    distance: 'absent', duration: 'absent', pace: 'absent',
    hr: 'absent', power: 'absent', dynamics: 'absent',
  };

  const distanceMi = usableMeasurement(activity.distanceMi);
  const activeSec = usableMeasurement(activity.activeSec);

  if (distanceMi == null) rejections.push('NO_USABLE_DISTANCE');
  else signals.distance = 'high';
  if (activeSec == null) rejections.push('NO_USABLE_DURATION');
  else signals.duration = 'high';
  if (activeSec != null && activeSec < MIN_INFERENCE_DURATION_SEC) {
    rejections.push('DURATION_BELOW_ANY_INFERENCE_FLOOR');
  }

  const rawSplits = activity.splits ?? [];
  const splitsDropped = rawSplits.length === 0 && activity.splitsReconciliation != null;
  const splitsUsable = activity.splitsUnreliable === true ? [] : rawSplits;
  if (splitsDropped) signalReasons.push('SPLITS_DROPPED_AT_INGEST');
  const analysable = analysableSplits(splitsUsable);

  const continuity = readContinuity({
    activeSec,
    elapsedSec: activity.elapsedSec ?? null,
    distanceMi,
    splits: splitsUsable,
    splitsReconciliation: activity.splitsReconciliation ?? null,
    splitsDropped,
  });

  // ── PACE ────────────────────────────────────────────────────────────────
  if (distanceMi != null && activeSec != null) {
    const paceSec = activeSec / distanceMi;
    if (paceSec < IMPLAUSIBLE_PACE_FAST_SEC || paceSec > IMPLAUSIBLE_PACE_SLOW_SEC) {
      rejections.push('IMPLAUSIBLE_PACE');
      signals.pace = 'unusable';
    } else if (analysable.length >= 3) {
      const cv = coefficientOfVariation(analysable.map((s) => s.paceSecPerMi));
      const grade = stabilityOf(cv, PACE_STABILITY_HIGH_CV, PACE_STABILITY_MODERATE_CV);
      // A structured run's split-to-split spread is DESIGNED, not a defect, so
      // spread never downgrades pace below `moderate_high`: the instrument is
      // reading correctly either way. Stability is reported separately, on
      // `ExternalOutputRead`, where it belongs.
      signals.pace = grade === 'high' ? 'high' : 'moderate_high';
      signalReasons.push('PACE_STABILITY_CONFIRMED_BY_SPLITS');
    } else {
      // Plausible, but stability cannot be checked. Rule 11: a different fact
      // from "stable", and it must not be graded as if the check had passed.
      signals.pace = 'moderate';
      signalReasons.push('PACE_STABILITY_UNVERIFIABLE_WITHOUT_SPLITS');
    }
  }

  // ── DO THE SPLITS ACTUALLY DECOMPOSE THIS RUN? ─────────────────────────
  //
  // Two members of one arithmetic family, reconciled rather than read side by
  // side (`scripts/check-derived-consistency.sh`, family
  // `splits.total-vs-distance`). The failure this prevents is real and named
  // in `splits-adopt.ts`'s own header: a production row whose splits summed to
  // 12.0 mi against a stated 1.00 mi. Handing that array to the segment lane
  // would produce a completely fabricated structure for the run.
  //
  // TIME first — `splitTimesReliable` is the ONE definition of whether split
  // TIMES reconcile with the clock (Rule 16), reused rather than restated.
  if (analysable.length > 0 && activeSec != null && distanceMi != null) {
    const sum = splitsSumSeconds(
      analysable.map((s) => ({ paceSecPerMi: s.paceSecPerMi, distanceMi: s.distanceMi })),
    );
    if (!splitTimesReliable(sum, activeSec, distanceMi)) rejections.push('SPLITS_CONTRADICT_ACTIVITY');
  }
  // DISTANCE second, through the shared reconciler — with one documented
  // departure from its verdict.
  //
  // `reconcileSplitsTotal` refuses at a SYMMETRIC quarter-mile drift, which is
  // right for the whole-array mismatch it was written for and wrong for the
  // ordinary un-split tail: `deriveSplitsFromPaceSamples` only emits a split
  // on a whole-mile crossing, so a 13.49-mile run yields 13 splits covering
  // 13.0 miles and falls 0.49 short BY CONSTRUCTION. That is exactly the
  // asymmetry `lib/runs/split-coverage.ts` already established for the TIME
  // member of this same family — over-claim is impossible, shortfall up to one
  // unit is expected — and it is applied here to the distance member so the
  // two halves of one family are not judged by two different shapes.
  //
  // An honest finding rather than a workaround: `reconcileSplitsTotal`'s
  // symmetric tolerance is the same defect one member over, and is reported
  // rather than fixed here because it is a deployed reader with its own
  // callers.
  if (analysable.length > 0 && distanceMi != null) {
    const coherent = reconcileSplitsTotal({ splits: analysable } as unknown as RunData, distanceMi);
    if (coherent === false) {
      const coveredMi = analysable.reduce((acc, r) => acc + r.distanceMi, 0);
      const meanSplitMi = coveredMi / analysable.length;
      const overclaims = coveredMi - distanceMi > MAX_SPLIT_SUM_DRIFT_MI;
      const shortByMoreThanOneSplit = distanceMi - coveredMi > meanSplitMi * 1.1;
      if (overclaims || shortByMoreThanOneSplit) rejections.push('SPLITS_CONTRADICT_ACTIVITY');
    }
  }

  // ── HEART RATE ──────────────────────────────────────────────────────────
  const avgHr = activity.avgHrBpm;
  const maxHr = activity.maxHrBpm;
  const hrPresent = avgHr != null && Number.isFinite(avgHr);
  if (!hrPresent) {
    signals.hr = 'absent';
    signalReasons.push('HR_CURVE_ABSENT');
  } else if (
    (avgHr as number) < IMPLAUSIBLE_HR_LOW || (avgHr as number) > IMPLAUSIBLE_HR_HIGH ||
    (maxHr != null && Number.isFinite(maxHr) &&
      (maxHr < IMPLAUSIBLE_HR_LOW || maxHr > IMPLAUSIBLE_HR_HIGH || maxHr < (avgHr as number)))
  ) {
    // A max below the average, or either outside human range, is a sensor
    // contradicting itself — not noise, a fault.
    rejections.push('HR_SENSOR_IMPLAUSIBLE');
    signals.hr = 'unusable';
  } else {
    const hrSplits = analysable.filter((s) => s.hrBpm != null);
    if (hrSplits.length >= 3) {
      // A curve exists. Discontinuity is what downgrades it: the spikes are
      // pauses, not physiology, so the SIGNAL is fine and its
      // INTERPRETABILITY is what suffered.
      if (continuity.interruptedSplitIndices.length > 0) {
        signals.hr = 'moderate_high';
        signalReasons.push('HR_DOWNGRADED_BY_INTERRUPTION_SHAPED_SPLITS');
      } else if (continuity.grade === 'moderate') {
        signals.hr = 'moderate_high';
        signalReasons.push('HR_DOWNGRADED_BY_DISCONTINUITY');
      } else if (continuity.grade === 'low') {
        signals.hr = 'moderate';
        signalReasons.push('HR_DOWNGRADED_BY_DISCONTINUITY');
      } else {
        signals.hr = 'high';
      }
    } else {
      // One number for the whole activity. Real, but it cannot answer any
      // question about how cost changed WITHIN the run.
      signals.hr = 'moderate';
      signalReasons.push('HR_CURVE_ABSENT');
    }
  }

  // ── POWER ───────────────────────────────────────────────────────────────
  const powerSplits = analysable.filter((s) => s.powerW != null && Number.isFinite(s.powerW));
  if (activity.avgPowerW == null || !Number.isFinite(activity.avgPowerW)) {
    signals.power = 'absent';
    signalReasons.push('NO_POWER_RECORDED');
  } else if (powerSplits.length >= 3) {
    const cv = coefficientOfVariation(powerSplits.map((s) => s.powerW as number));
    const grade = stabilityOf(cv, POWER_STABILITY_HIGH_CV, POWER_STABILITY_MODERATE_CV);
    signals.power = grade === 'high' ? 'high' : 'moderate_high';
    signalReasons.push('POWER_STABILITY_CONFIRMED_BY_SPLITS');
  } else {
    signals.power = 'moderate';
    signalReasons.push('POWER_STABILITY_UNVERIFIABLE_WITHOUT_SPLITS');
  }

  // ── DYNAMICS ────────────────────────────────────────────────────────────
  if (
    activity.avgCadenceSpm != null || activity.groundContactMs != null ||
    activity.verticalOscillationCm != null || activity.strideLengthM != null
  ) {
    signals.dynamics = 'moderate';
    signalReasons.push('DYNAMICS_PRESENT_NOT_SURFACED');
  }

  // ── ADMISSIBILITY ───────────────────────────────────────────────────────
  // Only the pathological rejections make the whole activity inadmissible.
  // `SPLITS_CONTRADICT_ACTIVITY` does not: it condemns the splits array, and
  // the activity remains good evidence at whole-activity level.
  const FATAL: ReadonlySet<EligibilityRejectionCode> = new Set([
    'NO_USABLE_DISTANCE', 'NO_USABLE_DURATION', 'IMPLAUSIBLE_PACE',
    'HR_SENSOR_IMPLAUSIBLE', 'DURATION_BELOW_ANY_INFERENCE_FLOOR',
  ]);
  const admissible = !rejections.some((r) => FATAL.has(r));

  return { admissible, signals, signalReasons, continuity, rejections };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · SEGMENTATION — inferring structure without a label
 *
 * The structured-long-run reference case Part 1's pipeline, in order:
 *
 *     RAW RUN → remove pauses / bad samples → detect meaningful intensity
 *     changes → group sustained segments → identify work/recovery pattern
 *     → classify likely physiological intensity → extract evidence
 *
 * TWO SIGNALS MUST AGREE before a stretch is promoted to quality. Pace says
 * what the runner DID; heart rate says whether the body treated it as
 * different. Requiring both is what "physiological support where available"
 * means, and it is the clause that keeps a downhill mile, a tailwind, or a
 * GPS wobble from becoming an interval.
 *
 * The baseline both are measured against is the ACTIVITY'S OWN, not a
 * prescribed easy pace and not a fitness belief: the median of the slower half
 * of its splits. That keeps segmentation independent of everything this layer
 * must not consume, and makes it work identically for a runner whose easy pace
 * is 6:30 and one whose easy pace is 11:00.
 *
 * RECOVERY IS STRUCTURAL, NOT NUMERIC. A non-quality stretch is recovery when
 * it SITS BETWEEN two quality blocks and its heart rate actually dropped. That
 * is a discrete fact about shape, so no threshold on a continuous quantity
 * decides it and there is no cliff to smooth (Rule 9). On the 2026-08-30
 * fixture mile 6 is 8:38/mi — only 2.6% slower than the run's baseline, which
 * any percentage rule would have had to hair-split — and it is unambiguously
 * recovery because of where it sits.
 * ══════════════════════════════════════════════════════════════════════ */

/** Friel 7-zone index → segment classification. Zone 5a (100-102% LTHR) is
 *  still threshold work; only 5b (>=103%, Friel's own VO2 edge) and above are
 *  high intensity. That distinction is why the 2026-08-30 long run's blocks,
 *  which top out at LTHR exactly, produce threshold evidence and NOT
 *  high-intensity evidence. */
function classificationForZone(idx: number | null): SegmentClassification {
  if (idx == null) return 'unknown';
  if (idx <= 1) return 'recovery';
  if (idx === 2) return 'easy_aerobic';
  if (idx === 3) return 'steady_aerobic';
  if (idx <= 5) return 'threshold_like';
  return 'high_intensity';
}

/** Friel 7-zone index → whole-activity execution character. Same table, so the
 *  two never disagree (Rule 16). */
function executionForZone(idx: number | null): ObservedExecution {
  if (idx == null) return 'INDETERMINATE';
  if (idx <= 1) return 'RECOVERY';
  if (idx === 2) return 'EASY';
  if (idx === 3) return 'AEROBIC_STEADY';
  if (idx <= 5) return 'THRESHOLD';
  return 'HIGH_INTENSITY';
}

/** One step down the intensity ladder — used when heart rate says threshold
 *  but external output is sitting at the run's own easy baseline. */
function downgradeOneStep(c: SegmentClassification): SegmentClassification {
  switch (c) {
    case 'high_intensity': return 'threshold_like';
    case 'threshold_like': return 'steady_aerobic';
    case 'steady_aerobic': return 'easy_aerobic';
    default: return c;
  }
}

export interface SegmentationResult {
  segments: ObservedSegment[];
  easyPaceBaselineSecPerMi: number | null;
  /** Mean HR of the OPENING easy segment — the reference the residual-load
   *  read compares the closing stretch against. */
  openingEasyHrBpm: number | null;
  openingEasyPaceSecPerMi: number | null;
}

/**
 * Pure · segment one activity from its splits.
 *
 * Returns a single segment for a genuinely continuous run (the easy-run
 * fixture), and several for a structured one (the long-run fixture). Both are
 * correct outputs; `structured` on the result is simply `segments.length > 1`.
 */
export function segmentActivity(input: {
  splits: readonly EvidenceSplit[];
  interruptedSplitIndices?: readonly number[];
  /** The runner's Friel 7-zone table, or null without a usable LTHR. HANDED
   *  IN rather than derived: `classifyActivityEvidence` already builds it, and
   *  two copies of one derivation is two chances to disagree (Rule 16). */
  zoneTable: ZoneTable | null;
  hasPerSplitPower: boolean;
}): SegmentationResult {
  const interrupted = new Set(input.interruptedSplitIndices ?? []);
  const usable = analysableSplits(input.splits).filter((s) => !interrupted.has(s.index));
  if (usable.length === 0) {
    return { segments: [], easyPaceBaselineSecPerMi: null, openingEasyHrBpm: null, openingEasyPaceSecPerMi: null };
  }

  const zoneTable = input.zoneTable;

  // ── the activity's OWN easy baseline: median of its slower half ─────────
  const paces = usable.map((s) => s.paceSecPerMi).sort((a, b) => b - a); // slowest first
  const slowerHalf = paces.slice(0, Math.max(1, Math.ceil(paces.length / 2)));
  const easyPaceBaselineSecPerMi = median(slowerHalf);

  // ── pass 1 · pace lift ─────────────────────────────────────────────────
  const paceThreshold = easyPaceBaselineSecPerMi * (1 - QUALITY_PACE_LIFT_FRAC);
  const paceFast = usable.map((s) => s.paceSecPerMi <= paceThreshold);

  // ── pass 2 · HR corroboration against the NON-fast stretches ────────────
  const baseHrs = usable.filter((s, i) => !paceFast[i] && s.hrBpm != null).map((s) => s.hrBpm as number);
  const hrBaseline = meanOrNull(baseHrs);
  const isQuality = usable.map((s, i) => {
    if (!paceFast[i]) return false;
    if (s.hrBpm == null || hrBaseline == null) return false; // no corroboration available
    return (s.hrBpm as number) >= hrBaseline + MEANINGFUL_HR_SEPARATION_BPM;
  });

  // ── group consecutive runs of the same quality flag ─────────────────────
  type Group = { splits: EvidenceSplit[]; quality: boolean; hrCorroborationFailed: boolean };
  const groups: Group[] = [];
  for (let i = 0; i < usable.length; i++) {
    const q = isQuality[i];
    const failed = paceFast[i] && !isQuality[i];
    const last = groups[groups.length - 1];
    if (last && last.quality === q) {
      last.splits.push(usable[i]);
      last.hrCorroborationFailed = last.hrCorroborationFailed || failed;
    } else {
      groups.push({ splits: [usable[i]], quality: q, hrCorroborationFailed: failed });
    }
  }

  // ── build segments ─────────────────────────────────────────────────────
  const segments: ObservedSegment[] = [];
  let cursorSec = 0;
  groups.forEach((g, gi) => {
    const spanSec = g.splits.reduce((s, r) => s + splitSeconds(r), 0);
    const distanceMi = g.splits.reduce((s, r) => s + r.distanceMi, 0);
    const meanPaceSecPerMi = distanceMi > 0 ? spanSec / distanceMi : 0;
    const hrs = g.splits.filter((s) => s.hrBpm != null).map((s) => s.hrBpm as number);
    const meanHrBpm = meanOrNull(hrs);
    const powers = g.splits.filter((s) => s.powerW != null).map((s) => s.powerW as number);
    const meanPowerW = meanOrNull(powers);
    const hrZoneIdx = meanHrBpm != null && zoneTable ? zoneIdxForBpm(meanHrBpm, zoneTable) : null;
    const accumulatedMinutesBefore = cursorSec / 60;
    const startSec = cursorSec;
    cursorSec += spanSec;

    const reasons: SegmentReasonCode[] = [];
    const classification = classificationForZone(hrZoneIdx);

    if (g.quality) {
      reasons.push('PACE_LIFT_CORROBORATED_BY_HR');
    } else if (g.hrCorroborationFailed) {
      reasons.push('PACE_LIFT_NOT_CORROBORATED_BY_HR');
    }

    if (accumulatedMinutesBefore >= DRIFT_SCOPE_MIN_MINUTES) reasons.push('UNDER_ACCUMULATED_LOAD');
    if (spanSec / 60 < SEGMENT_MIN_MINUTES) reasons.push('BELOW_SEGMENT_MIN_DURATION');
    if (!input.hasPerSplitPower) reasons.push('NO_POWER_RECORDED_FOR_THIS_ACTIVITY');

    // Segment confidence · every factor continuous, none of them a gate.
    const internalPaceCv = coefficientOfVariation(g.splits.map((s) => s.paceSecPerMi)) ?? 0;
    const stabilityCredit = clamp01(1 - internalPaceCv / PACE_STABILITY_MODERATE_CV / 2);
    const durationCredit = clamp01((spanSec / 60) / SEGMENT_MIN_MINUTES);
    const hrCredit = meanHrBpm != null ? 1 : 0.5;
    const separationCredit = g.quality
      ? clamp01(Math.abs(easyPaceBaselineSecPerMi - meanPaceSecPerMi) /
          (easyPaceBaselineSecPerMi * QUALITY_PACE_LIFT_FRAC * 2))
      : 1;
    const confidence = geometricMean([stabilityCredit, durationCredit, hrCredit, separationCredit]);

    segments.push({
      index: gi + 1,
      splitIndices: g.splits.map((s) => s.index),
      startSec: Math.round(startSec),
      endSec: Math.round(cursorSec),
      spanSec: Math.round(spanSec),
      distanceMi,
      meanPaceSecPerMi: Math.round(meanPaceSecPerMi),
      meanHrBpm: meanHrBpm != null ? roundTo(meanHrBpm, 1) : null,
      meanPowerW: meanPowerW != null ? roundTo(meanPowerW, 1) : null,
      hrZoneIdx,
      relativeIntensity: roundTo(easyPaceBaselineSecPerMi / meanPaceSecPerMi, 4),
      classification,
      confidence: roundTo(confidence, 4),
      accumulatedMinutesBefore: roundTo(accumulatedMinutesBefore, 1),
      underAccumulatedLoad: accumulatedMinutesBefore >= DRIFT_SCOPE_MIN_MINUTES,
      reasons,
    });
  });

  // ── post-pass · output at the easy baseline despite a working heart rate ─
  //
  // A stretch running at the activity's own easy baseline while heart rate
  // sits in a working zone is NOT threshold work: the runner is not producing
  // threshold output, and classifying it as such would read physiology they
  // did not generate. That is the 2026-08-30 long run's closing three miles
  // (8:21-8:30/mi at HR 161-168).
  //
  // GUARDED ON THE ACTIVITY CONTAINING QUALITY AT ALL, and the guard is
  // load-bearing rather than defensive. On a run with ONE segment the easy
  // baseline IS that segment's own pace, so an unguarded rule downgrades every
  // continuous tempo — a genuine forty-minute threshold session would have
  // been reclassified `steady_aerobic` and produced no threshold evidence at
  // all. The comparison only means something when some OTHER stretch of the
  // same run established what easy looked like that day.
  const activityHasQuality = groups.some((g) => g.quality);
  if (activityHasQuality) {
    for (const seg of segments) {
      const isQualitySeg =
        seg.classification === 'threshold_like' || seg.classification === 'high_intensity';
      const atEasyBaseline =
        seg.meanPaceSecPerMi >= easyPaceBaselineSecPerMi * (1 - QUALITY_PACE_LIFT_FRAC);
      const wasPromoted = seg.reasons.includes('PACE_LIFT_CORROBORATED_BY_HR');
      if (!isQualitySeg || wasPromoted || !atEasyBaseline) continue;
      seg.classification = downgradeOneStep(seg.classification);
      seg.reasons.push('OUTPUT_AT_EASY_BASELINE_DESPITE_ELEVATED_HR');
    }
  }

  // ── recovery is STRUCTURAL: a non-quality segment flanked by quality ────
  for (let i = 1; i < segments.length - 1; i++) {
    const prev = segments[i - 1];
    const seg = segments[i];
    const next = segments[i + 1];
    const flanked =
      prev.classification === 'threshold_like' || prev.classification === 'high_intensity';
    const followed =
      next.classification === 'threshold_like' || next.classification === 'high_intensity';
    if (!flanked || !followed) continue;
    if (seg.classification === 'threshold_like' || seg.classification === 'high_intensity') continue;
    const dropped =
      seg.meanHrBpm != null && prev.meanHrBpm != null &&
      prev.meanHrBpm - seg.meanHrBpm >= MEANINGFUL_HR_SEPARATION_BPM;
    if (!dropped) continue;
    seg.classification = 'recovery';
    seg.reasons.push('SITS_BETWEEN_QUALITY_BLOCKS');
  }

  const opening = segments[0] ?? null;
  const openingEasy =
    opening && (opening.classification === 'easy_aerobic' || opening.classification === 'recovery')
      ? opening : null;

  // ── residual cardiovascular load into the close ─────────────────────────
  const closing = segments[segments.length - 1] ?? null;
  if (
    closing && openingEasy && closing !== openingEasy &&
    closing.meanHrBpm != null && openingEasy.meanHrBpm != null &&
    closing.meanHrBpm - openingEasy.meanHrBpm >= MEANINGFUL_HR_SEPARATION_BPM
  ) {
    closing.reasons.push('RESIDUAL_HR_ABOVE_OPENING_EASY');
  }

  return {
    segments,
    easyPaceBaselineSecPerMi: Math.round(easyPaceBaselineSecPerMi),
    openingEasyHrBpm: openingEasy?.meanHrBpm ?? null,
    openingEasyPaceSecPerMi: openingEasy?.meanPaceSecPerMi ?? null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · INTERNAL COST (cardiovascular drift) — continuous activities only
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Pure · did the cardiovascular cost of holding the same external output rise?
 *
 * NOT `computeAerobicDecoupling`, and the difference is doctrine, not
 * convenience. That function implements Research/03 §12's PROTOCOL — a steady
 * aerobic run of 60-90 minutes — and its 5/8/10 verdict bands describe runs of
 * that length. Applying them to a 52-minute interrupted easy run in the heat
 * is quoting a table outside its own scope, and the easy-run reference case §8
 * forbids it by name: "Do NOT apply `decoupling > 5% → durability problem`."
 *
 * What this reads instead is Research/03 §2's confounder row — "Cardiac drift
 * (>30 min steady) | Rises | +5–15% over 60 min" — which scopes the
 * observation at 30 minutes and states the NORMAL expected magnitude. So the
 * output says how large the rise was per 60 minutes, and whether that sits
 * inside doctrine's own normal band. A rise inside the band is the
 * physiological response working, not a finding about the runner.
 */
export function readInternalCost(input: {
  splits?: readonly EvidenceSplit[] | null;
  interruptedSplitIndices?: readonly number[];
  structured: boolean;
  continuityWeight: number;
  continuityGrade: ContinuityRead['grade'];
  hrSignalQuality: SignalQuality;
  hrConfoundWeight: number;
}): InternalCostRead {
  if (input.structured) return { ok: false, reason: 'activity_is_structured' };
  if (input.continuityGrade === 'low') return { ok: false, reason: 'continuity_unusable' };

  const interrupted = new Set(input.interruptedSplitIndices ?? []);
  const all = analysableSplits(input.splits ?? []);
  const splitsExcludedFragment = (input.splits ?? []).length - all.length;
  const withHr = all.filter((s) => s.hrBpm != null && Number.isFinite(s.hrBpm));
  if (withHr.length < 4) return { ok: false, reason: 'no_hr_curve' };

  const notInterrupted = withHr.filter((s) => !interrupted.has(s.index));
  const splitsExcludedInterruption = withHr.length - notInterrupted.length;

  // Opening settling window (easy-run reference case §24 item 2).
  const settled: EvidenceSplit[] = [];
  let cumulativeSec = 0;
  for (const s of notInterrupted) {
    cumulativeSec += splitSeconds(s);
    if (cumulativeSec <= HR_SETTLING_MINUTES * 60) continue;
    settled.push(s);
  }
  const splitsExcludedSettling = notInterrupted.length - settled.length;
  if (settled.length < 4) return { ok: false, reason: 'insufficient_analysable_splits' };

  const analysedSec = settled.reduce((s, r) => s + splitSeconds(r), 0);
  const analysedMinutes = analysedSec / 60;
  if (analysedMinutes < DRIFT_SCOPE_MIN_MINUTES) return { ok: false, reason: 'below_drift_scope' };

  const mid = Math.ceil(settled.length / 2);
  const h1 = settled.slice(0, mid);
  const h2 = settled.slice(mid);
  const firstHalfHr = mean(h1.map((s) => s.hrBpm as number));
  const secondHalfHr = mean(h2.map((s) => s.hrBpm as number));
  const firstHalfPaceSec = mean(h1.map((s) => s.paceSecPerMi));
  const secondHalfPaceSec = mean(h2.map((s) => s.paceSecPerMi));

  // The claim this read makes is about cost at CONSTANT external output. If
  // the runner varied effort, the claim is not available — the correct answer
  // is a refusal, not a number with a caveat.
  if (Math.abs(secondHalfPaceSec - firstHalfPaceSec) > OUTPUT_CHANGE_EXPLAINS_HR_SEC_PER_MI) {
    return { ok: false, reason: 'external_output_not_steady' };
  }
  if (!(firstHalfHr > 0)) return { ok: false, reason: 'no_hr_curve' };

  const risePct = ((secondHalfHr - firstHalfHr) / firstHalfHr) * 100;
  const risePctPer60Min = risePct * (60 / analysedMinutes);
  const [normalLo, normalHi] = DRIFT_NORMAL_BAND_PCT_PER_60MIN;
  const withinDoctrineNormalBand = risePctPer60Min >= normalLo && risePctPer60Min <= normalHi;
  const magnitude: DriftMagnitude =
    risePctPer60Min < normalLo ? 'minimal' : risePctPer60Min <= normalHi ? 'moderate' : 'large';

  // Confidence: the geometric mean of four independent quality factors, each
  // continuous. Duration credit ramps across Research/03's own scope — 30
  // minutes is where drift becomes readable, 60 where §12's protocol begins —
  // so a 52-minute run scores partial credit rather than passing a gate.
  const durationCredit = clamp01(
    (analysedMinutes - DRIFT_SCOPE_MIN_MINUTES) /
      (DECOUPLING_PROTOCOL_MIN_MINUTES - DRIFT_SCOPE_MIN_MINUTES),
  );
  const confidence = geometricMean([
    input.continuityWeight,
    durationCredit,
    1 - clamp01(input.hrConfoundWeight),
    SIGNAL_QUALITY_WEIGHT[input.hrSignalQuality],
  ]);

  return {
    ok: true,
    detected: risePct > 0,
    risePct: roundTo(risePct, 2),
    risePctPer60Min: roundTo(risePctPer60Min, 2),
    magnitude,
    withinDoctrineNormalBand,
    confidence: roundTo(confidence, 4),
    confidenceBand: confidenceBandOf(confidence),
    analysedMinutes: roundTo(analysedMinutes, 1),
    firstHalfHr: roundTo(firstHalfHr, 1),
    secondHalfHr: roundTo(secondHalfHr, 1),
    firstHalfPaceSec: Math.round(firstHalfPaceSec),
    secondHalfPaceSec: Math.round(secondHalfPaceSec),
    splitsAnalysed: settled.length,
    splitsExcludedSettling,
    splitsExcludedInterruption,
    splitsExcludedFragment,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · QUALITY UNDER ACCUMULATED LOAD — structured activities only
 * ══════════════════════════════════════════════════════════════════════ */

/** Pure · the sequence read the structured-long-run reference case Part 2
 *  item 3 requires: WHERE in the accumulated-duration timeline the quality
 *  happened, not just that it happened. */
export function readQualityUnderLoad(seg: SegmentationResult): QualityUnderLoadRead {
  const segments = seg.segments;
  if (segments.length <= 1) return { ok: false, reason: 'activity_not_structured' };
  const quality = segments.filter(
    (s) => s.classification === 'threshold_like' || s.classification === 'high_intensity',
  );
  if (quality.length === 0) return { ok: false, reason: 'no_quality_segments' };

  const totalQualitySec = quality.reduce((s, q) => s + q.spanSec, 0);
  const underLoadSec = quality.reduce((s, q) => {
    const loadStart = DRIFT_SCOPE_MIN_MINUTES * 60;
    const overlap = Math.max(0, q.endSec - Math.max(q.startSec, loadStart));
    return s + overlap;
  }, 0);
  if (underLoadSec <= 0) return { ok: false, reason: 'no_segments_under_accumulated_load' };

  const first = quality[0];
  const last = quality[quality.length - 1];
  const lateVsEarlyPaceRatio =
    quality.length >= 2 && first.meanPaceSecPerMi > 0
      ? roundTo(last.meanPaceSecPerMi / first.meanPaceSecPerMi, 4)
      : null;

  const opening = segments[0];
  const closing = segments[segments.length - 1];
  const closingVsOpeningPaceRatio =
    closing !== opening && opening.meanPaceSecPerMi > 0
      ? roundTo(closing.meanPaceSecPerMi / opening.meanPaceSecPerMi, 4)
      : null;
  const lateRunPacingCollapse =
    closingVsOpeningPaceRatio != null && closingVsOpeningPaceRatio > 1 + LATE_COLLAPSE_PACE_FRAC;

  const residualHrElevationBpm =
    closing !== opening && closing.meanHrBpm != null && seg.openingEasyHrBpm != null
      ? roundTo(closing.meanHrBpm - seg.openingEasyHrBpm, 1)
      : null;

  return {
    ok: true,
    qualityBlocks: quality.length,
    totalQualityMinutes: roundTo(totalQualitySec / 60, 1),
    qualityMinutesUnderLoad: roundTo(underLoadSec / 60, 1),
    latestBlockStartMinutes: last.accumulatedMinutesBefore,
    lateVsEarlyPaceRatio,
    closingVsOpeningPaceRatio,
    lateRunPacingCollapse,
    residualHrElevationBpm,
    residualCardiovascularLoad:
      residualHrElevationBpm != null && residualHrElevationBpm >= MEANINGFUL_HR_SEPARATION_BPM,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 11 · THE THIRD OUTCOME — belief tension
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Pure · does this activity sit in tension with a capacity belief it was
 * handed?
 *
 * TWO DIRECTIONS, deliberately, because Rule 22 is about gates that can only
 * fire one way:
 *
 *   · STRONGER THAN BELIEF · sustained threshold-like work, at least
 *     `THRESHOLD_MIN_SUSTAINED_MINUTES` of it, a meaningful part of it past
 *     `DRIFT_SCOPE_MIN_MINUTES` of accumulated running, whose aggregate pace
 *     is faster than the believed threshold pace or within
 *     `BELIEF_MATCH_MARGIN_PCT` of it. The reasoning is stated rather than
 *     assumed: a threshold pace is by definition what a runner holds FRESH.
 *     MATCHING it deep inside a long run, without collapse, is not what a
 *     correct belief predicts — it is what a conservative one predicts.
 *
 *   · WEAKER THAN BELIEF · a graded effort (race, time trial, or a session the
 *     plan called threshold) run while FRESH, more than the margin slower than
 *     the belief. Same margin, opposite sign.
 *
 * Neither moves anything. `anchorEffect` is typed to a single literal that
 * cannot express an anchor move.
 */
export function readBeliefTension(input: {
  belief?: CurrentCapacityBelief | null;
  segments: readonly ObservedSegment[];
  plannedIntent: PlannedIntent | null;
  continuityWeight: number;
  hrSignalQuality: SignalQuality;
  hrConfoundWeight: number;
}): BeliefTensionRead {
  const believed = input.belief?.thresholdPaceSecPerMi;
  if (believed == null || !Number.isFinite(believed) || believed <= 0) {
    return { ok: false, reason: 'no_belief_supplied' };
  }

  const quality = input.segments.filter(
    (s) => s.classification === 'threshold_like' || s.classification === 'high_intensity',
  );
  const qualitySec = quality.reduce((s, q) => s + q.spanSec, 0);
  const qualityMi = quality.reduce((s, q) => s + q.distanceMi, 0);
  const observedPace = qualityMi > 0 ? qualitySec / qualityMi : null;
  const accumulatedBefore = quality.length > 0 ? quality[quality.length - 1].accumulatedMinutesBefore : 0;
  const underLoadSec = quality.reduce((s, q) => {
    const loadStart = DRIFT_SCOPE_MIN_MINUTES * 60;
    return s + Math.max(0, q.endSec - Math.max(q.startSec, loadStart));
  }, 0);

  const marginSec = believed * (BELIEF_MATCH_MARGIN_PCT / 100);

  // ── stronger-than-belief arm ────────────────────────────────────────────
  if (
    observedPace != null &&
    qualitySec / 60 >= THRESHOLD_MIN_SUSTAINED_MINUTES &&
    underLoadSec > 0 &&
    observedPace <= believed + marginSec
  ) {
    const magnitudeSecPerMi = roundTo(believed - observedPace, 1);
    const reasons: BeliefTensionReasonCode[] = [
      observedPace < believed
        ? 'SUSTAINED_WORK_FASTER_THAN_BELIEF'
        : 'SUSTAINED_WORK_MATCHED_BELIEF_UNDER_ACCUMULATED_LOAD',
      'NOT_CORROBORATED_BY_THIS_ACTIVITY_ALONE',
    ];
    const reexaminationWeight = geometricMean([
      input.continuityWeight,
      SIGNAL_QUALITY_WEIGHT[input.hrSignalQuality],
      clamp01(qualitySec / 60 / (THRESHOLD_MIN_SUSTAINED_MINUTES * 2)),
      clamp01(underLoadSec / qualitySec),
      1 - clamp01(input.hrConfoundWeight),
    ]);
    return {
      ok: true,
      capacity: 'threshold',
      code: 'CONTRADICTS_CURRENT_ESTIMATE',
      direction: 'observation_stronger_than_belief',
      believedPaceSecPerMi: Math.round(believed),
      observedPaceSecPerMi: Math.round(observedPace),
      magnitudeSecPerMi,
      magnitudePct: roundTo(((believed - observedPace) / believed) * 100, 2),
      observedMinutes: roundTo(qualitySec / 60, 1),
      accumulatedMinutesBefore: accumulatedBefore,
      beliefAsOf: input.belief?.asOf ?? null,
      anchorEffect: 'no_change_flag_for_reexamination',
      reexaminationWeight: roundTo(reexaminationWeight, 4),
      reasons,
    };
  }

  // ── weaker-than-belief arm ──────────────────────────────────────────────
  const graded =
    input.plannedIntent != null &&
    (input.plannedIntent === 'RACE' || input.plannedIntent === 'TIME_TRIAL' ||
      input.plannedIntent === 'THRESHOLD');
  // "While fresh" is about when the work BEGAN, not when it ended. A honest
  // 40-minute tempo started at minute zero necessarily runs past
  // `DRIFT_SCOPE_MIN_MINUTES`, so testing that none of it fell under
  // accumulated load would make this arm unreachable for exactly the sessions
  // it exists to judge — a gate that cannot fire (Rule 21).
  const startedFresh =
    quality.length > 0 && quality[0].accumulatedMinutesBefore < DRIFT_SCOPE_MIN_MINUTES;
  if (
    graded && observedPace != null &&
    qualitySec / 60 >= THRESHOLD_MIN_SUSTAINED_MINUTES &&
    startedFresh &&
    observedPace > believed + marginSec
  ) {
    const reexaminationWeight = geometricMean([
      input.continuityWeight,
      SIGNAL_QUALITY_WEIGHT[input.hrSignalQuality],
      clamp01(qualitySec / 60 / (THRESHOLD_MIN_SUSTAINED_MINUTES * 2)),
      1 - clamp01(input.hrConfoundWeight),
    ]);
    return {
      ok: true,
      capacity: 'threshold',
      code: 'CONTRADICTS_CURRENT_ESTIMATE',
      direction: 'observation_weaker_than_belief',
      believedPaceSecPerMi: Math.round(believed),
      observedPaceSecPerMi: Math.round(observedPace),
      magnitudeSecPerMi: roundTo(believed - observedPace, 1),
      magnitudePct: roundTo(((believed - observedPace) / believed) * 100, 2),
      observedMinutes: roundTo(qualitySec / 60, 1),
      accumulatedMinutesBefore: accumulatedBefore,
      beliefAsOf: input.belief?.asOf ?? null,
      anchorEffect: 'no_change_flag_for_reexamination',
      reexaminationWeight: roundTo(reexaminationWeight, 4),
      reasons: ['GRADED_EFFORT_SLOWER_THAN_BELIEF_WHILE_FRESH', 'NOT_CORROBORATED_BY_THIS_ACTIVITY_ALONE'],
    };
  }

  if (observedPace == null) return { ok: false, reason: 'no_comparable_observation' };
  return { ok: false, reason: 'observation_consistent_with_belief' };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 12 · THE CLASSIFIER
 * ══════════════════════════════════════════════════════════════════════ */

/** The execution character an intent WOULD produce if executed exactly. Used
 *  only to report divergence — never to relabel the workout. */
function intentAsExecution(intent: PlannedIntent): ObservedExecution {
  switch (intent) {
    case 'RECOVERY': return 'RECOVERY';
    case 'EASY':
    case 'LONG': return 'EASY';
    case 'STEADY': return 'AEROBIC_STEADY';
    case 'THRESHOLD': return 'THRESHOLD';
    case 'INTERVALS':
    case 'REPETITION': return 'HIGH_INTENSITY';
    case 'RACE':
    case 'TIME_TRIAL': return 'THRESHOLD';
    default: return 'INDETERMINATE';
  }
}

/**
 * Pure · the whole-activity execution character, for a CONTINUOUS activity.
 *
 * Excluding the opening settling window and any interrupted splits, which zone
 * did the running sit in at the start of the sustained portion and which at
 * the end? Same zone → that zone's character. Adjacent zones → the transition.
 * Further apart, or non-monotonic → MIXED.
 *
 * With no HR curve, only a whole-activity mean is available, and the honest
 * answer is the single zone that mean sits in — never a transition, because a
 * mean cannot show one.
 */
function classifyContinuousExecution(input: {
  splits: readonly EvidenceSplit[];
  interruptedSplitIndices: readonly number[];
  avgHrBpm: number | null;
  zoneTable: ZoneTable | null;
}): ObservedExecution {
  const { zoneTable } = input;
  if (!zoneTable) return 'INDETERMINATE';
  const interrupted = new Set(input.interruptedSplitIndices);
  const usable = analysableSplits(input.splits)
    .filter((s) => !interrupted.has(s.index))
    .filter((s) => s.hrBpm != null && Number.isFinite(s.hrBpm));

  const settled: EvidenceSplit[] = [];
  let cumulativeSec = 0;
  for (const s of usable) {
    cumulativeSec += splitSeconds(s);
    if (cumulativeSec <= HR_SETTLING_MINUTES * 60) continue;
    settled.push(s);
  }
  const analysed = settled.length >= 2 ? settled : usable;

  if (analysed.length >= 2) {
    const mid = Math.ceil(analysed.length / 2);
    const firstIdx = zoneIdxForBpm(mean(analysed.slice(0, mid).map((s) => s.hrBpm as number)), zoneTable);
    const lastIdx = zoneIdxForBpm(mean(analysed.slice(mid).map((s) => s.hrBpm as number)), zoneTable);
    if (firstIdx == null || lastIdx == null) return 'INDETERMINATE';
    if (firstIdx === lastIdx) return executionForZone(firstIdx);
    if (lastIdx === firstIdx + 1) {
      const from = executionForZone(firstIdx);
      const to = executionForZone(lastIdx);
      if (from === 'EASY' && to === 'AEROBIC_STEADY') return 'EASY_TO_AEROBIC_STEADY';
      if (from === 'AEROBIC_STEADY' && to === 'THRESHOLD') return 'STEADY_TO_THRESHOLD';
      return to;
    }
    return 'MIXED';
  }

  if (input.avgHrBpm != null && Number.isFinite(input.avgHrBpm)) {
    return executionForZone(zoneIdxForBpm(input.avgHrBpm, zoneTable));
  }
  return 'INDETERMINATE';
}

/**
 * THE ownership-layer entry point: what did this one completed activity
 * demonstrate?
 *
 * Pure. Every input is an argument; nothing is read from a database, a plan or
 * another activity. See the file header for the boundary this does not cross.
 */
export function classifyActivityEvidence(
  activity: RawActivityInput,
  context: ClassifyContext = {},
): ActivityEvidenceResult {
  const eligibility = assessEligibility(activity);
  const environment = readEnvironment({
    tempF: activity.tempF,
    humidityPct: activity.humidityPct,
    dewpointF: activity.dewpointF,
    cloudCoverPct: activity.cloudCoverPct,
    conditions: activity.conditions,
    indoor: activity.indoor,
    effortSec: activity.activeSec,
  });

  const plannedIntent = context.plannedWorkout?.intent ?? null;
  const subjective = context.subjectiveReport ?? null;
  const splits = activity.splitsUnreliable === true ? [] : (activity.splits ?? []);
  const lthrBpm = usableMeasurement(activity.lthrBpm);
  const zoneTable: ZoneTable | null = lthrBpm != null ? friel7Zones(lthrBpm) : null;

  const dynamics: RunningDynamicsRead = {
    cadenceSpm: activity.avgCadenceSpm ?? null,
    groundContactMs: activity.groundContactMs ?? null,
    verticalOscillationCm: activity.verticalOscillationCm ?? null,
    strideLengthM: activity.strideLengthM ?? null,
    surfaced: false,
    reason: 'insufficient_evidence_from_one_activity',
  };

  // ── INADMISSIBLE · every capacity is indeterminate, and says so ─────────
  if (!eligibility.admissible) {
    const ind = (capacity: CapacityName): CapacityEvidence => ({
      capacity, kind: 'indeterminate', reasons: ['ACTIVITY_INADMISSIBLE'],
    });
    return {
      modelVersion: ACTIVITY_EVIDENCE_MODEL_VERSION,
      activityId: activity.activityId,
      date: activity.date,
      eligibility, environment, plannedIntent,
      observedExecution: 'INDETERMINATE',
      executionDivergedFromIntent: false,
      executionQuality: 'indeterminate',
      structured: false,
      segments: [],
      easyPaceBaselineSecPerMi: null,
      externalOutput: {
        paceStability: 'unknown', paceCv: null,
        powerStability: 'unknown', powerCv: null, verdict: 'unknown',
      },
      internalCost: { ok: false, reason: 'no_hr_curve' },
      qualityUnderLoad: { ok: false, reason: 'activity_not_structured' },
      capacities: {
        high_intensity: ind('high_intensity'), threshold: ind('threshold'),
        durability: ind('durability'), easy_ceiling: ind('easy_ceiling'),
      },
      beliefTension: { ok: false, reason: 'no_comparable_observation' },
      ledger: [],
      trainingLoad: {
        stimulus: 'none', aerobicMinutes: null,
        distanceMi: activity.distanceMi ?? null,
        primaryValue: 'Not interpretable as training evidence.',
      },
      runningDynamics: dynamics,
      anchorMoveCandidate: false,
      anchorMoveReasons: ['ACTIVITY_INADMISSIBLE'],
      reasons: [
        ...eligibility.rejections, ...eligibility.signalReasons,
        ...eligibility.continuity.reasons, ...environment.reasons,
      ],
    };
  }

  // ── SEGMENTATION ────────────────────────────────────────────────────────
  const hasPerSplitPower = analysableSplits(splits).some((s) => s.powerW != null);
  const seg = segmentActivity({
    splits,
    interruptedSplitIndices: eligibility.continuity.interruptedSplitIndices,
    zoneTable,
    hasPerSplitPower,
  });
  const structured = seg.segments.length > 1;

  // ── EXECUTION ───────────────────────────────────────────────────────────
  const observedExecution: ObservedExecution = structured
    ? 'MIXED'
    : classifyContinuousExecution({
        splits,
        interruptedSplitIndices: eligibility.continuity.interruptedSplitIndices,
        avgHrBpm: activity.avgHrBpm,
        zoneTable,
      });

  // ── EXTERNAL OUTPUT ─────────────────────────────────────────────────────
  const analysed = analysableSplits(splits).filter(
    (s) => !eligibility.continuity.interruptedSplitIndices.includes(s.index),
  );
  const paceCv = analysed.length >= 3 ? coefficientOfVariation(analysed.map((s) => s.paceSecPerMi)) : null;
  const powerVals = analysed.filter((s) => s.powerW != null).map((s) => s.powerW as number);
  const powerCv = powerVals.length >= 3 ? coefficientOfVariation(powerVals) : null;
  const paceStability = stabilityOf(paceCv, PACE_STABILITY_HIGH_CV, PACE_STABILITY_MODERATE_CV);
  const powerStability = stabilityOf(powerCv, POWER_STABILITY_HIGH_CV, POWER_STABILITY_MODERATE_CV);
  const outputVerdict: ExternalOutputRead['verdict'] =
    paceStability === 'unknown' && powerStability === 'unknown'
      ? 'unknown'
      : (paceStability === 'high' || paceStability === 'moderate') && powerStability !== 'low'
        ? 'stable'
        : 'variable';
  const externalOutput: ExternalOutputRead = {
    paceStability, paceCv, powerStability, powerCv, verdict: outputVerdict,
  };

  // ── INTERNAL COST · continuous runs only ────────────────────────────────
  const internalCost = readInternalCost({
    splits,
    interruptedSplitIndices: eligibility.continuity.interruptedSplitIndices,
    structured,
    continuityWeight: eligibility.continuity.weight,
    continuityGrade: eligibility.continuity.grade,
    hrSignalQuality: eligibility.signals.hr,
    hrConfoundWeight: environment.hrConfoundWeight,
  });

  // ── QUALITY UNDER LOAD · structured runs only ───────────────────────────
  const qualityUnderLoad = readQualityUnderLoad(seg);

  // Execution quality asks "was this under control", which is a DIFFERENT
  // question from "was the output steady". A structured run's split-to-split
  // spread is designed, so `outputVerdict` is correctly `variable` and would be
  // the wrong input here. For a structured run the control question is whether
  // each block held together internally and the run did not fall apart late.
  const executionQuality: ExecutionQuality = structured
    ? qualityUnderLoad.ok
      ? qualityUnderLoad.lateRunPacingCollapse ? 'variable' : 'controlled'
      : 'indeterminate'
    : outputVerdict === 'unknown'
      ? 'indeterminate'
      : outputVerdict === 'stable' ? 'controlled' : 'variable';

  // ── CAPACITY EVIDENCE ───────────────────────────────────────────────────
  const capacities = resolveCapacityEvidence({
    activity, segments: seg.segments, structured, zoneTable,
    externalOutput, internalCost, qualityUnderLoad, environment,
    continuity: eligibility.continuity, plannedIntent,
    hrSignalQuality: eligibility.signals.hr,
  });

  // ── BELIEF TENSION ──────────────────────────────────────────────────────
  const beliefTension = readBeliefTension({
    belief: context.currentBelief,
    segments: seg.segments,
    plannedIntent,
    continuityWeight: eligibility.continuity.weight,
    hrSignalQuality: eligibility.signals.hr,
    hrConfoundWeight: environment.hrConfoundWeight,
  });

  // ── LEDGER ──────────────────────────────────────────────────────────────
  const subjectiveEffort = subjective?.rpe ?? subjective?.appleEffortRating ?? null;
  const interruptionsPresent =
    eligibility.continuity.interruptedSplitIndices.length > 0 ||
    (eligibility.continuity.unaccountedSec ?? 0) > 0;
  const baseEntry = {
    activityId: activity.activityId,
    date: activity.date,
    modelVersion: ACTIVITY_EVIDENCE_MODEL_VERSION,
    activeDurationSec: activity.activeSec ?? null,
    distanceMi: activity.distanceMi ?? null,
    intent: plannedIntent,
    observedExecution,
    externalLoad: outputVerdict,
    paceStability,
    powerStability,
    cardiovascularDrift: internalCost.ok ? internalCost.magnitude : ('not_measured' as const),
    subjectiveEffort,
    environment: environment.load,
    interruptionsPresent,
  };

  const ledger: EvidenceLedgerEntry[] = [];
  const durability = capacities.durability;
  if (durability.kind === 'evidence') {
    ledger.push({
      ...baseEntry,
      kind: structured ? 'QUALITY_UNDER_LOAD_OBSERVATION' : 'AEROBIC_DURABILITY_OBSERVATION',
      reliability: durability.reliability,
      anchorEffect: durability.anchorEffect,
      reasons: durability.reasons,
    });
  }
  // The environmental response is retained even when nothing else is, because
  // "if similar conditions repeatedly produce ~8:20 pace / ~285W / HR rising
  // into mid-150s" the system eventually learns an individualised response
  // (easy-run reference case §16-17). That is a Runner Model question; this
  // layer's job is to write the observation down in a form that can answer it.
  if (environment.load !== 'unknown' && environment.load !== 'none' && internalCost.ok) {
    ledger.push({
      ...baseEntry,
      kind: 'ENVIRONMENTAL_RESPONSE_OBSERVATION',
      reliability: 'low_to_moderate',
      anchorEffect: 'supporting_evidence_only',
      reasons: ['ENVIRONMENTALLY_AFFECTED'],
    });
  }
  // The nuance a pacing-only read misses, carried as its own lower-weight
  // entry rather than folded into the durability one or silently dropped.
  if (qualityUnderLoad.ok && qualityUnderLoad.residualCardiovascularLoad) {
    ledger.push({
      ...baseEntry,
      kind: 'RESIDUAL_CARDIOVASCULAR_LOAD_OBSERVATION',
      reliability: 'low',
      anchorEffect: 'supporting_evidence_only',
      reasons: ['RESIDUAL_CARDIOVASCULAR_LOAD_INTO_CLOSE'],
    });
  }

  // ── TRAINING LOAD · valuable even when it taught us nothing ─────────────
  const aerobicMinutes = activity.activeSec != null ? roundTo(activity.activeSec / 60, 1) : null;
  let stimulus: TrainingStimulus;
  if (structured) stimulus = 'mixed_aerobic_and_quality';
  else if (observedExecution === 'INDETERMINATE') stimulus = 'none';
  else if (observedExecution === 'HIGH_INTENSITY') stimulus = 'high_intensity_development';
  else if (observedExecution === 'THRESHOLD' || observedExecution === 'STEADY_TO_THRESHOLD') {
    stimulus = 'threshold_development';
  } else if (observedExecution === 'RECOVERY') stimulus = 'recovery';
  else stimulus = 'aerobic_development';

  // ── ANCHOR-MOVE CANDIDACY ───────────────────────────────────────────────
  const anchorMoveReasons: CapacityReasonCode[] = [];
  const tierCapable = plannedIntent != null && ANCHOR_CAPABLE_INTENTS.has(plannedIntent);
  const bestWeight = Object.values(capacities).reduce(
    (best, c) => (c.kind === 'evidence' && c.weight > best ? c.weight : best), 0,
  );
  const anchorMoveCandidate = tierCapable && bestWeight >= ANCHOR_MOVE_MIN_WEIGHT;
  if (!anchorMoveCandidate) anchorMoveReasons.push('SINGLE_ACTIVITY_BELOW_ANCHOR_MOVE_TIER');
  if (structured) anchorMoveReasons.push('MIXED_INTENSITY_ACTIVITY_AVERAGE_NOT_EVIDENCE');

  return {
    modelVersion: ACTIVITY_EVIDENCE_MODEL_VERSION,
    activityId: activity.activityId,
    date: activity.date,
    eligibility,
    environment,
    plannedIntent,
    observedExecution,
    executionDivergedFromIntent:
      plannedIntent != null && observedExecution !== 'INDETERMINATE' &&
      intentAsExecution(plannedIntent) !== observedExecution,
    executionQuality,
    structured,
    segments: seg.segments,
    easyPaceBaselineSecPerMi: seg.easyPaceBaselineSecPerMi,
    externalOutput,
    internalCost,
    qualityUnderLoad,
    capacities,
    beliefTension,
    ledger,
    trainingLoad: {
      stimulus,
      aerobicMinutes,
      distanceMi: activity.distanceMi ?? null,
      primaryValue:
        stimulus === 'mixed_aerobic_and_quality'
          ? 'Aerobic volume plus embedded sustained work.'
          : stimulus === 'aerobic_development'
            ? 'Aerobic volume and consistency.'
            : stimulus === 'recovery'
              ? 'Recovery and circulation.'
              : stimulus === 'threshold_development'
                ? 'Sustained threshold stimulus.'
                : stimulus === 'high_intensity_development'
                  ? 'High-intensity stimulus.'
                  : 'No training stimulus identified.',
    },
    runningDynamics: dynamics,
    anchorMoveCandidate,
    anchorMoveReasons,
    reasons: [...new Set([
      ...eligibility.rejections, ...eligibility.signalReasons,
      ...eligibility.continuity.reasons, ...environment.reasons,
      ...Object.values(capacities).flatMap((c) => c.reasons),
      ...anchorMoveReasons,
    ])],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 13 · CAPACITY EVIDENCE
 * ══════════════════════════════════════════════════════════════════════ */

/** Apply the single-activity ceiling unless this activity is on §10's explicit
 *  exceptional-evidence path (a race or a properly executed time trial). */
function capSingleActivity(weight: number, intent: PlannedIntent | null): {
  weight: number; capped: boolean;
} {
  const exceptional = intent === 'RACE' || intent === 'TIME_TRIAL';
  if (exceptional || weight <= SINGLE_ACTIVITY_EVIDENCE_CEILING) return { weight, capped: false };
  return { weight: SINGLE_ACTIVITY_EVIDENCE_CEILING, capped: true };
}

function anchorEffectFor(weight: number, intent: PlannedIntent | null): AnchorEffect {
  return weight >= ANCHOR_MOVE_MIN_WEIGHT && intent != null && ANCHOR_CAPABLE_INTENTS.has(intent)
    ? 'candidate_anchor_move'
    : 'supporting_evidence_only';
}

function resolveCapacityEvidence(input: {
  activity: RawActivityInput;
  segments: readonly ObservedSegment[];
  structured: boolean;
  zoneTable: ZoneTable | null;
  externalOutput: ExternalOutputRead;
  internalCost: InternalCostRead;
  qualityUnderLoad: QualityUnderLoadRead;
  environment: EnvironmentalContext;
  continuity: ContinuityRead;
  plannedIntent: PlannedIntent | null;
  hrSignalQuality: SignalQuality;
}): Record<CapacityName, CapacityEvidence> {
  const {
    activity, segments, structured, zoneTable, externalOutput,
    internalCost, qualityUnderLoad, environment, continuity, plannedIntent,
  } = input;

  const hasHrCurve = segments.some((s) => s.meanHrBpm != null);
  const minutesIn = (pred: (s: ObservedSegment) => boolean): number =>
    segments.filter(pred).reduce((s, x) => s + x.spanSec, 0) / 60;

  // ── HIGH INTENSITY ──────────────────────────────────────────────────────
  let highIntensity: CapacityEvidence;
  if (!zoneTable) {
    highIntensity = { capacity: 'high_intensity', kind: 'indeterminate', reasons: ['NO_ZONE_TABLE_WITHOUT_LTHR'] };
  } else if (!hasHrCurve) {
    // Only a whole-run mean. If that mean is itself below Friel's VO2 edge, no
    // amount of hidden structure could have produced four sustained minutes
    // above it without moving the mean, so this is a measurement.
    const meanIdx = activity.avgHrBpm != null ? zoneIdxForBpm(activity.avgHrBpm, zoneTable) : null;
    highIntensity = meanIdx != null && meanIdx < 6
      ? {
          capacity: 'high_intensity', kind: 'no_evidence',
          reasons: ['NO_HIGH_INTENSITY_WORK_PERFORMED', 'GRANULARITY_CANNOT_RESOLVE_INTERVALS'],
        }
      : {
          capacity: 'high_intensity', kind: 'indeterminate',
          reasons: ['NO_HR_CURVE_TO_READ_INTERNAL_COST'],
        };
  } else {
    const hiMinutes = minutesIn((s) => s.classification === 'high_intensity');
    highIntensity = hiMinutes >= HIGH_INTENSITY_MIN_MINUTES
      ? (() => {
          const raw = geometricMean([
            continuity.weight,
            clamp01(hiMinutes / (HIGH_INTENSITY_MIN_MINUTES * 3)),
            1 - clamp01(environment.hrConfoundWeight),
          ]);
          const { weight, capped } = capSingleActivity(raw, plannedIntent);
          const reasons: CapacityReasonCode[] = [];
          if (capped) reasons.push('SINGLE_ACTIVITY_CEILING_APPLIED');
          const anchorEffect = anchorEffectFor(weight, plannedIntent);
          if (anchorEffect === 'supporting_evidence_only') reasons.push('SINGLE_ACTIVITY_BELOW_ANCHOR_MOVE_TIER');
          return {
            capacity: 'high_intensity' as const, kind: 'evidence' as const,
            strength: strengthOf(weight), weight: roundTo(weight, 4),
            reliability: reliabilityOf(weight), anchorEffect, reasons,
          };
        })()
      : {
          capacity: 'high_intensity', kind: 'no_evidence',
          reasons: ['NO_HIGH_INTENSITY_WORK_PERFORMED', 'GRANULARITY_CANNOT_RESOLVE_INTERVALS'],
        };
  }

  // ── THRESHOLD ───────────────────────────────────────────────────────────
  // "Do not derive threshold from this run merely because pace and HR exist."
  // The gate is SUSTAINED threshold-like segment minutes.
  let threshold: CapacityEvidence;
  if (!zoneTable) {
    threshold = { capacity: 'threshold', kind: 'indeterminate', reasons: ['NO_ZONE_TABLE_WITHOUT_LTHR'] };
  } else if (!hasHrCurve) {
    const meanIdx = activity.avgHrBpm != null ? zoneIdxForBpm(activity.avgHrBpm, zoneTable) : null;
    threshold = meanIdx != null && meanIdx < 4
      ? {
          capacity: 'threshold', kind: 'no_evidence',
          reasons: ['NO_SUSTAINED_THRESHOLD_SEGMENT', 'PACE_AND_HR_EXIST_BUT_DEMONSTRATE_NOTHING'],
        }
      : { capacity: 'threshold', kind: 'indeterminate', reasons: ['NO_HR_CURVE_TO_READ_INTERNAL_COST'] };
  } else {
    const tMinutes = minutesIn(
      (s) => s.classification === 'threshold_like' || s.classification === 'high_intensity',
    );
    if (tMinutes >= THRESHOLD_MIN_SUSTAINED_MINUTES) {
      const raw = geometricMean([
        continuity.weight,
        clamp01(tMinutes / (THRESHOLD_MIN_SUSTAINED_MINUTES * 2)),
        1 - clamp01(environment.hrConfoundWeight),
      ]);
      const { weight, capped } = capSingleActivity(raw, plannedIntent);
      const reasons: CapacityReasonCode[] = ['SUSTAINED_THRESHOLD_LIKE_WORK_PRESENT'];
      if (capped) reasons.push('SINGLE_ACTIVITY_CEILING_APPLIED');
      if (environment.hrCostPlausiblyElevated) reasons.push('ENVIRONMENTALLY_AFFECTED');
      const anchorEffect = anchorEffectFor(weight, plannedIntent);
      if (anchorEffect === 'supporting_evidence_only') reasons.push('SINGLE_ACTIVITY_BELOW_ANCHOR_MOVE_TIER');
      threshold = {
        capacity: 'threshold', kind: 'evidence',
        strength: strengthOf(weight), weight: roundTo(weight, 4),
        reliability: reliabilityOf(weight), anchorEffect, reasons,
      };
    } else {
      threshold = {
        capacity: 'threshold', kind: 'no_evidence',
        reasons: ['NO_SUSTAINED_THRESHOLD_SEGMENT', 'PACE_AND_HR_EXIST_BUT_DEMONSTRATE_NOTHING'],
      };
    }
  }

  // ── DURABILITY ──────────────────────────────────────────────────────────
  // Two lanes, and the difference between them is the whole point of pairing
  // the two reference cases:
  //
  //   · CONTINUOUS · stable external output + rising internal cost over a
  //     meaningful duration. Real, and deliberately modest: the easy-run
  //     fixture's own §9 grades it "LOW-TO-MODERATE SUPPORTING EVIDENCE...
  //     enters the evidence ledger without materially moving the durability
  //     anchor by itself."
  //   · STRUCTURED · quality that SURVIVED accumulated load, repeated across
  //     blocks, without a late collapse. The structured-long-run fixture's
  //     Part 2 item 2 requires this to weigh "meaningfully MORE" than an
  //     ordinary easy run, and it does — more factors are near 1, so the
  //     geometric mean lands higher before the single-activity ceiling binds.
  let durability: CapacityEvidence;
  if (structured) {
    if (!qualityUnderLoad.ok) {
      durability = qualityUnderLoad.reason === 'no_quality_segments'
        ? {
            capacity: 'durability', kind: 'no_evidence',
            reasons: ['PACE_AND_HR_EXIST_BUT_DEMONSTRATE_NOTHING'],
          }
        : {
            capacity: 'durability', kind: 'indeterminate',
            reasons: ['NO_HR_CURVE_TO_READ_INTERNAL_COST'],
          };
    } else {
      const q = qualityUnderLoad;
      const dataQuality = continuity.weight * SIGNAL_QUALITY_WEIGHT[input.hrSignalQuality];
      const underLoadCredit = clamp01(q.qualityMinutesUnderLoad / THRESHOLD_MIN_SUSTAINED_MINUTES);
      // Repeated blocks inside one activity are corroboration WITHIN the
      // activity — Brief 02's "repeated evidence dominates isolated
      // observations", at the only scale this layer can see.
      const repetitionCredit = clamp01(0.5 + 0.25 * q.qualityBlocks);
      const retentionCredit = q.lateVsEarlyPaceRatio == null
        ? 0.8
        : clamp01(1 - Math.max(0, q.lateVsEarlyPaceRatio - 1) / 0.30);
      const noCollapseCredit = q.closingVsOpeningPaceRatio == null
        ? 0.8
        : clamp01(1 - Math.max(0, q.closingVsOpeningPaceRatio - 1) / LATE_COLLAPSE_PACE_FRAC / 2);
      const raw = geometricMean([
        dataQuality, underLoadCredit, repetitionCredit, retentionCredit, noCollapseCredit,
      ]);
      const { weight, capped } = capSingleActivity(raw, plannedIntent);
      const reasons: CapacityReasonCode[] = ['QUALITY_SURVIVED_ACCUMULATED_LOAD'];
      if (q.qualityBlocks >= 2) reasons.push('REPEATED_QUALITY_BLOCKS_WITHIN_ONE_ACTIVITY');
      if (!q.lateRunPacingCollapse) reasons.push('NO_LATE_RUN_PACING_COLLAPSE');
      if (q.residualCardiovascularLoad) reasons.push('RESIDUAL_CARDIOVASCULAR_LOAD_INTO_CLOSE');
      if (environment.hrCostPlausiblyElevated) reasons.push('ENVIRONMENTALLY_AFFECTED');
      if (capped) reasons.push('SINGLE_ACTIVITY_CEILING_APPLIED');
      const anchorEffect = anchorEffectFor(weight, plannedIntent);
      if (anchorEffect === 'supporting_evidence_only') reasons.push('SINGLE_ACTIVITY_BELOW_ANCHOR_MOVE_TIER');
      durability = {
        capacity: 'durability', kind: 'evidence',
        strength: strengthOf(weight), weight: roundTo(weight, 4),
        reliability: reliabilityOf(weight), anchorEffect, reasons,
      };
    }
  } else if (!internalCost.ok) {
    durability = internalCost.reason === 'external_output_not_steady'
      ? { capacity: 'durability', kind: 'no_evidence', reasons: ['PACE_AND_HR_EXIST_BUT_DEMONSTRATE_NOTHING'] }
      : { capacity: 'durability', kind: 'indeterminate', reasons: ['NO_HR_CURVE_TO_READ_INTERNAL_COST'] };
  } else if (externalOutput.verdict !== 'stable') {
    durability = {
      capacity: 'durability', kind: 'no_evidence',
      reasons: ['PACE_AND_HR_EXIST_BUT_DEMONSTRATE_NOTHING'],
    };
  } else {
    const durationCredit = clamp01(
      (internalCost.analysedMinutes - DRIFT_SCOPE_MIN_MINUTES) /
        (DECOUPLING_PROTOCOL_MIN_MINUTES - DRIFT_SCOPE_MIN_MINUTES),
    );
    const outputCredit =
      externalOutput.paceStability === 'high' && externalOutput.powerStability === 'high' ? 1
        : externalOutput.paceStability === 'high' || externalOutput.powerStability === 'high' ? 0.8
          : 0.6;
    const raw = clamp01(internalCost.confidence * durationCredit * outputCredit);
    const { weight, capped } = capSingleActivity(raw, plannedIntent);
    const reasons: CapacityReasonCode[] = ['STABLE_OUTPUT_WITH_RISING_INTERNAL_COST'];
    if (internalCost.analysedMinutes < DECOUPLING_PROTOCOL_MIN_MINUTES) reasons.push('DURATION_BELOW_PROTOCOL');
    if (environment.hrCostPlausiblyElevated) reasons.push('ENVIRONMENTALLY_AFFECTED');
    if (continuity.interruptedSplitIndices.length > 0 || (continuity.unaccountedSec ?? 0) > 0) {
      reasons.push('ACTIVITY_INTERRUPTED');
    }
    if (capped) reasons.push('SINGLE_ACTIVITY_CEILING_APPLIED');
    const anchorEffect = anchorEffectFor(weight, plannedIntent);
    if (anchorEffect === 'supporting_evidence_only') reasons.push('SINGLE_ACTIVITY_BELOW_ANCHOR_MOVE_TIER');
    durability = {
      capacity: 'durability', kind: 'evidence',
      strength: strengthOf(weight), weight: roundTo(weight, 4),
      reliability: reliabilityOf(weight), anchorEffect, reasons,
    };
  }

  // ── EASY CEILING ────────────────────────────────────────────────────────
  // Doctrine §15-16 and the easy-run reference case §21: "Your easy pace
  // should now be slower" is exactly what a single warm, interrupted,
  // sub-protocol run does not license. That is a longitudinal question, and
  // the observation is kept in the ledger for it rather than spent here.
  const easyCeiling: CapacityEvidence = {
    capacity: 'easy_ceiling', kind: 'no_evidence',
    reasons: ['SINGLE_ACTIVITY_DOES_NOT_RESET_EASY_CEILING'],
  };

  return { high_intensity: highIntensity, threshold, durability, easy_ceiling: easyCeiling };
}
