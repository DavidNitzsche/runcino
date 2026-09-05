/**
 * lib/runner-state/belief.ts · THE SHAPE OF ONE THING THE BRAIN BELIEVES
 * ABOUT THE RUNNER.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * David, 2026-09-05:
 *
 *   "The brain needs a coherent model of the runner, not separate facts
 *    interpreted differently by each feature."
 *
 * `docs/BRAIN_CONSTITUTION.md` §29 already assigns one canonical OWNER to
 * every coaching QUESTION. What it does not do is give the runner FACTS a
 * common shape, and the app shows the cost of that. `lib/topics/types.ts`'s
 * `CoachState` is the closest thing to a model of the runner that exists, and
 * its own header instructs every consumer to collapse Rule 11:
 *
 *   > Any field can be null · prereqs MUST handle nulls (a missing value
 *   > means "we do not know" and the topic should defer).
 *
 * So a measured zero, an absent read and a failed read arrive at forty
 * consumers as the same `null`, and each of them decides for itself what that
 * means. `lib/coach/acwr.ts` computes a genuinely three-state `AcwrResult`
 * carrying an `AcwrAbsentReason`, and `lib/coach/state-loader.ts:461-464`
 * flattens it to three nullable numbers and drops the reason on the floor.
 * That is the defect this shape is built to make unsayable.
 *
 * ── WHAT THIS FILE IS NOT ──────────────────────────────────────────────────
 *
 * IT COMPUTES NO BELIEF. There is not one physiological number in this
 * directory and there must never be. `docs/BRAIN_CONSTITUTION.md` §9's
 * anti-bloat questions have one honest answer here: every belief below
 * already has an owner, this adds no second source of truth, and what it
 * contributes is a SHAPE plus a REGISTRY of who owns what. §10 is the same
 * rule pointed the other way: signals are evidence, not new engines.
 *
 * IT IS NOT A SCORE (§11). Nothing here combines beliefs into a number.
 * `confidence` is per belief, it is the owner's own confidence carried
 * through unchanged, and there is deliberately no field anywhere in this
 * directory that adds two confidences together.
 *
 * ── RULE 16 · THE NAME COLLISION, ADDRESSED RATHER THAN LEFT ───────────────
 *
 * `lib/training/runner-state.ts` already exports `RunnerState`, and it means
 * something narrower than this directory's name suggests: it is the READINESS
 * decision (proceed / caution / reduce / recover / stop), the Constitution's
 * §D owner. A second type called `RunnerState` is exactly what Rule 16
 * forbids, so there is not one:
 *
 *   · that module keeps `RunnerState` and keeps owning readiness;
 *   · this directory's assembled type is `RunnerBeliefs`, and readiness is
 *     ONE KEY inside it whose canonical owner is `resolveRunnerState`;
 *   · nothing here re-derives a readiness decision, and the registry entry
 *     for `READINESS` names that function as the owner so a grep finds it.
 *
 * `lib/faff/surface-sweep-matrix.ts:80` exports a THIRD `RunnerState` (a
 * test-matrix label for a UI state). It is recorded in `ownership.ts` as an
 * open naming collision rather than renamed here, because it is a fixture
 * vocabulary in another owner's file.
 *
 * ── RULE 11 · THREE FACTS, AND NOT A FIFTH SPELLING OF THEM ────────────────
 *
 * "Don't know", "measured zero" and "the read failed" are three facts. This
 * codebase already spells that four ways, each locally argued:
 *
 *   `Measured<T>`        lib/adaptation/canonical/input.ts:113   general
 *   `NormalReading<T>`   lib/training/normal-window.ts:454       Rule 8 refusal
 *   `SignalRead<T>`      lib/safety/safety-verdict.ts:157        safety inputs
 *   `BeliefTensionRead`  lib/evidence/activity-evidence.ts:915   one comparison
 *
 * A fifth would be the defect, so there is not one. `Belief.reading` IS
 * `Measured<BeliefEstimate<T>>` · the general one, type-imported, not
 * restated. Its refusal branch carries no `value` field, so `reading.value`
 * does not compile until the caller has branched, which is what makes Rule 11
 * a type error here rather than a discipline.
 *
 * `normalReadingToMeasured` is the bridge from the Rule 8 union. It is the
 * generic twin of `fromNormalReading` in
 * `lib/plan/adjudication/dose-responsive.ts:1069`, which is specialised to
 * `number`. The two are BOUND BY ASSERTION rather than by import
 * (`_runner_state.test.ts` runs both over the same readings and fails if they
 * ever disagree), for the reason `MIN_REPRESENTATIVE_DAYS` and
 * `SUSTAINED_WEEK_RANK` are bound that way in `normal-window.ts`: importing
 * it would make a runner-state module depend on plan adjudication, which is
 * the wrong direction through the Constitution's §3 flow.
 *
 * ── CONFLICTING EVIDENCE STAYS VISIBLE ─────────────────────────────────────
 *
 * David, same instruction: conflicting evidence stays visible rather than
 * being averaged into false certainty. So `contradicting` is a first-class
 * field beside `supporting`, and `tension` is the named third outcome
 * `lib/evidence/activity-evidence.ts` already established for a single
 * comparison: evidence can challenge a belief without updating it.
 *
 * The shape CANNOT express an average. `BeliefTension.resolution` is hard
 * typed to the single literal `'HELD_AND_STATED'`, the same move
 * `activity-evidence.ts` makes with `anchorEffect:
 * 'no_change_flag_for_reexamination'`, so a consumer cannot mistake a
 * contradiction for a settled midpoint and a future edit cannot quietly widen
 * it without changing the type. `withContradiction` is the only constructor
 * that adds one, it leaves `estimate.best` byte-identical, and
 * `_runner_state.test.ts` falsifies that by planting a midpoint and watching
 * the gate name it.
 *
 * ── RULE 21 AND RULE 22 · THE THREE LEVER LISTS ARE THE POINT ──────────────
 *
 * `movesUpOn`, `movesDownOn` and `neverMovesOn` are not documentation. Rule
 * 21 measured this engine at 309 production adaptations with ZERO upward, and
 * Rule 22 measured its test suite at 29 files that know how to hold a runner
 * back against 2 that know what accelerating means. A belief that carries a
 * way down and no way up is that bias made structural, so the gate refuses
 * one: `everyBeliefCanMoveBothWays` fails on any movable belief with an empty
 * `movesUpOn`, and it was falsified against an emptied list before it landed.
 *
 * `neverMovesOn` is the prohibition half and it is where the goal lives. The
 * standing rule is that the coach projects and never renegotiates a stated
 * goal, so `GOAL_STATED` appears in `neverMovesOn` for every capacity belief
 * and the gate asserts it does.
 *
 * ── RULE 8 · EVERY BELIEF STATES ITS SIDE ──────────────────────────────────
 *
 * `rule8Side` is required, has no default, and there is no "unset" value. A
 * habit question is filtered through `lib/training/normal-window.ts`; an
 * absorbed-load question is deliberately not. The registry in `ownership.ts`
 * carries the side per belief and the gate cross-checks the ones
 * `DOSE_EVIDENCE_READERS` also names, so the two registries cannot drift.
 *
 * ── PURITY ─────────────────────────────────────────────────────────────────
 *
 * Every import in this file is `import type`, erased at compile time, so this
 * module emits no import statement at all and reaches no database at any
 * depth. Rule 19 was earned by a header comment that asserted exactly this
 * and was false for a day, so it is gated rather than asserted:
 * `_runner_state.test.ts` walks the transitive graph from every file in this
 * directory and fails on a server-only module, and its walk asserts it
 * actually walked.
 */
import type { Measured } from '@/lib/adaptation/canonical/input';
import type { NormalReading } from '@/lib/training/normal-window';
import type { SourceMode } from '@/lib/training/capacity-resolver';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE TWENTY BELIEFS
 *
 * One key per coaching FACT about the runner. Not per signal, not per table,
 * not per screen. §34's test applies to any addition here: does this require
 * a NEW BELIEF, or is it merely NEW EVIDENCE about an existing one? Almost
 * always the second, and then it does not belong in this list.
 * ═══════════════════════════════════════════════════════════════════════ */

export type BeliefKey =
  /** What he can hold week after week. Capability, not last week's number. */
  | 'SUSTAINABLE_WEEKLY_VOLUME'
  /** What his legs have actually carried lately, taper days included. */
  | 'RECENT_COMPLETED_VOLUME'
  /** The last seven days of load, as load rather than as capability. */
  | 'ACUTE_LOAD'
  /** The chronic base that acute load is measured against. */
  | 'CHRONIC_LOAD'
  /** How many days a week he trains on, and can train on. */
  | 'RUN_FREQUENCY_TOLERANCE'
  /** How long a long run he handles. Two questions under one name; see below. */
  | 'LONG_RUN_TOLERANCE'
  /** What he can sustain at threshold. */
  | 'THRESHOLD_PACE'
  /** What he can hold for the marathon, which is not threshold minus a number. */
  | 'MARATHON_PACE'
  /** What he can hold at 3-5K effort. */
  | 'INTERVAL_PACE'
  /** The biggest dose of a given workout type he has actually completed. */
  | 'MAX_DEMONSTRATED_DOSE'
  /** How he comes back from a hard session or a race. */
  | 'RECOVERY_RESPONSE'
  /** How regularly he trains, in shape and not only in mean. */
  | 'TRAINING_CONSISTENCY'
  /** What he has actually raced. */
  | 'RACE_PERFORMANCE'
  /** How much heat, dewpoint and terrain cost THIS runner. */
  | 'ENVIRONMENTAL_SENSITIVITY'
  /** Whether an injury is open, and what it restricts. */
  | 'INJURY_STATE'
  /** Whether he is ill, and how far into it. */
  | 'ILLNESS_STATE'
  /** How far the underlying measurements can be trusted at all. */
  | 'DATA_QUALITY'
  /** How the stated goal compares with the current outlook. */
  | 'GOAL_FEASIBILITY'
  /** Where he is in the block. */
  | 'TRAINING_PHASE'
  /** Whether the next prescribed stress is appropriate today. */
  | 'READINESS';

export const BELIEF_KEYS: readonly BeliefKey[] = [
  'SUSTAINABLE_WEEKLY_VOLUME',
  'RECENT_COMPLETED_VOLUME',
  'ACUTE_LOAD',
  'CHRONIC_LOAD',
  'RUN_FREQUENCY_TOLERANCE',
  'LONG_RUN_TOLERANCE',
  'THRESHOLD_PACE',
  'MARATHON_PACE',
  'INTERVAL_PACE',
  'MAX_DEMONSTRATED_DOSE',
  'RECOVERY_RESPONSE',
  'TRAINING_CONSISTENCY',
  'RACE_PERFORMANCE',
  'ENVIRONMENTAL_SENSITIVITY',
  'INJURY_STATE',
  'ILLNESS_STATE',
  'DATA_QUALITY',
  'GOAL_FEASIBILITY',
  'TRAINING_PHASE',
  'READINESS',
] as const;

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · RULE 8 · WHICH QUESTION IS THIS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Which side of Rule 8's corollary a belief falls on.
 *
 * THE SAME THREE VALUES as `CanonicalReader.rule8Side` in
 * `lib/plan/adjudication/dose-responsive.ts:229`, spelled the same way on
 * purpose so the two registries can be cross-checked term for term rather
 * than mapped. `_runner_state.test.ts` asserts the overlap agrees.
 *
 *   HABIT          filter it. "What does this runner normally do."
 *   ABSORBED_LOAD  do not filter it. "What have the legs actually carried."
 *   NEITHER        the question has no taper exposure at all.
 *
 * There is no fourth value and there is deliberately no default. Rule 8's
 * corollary spends most of its text on the over-application failure, where a
 * safety guard measured against a pre-taper self waves through a jump the
 * legs were never prepared for. A belief that has not said which question it
 * asks cannot be checked for that.
 */
export type Rule8Side = 'HABIT' | 'ABSORBED_LOAD' | 'NEITHER';

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE ESTIMATE  ·  a value OR a range, never a fake point
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * What the belief currently holds.
 *
 * `range` is nullable because some beliefs are honestly point-valued (a phase
 * label is not a band) and some are not. Doctrine §18 is explicit that a
 * prediction should return uncertainty and that "Predicted time: 1:31:47"
 * implies knowledge the system does not possess, so where a range exists it
 * is carried rather than collapsed to `best` for presentation.
 *
 * `best` is NOT recomputed anywhere in this directory. It is the owner's own
 * answer, carried through. That is the whole reason a coherent model does not
 * become a second brain.
 */
export interface BeliefEstimate<T> {
  readonly best: T;
  /** Present only when the belief is honestly a band. Null when point-valued. */
  readonly range: { readonly low: T; readonly high: T } | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · EVIDENCE  ·  supporting AND contradicting, both first class
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * What kind of observation this is. Deliberately coarse: the fine-grained
 * classification is the Evidence Engine's (`lib/evidence/activity-evidence.ts`)
 * and duplicating its taxonomy here would be a second answer to §B's question.
 */
export type EvidenceKind =
  | 'RACE'
  | 'QUALITY_SESSION'
  | 'LONG_RUN'
  | 'EASY_RUN'
  | 'WEEK_TOTAL'
  | 'BIOMETRIC'
  | 'RUNNER_REPORTED'
  | 'PLAN_RECORD'
  | 'POPULATION_PRIOR';

/**
 * One observation behind a belief, named so the belief is traceable (doctrine
 * §25: no important fitness belief should emerge mysteriously from a black
 * box).
 *
 * `id` is whatever the owner names its evidence by · a `runs.id`, a race slug,
 * a `plan_workouts.id`. It is carried, never parsed here.
 */
export interface EvidenceRef {
  readonly id: string;
  readonly kind: EvidenceKind;
  /** The day the observation happened. */
  readonly dateISO: string;
  /** In the runner's language. One short clause, not a paragraph. */
  readonly what: string;
}

/** How old the evidence behind a belief is. Doctrine §16: uncertainty decays
 *  with stale evidence; the value does not. Carried so a consumer can age
 *  CONFIDENCE without being tempted to age the number. */
export interface EvidenceRecency {
  readonly newestISO: string;
  readonly oldestISO: string;
  readonly medianAgeDays: number;
  /** How many observations the owner admitted. Zero is a measurement. */
  readonly observations: number;
}

/**
 * Evidence that disagrees with the belief, kept visible.
 *
 * `resolution` is hard typed to ONE literal. This shape is structurally
 * incapable of saying the contradiction was averaged away, resolved in favour
 * of either side, or downweighted into agreement · the same trick
 * `lib/evidence/activity-evidence.ts` plays with `anchorEffect:
 * 'no_change_flag_for_reexamination'`, and for the same reason: a consumer
 * cannot mistake it for a settled answer, and a future edit that wants a
 * different behaviour has to change the type in front of a reviewer.
 */
export interface BeliefTension {
  readonly direction:
    /** The observations say he is better than the belief. */
    | 'EVIDENCE_STRONGER_THAN_BELIEF'
    /** The observations say he is worse than the belief. */
    | 'EVIDENCE_WEAKER_THAN_BELIEF'
    /** The observations disagree with each other, not with the belief. */
    | 'EVIDENCE_DISAGREES_WITH_ITSELF';
  /** Runner-facing. Says what disagrees, not what to do about it. */
  readonly say: string;
  /** Never empty. A tension with no evidence behind it is not a tension. */
  readonly evidence: readonly EvidenceRef[];
  /** The only value. The belief is held and the disagreement is stated. */
  readonly resolution: 'HELD_AND_STATED';
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · THE LEVERS  ·  up, down, and never
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * One thing that would move this belief, and who would notice.
 *
 * `reader` is `module#symbol`, resolved against the real file by the gate, so
 * a lever pointing at a function that has been renamed fails the build
 * instead of quietly meaning nothing. That is the discipline
 * `DOSE_EVIDENCE_READERS` already applies to its own ten readers.
 */
export interface BeliefLever {
  /** In the runner's language. "Two more threshold sessions at this pace." */
  readonly what: string;
  /** `lib/path/file.ts#exportedSymbol`. */
  readonly reader: string;
}

/**
 * Something that must NEVER move this belief, and why.
 *
 * Not a lever with a negative sign. These are prohibitions, and the reason is
 * required because a prohibition nobody can argue with is a prohibition
 * nobody will keep. The recurring entries:
 *
 *   GOAL_STATED       the coach projects; it never renegotiates a stated goal.
 *   CALENDAR_TIME     doctrine §16 · time passing is not evidence of decline.
 *   ONE_ANOMALY       doctrine §15 · one run should rarely rewrite the runner.
 *   READINESS         §18 · tired is not less fit. State never edits capacity.
 *   PRESCRIBED_TAPER  Rule 8 · a taper is never the runner's normal.
 */
export interface BeliefImmovable {
  readonly what:
    | 'GOAL_STATED'
    | 'CALENDAR_TIME'
    | 'ONE_ANOMALY'
    | 'READINESS'
    | 'PRESCRIBED_TAPER'
    | 'RACE_PREDICTION';
  readonly why: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · WHO OWNS IT
 * ═══════════════════════════════════════════════════════════════════════ */

/** A row of `docs/BRAIN_CONSTITUTION.md` §29's ownership table, verbatim. */
export type ConstitutionOwner =
  | 'Activity Interpreter'
  | 'Evidence Engine'
  | 'Runner Model'
  | 'Readiness'
  | 'Safety'
  | 'Coaching Thesis'
  | 'Pace Prescription'
  | 'Plan Generator'
  | 'Adaptation'
  | 'Race Prediction'
  | 'Goal Feasibility'
  | 'Goal System'
  | 'Coaching/UI'
  /** §M. Named in §2 but not given a row in §29's table. Recorded, not invented. */
  | 'Training Load'
  /** §N. Same. */
  | 'Environmental Context';

/**
 * The one function that answers this belief.
 *
 * Field names match `CanonicalReader` in
 * `lib/plan/adjudication/dose-responsive.ts:229` exactly, so the ten readers
 * that registry already names can be compared with this one term for term
 * rather than through a mapping nobody maintains. The gate does that
 * comparison and fails on a disagreement, which is Rule 16 in its enforceable
 * form: two registries naming the same reader must name the same reader.
 */
export interface BeliefOwnerRef {
  /** `lib/path/file.ts`, relative to `web-v2`. */
  readonly module: string;
  /** The exported symbol. Resolved against the real file by the gate. */
  readonly symbol: string;
  /** What it answers, in one sentence. */
  readonly answers: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · THE BELIEF
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * One thing the brain believes about the runner, with everything needed to
 * argue with it.
 *
 * Every field is required. There is no partial belief and no optional
 * provenance, because an optional field is a field half the call sites will
 * not fill in, and the half that does not is where the next silent default
 * lives.
 */
export interface Belief<T> {
  readonly key: BeliefKey;

  /**
   * The answer, or an argued non-answer. Rule 11 in the type: the refusal
   * branch has no `value`, so `belief.reading.value` does not compile until
   * the caller has checked `belief.reading.ok`.
   */
  readonly reading: Measured<BeliefEstimate<T>>;

  /**
   * 0..1, the OWNER's own confidence, carried through unchanged. Null when
   * the owner does not produce one · which is itself worth knowing and is not
   * the same fact as zero confidence.
   *
   * Never combined with another belief's confidence anywhere in this
   * directory. §11: a score that exists only to combine other scores is the
   * thing to question aggressively.
   */
  readonly confidence: number | null;

  /**
   * Which rung of evidence answered. `SourceMode` is type-imported from
   * `lib/training/capacity-resolver.ts` rather than restated, because
   * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` requires every
   * estimate to carry one and there must be one vocabulary for it. Null only
   * when the owner does not classify its own source.
   */
  readonly sourceMode: SourceMode | null;

  readonly supporting: readonly EvidenceRef[];

  /**
   * Evidence that points the other way. Carried even when the belief did not
   * move, which is the point: a belief with contradicting evidence and full
   * confidence is a defect a consumer can now see.
   */
  readonly contradicting: readonly EvidenceRef[];

  /** Present when `contradicting` is non-empty and the disagreement is
   *  material. Null when the evidence merely varies. */
  readonly tension: BeliefTension | null;

  /** Null when there is no runner-specific evidence at all, which is the
   *  population-prior case and is different from an empty window. */
  readonly recency: EvidenceRecency | null;

  /** When the owner last resolved this. ISO instant, per Rule 10, so a belief
   *  that gets logged or cached carries its own age. */
  readonly lastUpdatedISO: string;

  readonly rule8Side: Rule8Side;

  /** May be empty ONLY when `movesDownOn` is empty too · see the gate. */
  readonly movesUpOn: readonly BeliefLever[];
  readonly movesDownOn: readonly BeliefLever[];
  /** Never empty. Every belief has at least one thing that must not move it. */
  readonly neverMovesOn: readonly BeliefImmovable[];

  readonly owner: BeliefOwnerRef;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · CONSTRUCTORS  ·  the only ways to make one
 * ═══════════════════════════════════════════════════════════════════════ */

/** A point-valued estimate. */
export function point<T>(best: T): BeliefEstimate<T> {
  return { best, range: null };
}

/** A banded estimate. `best` is the owner's own answer, not the midpoint. */
export function band<T>(best: T, low: T, high: T): BeliefEstimate<T> {
  return { best, range: { low, high } };
}

/**
 * A `NormalReading<T>` as a `Measured<T>`.
 *
 * The refusal becomes an ABSENT carrying the refusal's own message, never a
 * zero · the same decision `normal-window.ts` made in its own types and for
 * the reason it gives there. Generic twin of `fromNormalReading` in
 * `lib/plan/adjudication/dose-responsive.ts`; see this file's header for why
 * they are bound by assertion rather than by import.
 */
export function normalReadingToMeasured<T>(r: NormalReading<T>): Measured<T> {
  if (r.ok) return { ok: true, value: r.value };
  return { ok: false, why: { kind: 'ABSENT', what: r.refusal.message } };
}

/* There are deliberately NO `beliefAbsent` / `beliefFailed` constructors in
 * this file. The first cut had them, one argument each, alongside
 * `absentBelief` / `failedBelief` in `assemble.ts`, two arguments each — four
 * near-identical names for two things, which is Rule 16 in miniature and
 * produced a real mis-import in this module's own suite the first time it was
 * written. The refusal constructors live in ONE place, `assemble.ts`, because
 * that is the layer a loader talks to. */

/**
 * Record a contradiction WITHOUT moving the belief.
 *
 * The estimate is returned byte-identical. That is the clause David's
 * instruction turns on · conflicting evidence stays visible rather than being
 * averaged into false certainty · and it is asserted rather than trusted:
 * `_runner_state.test.ts` plants a midpoint here, watches the gate name it,
 * and restores.
 *
 * Confidence is CAPPED, not zeroed. A contradicted belief is less certain, it
 * is not unknown, and zeroing it would be the mirror of the averaging error.
 * The cap is `CONTRADICTED_CONFIDENCE_CEILING`.
 */
export function withContradiction<T>(
  b: Belief<T>,
  tension: BeliefTension,
): Belief<T> {
  const capped = b.confidence == null
    ? null
    : Math.min(b.confidence, CONTRADICTED_CONFIDENCE_CEILING);
  return {
    ...b,
    // `reading` is passed through by reference. Not a stylistic choice: an
    // identity check is what the gate asserts, so a future edit that rebuilds
    // the estimate here fails even if every number still matches.
    reading: b.reading,
    confidence: capped,
    contradicting: [...b.contradicting, ...tension.evidence],
    tension,
  };
}

/**
 * The most confident a contradicted belief may be.
 *
 * THE SAME NUMBER as `CAPACITY_CONFIDENCE_BANDS.directFloor` in
 * `lib/training/capacity-resolver.ts`, bound by assertion in
 * `_runner_state.test.ts` rather than imported, because importing a value
 * from that module would pull `@/lib/db/pool` into this file's graph and this
 * module is pure. The argument for the number is the confidence layer's own:
 * `directFloor` is the bottom of the band that layer reserves for a
 * corroborated direct read, and a belief the evidence argues with is by
 * definition not corroborated, so it may not sit inside it.
 */
export const CONTRADICTED_CONFIDENCE_CEILING = 0.5;
