/**
 * lib/runner-state/assemble.ts · ONE COHERENT MODEL OF THE RUNNER, ASSEMBLED
 * FROM THE CANONICAL OWNERS AND FROM NOTHING ELSE.
 *
 * ── THE ONE ENTRY POINT ────────────────────────────────────────────────────
 *
 *     assembleRunnerBeliefs(input: RunnerBeliefInput): RunnerBeliefs
 *
 * PURE. It takes answers that the canonical owners have ALREADY produced and
 * gives them one shape. It performs no query, no clock read and no
 * physiological arithmetic, and `_runner_state.test.ts` walks the import
 * graph and fails if a database edge ever appears.
 *
 * ── WHAT THE CALLER MAY AND MAY NOT SUPPLY ─────────────────────────────────
 *
 * A caller supplies a `BeliefSubmission`: the reading, the confidence, the
 * source mode, the evidence, the timestamp. That is all.
 *
 * It may NOT supply `rule8Side`, `owner`, `movesUpOn`, `movesDownOn` or
 * `neverMovesOn`. Those come from `BELIEF_OWNERSHIP` and are welded on here.
 * That is the load-bearing decision in this file and it is worth stating
 * plainly: a loader cannot declare that its own number is filtered, cannot
 * name itself as the owner of a belief it does not own, and cannot quietly
 * drop the prohibition that says a goal must never move it. Rule 20's lesson
 * is that a rule which lives only in prose is a hypothesis; this makes the
 * metadata structural instead.
 *
 * ── RULE 11 · THE LOADER MUST SAY WHICH KIND OF NOTHING IT HAS ─────────────
 *
 * There is no partial input and no optional submission. `RunnerBeliefInput`
 * requires all twenty keys, and a loader that did not look says so with
 * `notLookedFor`, which is a distinct fact from `absent` ("looked, found
 * none") and from `failed` ("the read did not complete"). Leaving a key out
 * is a compile error, which is the whole point: `CoachState`'s instruction
 * that "any field can be null and a missing value means we do not know" is
 * exactly the collapse this shape refuses.
 *
 * ── RULE 16 · WHAT THIS IS NOT ─────────────────────────────────────────────
 *
 * NOT a second `RunnerState`. `lib/training/runner-state.ts` keeps that name
 * and keeps owning readiness; readiness is one key in here and its value
 * type is that module's own `StateDecision`, type-imported rather than
 * restated. See `belief.ts`'s header for the full argument.
 *
 * NOT a resolver. Nothing here decides anything. If a future edit computes a
 * pace, a mileage or a verdict in this directory it has started a second
 * brain, and the gate fails on it.
 *
 * NOT a score. There is no combined number anywhere in this file, per
 * Constitution 11.
 *
 * ── RULE 22 · WHAT THIS FILE'S GATE CANNOT FAIL ON ─────────────────────────
 *
 * · It cannot tell whether a submitted value is CORRECT. Everything here is
 *   pass-through, so a wrong threshold pace arrives wrong and leaves wrong.
 *   The owners' own suites are what check that.
 * · It cannot tell whether the loader called the CANONICAL owner. The
 *   registry names the owner and the submission carries a number; nothing
 *   syntactic connects them. A loader that calls the legacy cascade and
 *   submits the result produces a belief that looks identical.
 * · It cannot see a belief that is silently never submitted in production,
 *   because `notLookedFor` is a legal and honest submission. What it can see
 *   is a loader that submits nothing at all, since the input type is total.
 * · Its contradiction assertions fire on averaging. They do not fire on the
 *   opposite failure, a belief that reports a tension it does not have.
 */
import {
  type Belief,
  type BeliefEstimate,
  type BeliefKey,
  type BeliefTension,
  type EvidenceRecency,
  type EvidenceRef,
  BELIEF_KEYS,
} from './belief';
import { BELIEF_OWNERSHIP } from './ownership';
import type { Measured } from '@/lib/adaptation/canonical/input';
import type { SourceMode } from '@/lib/training/capacity-resolver';
import type { StateDecision } from '@/lib/training/runner-state';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · WHAT EACH BELIEF HOLDS
 *
 * The value types are NARROWINGS of the owners' own types, never
 * replacements. Each one names the type it narrows, so a reader can go and
 * read the real thing. They are narrow on purpose: the brain needs the fact,
 * and the surface that wants every field calls the owner directly rather
 * than growing this file into a mirror of six other modules.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Narrows `InjurySignal` (lib/safety/safety-verdict.ts). */
export interface InjuryBelief {
  readonly open: boolean;
  readonly site: string | null;
  readonly severity: 'minor' | 'moderate' | 'major' | null;
  readonly daysOpen: number | null;
}

/** Narrows `IllnessSignal` (lib/safety/safety-verdict.ts). */
export interface IllnessBelief {
  readonly open: boolean;
  readonly hasFever: boolean;
  readonly daysActive: number | null;
}

/** Narrows `RecoveryPhase` (lib/coach/recovery-phase.ts). */
export interface RecoveryBelief {
  /** What he is recovering from. Null when nothing recent qualifies. */
  readonly anchor: 'race' | 'long' | 'intervals' | 'tempo' | 'threshold' | null;
  readonly daysSinceAnchor: number | null;
  /** How the observed bounce-back compares with the expected window. */
  readonly versusExpected: 'ahead' | 'on_schedule' | 'behind' | null;
}

/** Narrows the adherence shape. Both fields are needed: a mean alone hides
 *  an interrupted block behind a steady one. */
export interface ConsistencyBelief {
  /** Completed over prescribed, across the window. */
  readonly meanShareOfPlan: number;
  /** Spread of that share. High spread with a good mean is an interruption. */
  readonly spread: number;
  readonly weeksObserved: number;
}

/** Narrows `RaceOutlook` (lib/race/race-outlook.ts). Seconds. */
export interface RacePerformanceBelief {
  readonly distanceMi: number;
  readonly expectedSec: number;
  readonly limiter: string | null;
}

/** Narrows `HeatAcclimatization` (lib/coach/heat-acclimatization.ts). */
export interface EnvironmentalBelief {
  readonly acclimationDay: number;
  readonly expectedPenaltyBpm: number;
  /**
   * Whether the acclimatisation reading was measured on this runner or
   * inferred from the calendar. Doctrine 26's ladder made visible: a day
   * count is a population assumption, a measured response is not.
   */
  readonly evidence: 'measured' | 'day_count_only';
}

/** Narrows the per-signal quality read (lib/evidence/activity-evidence.ts). */
export interface DataQualityBelief {
  readonly heartRate: 'high' | 'moderate' | 'low' | 'unusable' | 'absent';
  readonly pace: 'high' | 'moderate' | 'low' | 'unusable' | 'absent';
  /** Representative days the account can be seen over at all. */
  readonly coverageDays: number;
}

/** Narrows the outlook's own feasibility vocabulary. Not goal-assessment's,
 *  which is a different and overlapping set; see the OPEN conflict. */
export type GoalFeasibilityBelief =
  | 'no_goal'
  | 'comfortable'
  | 'realistic'
  | 'aggressive'
  | 'unlikely_currently';

/** The engine's own four authored phase labels, and nothing else. Three of
 *  the app's five phase vocabularies contain members the generator never
 *  writes, so a predicate typed on them can only ever be false. */
export type TrainingPhaseBelief = 'BASE' | 'QUALITY' | 'RACE-SPECIFIC' | 'TAPER';

/** Biggest completed dose per workout family, in at-pace minutes. Empty when
 *  measured and none found, which is not the same as never looked. */
export interface MaxDoseBelief {
  readonly atPaceMinutesByFamily: Readonly<Record<string, number>>;
}

/**
 * The value type of each belief. Exported so `lib/brain/` can type its own
 * loader against it without restating any of it.
 */
export interface BeliefValueByKey {
  /** Miles per week. */
  SUSTAINABLE_WEEKLY_VOLUME: number;
  /** Miles per week. */
  RECENT_COMPLETED_VOLUME: number;
  /** Miles per day, seven-day mean. */
  ACUTE_LOAD: number;
  /** Miles per day, twenty-eight-day mean. */
  CHRONIC_LOAD: number;
  /** Days per week. */
  RUN_FREQUENCY_TOLERANCE: number;
  /** Miles. */
  LONG_RUN_TOLERANCE: number;
  /** Seconds per mile. */
  THRESHOLD_PACE: number;
  /** Seconds per mile. */
  MARATHON_PACE: number;
  /** Seconds per mile. */
  INTERVAL_PACE: number;
  MAX_DEMONSTRATED_DOSE: MaxDoseBelief;
  RECOVERY_RESPONSE: RecoveryBelief;
  TRAINING_CONSISTENCY: ConsistencyBelief;
  RACE_PERFORMANCE: RacePerformanceBelief;
  ENVIRONMENTAL_SENSITIVITY: EnvironmentalBelief;
  INJURY_STATE: InjuryBelief;
  ILLNESS_STATE: IllnessBelief;
  DATA_QUALITY: DataQualityBelief;
  GOAL_FEASIBILITY: GoalFeasibilityBelief;
  TRAINING_PHASE: TrainingPhaseBelief;
  /** `lib/training/runner-state.ts`'s own decision, type-imported. */
  READINESS: StateDecision;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · WHAT A LOADER SUBMITS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * One owner's answer, as the loader received it.
 *
 * Notice what is NOT here: no Rule 8 side, no owner reference, no levers.
 * A loader states what it measured; the registry states what the belief IS.
 */
export interface BeliefSubmission<T> {
  readonly reading: Measured<BeliefEstimate<T>>;
  /** The owner's own confidence, unchanged. Null when it produces none. */
  readonly confidence: number | null;
  readonly sourceMode: SourceMode | null;
  readonly supporting: readonly EvidenceRef[];
  /** Evidence pointing the other way. Empty is a measurement. */
  readonly contradicting: readonly EvidenceRef[];
  readonly tension: BeliefTension | null;
  readonly recency: EvidenceRecency | null;
  /** When the owner resolved this. ISO instant. */
  readonly lastUpdatedISO: string;
}

/**
 * Every belief, submitted. TOTAL over `BeliefKey` on purpose: omitting a key
 * is a compile error, so a loader has to say `notLookedFor` rather than
 * leaving a hole that reads as a null downstream.
 */
export type RunnerBeliefInput = {
  readonly [K in BeliefKey]: BeliefSubmission<BeliefValueByKey[K]>;
};

/** The assembled model. */
export type RunnerBeliefs = {
  readonly [K in BeliefKey]: Belief<BeliefValueByKey[K]>;
};

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · SUBMISSION CONSTRUCTORS
 *
 * Three, matching Rule 11's three facts exactly, plus the measured one.
 * There is no fourth and there is no default.
 * ═══════════════════════════════════════════════════════════════════════ */

const NO_EVIDENCE: readonly EvidenceRef[] = [];

/** The owner answered. */
export function submitted<T>(args: {
  estimate: BeliefEstimate<T>;
  confidence: number | null;
  sourceMode: SourceMode | null;
  supporting?: readonly EvidenceRef[];
  contradicting?: readonly EvidenceRef[];
  tension?: BeliefTension | null;
  recency?: EvidenceRecency | null;
  lastUpdatedISO: string;
}): BeliefSubmission<T> {
  return {
    reading: { ok: true, value: args.estimate },
    confidence: args.confidence,
    sourceMode: args.sourceMode,
    supporting: args.supporting ?? NO_EVIDENCE,
    contradicting: args.contradicting ?? NO_EVIDENCE,
    tension: args.tension ?? null,
    recency: args.recency ?? null,
    lastUpdatedISO: args.lastUpdatedISO,
  };
}

/**
 * The owner looked and there is nothing to report, or it refused.
 *
 * `what` is the owner's own words where it has any. A `NormalReading`
 * refusal message goes here verbatim, because it is written in coach voice
 * and is safe to surface, and rewriting it would put a second sentence in
 * front of the runner for one fact (Rule 17).
 */
export function absentBelief<T>(what: string, atISO: string): BeliefSubmission<T> {
  return {
    reading: { ok: false, why: { kind: 'ABSENT', what } },
    confidence: null,
    sourceMode: null,
    supporting: NO_EVIDENCE,
    contradicting: NO_EVIDENCE,
    tension: null,
    recency: null,
    lastUpdatedISO: atISO,
  };
}

/** The read did not complete. Not an absence, and never a zero. */
export function failedBelief<T>(what: string, atISO: string): BeliefSubmission<T> {
  return {
    reading: { ok: false, why: { kind: 'FAILED', what } },
    confidence: null,
    sourceMode: null,
    supporting: NO_EVIDENCE,
    contradicting: NO_EVIDENCE,
    tension: null,
    recency: null,
    lastUpdatedISO: atISO,
  };
}

/**
 * The loader did not ask.
 *
 * The third fact, and the one every flat state bag in this app loses. It is
 * spelled as an ABSENT carrying a specific sentence rather than as a fourth
 * union member, because `Measured<T>` is the app's one Rule 11 union and a
 * fifth spelling of it would be the defect this directory exists to name.
 * `didNotLook` reads it back out.
 */
export function notLookedFor<T>(key: BeliefKey, atISO: string): BeliefSubmission<T> {
  return absentBelief<T>(`${NOT_LOOKED_PREFIX}${key}`, atISO);
}

/** The marker `notLookedFor` writes and `didNotLook` reads. */
export const NOT_LOOKED_PREFIX = 'not-looked-for:';

/**
 * True when this belief was never asked for, as against asked and empty.
 *
 * Takes only the `reading`, not a whole `Belief`, so it can be called across
 * the twenty differently-parameterised members of `RunnerBeliefs` without a
 * cast at every call site.
 */
export function didNotLook(b: { readonly reading: Measured<unknown> }): boolean {
  return !b.reading.ok
    && b.reading.why.kind === 'ABSENT'
    && b.reading.why.what.startsWith(NOT_LOOKED_PREFIX);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THE ASSEMBLER
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Weld one submission to its registry entry.
 *
 * Pass-through for everything the loader supplied; the registry supplies
 * everything the loader is not allowed to. No value is recomputed and no
 * confidence is adjusted, so a belief that leaves here disagreeing with its
 * owner is impossible by construction rather than by test.
 */
function weld<K extends BeliefKey>(
  key: K,
  s: BeliefSubmission<BeliefValueByKey[K]>,
): Belief<BeliefValueByKey[K]> {
  const o = BELIEF_OWNERSHIP[key];
  return {
    key,
    reading: s.reading,
    confidence: s.confidence,
    sourceMode: s.sourceMode,
    supporting: s.supporting,
    contradicting: s.contradicting,
    tension: s.tension,
    recency: s.recency,
    lastUpdatedISO: s.lastUpdatedISO,
    rule8Side: o.rule8Side,
    movesUpOn: o.movesUpOn,
    movesDownOn: o.movesDownOn,
    neverMovesOn: o.neverMovesOn,
    owner: o.canonical ?? {
      module: 'lib/runner-state/ownership.ts',
      symbol: 'BELIEF_OWNERSHIP',
      answers: `No canonical owner. ${o.conflict?.shouldOwn ?? 'Unassigned.'}`,
    },
  };
}

/**
 * THE ENTRY POINT. Assemble one coherent model of the runner.
 *
 * Call it from `lib/brain/`, which does the loading. This function is pure
 * and total: every key in, every key out, nothing computed on the way
 * through.
 */
export function assembleRunnerBeliefs(input: RunnerBeliefInput): RunnerBeliefs {
  const out = {} as { -readonly [K in BeliefKey]: Belief<BeliefValueByKey[K]> };
  for (const key of BELIEF_KEYS) {
    // The cast is confined to this one line and is what a per-key mapped
    // build costs in TypeScript: `key` is a union here, so the compiler
    // cannot see that `input[key]` and `out[key]` are the SAME member of it.
    // `weld` itself is generic over K and is fully checked.
    (out as Record<BeliefKey, unknown>)[key] =
      weld(key, input[key] as BeliefSubmission<never>);
  }
  return out as RunnerBeliefs;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · READING THE MODEL BACK
 *
 * Derived views live here so no surface re-derives them (Rule 17), and so
 * that "which beliefs are contested" has one answer rather than one per
 * screen (Rule 16).
 * ═══════════════════════════════════════════════════════════════════════ */

/** Beliefs the evidence argues with. The whole reason `tension` exists. */
export function contestedBeliefs(s: RunnerBeliefs): readonly BeliefKey[] {
  return BELIEF_KEYS.filter((k) => s[k].tension != null);
}

/** Beliefs the owner refused or found nothing for, EXCLUDING never asked. */
export function absentBeliefs(s: RunnerBeliefs): readonly BeliefKey[] {
  return BELIEF_KEYS.filter((k) => {
    const b = s[k];
    return !b.reading.ok && b.reading.why.kind === 'ABSENT' && !didNotLook(b);
  });
}

/** Beliefs whose read did not complete. A different fact, and actionable. */
export function failedBeliefs(s: RunnerBeliefs): readonly BeliefKey[] {
  return BELIEF_KEYS.filter((k) => {
    const b = s[k];
    return !b.reading.ok && b.reading.why.kind === 'FAILED';
  });
}

/** Beliefs nobody asked for on this load. */
export function unaskedBeliefs(s: RunnerBeliefs): readonly BeliefKey[] {
  return BELIEF_KEYS.filter((k) => didNotLook(s[k]));
}

/**
 * A belief that is CONFIDENT and CONTESTED at once.
 *
 * The defect this whole shape was built to make visible. Doctrine 27 says a
 * low-confidence estimate should resist large changes and prefer gathering
 * evidence; the mirror of that is that a belief the evidence argues with may
 * not keep speaking with authority. `withContradiction` caps it, so a
 * non-empty result here means a belief reached the model without going
 * through that constructor.
 */
export function overconfidentContested(s: RunnerBeliefs): readonly BeliefKey[] {
  return contestedBeliefs(s).filter((k) => {
    const c = s[k].confidence;
    return c != null && c > CONTESTED_CONFIDENCE_LIMIT;
  });
}

/**
 * The ceiling `overconfidentContested` tests against.
 *
 * THE SAME NUMBER as `CONTRADICTED_CONFIDENCE_CEILING` in `belief.ts`, and
 * it is written here rather than imported ONLY so that the check and the
 * constructor are two independent statements of the rule: importing it would
 * make the assertion pass by construction whatever the constructor did, and
 * a check that agrees with itself proves nothing (Rule 18). The gate asserts
 * the two are equal.
 */
export const CONTESTED_CONFIDENCE_LIMIT = 0.5;
