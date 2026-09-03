/**
 * lib/adaptation/adaptation-engine.ts · THE ADAPTATION ENGINE'S OWNERSHIP LAYER.
 *
 * ONE owning service answers "what should change in response to new evidence?"
 * — `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §1's Adaptation
 * Engine row, `docs/PRODUCT_COACHING_DOCTRINE_BRIEFS.md` BRIEF 07, and the
 * operational spec in `docs/ADAPTATION_PROGRESSION_DOCTRINE.md`.
 *
 *     "The calendar proposes progression. The runner earns it."
 *                                     — ADAPTATION_PROGRESSION_DOCTRINE.md
 *
 * ── THE BOUNDARY, STATED SO IT CANNOT DRIFT ─────────────────────────────────
 *
 * It PROPOSES. It does not reinterpret raw activity data and it does not
 * mutate a plan. §8's pipeline, with this file's slot marked:
 *
 *     raw activity → data quality → evidence classification → evidence ledger
 *       → capacity resolver → ADAPTATION DECISION → proposed plan change
 *                             ╰──── this file ────╯
 *
 * So it does NOT:
 *
 *   · read a `runs` row, a split or a heart rate. Every physiological judgement
 *     arrives already made, from `lib/evidence/activity-evidence.ts`. This file
 *     COUNTS and COMPARES those judgements; it never re-derives one. A
 *     `run.pace < target → speed the plan up` anywhere here would be exactly
 *     the shortcut §8 names.
 *   · resolve a capacity. `lib/training/capacity-resolver.ts` owns that, and the
 *     belief-tension consumer that lowers a corroboration bar lives THERE
 *     (`lib/evidence/reexamination.ts`) for the same reason: which evidence
 *     counts toward a belief is the Runner Model's question, not this one's.
 *   · prescribe a pace. When a PACE proposal names a number, that number is the
 *     capacity resolver's own `paceSecPerMi`, carried, never computed here.
 *   · write anything. `lib/plan/adapt.ts` still owns every mutation, unchanged.
 *
 * ── WHAT ALREADY EXISTED, AND WHAT THIS CONSOLIDATES (§53, §63, §67) ────────
 *
 * The consolidation brief's process mandate is explicit that the first move is
 * to find the current owner, not to write a new engine. The audit, and the
 * verdict for each:
 *
 *   · `lib/adaptation/adaptation-model.ts` · `classifyAdaptation` — "how well is
 *     this runner absorbing the training", five dimensions, band + CycleDecision
 *     + stepMultiplier. CORRECT AND KEPT. It is this engine's ABSORPTION input,
 *     consumed whole. Nothing here re-scores absorption.
 *   · `lib/plan/progression-pass.ts` · `resolveWeekProgression` — TAKE /
 *     ACCELERATE / HOLD / BACK_OFF over one week's quality GEOMETRY. CORRECT AND
 *     KEPT, and it is the DENSITY lever's owner: a density proposal here carries
 *     that function's own resolution rather than a second opinion about reps and
 *     recovery. This file never calls `advanceShape` itself.
 *   · `lib/plan/adaptive-ramp.ts` — the VOLUME/DURATION ceilings
 *     (`MAX_WEEKLY_BUMP_MI`, `MAX_LONG_BUMP_MI`) and the tier band. CAPS
 *     REUSED, imported, never re-typed.
 *   · `lib/training/pace-anchor.ts` — `TRAINING_LEAD_REANCHOR_DELTA`, the
 *     doctrinal upward soft-lead quantum. REUSED as the PACE lever's step
 *     ceiling.
 *   · `lib/plan/adapt.ts` · the fourteen detectors — READINESS, SAFETY, MISSED
 *     WORK, GAP, OVERSHOOT. KEPT AND ROUTED THROUGH: `runner-state.ts` already
 *     consolidated the readiness half into one typed answer, and this file
 *     consumes THAT, so there is no second readiness rule here either.
 *
 * WHAT DID NOT EXIST, and is the only thing added: ONE typed proposal, four
 * INDEPENDENT levers each with its own evidence requirement, a structural
 * one-stressor-at-a-time rule, and a ranking. `adapt.ts` emits fourteen
 * independent triggers that never see each other, so nothing in this codebase
 * could ever answer "given everything, what is the ONE smallest useful change?"
 * That question is this file, and it is the reason it is not a fifth detector.
 *
 * ── THE FOUR LEVERS ARE NOT ONE SCORE ───────────────────────────────────────
 *
 *     "Four separate questions — never one generic progression score."
 *
 *   PACE      progresses from CAPACITY evidence, and only with CONTROL.
 *   VOLUME    progresses from LOAD-TOLERANCE evidence, independent of pace.
 *   DURATION  progresses from long-run TOLERANCE, independent of both.
 *   DENSITY   progresses independently of all of them.
 *
 * Each has its own detector below, each detector receives ONLY its own slice of
 * the input, and no detector can see another's evidence. That is why the input
 * is split into named sub-objects rather than one bag: BRIEF 07's "adapt the
 * thing that changed" is a plumbing property here, not a discipline.
 *
 * ── CONTROL, AND WHY A BEATEN TARGET IS NOT EVIDENCE ────────────────────────
 *
 * The doctrine's Example A vs Example B, which is the single most load-bearing
 * distinction in this file:
 *
 *   A · `6:49 / 6:48 / 6:47 / 6:45`, controlled HR, RPE 6  → upward evidence.
 *   B · `6:30 / 6:32 / 6:45 / 7:10`, finished destroyed    → NOT evidence pace
 *                                                            should move.
 *
 * Both "beat" the target. `PACE` therefore never counts a session the Evidence
 * Engine graded `executionQuality: 'variable'` or that carried a late-run
 * pacing collapse, however fast it was. The engine already computes both; this
 * file reads them and does not recompute either.
 *
 * ── RULE 21 · THE BAR TO GO UP IS NOT HIGHER THAN THE BAR TO COME DOWN ──────
 *
 * Measured on the owner's account the night this landed: ZERO upward
 * adaptations across the entire life of `coach_intents`, against five
 * downgrades. Every threshold below has its opposite number named beside it,
 * and where the two differ the asymmetry is argued rather than inherited:
 *
 *   · PROGRESS needs `CORROBORATION_MIN_OBSERVATIONS` controlled sessions.
 *     REDUCE needs ONE readiness signal. That asymmetry is DOCTRINE — BRIEF 11
 *     puts safety above the coaching loop and §19 gives it an override channel,
 *     and there genuinely are more ways to be injured than to be ready.
 *   · But PROGRESS and HOLD sit at the SAME bar: falling one observation short
 *     of corroboration produces a HOLD proposal naming what is missing, not
 *     silence. A lever that can only ever fail to fire is the Rule 21 defect
 *     wearing a different hat.
 *   · And no PROGRESS threshold here is higher than the mechanism it routes to
 *     already required. Pushing means spending headroom doctrine already
 *     allows; it never means weakening a guard.
 *
 * ── RULE 22 · WHAT THIS FILE'S OWN GATE CANNOT FAIL ON ──────────────────────
 *
 * Stated here because Rule 22 requires it next to the liveness assertion, and
 * an unstated blind spot is the one that survives:
 *
 *   · It cannot catch a WRONG MAGNITUDE. Every reachability and doctrine test
 *     asserts which decision and which lever, and the numeric step is only
 *     bounded (never above the doctrine cap, never below zero). A +3 mi week
 *     where +1 was right passes every check here.
 *   · It cannot catch BAD EVIDENCE. It trusts `activity-evidence.ts`'s
 *     `executionQuality` completely. If that classifier calls a destroyed
 *     session controlled, this file proposes an upward pace move and no test
 *     here can tell.
 *   · It cannot say whether a proposal is GOOD COACHING, only whether it is
 *     doctrinally legal. The shadow-mode audit against the owner's real history
 *     is what produces that judgement, and it produces it for a human.
 *   · It cannot see a lever nobody wired. DENSITY refuses honestly when no plan
 *     row carries a progression block — which is the production reality today,
 *     measured 2026-08-31 at SIX rows out of 4,639 across every plan in the
 *     database — and a refusal is not the same as a mechanism that works. The
 *     refusal now names WHICH of the five reasons applies, which is the most
 *     this file can do: authoring the block is the Plan Generator's job and
 *     this engine must not grow a second opinion about session geometry.
 *   · It cannot tell whether the EVIDENCE WINDOW was the right one. It reads
 *     the lookback the loader hands it and trusts the `stalenessFactor` on it.
 *   · It cannot catch a WRONG WEEK FLAG. `WeekAheadRead` is the plan's own
 *     `is_cutback` / `is_race_week` / TAPER label, carried. A cutback week the
 *     author forgot to flag is a progression week here, and a VOLUME proposal
 *     will land on it.
 *
 * ── THE 2026-08-31 REVIEW · what changed and why ────────────────────────────
 *
 *   · A FIFTH DECISION. `INSUFFICIENT_EVIDENCE` — see `AdaptationDecision`.
 *     Every "we could not see it" branch used to land on HOLD carrying a reason
 *     code that asserts a finding.
 *   · A CONFIDENCE-WEIGHTED LOOKBACK. `EvidenceLookback`, resolved by
 *     `lib/training/normal-window.ts`. The gate no longer cliffs at day 28 when
 *     days 1-28 were a taper; it reaches back for representative training and
 *     prices the age of what it finds into `confidence`.
 *   · VOLUME ASKS TWO QUESTIONS. `historicalTolerance` beside `recentWeeks` —
 *     a plan authored yesterday knows nothing about a runner who has held 43
 *     mi/wk since June, and used to report that as `LOAD_NOT_YET_ABSORBED`.
 *   · ONE STIMULUS CHANGE PER CYCLE, not merely one PROGRESS. See
 *     `changesStimulus`: a PACE progression and a SPECIFICITY restructure were
 *     both reachable in the same `marginal` cycle and are two stressors.
 */
import { CORROBORATION_MIN_OBSERVATIONS } from '@/lib/training/vdot-corpus';
import { TRAINING_LEAD_REANCHOR_DELTA } from '@/lib/training/pace-anchor';
import { MAX_LONG_BUMP_MI, MAX_WEEKLY_BUMP_MI } from '@/lib/plan/adaptive-ramp';
import { RERAMP_WEEKLY_GROWTH } from '@/lib/plan/adapt';
import { tPaceFromVdot, vdotFromTpace } from '@/lib/training/vdot';
import { PACE_STEP_S_PER_MI, type WorkShape } from '@/lib/prescription/levers';
import { roundTo } from '@/lib/format/run';
import type { ProgressionResolution } from '@/lib/plan/progression-pass';
import type { ProgressionLever } from '@/lib/prescription/levers';
import type { AdaptationVerdict } from './adaptation-model';
import type { RunnerState, StateDecision } from '@/lib/training/runner-state';
import type { ResolvedCapacity, Immutable } from '@/lib/training/prescription-resolver';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE STATE MACHINE
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * `ADAPTATION_PROGRESSION_DOCTRINE.md` §state machine, plus the fifth state
 * Rule 11 requires and the doctrine's four-word list cannot express.
 *
 * ── WHY `INSUFFICIENT_EVIDENCE` IS A DECISION AND NOT A FLAVOUR OF HOLD ─────
 *
 * Three facts, never one:
 *
 *   PROGRESS              · the evidence supports asking for more.
 *   HOLD                  · the evidence was READ and it argues against more.
 *   INSUFFICIENT_EVIDENCE · there was no opportunity to demonstrate anything.
 *
 * The first draft of this engine had four states, and every "we could not see
 * it" branch landed on HOLD — carrying reason codes that ASSERT A FINDING. A
 * runner three days into a plan came back `HOLD · LOAD_NOT_YET_ABSORBED`, which
 * is a sentence about him, from a gate that had one week to look at. A taper
 * that generates zero threshold sessions came back `HOLD · SINGLE_STRONG_
 * SESSION_IS_NOT_CORROBORATION`, which says the sessions did not corroborate
 * when the truth is that the plan did not prescribe any.
 *
 * That is Rule 11 exactly — "don't know", "measured zero" and "the read
 * failed" are three facts — and it is the shape that made `recentQualityPerWeek`
 * answer full quality density off a prescribed recovery block. Absence of an
 * OPPORTUNITY to demonstrate capacity is not negative evidence, and a state
 * machine that cannot say so will keep saying the wrong one of the two.
 *
 * A refusal is still an ANSWER: it carries the lever, the numbers unchanged and
 * a reason naming what was missing, so it is never silence (Rule 21).
 */
export type AdaptationDecision =
  | 'PROGRESS' | 'HOLD' | 'REDUCE' | 'RESTRUCTURE' | 'INSUFFICIENT_EVIDENCE';

/** The two decisions that leave the number where it is. One definition, so a
 *  new non-moving decision cannot be added without every check seeing it. */
export const NON_MOVING_DECISIONS: ReadonlySet<AdaptationDecision> =
  new Set<AdaptationDecision>(['HOLD', 'INSUFFICIENT_EVIDENCE']);

/** The same document's `target:` row. */
export type AdaptationLever =
  | 'PACE' | 'VOLUME' | 'DURATION' | 'QUALITY_VOLUME' | 'DENSITY'
  | 'SPECIFICITY' | 'RECOVERY' | 'SCHEDULE';

/**
 * BRIEF 07's five adaptation TYPES, which are not the same axis as the lever.
 *
 * "Adapt the thing that changed. Fitness, load, schedule, goal and safety are
 * separate problems." The lever says WHAT MOVES; the domain says WHY. Pairing
 * them is what stops a missed Wednesday touching fitness, and the pairing is
 * enforced by the union in section 2 rather than by a validator — a
 * `SCHEDULE`-target proposal cannot be constructed with a pace magnitude
 * because no arm of the union has that shape.
 *
 * GOAL is deliberately absent. A goal change is Race Prediction's to surface
 * (§1), the owner's standing rule is that the coach projects and never
 * renegotiates a stated goal, and an Adaptation Engine that could emit a
 * GOAL-domain proposal is one card away from breaking it.
 */
export type AdaptationDomain = 'FITNESS' | 'LOAD' | 'SCHEDULE' | 'SAFETY';

export type AdaptationReasonCode =
  // ── PACE ──
  | 'REPEATED_CONTROLLED_QUALITY_EXECUTION'
  | 'CAPACITY_LEADS_PRESCRIPTION_BY_A_USEFUL_STEP'
  | 'SINGLE_STRONG_SESSION_IS_NOT_CORROBORATION'
  | 'EXECUTION_BEAT_TARGET_WITHOUT_CONTROL'
  | 'LATE_SESSION_DETERIORATION'
  | 'CAPACITY_NOT_DIRECTLY_EVIDENCED'
  | 'PRESCRIPTION_ALREADY_MATCHES_CAPACITY'
  | 'PACE_STEP_CLAMPED_TO_DOCTRINE_QUANTUM'
  | 'NO_QUALITY_EVIDENCE_IN_WINDOW'
  // ── VOLUME / DURATION ──
  | 'RECENT_LOAD_ABSORBED'
  | 'LOAD_NOT_YET_ABSORBED'
  | 'HISTORICAL_VOLUME_TOLERANCE_ESTABLISHED'
  | 'CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION'
  | 'STEP_HELD_TO_DEMONSTRATED_HISTORICAL_VOLUME'
  | 'NO_VOLUME_TOLERANCE_EVIDENCE'
  | 'LONG_RUN_TOLERATED_WITHOUT_COLLAPSE'
  | 'LONG_RUN_SHOWED_LATE_COLLAPSE'
  /** A long run was graded and its execution was `variable` — a READ that
   *  argues against growing it, not an absence (1.1.0; used to be reported
   *  under `NO_LONG_RUN_EVIDENCE_IN_WINDOW`, a finding wearing an absence's
   *  name). */
  | 'LONG_RUN_EXECUTION_UNCONTROLLED'
  | 'NO_LONG_RUN_EVIDENCE_IN_WINDOW'
  | 'AT_TIER_CEILING'
  | 'STEP_CLAMPED_TO_RAMP_CAP'
  /** The week the lever would move is a cutback, race week or taper. Doctrine
   *  gives those weeks no progression step — the same rule the DENSITY gate
   *  already applied (`WEEK_TAKES_NO_STEP`), now on every LOAD lever (1.1.0). */
  | 'WEEK_AHEAD_TAKES_NO_PROGRESSION_STEP'
  /** The absorption model could not read this runner (fewer than its minimum
   *  readable dimensions). An absence, never a finding (1.1.0). */
  | 'ABSORPTION_NOT_YET_READABLE'
  // ── DENSITY ──
  | 'PROGRESSION_GATE_RESOLVED_A_DENSER_SESSION'
  | 'PROGRESSION_GATE_RESOLVED_MORE_QUALITY_WORK'
  | 'PROGRESSION_GATE_HELD_THE_SESSION'
  | 'NO_PROGRESSION_TARGETS_AUTHORED'
  // ── the lookback (Rule 8's confidence-weighted extension) ──
  | 'LOOKBACK_EXTENDED_PAST_A_PRESCRIBED_PERIOD'
  | 'CONFIDENCE_DISCOUNTED_FOR_EVIDENCE_AGE'
  // ── HOLD / REDUCE / RESTRUCTURE ──
  | 'ANOTHER_LEVER_IS_PROGRESSING_THIS_CYCLE'
  | 'ABSORPTION_MARGINAL'
  | 'ABSORPTION_POOR'
  | 'STATE_SAYS_TODAY_IS_NOT_THE_DAY'
  | 'SAFETY_OVERRIDES_NORMAL_PROGRESSION'
  | 'SESSIONS_OUT_OF_PLACE'
  | 'STIMULUS_TYPE_CHANGED_RATHER_THAN_REDUCED'
  | 'TRAINING_IS_WORKING'
  // ── shared ──
  | 'EVIDENCE_UNREADABLE';

/**
 * §31 · version the model. MINOR when a lever's evidence requirement or the
 * ranking changes; PATCH when a reason code or a reported field moves without
 * changing a decision.
 *
 * 1.1.0 (2026-09-02, Phase 9 shadow finish) · MINOR, three evidence
 * requirements moved on the LOAD levers:
 *   · VOLUME and DURATION now HOLD when the week ahead is a cutback, race week
 *     or taper (`WeekAheadRead`) — the rule DENSITY's gate already applied and
 *     the two LOAD levers did not, so a +5 mi proposal could land on a taper.
 *   · VOLUME and DURATION now refuse (`INSUFFICIENT_EVIDENCE`) when the
 *     absorption model could not read the runner, instead of spending its
 *     "proceed as planned" default as permission to add load beyond the plan.
 *   · REDUCE sizes its magnitude off the week ahead's real quality-session
 *     count rather than the density gate's resolution count, which is zero on
 *     six days in seven.
 * A shadow record stamped 1.0.0 was produced under the old requirements.
 */
export const ADAPTATION_ENGINE_MODEL_VERSION = '1.1.0';

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE PROPOSAL — §9's reason object, with the levers kept apart by type
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * One magnitude type per lever, so `previous` and `proposed` are in the lever's
 * own units and cannot be in another's.
 *
 * This is the structural half of "a schedule-restructure proposal must never
 * carry a PACE target": there is no arm of `AdaptationProposal` that pairs
 * `target: 'SCHEDULE'` with a `sec_per_mi` magnitude, so the mistake does not
 * compile rather than failing a validator someone can forget to call.
 */
export type PaceMagnitude = { unit: 'sec_per_mi'; value: number };
export type VolumeMagnitude = { unit: 'weekly_mi'; value: number };
export type DurationMagnitude = { unit: 'long_run_mi'; value: number };
export type DensityMagnitude = {
  unit: 'work_shape';
  reps: number;
  repMinutes: number;
  recoveryMinutes: number;
  /** Total minutes of work — `totalWorkMinutes` of the shape, carried so a
   *  consumer does not multiply it back out and get a different answer. */
  workMinutes: number;
};
/** Total minutes of quality work in a session. Distinct from DENSITY, which
 *  is the same work packed tighter. */
export type QualityVolumeMagnitude = { unit: 'quality_minutes'; value: number };
export type SpecificityMagnitude = { unit: 'race_specific_minutes'; value: number };
export type RecoveryMagnitude = { unit: 'quality_sessions_per_week'; value: number };
export type ScheduleMagnitude = { unit: 'sessions_out_of_place'; value: number };

/**
 * The alternative that was NOT taken, and why.
 *
 * The consolidation brief's "why AND why-not, both recorded": *"a decision log
 * that only records what happened, not why the alternative was rejected, is
 * half a log."* Every proposal carries the levers it beat.
 */
export interface RejectedAlternative {
  lever: AdaptationLever;
  reasonCodes: AdaptationReasonCode[];
  detail: string;
}

interface ProposalCore {
  decision: AdaptationDecision;
  /** 0-1. How much to trust this proposal. Never a probability; an ordering. */
  confidence: number;
  /**
   * Traceable to the observations behind it (§10). `runs.id` strings for a
   * training-derived proposal, plus the capacity estimate's own `evidenceIds`
   * where a capacity moved. EMPTY only on a proposal driven purely by state,
   * where the evidence is a readiness signal rather than an activity.
   */
  supportingEvidence: string[];
  reasonCodes: AdaptationReasonCode[];
  /** One line in the coach register. BRIEF 12's voice: direct, specific, no
   *  hype. Never assembled independently of `reasonCodes` (§27). */
  explanation: string;
  /** Why the obvious alternative was not taken. */
  whyNot: RejectedAlternative[];
  resolvedAt: string;
  modelVersion: string;
}

/**
 * §9's `AdaptationProposal {type, target, previous, proposed, confidence,
 * supporting_evidence, reason_codes, explanation}`, as a discriminated union on
 * `target`.
 *
 * ONE `target` FIELD, SINGULAR. A proposal that wanted to change pace AND
 * density AND duration is not expressible: it would be three proposals, and
 * `composeAdaptation` ranks them and promotes exactly one. "Progress one
 * primary stressor at a time" is therefore a property of the type, not of the
 * caller's restraint.
 */
export type AdaptationProposal =
  | (ProposalCore & {
      target: 'PACE'; domain: 'FITNESS';
      /** The soonest phase this proposal actually touches (or, on a HOLD /
       *  INSUFFICIENT_EVIDENCE, the soonest phase read) — a single number for
       *  a caller that just wants "the headline". THE MECHANISM ITSELF is
       *  `phaseBreakdown`, never this pair alone. */
      previous: PaceMagnitude; proposed: PaceMagnitude;
      /** EVERY phase read, each with its OWN previous/proposed/step — Part 1
       *  of the 2026-09-01 decision. Never a blended average applied
       *  uniformly; see `PacePhaseOutcome`. */
      phaseBreakdown: PacePhaseOutcome[];
    })
  | (ProposalCore & {
      target: 'VOLUME'; domain: 'LOAD';
      previous: VolumeMagnitude; proposed: VolumeMagnitude;
    })
  | (ProposalCore & {
      target: 'DURATION'; domain: 'LOAD';
      previous: DurationMagnitude; proposed: DurationMagnitude;
    })
  | (ProposalCore & {
      target: 'DENSITY'; domain: 'FITNESS';
      previous: DensityMagnitude; proposed: DensityMagnitude;
      /** The progression gate's own resolution. Carried, not re-decided. */
      resolution: ProgressionResolution;
    })
  | (ProposalCore & {
      target: 'QUALITY_VOLUME'; domain: 'FITNESS';
      previous: QualityVolumeMagnitude; proposed: QualityVolumeMagnitude;
      /** The progression gate's own resolution. Carried, not re-decided. */
      resolution: ProgressionResolution;
    })
  | (ProposalCore & {
      target: 'SPECIFICITY'; domain: 'FITNESS';
      previous: SpecificityMagnitude; proposed: SpecificityMagnitude;
    })
  | (ProposalCore & {
      target: 'RECOVERY'; domain: 'SAFETY';
      previous: RecoveryMagnitude; proposed: RecoveryMagnitude;
    })
  | (ProposalCore & {
      target: 'SCHEDULE'; domain: 'SCHEDULE';
      previous: ScheduleMagnitude; proposed: ScheduleMagnitude;
    });

export type EngineRefusalCode =
  | 'NO_CAPACITY_EVIDENCE'
  | 'NO_ACTIVITY_EVIDENCE_IN_WINDOW'
  /** The plan carries no progression block to step. The AUTHORING gap. */
  | 'NO_PROGRESSION_TARGETS'
  /** The weekly pass is not due today. Nothing is wrong. */
  | 'PROGRESSION_PASS_NOT_DUE'
  /** Cutback / race week / taper — doctrine says no step this week. */
  | 'WEEK_TAKES_NO_PROGRESSION_STEP'
  | 'NO_ACTIVE_PLAN'
  | 'PROGRESSION_GATE_UNREADABLE'
  | 'STATE_UNREADABLE'
  | 'NO_LOAD_PICTURE';

export interface EngineRefusal {
  lever: AdaptationLever;
  code: EngineRefusalCode;
  detail: string;
}

export interface AdaptationProposalSet {
  todayISO: string;
  /**
   * Ranked, strongest first. AT MOST ONE carries `decision: 'PROGRESS'` —
   * asserted by `_adaptation_engine.test.ts` and by the contradiction check in
   * section 6.
   */
  proposals: AdaptationProposal[];
  /**
   * PROGRESS proposals that HAD their evidence and lost the cycle to another
   * lever. Not rejections — deferrals, and they are reported separately so the
   * next cycle (and a human reading the log) can see that the engine found two
   * things it could have pushed and deliberately pushed one.
   */
  deferred: AdaptationProposal[];
  /** Rule 11 · false when an input could not be READ, distinguishable from an
   *  input that was read and found nothing. */
  readable: boolean;
  refusals: EngineRefusal[];
  resolvedAt: string;
  modelVersion: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE INPUT — split by lever, so a detector cannot see another's evidence
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * ONE quality session, as the Evidence Engine graded it.
 *
 * Every field is lifted from `ActivityEvidenceResult` — none is computed here.
 * The mapping lives in `load-adaptation-engine.ts` so the judgement stays in
 * the layer that owns it and this file stays pure.
 */
export interface QualitySessionRead {
  activityId: string;
  dateISO: string;
  /** `capacities.threshold` / `capacities.high_intensity` produced evidence. */
  capacity: 'threshold' | 'high_intensity';
  /** `CapacityEvidence.weight`, 0-1. Only present on the `evidence` arm. */
  weight: number;
  /** Whether the Evidence Engine considered this activity capable of
   *  contributing to an anchor move at all. */
  anchorMoveCandidate: boolean;
  /** `ExecutionQuality`, straight through. THE control signal. */
  executionQuality: 'controlled' | 'variable' | 'indeterminate';
  /** `qualityUnderLoad.lateRunPacingCollapse`, or null when not measurable.
   *  Rule 11: null is not false. */
  lateRunPacingCollapse: boolean | null;
  /** `internalCost.magnitude`, or null when the read refused. */
  internalCostMagnitude: 'minimal' | 'moderate' | 'large' | null;
  /** True when the internal-cost rise sat inside doctrine's own normal band. */
  internalCostWithinNormalBand: boolean | null;
}

/** What one long run demonstrated about load tolerance. */
export interface LongRunRead {
  activityId: string;
  dateISO: string;
  distanceMi: number;
  /** Durability evidence was produced (not `no_evidence`, not
   *  `indeterminate`). */
  durabilityEvidence: boolean;
  lateRunPacingCollapse: boolean | null;
  residualCardiovascularLoad: boolean | null;
  executionQuality: 'controlled' | 'variable' | 'indeterminate';
}

/**
 * HOW FAR BACK the evidence beside it was gathered from, and what that cost in
 * confidence. `lib/training/normal-window.ts` owns both numbers; this is the
 * shape they arrive in, and nothing here recomputes either.
 *
 * Carried on the two levers whose evidence is EPISODIC — a quality session and
 * a long run happen once or twice a week, so a window emptied by a taper leaves
 * them with nothing, which is the case Rule 8's cliff was hiding. The load
 * picture does not carry one: it reads whole weeks literally, on purpose (see
 * the loader's Rule 8 note).
 */
export interface EvidenceLookback {
  /** The window the gate was designed against. */
  baseWindowDays: number;
  /** The window actually read. Equal to `baseWindowDays` on the common path. */
  windowDays: number;
  /** Days of ordinary training inside `windowDays` — prescribed taper, race and
   *  recovery days excluded at every width. */
  representativeDays: number;
  /** Prescribed days dropped from the window. */
  excludedDays: number;
  /** 0-1. What the age of the evidence costs a belief resting on it. Exactly 1
   *  when the evidence sits inside the base window. */
  stalenessFactor: number;
  /** True when the outer bound was reached before enough ordinary training
   *  was found. Distinguishable from "found it further back" (Rule 11). */
  reachedOuterBound: boolean;
}

/**
 * ONE PHASE-WORTH of prescribed threshold/tempo/cruise pricing, as the plan
 * itself groups it (`plan_phases`/`plan_weeks`).
 *
 * ── PART 1 OF THE 2026-09-01 DECISION, §2 ────────────────────────────────────
 *
 * The bug this replaces: the loader used to run one `AVG(pace_target_s_per_mi)`
 * across EVERY remaining threshold/tempo/cruise row through the end of the
 * visible plan, and `detectPace` moved that single blended number by one step.
 * On the owner's real account (2026-08-31) that average was computed across
 * QUALITY (435 s/mi), RACE-SPECIFIC (424 s/mi) and TAPER (475 s/mi) — three
 * phases whose correct paces legitimately differ by doctrine, blended into
 * 438 and then nudged uniformly. A TAPER row and a QUALITY-phase row do not
 * share a "current authored pace"; averaging them produces a number that is
 * correct for neither, and moving every future row by the SAME delta off that
 * number is imprecise in exactly the way the decision doc names.
 *
 * Never blended across phases. RACE-SPECIFIC and TAPER price threshold work
 * differently ON PURPOSE.
 */
export interface PacePhaseRead {
  /** `plan_phases.label` (e.g. 'QUALITY', 'RACE-SPECIFIC', 'TAPER'), or null
   *  when the row carries no phase — an unlabelled row is its own single-row
   *  "phase", never folded into a neighbour's blend (Rule 11). */
  phaseLabel: string | null;
  /** This phase's OWN currently-authored pace, s/mi — averaged across this
   *  phase's own rows only, never across phases. */
  prescribedSecPerMi: number;
  /** Rows backing this phase's number. */
  rowCount: number;
  firstDateISO: string;
  lastDateISO: string;
}

/**
 * One phase's OUTCOME once a PACE decision has been computed — its own
 * previous/proposed/step, so "these specific future rows, each moving by
 * their own delta relative to their own current authored pace" (the decision
 * doc's own words) is a field on the proposal, not a sentence about it.
 *
 * Reported for EVERY phase, moved or not (Rule 16 — a phase that did not
 * move is still a fact about the proposal, not silence).
 */
export interface PacePhaseOutcome extends PacePhaseRead {
  previousSecPerMi: number;
  proposedSecPerMi: number;
  stepSecPerMi: number;
  /** Whether THIS phase's own gain cleared the step and actually moved. */
  moved: boolean;
}

/** The PACE lever's slice. Capacity and quality execution, nothing else. */
export interface PaceEvidence {
  /** Grouped by phase, chronological (soonest first). Each phase is priced
   *  and moved independently — see `PacePhaseRead`. Empty when the plan
   *  carries no priced threshold/tempo/cruise row ahead. */
  phases: PacePhaseRead[];
  sessions: QualitySessionRead[];
  lookback: EvidenceLookback;
}

/**
 * WHAT WEEKLY VOLUME THIS RUNNER HAS DEMONSTRATED HE TOLERATES, over his own
 * training history and independent of when the current plan was authored.
 *
 * A HABIT / CAPABILITY question, so it is Rule 8 filtered — a taper week is not
 * evidence about what he tolerates. Deliberately SEPARATE from `recentWeeks`,
 * which asks the different question of whether THIS PLAN is being absorbed.
 * Collapsing the two is the defect this type exists to make impossible: a plan
 * authored yesterday knows nothing about a runner who has held 43 mi/wk since
 * June, and reporting that as `LOAD_NOT_YET_ABSORBED` is a finding about him
 * invented out of the engine's own youth.
 */
export type VolumeToleranceRead =
  | {
      ok: true;
      /** The filtered weekly rate, mi/wk. */
      sustainedWeeklyMi: number;
      /** Representative days behind it. */
      representativeDays: number;
      oldestISO: string;
    }
  | { ok: false; reason: 'NOT_ENOUGH_REPRESENTATIVE_TRAINING' | 'UNREADABLE' };

/**
 * WHAT KIND OF WEEK the LOAD levers would be moving.
 *
 * A cutback, a race week and a taper are weeks doctrine sizes DOWN on purpose
 * (`Research/00a` §Volume progression rules · the cutback; `Research/08` §9.1
 * · the taper). Proposing "take the week to +5 mi" against one of them is not a
 * progression, it is undoing the plan's own recovery — and until 1.1.0 nothing
 * stopped it: the DENSITY lever refused on `WEEK_TAKES_NO_STEP` while VOLUME and
 * DURATION read `currentWeeklyMi` off the taper and added to it.
 *
 * The flags are the plan's own (`plan_weeks.is_cutback`, `is_race_week`,
 * `plan_phases.label = 'TAPER'`) and the predicate is `weekRowNoStepReason` in
 * `lib/plan/progression-pass.ts` — ONE definition, shared with the density
 * gate, so the three levers cannot disagree about what a no-step week is
 * (Rule 16). Rule 11: `readable: false` is a failed read of the flags and is
 * its own state; the levers refuse on it rather than assuming the week steps.
 */
export type WeekAheadRead =
  | { readable: true; takesProgressionStep: true }
  | { readable: true; takesProgressionStep: false; reason: 'CUTBACK' | 'RACE_WEEK' | 'TAPER' }
  | { readable: false };

/** The VOLUME lever's slice. Absorbed load, and the ceiling it may not pass. */
export interface LoadEvidence {
  /** The runner's current weekly prescription, mi. */
  currentWeeklyMi: number | null;
  /** Whether the week ahead is one doctrine lets a LOAD lever grow. */
  weekAhead: WeekAheadRead;
  /**
   * Quality sessions the plan prescribes in the week ahead. The REDUCE lever's
   * `previous` magnitude — what a "one fewer quality session" reduction is one
   * fewer OF. Null when the plan could not be counted (Rule 11), never zero
   * for that reason.
   */
  qualitySessionsWeekAhead: number | null;
  /**
   * CURRENT-PLAN ABSORPTION. Completed-versus-scheduled for each of the recent
   * whole weeks, newest first. `null` scheduled means the week had no schedule
   * to compare to, which is a different fact from a week that was scheduled and
   * missed — and, on a plan authored this week, it is the ONLY fact.
   */
  recentWeeks: Array<{ weekStartISO: string; completedMi: number; scheduledMi: number | null }>;
  /** HISTORICAL VOLUME TOLERANCE. The other question, kept apart. */
  historicalTolerance: VolumeToleranceRead;
  /** The upper edge of the runner's own tier band, mi. A proposal may never
   *  cross it — `adaptive-ramp.ts` owns the band and this is its number. */
  tierWeeklyUpperMi: number | null;
}

/** The DURATION lever's slice. */
export interface LongRunEvidence {
  /** The longest run the plan currently prescribes in the week ahead, mi. */
  prescribedLongMi: number | null;
  /** The doctrine cap for this runner's distance category, mi. */
  longRunCapMi: number | null;
  /** Max week-over-week growth as a fraction, e.g. 0.30. */
  longRunWoWMaxFraction: number | null;
  /** The same read the VOLUME lever carries — one read in the loader, two
   *  consumers, so the two LOAD levers cannot disagree about the week. */
  weekAhead: WeekAheadRead;
  recent: LongRunRead[];
  lookback: EvidenceLookback;
}

/**
 * WHY the progression gate produced nothing, when it produced nothing.
 *
 * `loadProgressionWeek` returns `null` for FIVE distinct reasons and the first
 * cut of this engine reported all five as "no plan row carries a progression
 * block, an authoring gap". On five days out of seven that sentence is simply
 * false — the pass runs once per training week, so on a Thursday the honest
 * answer is "already resolved this week", not a claim about how the plan was
 * authored. Rule 11 and Rule 16 both: a reason that is right one day in seven
 * is a reason nobody can act on.
 */
export type DensityGateState =
  /** The gate ran and returned resolutions. */
  | 'RESOLVED'
  /** The gate ran and the week's rows carry no `workout_spec.progression`.
   *  A genuine AUTHORING gap, and the only one of these that is. */
  | 'NO_AUTHORED_PROGRESSION_BLOCK'
  /** Once per training week, and this is not the day. Says nothing about the
   *  plan or the runner. */
  | 'PASS_NOT_DUE_THIS_WEEK'
  /** Cutback, race week or taper. Doctrine's own rule that a recovery week
   *  carries no progression step — a correct refusal, not a gap. */
  | 'WEEK_TAKES_NO_PROGRESSION_STEP'
  | 'NO_ACTIVE_PLAN'
  /** The read failed. Never to be reported as any of the above. */
  | 'UNREADABLE';

/** The DENSITY lever's slice — the progression gate's own output, carried. */
export interface DensityEvidence {
  /** `resolveWeekProgression`'s resolutions for the week ahead. */
  resolutions: ProgressionResolution[];
  /** Why there are none, when there are none. */
  gate: DensityGateState;
}

/** The SCHEDULE lever's slice. Schedule facts ONLY — no fitness, no capacity. */
export interface ScheduleEvidence {
  /** Key sessions in the recent window that were prescribed and not completed,
   *  and that are still recoverable (a clear slot exists). */
  sessionsOutOfPlace: number;
  /** Whether a clear slot exists to move them into. */
  clearSlotsAvailable: number;
}

/**
 * Everything the engine reads.
 *
 * NO GOAL FIELD, and the compile-time assertion in section 7 makes adding one a
 * build error. A stated goal must not be able to create a PACE proposal, and
 * §6's rule is that the service which cannot see the goal cannot train toward
 * it.
 *
 * `capacity` and `state` arrive `Immutable<>` for §7's reason: an adaptation
 * that wrote a state adjustment back onto a capacity estimate would collapse
 * fitness and readiness, and here it does not typecheck.
 */
export interface AdaptationEngineInput {
  todayISO: string;
  capacity: Immutable<ResolvedCapacity>;
  state: Immutable<RunnerState>;
  /** `classifyAdaptation`'s verdict. Consumed whole; never re-scored. */
  absorption: AdaptationVerdict;
  pace: PaceEvidence;
  load: LoadEvidence;
  longRun: LongRunEvidence;
  density: DensityEvidence;
  schedule: ScheduleEvidence;
  /** Rule 11 · false when one of the reads above FAILED rather than came back
   *  empty. A failed read must never look like a runner with no evidence. */
  readable: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THE BARS — every one named beside its opposite number (Rule 21)
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * How many CONTROLLED corroborating quality sessions license a pace proposal.
 *
 * `CORROBORATION_MIN_OBSERVATIONS`, imported. Not a new number: the corpus
 * reader, the capacity resolver and this engine all mean the same thing by
 * "corroborated", and a second constant would be two opinions about it
 * (Rule 16). The doctrine's own words are "two or three corroborating sessions
 * make it much more believable"; three is the app's existing choice and this
 * file does not get to relax it.
 *
 * ITS OPPOSITE NUMBER: `REDUCE` fires on ONE readiness signal. Argued in the
 * header — safety sits above the coaching loop (BRIEF 11), and that asymmetry
 * is doctrine rather than habit.
 */
export const PACE_PROGRESS_MIN_SESSIONS = CORROBORATION_MIN_OBSERVATIONS;

/**
 * The smallest pace change worth proposing, s/mi.
 *
 * `PACE_STEP_S_PER_MI` from `lib/prescription/levers.ts`, imported — the same
 * quantum the calendar's own progression uses, so the adaptation engine and the
 * plan author cannot disagree about what "one step" means. BRIEF 07's worked
 * example says the same thing in the runner's units: "approximately 5-8 sec/mi
 * faster".
 *
 * ITS OPPOSITE NUMBER: none. There is no minimum SIZE for a reduction, because
 * a safety reduction is sized by the reason, not by whether it is worth
 * mentioning.
 */
export const PACE_PROGRESS_MIN_STEP_SEC_PER_MI = PACE_STEP_S_PER_MI;

/**
 * How many recent whole weeks must show load actually absorbed.
 *
 * TWO, and deliberately BELOW the pace bar of three. The asymmetry runs the
 * other way here on purpose: load tolerance is measured on a weekly cycle and
 * three whole weeks is the better part of a mesocycle, so requiring three would
 * make the volume lever slower than the block it is meant to shape. It is also
 * the number `adaptive-ramp.ts` already uses for its own quality gate ("the
 * last 2 prescribed key sessions"), so the two upward paths agree.
 */
export const VOLUME_PROGRESS_MIN_ABSORBED_WEEKS = 2;

/**
 * What fraction of a scheduled week must be completed for it to count as
 * absorbed.
 *
 * 0.90 · the same shape as `completionThresholdMi`'s ≥60%-of-a-prescription
 * rule in `adapt.ts`, raised because that answers "did this session happen"
 * and this answers "did the runner take the whole week's load". Doctrine's
 * requirement is "consistently completing current volume"; ninety percent of a
 * week, twice, is the smallest reading of that which is not just "showed up".
 */
export const VOLUME_ABSORBED_SHARE = 0.90;

/**
 * How many recent long runs must be tolerated before duration may grow.
 *
 * ONE, and this is the lever's real asymmetry, stated rather than hidden: a
 * long run happens once a week, so requiring corroboration across three would
 * mean the long run could grow at most once a month. Doctrine's own test is
 * about the LAST one — "did they finish functioning like a runner who could
 * have reasonably absorbed it?" — and it is a single-observation question by
 * construction.
 *
 * The safety this gives up is bought back by the caps: a duration proposal is
 * bounded by `MAX_LONG_BUMP_MI`, by the week-over-week fraction, AND by the
 * absolute per-distance ceiling, all three of which are doctrine-bound
 * elsewhere and none of which this file may widen.
 */
export const DURATION_PROGRESS_MIN_TOLERATED_LONGS = 1;

/**
 * The order a PROGRESS lever is chosen in when more than one has earned it.
 *
 * SMALLEST USEFUL STRESSOR FIRST, and it is doctrine, not taste. BRIEF 04: "Do
 * not automatically use pace as the primary progression mechanism."
 * ADAPTATION_PROGRESSION_DOCTRINE: "what is the smallest useful progression?"
 * Density changes the shape of one session; pace changes every prescribed
 * number in the block. So pace goes last.
 *
 * It also happens to be the ordering that corrects this engine's measured
 * disposition: the historical failure was not that pace moved too often, it was
 * that nothing moved at all, and the cheapest lever is the one most likely to
 * clear its bar and break the zero.
 */
export const PROGRESS_LEVER_ORDER: readonly AdaptationLever[] = [
  'DENSITY', 'QUALITY_VOLUME', 'DURATION', 'VOLUME', 'PACE',
];

/**
 * THE ABSORPTION GATE ON LOAD PROGRESSION, and why it reads the DECISION rather
 * than the band.
 *
 * `classifyAdaptation` already answers "has this runner earned more training
 * stress" and says so in one word: PROGRESS / STAY / MODIFY / PROTECT. Reading
 * its BAND and re-deriving a verdict from it would be a second opinion about a
 * question that has an owner (§2), and the first draft of this file had exactly
 * that bug — `detectVolume` checked `band === 'marginal' || band === 'poor'`
 * while `detectDuration` checked nothing at all, so two LOAD-domain levers
 * disagreed about whether the same runner was absorbing his training. The
 * shadow-mode run against the owner's real account is what surfaced it: his
 * absorption read `marginal`, volume held, and the long run grew anyway.
 *
 * `decision === 'PROGRESS'` covers bands `strong` AND `normal`, so this is not
 * a high bar — it is the absorption model's own line, used once.
 *
 * ── THREE ANSWERS, NOT TWO (1.1.0, Rule 11) ──────────────────────────────────
 *
 * `classifyAdaptation` returns `PROGRESS` in TWO situations that are opposite
 * facts: the runner was read and is absorbing the work, and the runner could
 * not be read at all (fewer than `MIN_DIMENSIONS_FOR_VERDICT` readable
 * dimensions), where "proceed as planned" means the CALENDAR's own step may
 * proceed. A boolean gate collapsed them, so a runner three days into an
 * account, with a Strava import behind him, cleared the load gate and could be
 * handed a +5 mi week off historical tolerance while the absorption model was
 * saying "I cannot see you". The verdict now says which it was
 * (`evidenceSufficient`), and the LOAD levers refuse on the second rather than
 * spending it.
 *
 * ITS OPPOSITE NUMBER: `detectReduce` reads `band === 'poor'`, which an
 * unreadable runner never is — so insufficient evidence blocks the upward LOAD
 * path AND the downward one from this input. Symmetric, as Rule 21 requires.
 */
type LoadAbsorptionGate = 'PERMITS' | 'HOLDS' | 'INSUFFICIENT';

function loadAbsorptionGate(v: AdaptationVerdict): LoadAbsorptionGate {
  if (v.evidenceSufficient === false) return 'INSUFFICIENT';
  return v.decision === 'PROGRESS' ? 'PERMITS' : 'HOLDS';
}

/**
 * The reason a week ahead forbids a LOAD progression, said once for both
 * levers. Null when the week steps. `readable: false` is returned as a
 * refusal, not a hold — the flags could not be read, and a lever that assumed
 * the week steps would be adding load on an assumption (Rule 11).
 */
function weekAheadBlock(
  w: WeekAheadRead,
): { decision: 'HOLD' | 'INSUFFICIENT_EVIDENCE'; code: AdaptationReasonCode; sentence: string } | null {
  if (!w.readable) {
    return {
      decision: 'INSUFFICIENT_EVIDENCE',
      code: 'EVIDENCE_UNREADABLE',
      sentence: 'The week ahead could not be read from the plan, so nothing is added to it on an assumption.',
    };
  }
  if (w.takesProgressionStep) return null;
  const noun = w.reason === 'CUTBACK' ? 'a cutback week'
    : w.reason === 'RACE_WEEK' ? 'race week'
      : 'inside the taper';
  return {
    decision: 'HOLD',
    code: 'WEEK_AHEAD_TAKES_NO_PROGRESSION_STEP',
    sentence: `The week ahead is ${noun}, which takes no progression step by design.`,
  };
}

/**
 * THE ABSORPTION GATE ON PACE, which is deliberately LOWER, and argued.
 *
 * Pace progression is licensed by DEMONSTRATED CAPACITY UNDER CONTROL, and
 * absorption answers a load question. A runner who has executed three quality
 * sessions with control has demonstrated they hold the intensity; a `marginal`
 * absorption read says the weekly LOAD is not being absorbed cleanly, which is
 * a reason not to add miles rather than a reason to disbelieve the sessions.
 * Doctrine puts the two side by side: "If pace is going well but long-run
 * durability is lagging, progress duration instead" — the levers are
 * independent, so their gates are too.
 *
 * So pace is blocked only by the bands that mean something is wrong: `poor`,
 * Recorded rather than assumed: this asymmetry does NOT change
 * the owner's shadow-mode outcome either way (his pace lever is held one
 * session short of corroboration regardless), so it is a design call and not a
 * number chosen to produce a result.
 */
function absorptionPermitsPaceProgression(v: AdaptationVerdict): boolean {
  return v.band !== 'poor';
}

/** State decisions that forbid any upward proposal this cycle. */
const STATE_BLOCKS_PROGRESS: ReadonlySet<StateDecision> = new Set<StateDecision>([
  'proceed_with_caution', 'reduce', 'replace', 'recover', 'stop',
]);

/** State decisions that ARGUE for a reduction on their own. */
const STATE_ARGUES_REDUCE: ReadonlySet<StateDecision> = new Set<StateDecision>([
  'reduce', 'replace', 'recover', 'stop',
]);

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · THE FOUR LEVERS — each sees only its own evidence
 * ═══════════════════════════════════════════════════════════════════════ */

// THE canonical one-decimal rounding (`lib/format/run.ts`), not a local copy.
// `_format_lint.test.ts` caught the hand-rolled `Math.round(x*10)/10` this file
// shipped with: one way to write a distance down, in one place.
const round1 = (x: number): number => roundTo(x, 1);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * A session counts toward a PACE proposal only if it was CONTROLLED.
 *
 * The Example A / Example B test, in one predicate. `variable` execution and a
 * late-run pacing collapse are each disqualifying on their own, however fast
 * the session was and however much capacity evidence it produced.
 *
 * `indeterminate` does not count either, and that is Rule 11 rather than
 * conservatism: "we could not tell whether this was controlled" is not
 * "it was controlled".
 */
export function sessionDemonstratesControl(s: QualitySessionRead): boolean {
  if (s.executionQuality !== 'controlled') return false;
  if (s.lateRunPacingCollapse === true) return false;
  return true;
}

/**
 * One phase's step, computed against ITS OWN currently-authored pace.
 *
 * The step ceiling is anchored on THAT PHASE's `prescribedSecPerMi`, exactly
 * as the pre-fix single-value version anchored on the blended average — the
 * doctrinal soft-lead quantum ("one training-lead VDOT point, priced at this
 * runner's own level") is a property of the pace being moved FROM, and a
 * phase's own prescribed pace is the only honest anchor for that phase's own
 * step. `gain < 0` (this phase's own prescription is already faster than
 * believed capacity — e.g. a RACE-SPECIFIC phase deliberately pricing
 * marathon-pace segments near threshold) and `gain` below the doctrine
 * minimum are both "no move for this phase", kept apart in `moved`.
 */
function phaseStep(
  phase: PacePhaseRead,
  believedSecPerMi: number,
): PacePhaseOutcome {
  const prescribed = phase.prescribedSecPerMi;
  const gain = prescribed - believedSecPerMi;
  if (gain < PACE_PROGRESS_MIN_STEP_SEC_PER_MI) {
    return { ...phase, previousSecPerMi: prescribed, proposedSecPerMi: prescribed, stepSecPerMi: 0, moved: false };
  }
  const believedVdot = vdotFromTpace(prescribed);
  const stepCeiling = believedVdot != null
    ? (() => {
        const faster = tPaceFromVdot(believedVdot + TRAINING_LEAD_REANCHOR_DELTA);
        return faster != null ? Math.max(PACE_PROGRESS_MIN_STEP_SEC_PER_MI, prescribed - faster) : gain;
      })()
    : gain;
  const step = Math.min(gain, stepCeiling);
  return {
    ...phase,
    previousSecPerMi: prescribed,
    proposedSecPerMi: round1(prescribed - step),
    stepSecPerMi: step,
    moved: true,
  };
}

/** Every phase, unmoved — the shape a HOLD / INSUFFICIENT_EVIDENCE PACE
 *  proposal carries, since none of them got far enough to compute a step. */
const flatBreakdown = (phases: readonly PacePhaseRead[]): PacePhaseOutcome[] =>
  phases.map((p) => ({
    ...p, previousSecPerMi: p.prescribedSecPerMi, proposedSecPerMi: p.prescribedSecPerMi,
    stepSecPerMi: 0, moved: false,
  }));

/** PACE · progresses from capacity evidence, and only with control. */
function detectPace(
  capacity: Immutable<ResolvedCapacity>,
  evidence: PaceEvidence,
  absorption: AdaptationVerdict,
  now: string,
): { proposal: AdaptationProposal | null; hold: AdaptationProposal | null } {
  const controlled = evidence.sessions.filter(sessionDemonstratesControl);
  const uncontrolled = evidence.sessions.filter((s) => !sessionDemonstratesControl(s));
  const collapsed = uncontrolled.filter((s) => s.lateRunPacingCollapse === true);

  const phases = evidence.phases;
  // The SOONEST phase — chronological order is the loader's contract — stands
  // in as the single-number headline on a HOLD / INSUFFICIENT_EVIDENCE
  // proposal, where nothing was computed per phase because an earlier gate
  // (absorption, source mode, corroboration count) already stopped things.
  const nearest = phases[0] ?? null;
  const believed = capacity.threshold.paceSecPerMi;
  const reasons: AdaptationReasonCode[] = [];
  const ids = controlled.map((s) => s.activityId);

  const lookbackNote = lookbackReasons(evidence.lookback);

  const holdWith = (
    codes: AdaptationReasonCode[],
    explanation: string,
    decision: 'HOLD' | 'INSUFFICIENT_EVIDENCE' = 'HOLD',
  ): AdaptationProposal | null => {
    if (nearest == null) return null;
    return {
      decision, target: 'PACE', domain: 'FITNESS',
      previous: { unit: 'sec_per_mi', value: nearest.prescribedSecPerMi },
      proposed: { unit: 'sec_per_mi', value: nearest.prescribedSecPerMi },
      phaseBreakdown: flatBreakdown(phases),
      confidence: clamp01(capacity.threshold.confidence),
      supportingEvidence: ids,
      reasonCodes: [...codes, ...lookbackNote],
      explanation,
      whyNot: [],
      resolvedAt: now, modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
    };
  };

  if (nearest == null) {
    return { proposal: null, hold: null };
  }

  // The capacity resolver has to be speaking from the runner's own training.
  // A pace proposal off a VDOT fallback would be proposing a change on the
  // strength of an assumption (§17: a direct estimate with four supporting
  // workouts is not equivalent to a guess derived from a self-reported 10K).
  if (!absorptionPermitsPaceProgression(absorption)) {
    return {
      proposal: null,
      hold: holdWith(
        ['ABSORPTION_POOR'],
        'Threshold pace holds while the block is not being absorbed.',
      ),
    };
  }

  if (capacity.threshold.sourceMode !== 'direct') {
    // NOT a hold. A fallback estimate means we have not measured this runner's
    // threshold, which is an absence of evidence, not evidence against him.
    return {
      proposal: null,
      hold: holdWith(
        ['CAPACITY_NOT_DIRECTLY_EVIDENCED'],
        'No recent threshold work to price the target from. The current estimate rests on '
          + 'a fallback, so the target stays where it is until there is something to read.',
        'INSUFFICIENT_EVIDENCE',
      ),
    };
  }

  if (controlled.length < PACE_PROGRESS_MIN_SESSIONS) {
    /* THE THREE-STATE SPLIT (Rule 11, and the owner's point 6).
     *
     *   · sessions were run and they did NOT hold together  → HOLD. That is a
     *     read, and it argues against moving the target.
     *   · sessions were run, held together, and there are simply not enough of
     *     them yet, or there were none at all → INSUFFICIENT_EVIDENCE. A taper
     *     that prescribes no threshold work has not told us the runner cannot
     *     hold the pace; it has told us nothing.
     *
     * Collapsing these is how "the plan gave him no chance to show us" ends up
     * rendered as "his sessions did not corroborate". */
    if (collapsed.length > 0) reasons.push('LATE_SESSION_DETERIORATION');
    if (uncontrolled.length > 0) reasons.push('EXECUTION_BEAT_TARGET_WITHOUT_CONTROL');
    const evidenceArguesAgainst = uncontrolled.length > 0;
    if (evidence.sessions.length === 0) reasons.push('NO_QUALITY_EVIDENCE_IN_WINDOW');
    else reasons.push('SINGLE_STRONG_SESSION_IS_NOT_CORROBORATION');
    return {
      proposal: null,
      hold: holdWith(
        reasons,
        evidence.sessions.length === 0
          ? `No quality session in the last ${evidence.lookback.windowDays} days to read. `
            + 'The threshold target stays where it is.'
          : `Threshold pace holds. ${controlled.length} of the last ${evidence.sessions.length} `
            + `quality sessions held together; ${PACE_PROGRESS_MIN_SESSIONS} are needed before the `
            + 'target moves.',
        evidenceArguesAgainst ? 'HOLD' : 'INSUFFICIENT_EVIDENCE',
      ),
    };
  }

  /* ── PART 1 OF THE 2026-09-01 DECISION · EVERY PHASE, PRICED ON ITS OWN ──
   *
   * No blended average. Each phase's own prescribed pace is compared to the
   * SAME believed capacity (capacity is one number — it is a belief about the
   * runner, not about the plan), and each phase's step is bounded by ITS OWN
   * doctrinal quantum, anchored on ITS OWN prescribed pace. A phase whose own
   * prescription is already at or ahead of capacity (RACE-SPECIFIC, often;
   * TAPER, by design) reports `moved: false` rather than being dragged along
   * by a neighbour's gain. */
  const breakdown = phases.map((p) => phaseStep(p, believed));
  const moving = breakdown.filter((b) => b.moved);

  if (moving.length === 0) {
    return {
      proposal: null,
      hold: holdWith(
        ['REPEATED_CONTROLLED_QUALITY_EXECUTION', 'PRESCRIPTION_ALREADY_MATCHES_CAPACITY'],
        'Threshold pace holds. The work is going well and every upcoming phase already prices at '
          + 'or ahead of what the evidence supports.',
      ),
    };
  }

  reasons.push('REPEATED_CONTROLLED_QUALITY_EXECUTION', 'CAPACITY_LEADS_PRESCRIPTION_BY_A_USEFUL_STEP');
  if (moving.some((b) => b.stepSecPerMi < (b.prescribedSecPerMi - believed))) {
    reasons.push('PACE_STEP_CLAMPED_TO_DOCTRINE_QUANTUM');
  }
  reasons.push(...lookbackNote);

  // THE STALENESS PRICE. A belief carried by sessions the lookback had to reach
  // back for is a weaker belief, and it says so in the one field a consumer
  // orders proposals by. The MAGNITUDE is untouched — evidence that is older is
  // not evidence for a smaller step, it is the same evidence trusted less, and
  // shrinking the step instead would have hidden the discount inside a number
  // the runner reads as a prescription.
  const confidence = clamp01(capacity.threshold.confidence * evidence.lookback.stalenessFactor);

  const soonest = moving[0];
  const phaseList = moving
    .map((b) => `${b.phaseLabel ?? 'unphased'} ${Math.round(b.stepSecPerMi)} sec/mi quicker `
      + `(${b.rowCount} row${b.rowCount === 1 ? '' : 's'}, ${b.firstDateISO}–${b.lastDateISO})`)
    .join('; ');

  return {
    proposal: {
      decision: 'PROGRESS', target: 'PACE', domain: 'FITNESS',
      previous: { unit: 'sec_per_mi', value: soonest.previousSecPerMi },
      proposed: { unit: 'sec_per_mi', value: soonest.proposedSecPerMi },
      phaseBreakdown: breakdown,
      confidence,
      supportingEvidence: [...ids, ...capacity.threshold.evidenceIds],
      reasonCodes: reasons,
      explanation:
        `Your recent threshold work consistently supports faster training. `
        + `Move ${moving.length} of ${phases.length} upcoming phase${moving.length === 1 ? '' : 's'} `
        + `of threshold/tempo/cruise work: ${phaseList}.`,
      whyNot: [],
      resolvedAt: now, modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
    },
    hold: null,
  };
}

/**
 * The reason codes a widened or discounted lookback contributes, on every
 * proposal that rests on it.
 *
 * Written once so the six sites that build a pace or duration proposal cannot
 * each decide separately whether to mention that the evidence came from further
 * back than the gate's own window. A proposal that quietly spends stale
 * evidence is the Rule 20 shape: a rule nothing states is a rule nobody checks.
 */
function lookbackReasons(l: EvidenceLookback): AdaptationReasonCode[] {
  const out: AdaptationReasonCode[] = [];
  if (l.windowDays > l.baseWindowDays) out.push('LOOKBACK_EXTENDED_PAST_A_PRESCRIBED_PERIOD');
  if (l.stalenessFactor < 1) out.push('CONFIDENCE_DISCOUNTED_FOR_EVIDENCE_AGE');
  return out;
}

/** VOLUME · progresses from load tolerance, independent of pace capacity. */
function detectVolume(
  evidence: LoadEvidence,
  absorption: AdaptationVerdict,
  now: string,
): { proposal: AdaptationProposal | null; hold: AdaptationProposal | null } {
  const current = evidence.currentWeeklyMi;
  if (current == null || current <= 0) return { proposal: null, hold: null };

  const holdWith = (
    codes: AdaptationReasonCode[],
    explanation: string,
    decision: 'HOLD' | 'INSUFFICIENT_EVIDENCE' = 'HOLD',
  ): AdaptationProposal => ({
    decision, target: 'VOLUME', domain: 'LOAD',
    previous: { unit: 'weekly_mi', value: round1(current) },
    proposed: { unit: 'weekly_mi', value: round1(current) },
    confidence: absorption.confidence === 'high' ? 0.8 : absorption.confidence === 'medium' ? 0.6 : 0.4,
    supportingEvidence: [],
    reasonCodes: codes,
    explanation,
    whyNot: [],
    resolvedAt: now, modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
  });

  /* ── THE WEEK ITSELF, FIRST (1.1.0) ───────────────────────────────────────
   * Before asking whether the runner has earned more, ask whether the week is
   * one that may be given more. A cutback or a taper is sized down on purpose,
   * and no amount of absorbed load is a reason to undo that. Checked before the
   * evidence so the reason a runner reads is the proximate one. */
  const weekBlock = weekAheadBlock(evidence.weekAhead);
  if (weekBlock) {
    return {
      proposal: null,
      hold: holdWith(
        [weekBlock.code],
        `Weekly volume holds at ${round1(current)} mi. ${weekBlock.sentence}`,
        weekBlock.decision,
      ),
    };
  }

  const scheduled = evidence.recentWeeks.filter((w) => w.scheduledMi != null && w.scheduledMi > 0);
  const absorbed = scheduled.filter((w) => w.completedMi >= (w.scheduledMi as number) * VOLUME_ABSORBED_SHARE);

  /* ── TWO QUESTIONS, KEPT APART ────────────────────────────────────────────
   *
   * The defect this replaces: a single test on `absorbed.length` answered BOTH
   * "has this runner absorbed the load" and "do I have enough of this plan to
   * tell". A plan authored yesterday covers one comparable week, so the gate
   * reported `LOAD_NOT_YET_ABSORBED` — a finding about the runner — off the
   * engine's own youth. Measured on the owner's account on 2026-08-31: his plan
   * was authored the same morning and covered exactly one whole week, while his
   * completed history had held 37-48 mi/wk since June.
   *
   * So: CURRENT-PLAN ABSORPTION answers when it can, and when it cannot the
   * question falls back to HISTORICAL VOLUME TOLERANCE with the step held to
   * what the history actually demonstrates. It never falls through to a
   * finding, which is Rule 11 and the owner's "confidence-weighted, not
   * amnesia". */
  const planTooYoung = scheduled.length < VOLUME_PROGRESS_MIN_ABSORBED_WEEKS;
  const historical = evidence.historicalTolerance;
  /** Set only when the decision rested on history; caps the step below. */
  let historicalCeilingMi: number | null = null;

  if (planTooYoung) {
    if (!historical.ok) {
      return {
        proposal: null,
        hold: holdWith(
          ['CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION', 'NO_VOLUME_TOLERANCE_EVIDENCE'],
          `Weekly volume stays at ${round1(current)} mi. Only ${scheduled.length} whole week`
            + `${scheduled.length === 1 ? '' : 's'} of this plan can be compared yet, and there is `
            + 'not enough representative training behind it either.',
          'INSUFFICIENT_EVIDENCE',
        ),
      };
    }
    if (historical.sustainedWeeklyMi < current * VOLUME_ABSORBED_SHARE) {
      // History exists and it does NOT support the week the plan is asking for.
      // That is a read, so it is a HOLD.
      return {
        proposal: null,
        hold: holdWith(
          ['CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION', 'LOAD_NOT_YET_ABSORBED'],
          `Weekly volume holds at ${round1(current)} mi. Your own recent training averages `
            + `${round1(historical.sustainedWeeklyMi)} mi a week, which is below the week already `
            + 'prescribed.',
        ),
      };
    }
    historicalCeilingMi = historical.sustainedWeeklyMi;
  } else if (absorbed.length < VOLUME_PROGRESS_MIN_ABSORBED_WEEKS) {
    return {
      proposal: null,
      hold: holdWith(
        ['LOAD_NOT_YET_ABSORBED'],
        `Weekly volume holds at ${round1(current)} mi. `
          + `${absorbed.length} of the last ${scheduled.length} scheduled week`
          + `${scheduled.length === 1 ? '' : 's'} came in complete; `
          + `${VOLUME_PROGRESS_MIN_ABSORBED_WEEKS} are needed before the week grows.`,
      ),
    };
  }

  const gate = loadAbsorptionGate(absorption);
  if (gate === 'INSUFFICIENT') {
    return {
      proposal: null,
      hold: holdWith(
        ['ABSORPTION_NOT_YET_READABLE'],
        `Weekly volume stays at ${round1(current)} mi. There is not enough training evidence yet `
          + 'to read how the load is being absorbed, so nothing is added beyond the plan.',
        'INSUFFICIENT_EVIDENCE',
      ),
    };
  }
  if (gate === 'HOLDS') {
    return {
      proposal: null,
      hold: holdWith(
        [absorption.band === 'poor' ? 'ABSORPTION_POOR' : 'ABSORPTION_MARGINAL'],
        `Weekly volume holds at ${round1(current)} mi. The load is being completed but not `
          + 'absorbed cleanly.',
      ),
    };
  }

  const ceiling = evidence.tierWeeklyUpperMi;
  if (ceiling != null && current >= ceiling) {
    return {
      proposal: null,
      hold: holdWith(
        ['RECENT_LOAD_ABSORBED', 'AT_TIER_CEILING'],
        `Weekly volume holds at ${round1(current)} mi, the top of the band for this block.`,
      ),
    };
  }

  // FOUR CAPS, all owned elsewhere, none widened here:
  //   · MAX_WEEKLY_BUMP_MI      · adaptive-ramp.ts's absolute per-bump ceiling
  //   · RERAMP_WEEKLY_GROWTH    · adapt.ts's 10% week-over-week growth rule
  //   · tierWeeklyUpperMi       · the runner's own tier band
  //   · historicalCeilingMi     · set ONLY when the decision rested on history
  //     rather than on this plan's own absorption. Falling back to history buys
  //     the runner the volume he has ALREADY HELD and not one mile past it: the
  //     history says he tolerates 43 mi/wk, it does not say he tolerates 48,
  //     and spending an unproven step off an unproven week is how a fallback
  //     turns into a spike. Rule 8's corollary in the other direction.
  const byAbsolute = current + MAX_WEEKLY_BUMP_MI;
  const byFraction = current * RERAMP_WEEKLY_GROWTH;
  let uncapped = Math.min(byAbsolute, byFraction);
  if (historicalCeilingMi != null) uncapped = Math.min(uncapped, historicalCeilingMi);
  const proposed = round1(ceiling != null ? Math.min(uncapped, ceiling) : uncapped);
  if (proposed <= current) {
    // WHICH ceiling bound it matters, and used to be reported as the tier band
    // whichever one it was. "You are at the top of the block's band" and "the
    // plan has already reached the volume your own history supports" are
    // different sentences, and only one of them is true here.
    const boundByHistory = historicalCeilingMi != null && historicalCeilingMi <= (ceiling ?? Infinity);
    return {
      proposal: null,
      hold: boundByHistory
        ? holdWith(
            ['CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION', 'STEP_HELD_TO_DEMONSTRATED_HISTORICAL_VOLUME'],
            `Weekly volume holds at ${round1(current)} mi. This plan is too new to judge, and it is `
              + `already at the ${round1(historicalCeilingMi as number)} mi a week your own training `
              + 'supports.',
          )
        : holdWith(
            ['RECENT_LOAD_ABSORBED', 'AT_TIER_CEILING'],
            `Weekly volume holds at ${round1(current)} mi. There is no headroom left in the band.`,
          ),
    };
  }

  const reasons: AdaptationReasonCode[] = historicalCeilingMi != null
    ? ['HISTORICAL_VOLUME_TOLERANCE_ESTABLISHED', 'CURRENT_PLAN_TOO_YOUNG_TO_JUDGE_ABSORPTION']
    : ['RECENT_LOAD_ABSORBED'];
  if (proposed < round1(byAbsolute)) reasons.push('STEP_CLAMPED_TO_RAMP_CAP');
  if (historicalCeilingMi != null && round1(uncapped) <= round1(historicalCeilingMi)) {
    reasons.push('STEP_HELD_TO_DEMONSTRATED_HISTORICAL_VOLUME');
  }

  // A step taken on history rather than on this plan's own record is a weaker
  // claim, and the confidence field is where that belongs.
  const confidence = (absorption.confidence === 'high' ? 0.8 : absorption.confidence === 'medium' ? 0.6 : 0.4)
    * (historicalCeilingMi != null ? 0.75 : 1);

  return {
    proposal: {
      decision: 'PROGRESS', target: 'VOLUME', domain: 'LOAD',
      previous: { unit: 'weekly_mi', value: round1(current) },
      proposed: { unit: 'weekly_mi', value: proposed },
      confidence: clamp01(confidence),
      supportingEvidence: [],
      reasonCodes: reasons,
      explanation: historicalCeilingMi != null
        ? `This plan is too new to judge, and your own training has been holding `
          + `${round1(historicalCeilingMi)} mi a week. Take the week to ${proposed} mi.`
        : `The last ${absorbed.length} weeks were absorbed at ${round1(current)} mi. `
          + `Take the week to ${proposed} mi.`,
      whyNot: [],
      resolvedAt: now, modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
    },
    hold: null,
  };
}

/** DURATION · progresses from long-run tolerance, independent of both. */
function detectDuration(
  evidence: LongRunEvidence,
  absorption: AdaptationVerdict,
  now: string,
): { proposal: AdaptationProposal | null; hold: AdaptationProposal | null } {
  const current = evidence.prescribedLongMi;
  if (current == null || current <= 0) return { proposal: null, hold: null };

  const lookbackNote = lookbackReasons(evidence.lookback);

  const holdWith = (
    codes: AdaptationReasonCode[], explanation: string, ids: string[],
    decision: 'HOLD' | 'INSUFFICIENT_EVIDENCE' = 'HOLD',
  ): AdaptationProposal => ({
    decision, target: 'DURATION', domain: 'LOAD',
    previous: { unit: 'long_run_mi', value: round1(current) },
    proposed: { unit: 'long_run_mi', value: round1(current) },
    confidence: 0.6,
    supportingEvidence: ids,
    reasonCodes: [...codes, ...lookbackNote],
    explanation,
    whyNot: [],
    resolvedAt: now, modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
  });

  // THE WEEK ITSELF, FIRST (1.1.0) — the same check VOLUME makes, on the same
  // read. A taper's long run is short by design.
  const weekBlock = weekAheadBlock(evidence.weekAhead);
  if (weekBlock) {
    return {
      proposal: null,
      hold: holdWith(
        [weekBlock.code],
        `The long run holds at ${round1(current)} mi. ${weekBlock.sentence}`,
        [],
        weekBlock.decision,
      ),
    };
  }

  // THE SAME GATE VOLUME USES. Both are LOAD-domain levers, so both ask the
  // absorption model the same question and get the same answer. See
  // `loadAbsorptionGate` for the shadow-mode run that caught these two
  // disagreeing, and for why it has three answers rather than two.
  const gate = loadAbsorptionGate(absorption);
  if (gate === 'INSUFFICIENT') {
    return {
      proposal: null,
      hold: holdWith(
        ['ABSORPTION_NOT_YET_READABLE'],
        `The long run stays at ${round1(current)} mi. There is not enough training evidence yet `
          + 'to read how the load is being absorbed, so it is not grown beyond the plan.',
        [],
        'INSUFFICIENT_EVIDENCE',
      ),
    };
  }
  if (gate === 'HOLDS') {
    return {
      proposal: null,
      hold: holdWith(
        [absorption.band === 'poor' ? 'ABSORPTION_POOR' : 'ABSORPTION_MARGINAL'],
        `The long run holds at ${round1(current)} mi. The current load is being completed but `
          + 'not absorbed cleanly, and a longer long run is more of the same load.',
        evidence.recent.map((l) => l.activityId),
      ),
    };
  }

  if (evidence.recent.length === 0) {
    // Rule 11 · no long run in the window is an ABSENCE. It is not a runner who
    // failed to tolerate one, and after a race week it is usually the plan's
    // own doing.
    return {
      proposal: null,
      hold: holdWith(
        ['NO_LONG_RUN_EVIDENCE_IN_WINDOW'],
        `The long run stays at ${round1(current)} mi. No long run in the last `
          + `${evidence.lookback.windowDays} days to read.`,
        [],
        'INSUFFICIENT_EVIDENCE',
      ),
    };
  }

  // Doctrine's own test, and it is about the LAST one: "did they finish
  // functioning like a runner who could have reasonably absorbed it?"
  const tolerated = evidence.recent.filter(
    (l) => l.durabilityEvidence
      && l.lateRunPacingCollapse !== true
      && l.executionQuality !== 'variable',
  );
  const ids = tolerated.map((l) => l.activityId);

  if (tolerated.length < DURATION_PROGRESS_MIN_TOLERATED_LONGS) {
    // A long run that came apart is a READ and argues against growing it. A
    // long run the Evidence Engine could not grade is an absence, and the two
    // must not both come back as "held" (Rule 11).
    const collapsed = evidence.recent.some((l) => l.lateRunPacingCollapse === true);
    const unreadable = evidence.recent.every(
      (l) => !l.durabilityEvidence || l.executionQuality === 'indeterminate',
    );
    // THREE sentences for three facts (1.1.0). The middle one — a graded long
    // run whose execution was `variable` — used to be reported as
    // `NO_LONG_RUN_EVIDENCE_IN_WINDOW` on a HOLD: a finding carrying an
    // absence's name (Rule 16), and the one code a reader could not act on.
    const codes: AdaptationReasonCode[] = collapsed
      ? ['LONG_RUN_SHOWED_LATE_COLLAPSE']
      : unreadable
        ? ['NO_LONG_RUN_EVIDENCE_IN_WINDOW']
        : ['LONG_RUN_EXECUTION_UNCONTROLLED'];
    return {
      proposal: null,
      hold: holdWith(
        codes,
        collapsed
          ? `The long run holds at ${round1(current)} mi. The last one came apart over the `
            + 'closing miles.'
          : unreadable
            ? `The long run stays at ${round1(current)} mi. Nothing in the window could be read `
              + 'as the current distance being absorbed.'
            : `The long run holds at ${round1(current)} mi. The last one was run, but not under `
              + 'control, and that is not the distance being absorbed.',
        evidence.recent.map((l) => l.activityId),
        collapsed || !unreadable ? 'HOLD' : 'INSUFFICIENT_EVIDENCE',
      ),
    };
  }

  const byAbsolute = current + MAX_LONG_BUMP_MI;
  const byFraction = evidence.longRunWoWMaxFraction != null
    ? current * (1 + evidence.longRunWoWMaxFraction)
    : Number.POSITIVE_INFINITY;
  const uncapped = Math.min(byAbsolute, byFraction);
  const proposed = round1(
    evidence.longRunCapMi != null ? Math.min(uncapped, evidence.longRunCapMi) : uncapped,
  );

  if (proposed <= current) {
    return {
      proposal: null,
      hold: holdWith(
        ['LONG_RUN_TOLERATED_WITHOUT_COLLAPSE', 'AT_TIER_CEILING'],
        `The long run holds at ${round1(current)} mi, which is the ceiling for this block.`,
        ids,
      ),
    };
  }

  const reasons: AdaptationReasonCode[] = ['LONG_RUN_TOLERATED_WITHOUT_COLLAPSE'];
  if (proposed < round1(byAbsolute)) reasons.push('STEP_CLAMPED_TO_RAMP_CAP');
  reasons.push(...lookbackNote);

  return {
    proposal: {
      decision: 'PROGRESS', target: 'DURATION', domain: 'LOAD',
      previous: { unit: 'long_run_mi', value: round1(current) },
      proposed: { unit: 'long_run_mi', value: proposed },
      confidence: clamp01(0.7 * evidence.lookback.stalenessFactor),
      supportingEvidence: ids,
      reasonCodes: reasons,
      explanation:
        `The last long run finished under control. Take the long run to ${proposed} mi.`,
      whyNot: [],
      resolvedAt: now, modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
    },
    hold: null,
  };
}

/**
 * WHICH TARGET a progression step belongs to — DENSITY or QUALITY_VOLUME.
 *
 * The Brain Constitution lists both, and they are genuinely different claims
 * about what the runner earned:
 *
 *   · QUALITY_VOLUME · MORE work. Longer reps, more reps, a longer continuous
 *     effort. `quality_duration`, `interval_duration`, `rep_count`.
 *   · DENSITY        · THE SAME work, packed tighter. Shorter recovery, less
 *     rest between the same reps. `recovery_duration`, `work_density`.
 *
 * Doctrine draws exactly this line — "3x8min/3min recovery → 3x10min/2min
 * recovery" is given as TWO progressions, not one — and the split is read off
 * `ProgressionResolution.lever`, which the progression gate already decided.
 * This function chooses a NAME for a decision that has already been made; it
 * does not make one.
 */
export function targetForProgressionLever(
  lever: ProgressionLever | null,
): 'DENSITY' | 'QUALITY_VOLUME' | null {
  if (lever == null) return null;
  if (lever === 'recovery_duration' || lever === 'work_density') return 'DENSITY';
  if (lever === 'quality_duration' || lever === 'interval_duration' || lever === 'rep_count') {
    return 'QUALITY_VOLUME';
  }
  // Every other lever belongs to a different owner entirely (`weekly_volume`
  // to VOLUME, `long_run_duration` to DURATION, `pace` to PACE). Returning null
  // rather than defaulting to DENSITY keeps a mislabelled step out of the
  // session lever instead of quietly filing it there.
  return null;
}

const qualityMagnitude = (s: WorkShape): QualityVolumeMagnitude => ({
  unit: 'quality_minutes',
  value: roundTo(s.reps * s.repMinutes, 1),
});

const shapeMagnitude = (s: WorkShape): DensityMagnitude => ({
  unit: 'work_shape',
  reps: s.reps,
  repMinutes: s.repMinutes,
  recoveryMinutes: s.recoveryMinutes,
  workMinutes: s.reps * s.repMinutes,
});

/**
 * The refusal one `DensityGateState` earns, said in its own words.
 *
 * Exported so the shadow-mode audit and the loader read the SAME sentence a
 * consumer would (Rule 16), and so a state added to the union without a
 * sentence is a compile error rather than a silent fall-through to the
 * authoring-gap line — which is the defect this function replaces.
 */
export function densityRefusalFor(gate: DensityGateState): EngineRefusal {
  const at = (code: EngineRefusalCode, detail: string): EngineRefusal =>
    ({ lever: 'DENSITY', code, detail });
  switch (gate) {
    case 'NO_AUTHORED_PROGRESSION_BLOCK':
      return at(
        'NO_PROGRESSION_TARGETS',
        'No plan row in the week carries a progression block, so the progression gate had '
          + 'nothing to decide about. This is an authoring gap in the Plan Generator, not a '
          + 'runner-evidence gap, and no amount of training will close it.',
      );
    case 'PASS_NOT_DUE_THIS_WEEK':
      return at(
        'PROGRESSION_PASS_NOT_DUE',
        'The weekly progression pass runs once per training week and has already run for this '
          + 'one. Nothing is missing; there is simply no new session geometry to decide today.',
      );
    case 'WEEK_TAKES_NO_PROGRESSION_STEP':
      return at(
        'WEEK_TAKES_NO_PROGRESSION_STEP',
        'The week ahead is a cutback, a race week or inside the taper. Doctrine gives those '
          + 'weeks no progression step, so a refusal here is the correct answer rather than a gap.',
      );
    case 'NO_ACTIVE_PLAN':
      return at('NO_ACTIVE_PLAN', 'There is no active plan to progress a session inside.');
    case 'UNREADABLE':
      return at(
        'PROGRESSION_GATE_UNREADABLE',
        'The progression gate could not be read. That is a failure, not a finding, and no '
          + 'density decision is made from it.',
      );
    case 'RESOLVED':
      return at(
        'NO_PROGRESSION_TARGETS',
        'The progression gate ran and returned no resolutions for the week.',
      );
  }
}

/**
 * DENSITY · progresses independently of pace and volume.
 *
 * This detector DECIDES NOTHING. `resolveWeekProgression` already decided, and
 * carrying its `ProgressionResolution` onto the proposal is the whole point:
 * two systems answering "should this session get denser" is the duplication
 * §2 forbids, and the one that already exists is the one that is tested,
 * doctrine-capped and shipped.
 */
function detectDensity(
  evidence: DensityEvidence,
  now: string,
): { proposal: AdaptationProposal | null; hold: AdaptationProposal | null; refusal: EngineRefusal | null } {
  if (evidence.gate !== 'RESOLVED' || evidence.resolutions.length === 0) {
    return { proposal: null, hold: null, refusal: densityRefusalFor(evidence.gate) };
  }

  const denser = evidence.resolutions.filter(
    (r) => r.changed
      && (r.action === 'ACCELERATE' || r.action === 'TAKE')
      && r.shape.reps * r.shape.repMinutes
        > (r.authored.reps * r.authored.repMinutes) - 0.001
      && r.lever != null,
  );

  // Rank by how much work the step actually adds, so the ONE session proposed
  // is the most meaningful rather than the first in date order.
  const best = [...denser].sort(
    (a, b) => (b.shape.reps * b.shape.repMinutes) - (a.shape.reps * a.shape.repMinutes),
  )[0];

  if (!best) {
    const held = evidence.resolutions.find((r) => r.action === 'HOLD' || r.action === 'BACK_OFF');
    const ref = held ?? evidence.resolutions[0];
    return {
      proposal: null,
      hold: {
        decision: 'HOLD', target: 'DENSITY', domain: 'FITNESS',
        previous: shapeMagnitude(ref.shape),
        proposed: shapeMagnitude(ref.shape),
        confidence: 0.6,
        supportingEvidence: [],
        reasonCodes: ['PROGRESSION_GATE_HELD_THE_SESSION'],
        explanation: ref.why,
        whyNot: [],
        // The gate's own resolution rides along on a HOLD too — a held session
        // is still a decision the gate made, and dropping the resolution here
        // would make the hold unexplainable while the progress is explainable.
        resolution: ref,
        resolvedAt: now, modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
      },
      refusal: null,
    };
  }

  // A resolution whose shape equals what the row already carries is not a
  // change; `changed` already filtered those, so `previous` is the row's
  // current shape and `proposed` is the gate's.
  const previous = evidence.resolutions.find((r) => r.workoutId === best.workoutId);
  const authored = previous ? previous.authored : best.authored;

  // THE TARGET IS THE GATE'S OWN LEVER, named. A step that added reps is a
  // QUALITY_VOLUME progression; a step that shortened recovery is a DENSITY
  // one. Filing both as DENSITY would collapse the distinction doctrine draws
  // and the Brain Constitution lists separately.
  const target = targetForProgressionLever(best.lever);
  if (target === 'QUALITY_VOLUME') {
    return {
      proposal: {
        decision: 'PROGRESS', target: 'QUALITY_VOLUME', domain: 'FITNESS',
        previous: qualityMagnitude(authored),
        proposed: qualityMagnitude(best.shape),
        confidence: 0.7,
        supportingEvidence: [],
        reasonCodes: ['PROGRESSION_GATE_RESOLVED_MORE_QUALITY_WORK'],
        explanation: best.why,
        whyNot: [],
        resolution: best,
        resolvedAt: now, modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
      },
      hold: null,
      refusal: null,
    };
  }

  return {
    proposal: {
      decision: 'PROGRESS', target: 'DENSITY', domain: 'FITNESS',
      previous: shapeMagnitude(authored),
      proposed: shapeMagnitude(best.shape),
      confidence: 0.7,
      supportingEvidence: [],
      reasonCodes: ['PROGRESSION_GATE_RESOLVED_A_DENSER_SESSION'],
      explanation: best.why,
      whyNot: [],
      resolution: best,
      resolvedAt: now, modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
    },
    hold: null,
    refusal: null,
  };
}

/**
 * SAFETY / LOAD REDUCTION · state and absorption, never capacity.
 *
 * A tired Friday reduces today's demand. It does not touch threshold capacity,
 * and structurally it cannot: this detector's only magnitude is
 * `quality_sessions_per_week`.
 */
function detectReduce(
  state: Immutable<RunnerState>,
  absorption: AdaptationVerdict,
  qualityPerWeek: number,
  now: string,
): AdaptationProposal | null {
  const stateArgues = STATE_ARGUES_REDUCE.has(state.decision);
  const absorptionArgues = absorption.band === 'poor';
  if (!stateArgues && !absorptionArgues) return null;

  const reasons: AdaptationReasonCode[] = [];
  if (stateArgues) reasons.push('STATE_SAYS_TODAY_IS_NOT_THE_DAY');
  if (state.decision === 'stop') {
    reasons.push('SAFETY_OVERRIDES_NORMAL_PROGRESSION');
  }
  if (absorption.band === 'poor') reasons.push('ABSORPTION_POOR');

  const proposed = Math.max(0, qualityPerWeek - 1);
  return {
    decision: 'REDUCE', target: 'RECOVERY', domain: 'SAFETY',
    previous: { unit: 'quality_sessions_per_week', value: qualityPerWeek },
    proposed: { unit: 'quality_sessions_per_week', value: proposed },
    confidence: state.readable ? 0.8 : 0.5,
    supportingEvidence: [],
    reasonCodes: reasons,
    explanation: state.driver?.detail
      ?? absorption.summary
      ?? 'Ease the week back while the load settles.',
    whyNot: [],
    resolvedAt: now, modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
  };
}

/**
 * RESTRUCTURE · the same stimulus, arranged differently.
 *
 * Two distinct grounds, and both are RESTRUCTURE rather than REDUCE because
 * neither takes work away:
 *
 *   · SCHEDULE · life moved a session and a clear slot exists. BRIEF 10:
 *     "preserve training intent, not calendar purity."
 *   · TYPE     · the runner is struggling and has already been reduced. The
 *     doctrine's own instruction is to "change the TYPE of stress (not just
 *     less of the same)", which is a SPECIFICITY move, not a smaller one.
 */
function detectRestructure(
  schedule: ScheduleEvidence,
  absorption: AdaptationVerdict,
  state: Immutable<RunnerState>,
  now: string,
): AdaptationProposal | null {
  if (schedule.sessionsOutOfPlace > 0 && schedule.clearSlotsAvailable > 0) {
    const moved = Math.min(schedule.sessionsOutOfPlace, schedule.clearSlotsAvailable);
    return {
      decision: 'RESTRUCTURE', target: 'SCHEDULE', domain: 'SCHEDULE',
      previous: { unit: 'sessions_out_of_place', value: schedule.sessionsOutOfPlace },
      proposed: { unit: 'sessions_out_of_place', value: schedule.sessionsOutOfPlace - moved },
      confidence: 0.8,
      supportingEvidence: [],
      reasonCodes: ['SESSIONS_OUT_OF_PLACE'],
      explanation:
        `${schedule.sessionsOutOfPlace} session${schedule.sessionsOutOfPlace === 1 ? '' : 's'} `
        + `sat out of place this week. Move ${moved} into the clear days rather than dropping `
        + 'the stimulus.',
      whyNot: [],
      resolvedAt: now, modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
    };
  }

  // Struggling, but not for a safety reason the reduce path already owns —
  // change the KIND of stress instead of the amount.
  if (absorption.band === 'marginal' && !STATE_ARGUES_REDUCE.has(state.decision)) {
    return {
      decision: 'RESTRUCTURE', target: 'SPECIFICITY', domain: 'FITNESS',
      previous: { unit: 'race_specific_minutes', value: 0 },
      proposed: { unit: 'race_specific_minutes', value: 0 },
      confidence: 0.5,
      supportingEvidence: [],
      reasonCodes: ['STIMULUS_TYPE_CHANGED_RATHER_THAN_REDUCED', 'ABSORPTION_MARGINAL'],
      explanation:
        'The work is being completed but not absorbed cleanly. Change the kind of quality '
        + 'rather than the amount of it.',
      whyNot: [],
      resolvedAt: now, modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
    };
  }

  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · THE COMPOSER — one primary stressor, ranked, with the alternatives named
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Rank order for the final list. SAFETY first (§19 — no downstream service may
 * undo it), then SCHEDULE, then the single promoted PROGRESS, then the HOLDs.
 */
function rankOf(p: AdaptationProposal): number {
  if (p.domain === 'SAFETY') return 0;
  if (p.decision === 'RESTRUCTURE') return 1;
  if (p.decision === 'REDUCE') return 2;
  if (p.decision === 'PROGRESS') return 3;
  if (p.decision === 'HOLD') return 4;
  return 5; // INSUFFICIENT_EVIDENCE · last, because it is the least actionable
}

/**
 * Does this proposal CHANGE THE TRAINING STIMULUS?
 *
 * The one-stressor rule is enforced structurally at the proposal level — one
 * `target` field, no compound arm — and the composer promotes exactly one
 * PROGRESS. Neither of those catches the cycle-level version: a PROGRESS on one
 * lever and a FITNESS-domain RESTRUCTURE on another are two separate,
 * individually legal proposals that together tell the runner to run threshold
 * faster AND change the kind of quality he does, in the same week.
 *
 * That combination was reachable and was reached — `marginal` absorption emits
 * the SPECIFICITY restructure while still permitting a pace progression, which
 * is the deliberate gate asymmetry two sections up. The asymmetry is right; the
 * pair is not, so the composer suppresses the restructure rather than the gate
 * being changed.
 *
 * A SCHEDULE restructure is NOT a stimulus change: moving Tuesday's session to
 * Wednesday preserves the intent, which is BRIEF 10's whole point.
 */
function changesStimulus(p: AdaptationProposal): boolean {
  if (p.decision === 'PROGRESS') return true;
  return p.decision === 'RESTRUCTURE' && p.domain === 'FITNESS';
}

/**
 * The proposal set for a runner we COULD NOT READ.
 *
 * Exported so the loader returns this directly instead of assembling a
 * placeholder input to feed `composeAdaptation` — building a fake capacity to
 * get a refusal out is how a fabricated input eventually gets read by accident.
 * Rule 11: no proposal is ever made from a failed read.
 */
export function unreadableProposalSet(
  todayISO: string,
  detail: string,
): AdaptationProposalSet {
  const now = new Date().toISOString();
  return {
    todayISO,
    proposals: [],
    deferred: [],
    readable: false,
    refusals: [{ lever: 'PACE', code: 'NO_ACTIVITY_EVIDENCE_IN_WINDOW', detail }],
    resolvedAt: now,
    modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
  };
}

/**
 * THE canonical adaptation decision (§2).
 *
 * Pure. Every input is a plain value, so every branch is falsifiable without a
 * database (Rule 18), and the reachability of all four decisions is a unit test
 * rather than a hope.
 */
export function composeAdaptation(input: AdaptationEngineInput): AdaptationProposalSet {
  const now = new Date().toISOString();
  const refusals: EngineRefusal[] = [];
  const out: AdaptationProposal[] = [];
  const deferred: AdaptationProposal[] = [];

  if (!input.readable) {
    return unreadableProposalSet(
      input.todayISO,
      'One or more inputs could not be read. No proposal is made from a failed read '
        + '— that is a refusal, not a runner with no evidence (Rule 11).',
    );
  }

  /* ── SAFETY FIRST · §19's override channel ──────────────────────────────
   * Computed before anything upward, and it BLOCKS the upward path outright
   * rather than merely outranking it. "No downstream service can undo STOP."
   *
   * 1.1.0 · the magnitude is the week ahead's REAL quality-session count. It
   * used to be `density.resolutions.length`, which is the number of progression
   * resolutions the weekly pass returned — zero on the six days a week the pass
   * is not due, so REDUCE proposed `0 → 0` on most days it fired. The density
   * count remains the fallback only when the plan could not be counted
   * (Rule 11: a null count is not a count of zero). */
  const qualityPerWeek = input.load.qualitySessionsWeekAhead ?? input.density.resolutions.length;
  const reduce = detectReduce(input.state, input.absorption, qualityPerWeek, now);
  if (reduce) out.push(reduce);

  // Computed here, PUSHED LATER. Whether a FITNESS-domain restructure survives
  // depends on whether a progression is promoted below — see `changesStimulus`.
  const restructure = detectRestructure(input.schedule, input.absorption, input.state, now);

  /* ── THE FOUR LEVERS ────────────────────────────────────────────────────
   * Each detector receives ONLY its own slice. `detectPace` cannot see the
   * schedule; `detectRestructure` cannot see a capacity. That is BRIEF 07's
   * "adapt the thing that changed" as plumbing. */
  const pace = detectPace(input.capacity, input.pace, input.absorption, now);
  const volume = detectVolume(input.load, input.absorption, now);
  const duration = detectDuration(input.longRun, input.absorption, now);
  const density = detectDensity(input.density, now);
  if (density.refusal) refusals.push(density.refusal);

  // The session detector answers for BOTH session levers, and files its result
  // under whichever one the progression gate's own step belongs to
  // (`targetForProgressionLever`). It can only ever produce one, because there
  // is one promoted resolution — which is the one-stressor rule holding inside
  // the session levers as well as across them.
  const sessionTarget: AdaptationLever =
    density.proposal?.target ?? density.hold?.target ?? 'DENSITY';
  const byLever: Partial<Record<AdaptationLever, { proposal: AdaptationProposal | null; hold: AdaptationProposal | null }>> = {
    PACE: pace, VOLUME: volume, DURATION: duration,
    [sessionTarget]: { proposal: density.proposal, hold: density.hold },
  };

  /* ── STATE GATES THE UPWARD PATH ────────────────────────────────────────
   * A runner who should not be pushed today is not pushed, whatever the
   * evidence says. This is §7 in the other direction: state does not lower
   * capacity, it withholds the increase. */
  const stateBlocks = STATE_BLOCKS_PROGRESS.has(input.state.decision);

  const candidates = PROGRESS_LEVER_ORDER
    .map((lever) => ({ lever, p: byLever[lever]?.proposal ?? null }))
    .filter((c): c is { lever: AdaptationLever; p: AdaptationProposal } => c.p != null);

  if (stateBlocks) {
    // Every earned progression becomes a HOLD naming the state that withheld
    // it — never silence. A lever that quietly does not fire is the Rule 21
    // defect, and an engine whose upward path can vanish without a trace is
    // exactly how a zero goes unnoticed for a year.
    for (const c of candidates) {
      out.push(holdFor(c.p, ['STATE_SAYS_TODAY_IS_NOT_THE_DAY'],
        `${leverNoun(c.lever)} holds. ${input.state.driver?.detail ?? 'Today is not the day to add load.'}`,
        now));
    }
  } else if (candidates.length > 0) {
    /* ── ONE PRIMARY STRESSOR ──────────────────────────────────────────────
     * `PROGRESS_LEVER_ORDER` is the tie-break, and everything else that
     * EARNED a progression is DEFERRED rather than dropped. Two levers with
     * evidence produce two proposals — one promoted, one deferred — never one
     * compound proposal, which the type could not express anyway. */
    const [primary, ...rest] = candidates;
    primary.p.whyNot = rest.map((r) => ({
      lever: r.lever,
      reasonCodes: ['ANOTHER_LEVER_IS_PROGRESSING_THIS_CYCLE'],
      detail: `${leverNoun(r.lever)} also had evidence to progress and was deferred to keep one `
        + 'stressor at a time.',
    }));
    out.push(primary.p);
    for (const r of rest) {
      r.p.whyNot = [{
        lever: primary.lever,
        reasonCodes: ['ANOTHER_LEVER_IS_PROGRESSING_THIS_CYCLE'],
        detail: `${leverNoun(primary.lever)} is the primary stressor this cycle.`,
      }];
      deferred.push(r.p);
    }
  }

  /* ── ONE STIMULUS CHANGE PER CYCLE, ACROSS DECISION TYPES TOO ────────────
   *
   * `changesStimulus` explains the case. If a progression was promoted, the
   * FITNESS-domain restructure is not merely outranked, it is WITHDRAWN — and
   * the promoted proposal records that it was, so the log can tell "the engine
   * never considered changing the workout type" from "it did, and deferred it
   * to keep one stressor at a time". A SCHEDULE restructure always survives:
   * moving a session is not adding one. */
  const progressPromoted = out.some((p) => p.decision === 'PROGRESS');
  if (restructure) {
    if (progressPromoted && changesStimulus(restructure)) {
      const primaryProposal = out.find((p) => p.decision === 'PROGRESS');
      primaryProposal?.whyNot.push({
        lever: restructure.target,
        reasonCodes: restructure.reasonCodes,
        detail: 'Changing the KIND of quality was also available and was withheld: one stimulus '
          + 'changes per cycle, and the progression above is this cycle\'s.',
      });
    } else {
      out.push(restructure);
    }
  }

  // Every lever that did NOT progress states so, with its reason. A HOLD is a
  // decision, and doctrine says it is a frequent and correct one.
  const promoted = new Set(candidates.slice(0, stateBlocks ? 0 : 1).map((c) => c.lever));
  const deferredLevers = new Set(deferred.map((d) => d.target));
  for (const lever of PROGRESS_LEVER_ORDER) {
    if (promoted.has(lever) || deferredLevers.has(lever)) continue;
    if (stateBlocks && candidates.some((c) => c.lever === lever)) continue;
    const hold = byLever[lever]?.hold;
    if (hold) out.push(hold);
  }

  // Nothing at all to say is still a decision, and doctrine wants it said once
  // rather than met with silence.
  if (out.length === 0) {
    out.push({
      decision: 'HOLD', target: 'VOLUME', domain: 'LOAD',
      previous: { unit: 'weekly_mi', value: round1(input.load.currentWeeklyMi ?? 0) },
      proposed: { unit: 'weekly_mi', value: round1(input.load.currentWeeklyMi ?? 0) },
      confidence: 0.5,
      supportingEvidence: [],
      reasonCodes: ['TRAINING_IS_WORKING'],
      explanation: 'No change. The current training is doing its job.',
      whyNot: [],
      resolvedAt: now, modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
    });
  }

  out.sort((a, b) => rankOf(a) - rankOf(b));
  return {
    todayISO: input.todayISO,
    proposals: out,
    deferred,
    readable: true,
    refusals,
    resolvedAt: now,
    modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
  };
}

function leverNoun(l: AdaptationLever): string {
  switch (l) {
    case 'PACE': return 'Threshold pace';
    case 'VOLUME': return 'Weekly volume';
    case 'DURATION': return 'The long run';
    case 'DENSITY': return 'Session density';
    case 'QUALITY_VOLUME': return 'Quality volume';
    case 'SPECIFICITY': return 'Race specificity';
    case 'RECOVERY': return 'Recovery';
    case 'SCHEDULE': return 'The schedule';
  }
}

/**
 * Turn an earned PROGRESS into the HOLD that withheld it, keeping the lever's
 * own magnitude type. Written once so the six call sites cannot each decide
 * separately what "hold this lever" means.
 */
function holdFor(
  p: AdaptationProposal,
  codes: AdaptationReasonCode[],
  explanation: string,
  now: string,
): AdaptationProposal {
  const core = {
    decision: 'HOLD' as const,
    confidence: p.confidence,
    supportingEvidence: p.supportingEvidence,
    reasonCodes: codes,
    explanation,
    whyNot: [{
      lever: p.target,
      reasonCodes: p.reasonCodes,
      detail: `The evidence to progress was there: ${p.explanation}`,
    }],
    resolvedAt: now,
    modelVersion: ADAPTATION_ENGINE_MODEL_VERSION,
  };
  // The magnitude is carried from `previous` on both sides, which is what makes
  // "a HOLD does not move the number" a structural fact rather than an
  // assertion — and it keeps each lever in its own units.
  switch (p.target) {
    case 'PACE': return {
      ...core, target: 'PACE', domain: 'FITNESS', previous: p.previous, proposed: p.previous,
      // The state block withholds the WHOLE proposal, so the breakdown is
      // flattened to "nothing moved" too — a HOLD whose per-phase detail still
      // said `moved: true` would contradict its own top-level number.
      phaseBreakdown: p.phaseBreakdown.map((b) => ({
        ...b, proposedSecPerMi: b.previousSecPerMi, stepSecPerMi: 0, moved: false,
      })),
    };
    case 'VOLUME': return { ...core, target: 'VOLUME', domain: 'LOAD', previous: p.previous, proposed: p.previous };
    case 'DURATION': return { ...core, target: 'DURATION', domain: 'LOAD', previous: p.previous, proposed: p.previous };
    case 'DENSITY': return { ...core, target: 'DENSITY', domain: 'FITNESS', previous: p.previous, proposed: p.previous, resolution: p.resolution };
    case 'QUALITY_VOLUME': return { ...core, target: 'QUALITY_VOLUME', domain: 'FITNESS', previous: p.previous, proposed: p.previous, resolution: p.resolution };
    case 'SPECIFICITY': return { ...core, target: 'SPECIFICITY', domain: 'FITNESS', previous: p.previous, proposed: p.previous };
    case 'RECOVERY': return { ...core, target: 'RECOVERY', domain: 'SAFETY', previous: p.previous, proposed: p.previous };
    case 'SCHEDULE': return { ...core, target: 'SCHEDULE', domain: 'SCHEDULE', previous: p.previous, proposed: p.previous };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · THE CONTRADICTION CHECKER (§29) AND THE COMPILE-TIME ASSERTIONS
 * ═══════════════════════════════════════════════════════════════════════ */

export type ContradictionCode =
  | 'MORE_THAN_ONE_PRIMARY_STRESSOR'
  | 'HOLD_MOVED_THE_NUMBER'
  | 'PROGRESS_WHILE_SAFETY_REDUCES'
  | 'PROPOSAL_WITHOUT_REASON'
  | 'DEFERRED_IS_NOT_A_PROGRESSION'
  /** Two proposals that each change the training stimulus in one cycle. The
   *  one-stressor rule at the CYCLE level, which the type system cannot reach
   *  because each proposal is individually legal. */
  | 'MORE_THAN_ONE_STIMULUS_CHANGE'
  /** A refusal that also asserts a finding about the runner. "We could not see
   *  it" and "we saw it and it argues against you" are different sentences and
   *  a proposal may not carry both. */
  | 'INSUFFICIENT_EVIDENCE_CLAIMS_A_FINDING';

/**
 * Reason codes that ASSERT something about the runner rather than about what
 * the engine could see. An `INSUFFICIENT_EVIDENCE` proposal may not carry one.
 */
const FINDING_REASON_CODES: ReadonlySet<AdaptationReasonCode> = new Set<AdaptationReasonCode>([
  'EXECUTION_BEAT_TARGET_WITHOUT_CONTROL',
  'LATE_SESSION_DETERIORATION',
  'LOAD_NOT_YET_ABSORBED',
  'LONG_RUN_SHOWED_LATE_COLLAPSE',
  'LONG_RUN_EXECUTION_UNCONTROLLED',
  'ABSORPTION_MARGINAL',
  'ABSORPTION_POOR',
]);

/**
 * §29's deterministic validation layer, run over a finished proposal set.
 *
 * Returns the contradictions rather than throwing, so a caller can log them and
 * a test can assert the list is empty. Every one of these is a defect in THIS
 * file, not in the runner's data.
 */
export function contradictionsIn(set: AdaptationProposalSet): ContradictionCode[] {
  const out: ContradictionCode[] = [];
  const progress = set.proposals.filter((p) => p.decision === 'PROGRESS');
  if (progress.length > 1) out.push('MORE_THAN_ONE_PRIMARY_STRESSOR');

  for (const p of set.proposals) {
    if (NON_MOVING_DECISIONS.has(p.decision)
      && JSON.stringify(p.previous) !== JSON.stringify(p.proposed)) {
      out.push('HOLD_MOVED_THE_NUMBER');
    }
    if (p.reasonCodes.length === 0) out.push('PROPOSAL_WITHOUT_REASON');
    if (p.decision === 'INSUFFICIENT_EVIDENCE'
      && p.reasonCodes.some((c) => FINDING_REASON_CODES.has(c))) {
      out.push('INSUFFICIENT_EVIDENCE_CLAIMS_A_FINDING');
    }
  }

  const safetyReduces = set.proposals.some((p) => p.domain === 'SAFETY' && p.decision === 'REDUCE');
  if (safetyReduces && progress.length > 0) out.push('PROGRESS_WHILE_SAFETY_REDUCES');

  if (set.proposals.filter(changesStimulus).length > 1) out.push('MORE_THAN_ONE_STIMULUS_CHANGE');

  if (set.deferred.some((d) => d.decision !== 'PROGRESS')) out.push('DEFERRED_IS_NOT_A_PROGRESSION');

  return [...new Set(out)];
}

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type AssertTrue<T extends true> = T;

/**
 * THE ONLY fields an adaptation request may carry.
 *
 * Adding `goalSec`, `goalRaceTime`, `targetPace` or a generic "runner metrics"
 * bag that could hide one changes this union and stops the file compiling (§6).
 * Falsify (Rule 18) by adding `goalSec?: number` to `AdaptationEngineInput` and
 * watching this line go red — which was run against this file before it landed.
 */
type _NoGoalInInput = AssertTrue<
  Equals<
    keyof AdaptationEngineInput,
    'todayISO' | 'capacity' | 'state' | 'absorption' | 'pace' | 'load' | 'longRun' | 'density' | 'schedule' | 'readable'
  >
>;

/** The capacity input is deeply readonly, so §7's named anti-pattern — an
 *  adaptation writing back onto a capacity estimate — cannot be expressed. */
type _CapacityIsImmutable = AssertTrue<
  Equals<AdaptationEngineInput['capacity'], Immutable<ResolvedCapacity>>
>;

/** Exported so the assertions above are not dead code an unused-locals lint
 *  could delete along with the guarantees they carry. */
export type AdaptationInputIsSealed = _NoGoalInInput & _CapacityIsImmutable;
