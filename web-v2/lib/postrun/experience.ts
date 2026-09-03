/**
 * lib/postrun/experience.ts · THE canonical post-run interpretation.
 *
 * PURE. No pool, no query, no `userId`, no DB import at any depth — the same
 * seal `lib/execution/verdict.ts` carries, and for the same reason: this is
 * reached from `/api/v5/today`, from `/api/runs/[id]`, and from tests, and one
 * of those graphs touches a `'use client'` entry (Rule 19's client-graph gate
 * is the enforcement; this sentence is not). The database shell is
 * `lib/postrun/load.ts`.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `docs/0901/post-run-experience-review-and-brief-2026-09-02.md` raises three
 * P0s. Two of them were already answered when this was written, and saying so
 * is more useful than implementing around them:
 *
 *   · "Execution interpretation is not a first-class object." It IS, since
 *     2026-09-01: `lib/execution/verdict.ts#resolveWorkoutVerdict` is the one
 *     grader, `mapWatchPhases` is a mapper over it, and
 *     `_workout_verdict_owner.test.ts` scans for a second. What was still
 *     missing is the SESSION-LEVEL runner-facing form — a status, a headline
 *     and a sentence — which every surface was inventing from the parts.
 *   · "Two post-run compositions can disagree." They share `deriveRecap`,
 *     `deriveWin`, `composeRecap` and `resolveWorkoutVerdict` already. What
 *     they did not share was one OBJECT: each route assembled the arguments
 *     itself, so parity was a property of two call sites agreeing rather than
 *     of one answer being read twice.
 *
 * The third is real and was completely absent:
 *
 *   · "What this taught the brain is mostly absent." The Evidence Engine
 *     (`lib/evidence/activity-evidence.ts`) has classified every activity for
 *     weeks — capacity by capacity, with strength, reliability and an explicit
 *     `anchorMoveCandidate` — and NOT ONE post-run surface read it. Today's
 *     "What this did" was a weekly mileage percentage and a niggle row. The
 *     brief's own DELETE list names that percentage by name.
 *
 * So: one composer, four typed interpretations (execution, cost, evidence,
 * plan), one runner-facing sentence per interpretation, and one
 * `CoachingExplanation` (Stage 3's contract) carrying the briefing so the
 * voice audit reaches this copy the same way it reaches Today's "why".
 *
 * ── RULE 11 IS THE SPINE ────────────────────────────────────────────────────
 *
 * Every read here has three outcomes and they are three TYPES, never one
 * nullable number:
 *
 *   · the Evidence Engine said this run demonstrates nothing about a capacity
 *     (`kind: 'no_evidence'`) — a MEASUREMENT;
 *   · it could not tell (`kind: 'indeterminate'`) — a different fact;
 *   · the classification never ran or returned null — `role: 'UNREAD'`, which
 *     is this file's one deviation from the brief's `EvidenceImpact.role`
 *     enum. The brief has six roles and none of them can say "the read
 *     failed". Folding a failed read into `INSUFFICIENT` would print "not
 *     enough evidence yet" over a database error, which is the exact
 *     collapse Rule 11 exists to stop.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ─────────────────────────────────
 *
 *   · It cannot tell you the verdict is RIGHT. It renders what
 *     `resolveWorkoutVerdict` and `classifyActivityEvidence` decided. A wrong
 *     grade explained perfectly still ships.
 *   · It cannot see the runner's history. Every input is about ONE session, so
 *     it can never say "third week in a row" — and it must not try, because
 *     the across-activity question belongs to the Runner Model.
 *   · Its plan-impact arm can only report adaptations it was HANDED. A caller
 *     that queries the wrong population (Rule 14) gets a confidently wrong
 *     "unchanged", and nothing here can tell.
 *   · The copy is templated. It cannot catch a sentence that is grammatical,
 *     lexicon-clean and wrong for the session.
 */
import type { WorkoutVerdict, GradedPhase } from '@/lib/execution/verdict';
import { looksLikeStrideLabel } from '@/lib/training/expand-spec';
import { sessionLadder } from '@/lib/training/execution-semantics';
import { fmtPaceSlash } from '@/lib/format/run';
import type {
  ActivityEvidenceResult,
  CapacityEvidence,
  CapacityName,
} from '@/lib/evidence/activity-evidence';
import {
  EXPLANATION_MODEL_VERSION,
  type CoachingExplanation,
  type ExplanationFact,
  type Certainty,
} from '@/lib/faff/explanation';

export const POST_RUN_MODEL_VERSION = 'postrun-1';

/* ══════════════════════════════ 1 · the shape ═══════════════════════════ */

/** The brief's §6 `ExecutionInterpretation.status`, verbatim. */
export type PostRunExecutionStatus =
  | 'EXECUTED' | 'CONTROLLED' | 'FAST' | 'SLOW' | 'PARTIAL_PRODUCTIVE'
  | 'INCOMPLETE' | 'MODIFIED' | 'SENSOR_LIMITED' | 'INDETERMINATE';

export type StimulusDelivered = 'FULL' | 'EQUIVALENT' | 'PARTIAL' | 'NOT_DELIVERED' | 'UNKNOWN';

export interface PostRunExecution {
  status: PostRunExecutionStatus;
  /** Three to eight words. The answer before the evidence. */
  headline: string;
  /** One sentence, specific to the intended workout. */
  summary: string;
  /** What the session was FOR, in runner language. Null when nothing was
   *  prescribed — an unplanned run has no intended stimulus and inventing one
   *  would be the brief's "do not rewrite the workout label". */
  intendedStimulus: string | null;
  stimulusDelivered: StimulusDelivered;
  confidence: 'HIGH' | 'MODERATE' | 'LOW';
  /**
   * WHO SET THE TARGET this execution was graded against (PROVENANCE-1,
   * 2026-09-03). `'plan'` when a `plan_workouts` row authored it — the
   * coaching app's own prescription. `'self_authored'` when the per-phase
   * targets live only in the run's own recorded phases
   * (`data.phases[].targetPaceSPerMi`) with NO matching plan row — a
   * structured workout the runner built on the watch himself, most often a
   * race-day pacing plan for a course's segments. `'none'` when nothing
   * graded the work at all.
   *
   * This is a DIFFERENT fact from `raceMatched` on `PostRunInput`, and from
   * whether the grade itself is a window, a ceiling, or a target — those
   * describe WHAT the comparison is; this describes WHOSE it is. Collapsing
   * them was the actual defect on the Americas Finest City half: the per-
   * segment "asked 7:08" / "Slower than target" language is not invented —
   * David's own watch carried genuine per-segment pace targets for that
   * race — but the copy read as if the coaching app had prescribed them,
   * when there was no `plan_workouts` row for that day at all.
   */
  targetProvenance: 'plan' | 'self_authored' | 'none';
  /** ONE caption stating that provenance in the runner's own words, shown
   *  once near the graded comparison rather than folded into every phase
   *  row — same pattern Strava's own zone chart uses ("Based on a Marathon
   *  race time of 3:40:31"). Null when `targetProvenance` is `'plan'` (the
   *  ordinary case needs no extra explanation) or `'none'` (nothing to
   *  attribute). */
  targetProvenanceNote: string | null;
  /** Machine codes, never rendered. */
  reasons: string[];
}

export type PostRunCostStatus =
  | 'EXPECTED' | 'LOWER_THAN_EXPECTED' | 'HIGHER_EXPLAINED'
  | 'HIGHER_UNEXPLAINED' | 'UNKNOWN';

export interface PostRunCost {
  status: PostRunCostStatus;
  /** Null is a real answer and the surface then draws NOTHING — not a row
   *  reading "unknown", which is furniture with a shrug in it. */
  summary: string | null;
  /**
   * The heart rate this conclusion is ABOUT, and the scope it was measured
   * over. The two travel together because they are one fact: a work-phase
   * mean and a whole-run mean are different quantities, and the ceiling each
   * may be read against is different too (Rule 16). Null scope means no
   * reading — the surface then prints nothing rather than a zero.
   */
  hrBpm: number | null;
  hrScope: 'work' | 'overall' | null;
  /** The ceiling the plan set FOR THAT SCOPE. Null when the session set none,
   *  which is a real answer and not a missing number. */
  ceilingBpm: number | null;
  rpe: number | null;
  reasons: string[];
}

/** Six brief roles plus `UNREAD`. See the header. */
export type EvidenceRole =
  | 'CORROBORATES' | 'CHALLENGES' | 'NEW_ANCHOR_CANDIDATE'
  | 'CONTEXT_ONLY' | 'EXCLUDED' | 'INSUFFICIENT' | 'UNREAD';

export type EvidenceDomain =
  | 'THRESHOLD' | 'HIGH_INTENSITY' | 'DURABILITY' | 'LOAD_TOLERANCE' | 'READINESS';

export interface PostRunEvidenceImpact {
  role: EvidenceRole;
  domains: EvidenceDomain[];
  /** Layer 1. No confidence decimals, no engine nouns. */
  runnerSummary: string;
  beliefChanged: boolean;
  /** The Evidence Engine's `anchorMoveCandidate` — a STATEMENT that this run
   *  contains something an anchor could legitimately move on, never a decision
   *  that it should. */
  planAuthorityEligible: boolean;
  reasons: string[];
}

export type PlanImpactStatus =
  | 'UNCHANGED' | 'UPDATED' | 'RECOMMENDATION' | 'HELD_FOR_EVIDENCE'
  | 'NO_PLAN' | 'UNKNOWN';

export interface PostRunPlanImpact {
  status: PlanImpactStatus;
  runnerSummary: string;
  /** One line per recorded change. Empty on every status but `UPDATED`. */
  changes: string[];
  /** Hard-typed false. Sealed history is not editable by this path and the
   *  type says so rather than a comment promising it (Rule 20). */
  sealedHistoryChanged: false;
}

export interface PostRunNextAction {
  /** Null when the plan already says what is next and repeating it here would
   *  be the same sentence twice (Rule 17). */
  summary: string | null;
}

/* ── STRIDES · 2026-09-02 ─────────────────────────────────────────────────
 *
 * A stride is NOT a rep, and this type exists so that no reader can treat it
 * as one. `Research/04-workout-vocabulary.md` §7.2 calls a stride "relaxed",
 * puts it at "~85-95% max effort", and says in as many words that it is
 * "Not a workout" — which is why `appendStrides` gives it a deliberately wide
 * 45 s/mi band and why `execution-semantics.ts` shapes it `effort`, a shape
 * that is never pace-graded at all.
 *
 * The runner's 2026-09-02 easy day is why this is a type and not a filter. Six
 * 20-second accelerations at 401/347/349/365/350/431 s/mi against a 401 target
 * were folded into the session's WORK set alongside the 5.0 mi easy block, and
 * the screen told him "All seven reps landed, with four quicker than the
 * ceiling." Three separate wrongs in nine words: the easy block is not a rep,
 * the strides are not reps of it, and a stride being quick is the point of a
 * stride rather than a deviation from it.
 *
 * So strides travel as their own quantity, are never graded, and the sentence
 * about them states COMPLETION and never compliance. */
export interface PostRunStride {
  /** 1-based, as the runner counts them. */
  ordinal: number;
  /** The wrist's own label, e.g. "Stride 4 of 6". */
  label: string | null;
  distanceMi: number | null;
  durationSec: number | null;
  paceSecPerMi: number | null;
  avgHr: number | null;
  avgCadence: number | null;
  completed: boolean;
}

export interface PostRunStrides {
  /** From `workout_spec.strides_reps`. Null when the spec was not read — which
   *  is NOT zero, and is why the two are separate fields (Rule 11). */
  prescribed: number | null;
  /** What the wrist actually recorded. */
  recorded: number;
  /** Of those, the ones the wrist marked finished. */
  completed: number;
  strides: PostRunStride[];
  /** The walk-backs between them. Doctrine prescribes "Full walk-back or
   *  60-90 s jog — no fatigue between strides" (§7.2), so they are part of the
   *  drill and the runner is shown that he took them, not graded on them. */
  recoveryCount: number;
  recoveryDistanceMi: number | null;
  /** One sentence. States what was DONE. Never a verdict — see the header. */
  summary: string;
  /** How the strides were identified. `marker` is the authored
   *  `isStrideSegment` surviving the round trip; `label` is the fallback that
   *  reads the spec's rep count together with the authored label, and it is
   *  named so a reader can tell which one answered (Rule 11). */
  basis: 'marker' | 'label';
}

/* ── CAPTURE · Rule 11, applied to distance ───────────────────────────────
 *
 * "We recorded 5.98 miles" and "he ran 5.98 miles" are two different facts and
 * this app had no way to say the first without implying the second.
 *
 * On 2026-09-02 the runner's watch read 6.41 mi / 55:49 when he stopped. What
 * reached the database was 5.98 mi / 50:57 — the phase array summed to exactly
 * the end of the last prescribed walk-back, and the 0.43 mi he ran after it was
 * never uploaded. The row's own `clockAudit` says so: 4694 s of wall clock
 * against 3057 s counted. Nothing anywhere read that field, so every surface
 * drew 5.98 as the run.
 *
 * This does not guess the missing distance and must never be made to. It states
 * that the recording is short and lets every number below it be read as what it
 * is: a floor, not a measurement of the run. */
export type CaptureStatus = 'RECONCILED' | 'OVERTIME' | 'SHORT' | 'UNKNOWN';

/**
 * THREE QUANTITIES, ONE TOTAL — and a screen that lets the runner tell them
 * apart.
 *
 * The 2026-09-02 run is the worked example and it holds all three at once:
 *
 *   6.41 mi   the run's own total, repaired by hand from his watch display
 *   5.98 mi   the thirteen phases: the structured session, strides included
 *   5.00 mi   the five whole-mile split rows the mile table draws
 *
 * Every one of those is correct and they are three different questions. The
 * mile table answers "what did the watch record per mile"; the phases answer
 * "how was the session built"; the total answers "how far did he run". A
 * screen that shows one of them and calls it the run is wrong three ways at
 * once, and showing five miles of a 6.41-mile run is the specific way he
 * noticed.
 *
 * The difference between the total and the phases is OVERTIME: real running,
 * after the last prescribed phase, that belongs to the run without belonging
 * to the workout. It is reported as exactly that. It is not dressed as a
 * phase, it is not split into miles that nothing measured, and it is not
 * hidden.
 */
export interface PostRunCapture {
  status: CaptureStatus;
  /** Null when there is nothing to reconcile, and the surface then draws
   *  NOTHING — a row reading "capture OK" is furniture. */
  summary: string | null;
  /** The run's own total. What "how far did he run" means. */
  totalDistanceMi: number | null;
  totalDurationSec: number | null;
  /** What the phases account for — the structured session. */
  structuredDistanceMi: number | null;
  structuredDurationSec: number | null;
  /** Total minus structured. Null when they agree, which is most runs. */
  overtimeDistanceMi: number | null;
  overtimeDurationSec: number | null;
  /** What the per-mile table can draw. Null when the loader read no splits. */
  splitCount: number | null;
  splitDistanceMi: number | null;
  /** True when a human repaired the totals on this row. It travels because it
   *  changes what may be SAID: a stale `clockAudit` must not be narrated as a
   *  live shortfall once the number it complained about has been fixed. */
  correctedManually: boolean;
  /** Wall-clock seconds the tracker did not count, as the INGEST recorded it.
   *  Diagnostic only, never rendered — see `readCapture`. */
  uncountedSec: number | null;
  reasons: string[];
}

export interface PostRunExperienceV1 {
  version: string;
  /** The run this is about. The brief's "make run-id the canonical identity". */
  runId: string;
  dateISO: string;
  /** What both surfaces must agree on, byte for byte. */
  decisionVersion: string;
  execution: PostRunExecution;
  cost: PostRunCost;
  evidence: PostRunEvidenceImpact;
  plan: PostRunPlanImpact;
  next: PostRunNextAction;
  /** What the recording covers, and whether it covers the run. */
  capture: PostRunCapture;
  /** The strides, when the session had them. NULL when it did not — the
   *  surface then draws nothing rather than an empty section. */
  strides: PostRunStrides | null;
  /** Stage 3's typed contract, so `auditExplanation` reaches this copy. */
  briefing: CoachingExplanation;
}

/* ══════════════════════════════ 2 · the input ═══════════════════════════ */

export interface PostRunAdaptation {
  /** `coach_intents.reason`. */
  reason: string;
  /** One runner-readable line describing what moved. */
  display: string;
}

export interface PostRunInput {
  runId: string;
  dateISO: string;
  /** `plan_workouts.type` for the day, or null when nothing was prescribed. */
  plannedType: string | null;
  /** The runner-facing name for that type, from `displayTypeFor`. */
  plannedTypeDisplay: string | null;
  plannedDistanceMi: number | null;
  /**
   * This run matches a recorded `races` row for its own date (RACEWORD-1,
   * 2026-09-03) — a DIFFERENT fact from `plannedType === 'race'`, which is
   * null on any race with no matching `plan_workouts` row (unplanned entry,
   * or a race that predates the plan). "Most of the reps sat outside the
   * prescribed range" over the Americas Finest City half's five named course
   * segments is why this exists: that run has no plan row at all, so the
   * word choice below needs the runner's actual race history, not the plan.
   */
  raceMatched: boolean;
  /** See `PostRunExecution.targetProvenance` for the full doc — this is the
   *  same fact, computed once in `lib/postrun/load.ts` from whether a
   *  `plan_workouts` row exists for the day versus whether the run's own
   *  stored phases carry embedded `targetPaceSPerMi` values with no such
   *  row backing them. */
  targetProvenance: 'plan' | 'self_authored' | 'none';
  /** THE canonical grade. Never re-derived here. */
  verdict: WorkoutVerdict;
  /** The Evidence Engine's read, or null when the classification could not be
   *  run. Null is `role: 'UNREAD'` and is NOT the same as `INSUFFICIENT`. */
  evidence: ActivityEvidenceResult | null;
  /**
   * The ceilings the session prescribed, per SCOPE, resolved by
   * `lib/prescription/hr-ceiling.ts` — the one owner. A work-scoped ceiling
   * may only be read against a work-scoped mean, and a whole-run ceiling
   * against a whole-run mean; handing both in and letting `readCost` pick the
   * pair that matches is what keeps that from being a discipline (Rule 16).
   */
  workHrCeilingBpm: number | null;
  overallHrCeilingBpm: number | null;
  /** The whole-run mean heart rate. Used only when there are no work phases —
   *  on a steady run the whole run IS the work. */
  wholeRunHrBpm: number | null;
  /** The runner's own effort answer, 1-10. Null when not logged. */
  rpe: number | null;
  /** Adaptations recorded against this plan on or after the run's date. An
   *  EMPTY ARRAY means "we looked and there were none"; `null` means the look
   *  failed, and the two produce different plan-impact statuses (Rule 11). */
  adaptations: PostRunAdaptation[] | null;
  /** False when there is no active plan at all. */
  hasActivePlan: boolean;
  /** For `decisionVersion`. */
  activePlanId: string | null;
  /** True when the run has no usable GPS or HR — a sensor-limited session
   *  withholds the conclusions that need the missing sensor. */
  sensorLimited: boolean;
  /**
   * `workout_spec.strides_reps` for the day.
   *
   * THREE STATES, and they are three facts (Rule 11): a number is what the
   * session asked for, `0` is a session that prescribed none, and `null` is a
   * spec this loader could not read. Only a positive number licenses the
   * label-matching recovery rung, so a run with no plan row can never have a
   * phase relabelled into a stride by its own text.
   */
  stridesPrescribed: number | null;
  /** `runs.data.distanceMi` — the run's TOTAL. */
  recordedDistanceMi: number | null;
  recordedDurationSec: number | null;
  /** What the phase array accounts for. A different quantity from the total
   *  and named separately for that reason (Rule 16): on 2026-09-02 the total
   *  is 6.41 mi and the thirteen phases are 5.98 of it. */
  structuredDistanceMi: number | null;
  structuredDurationSec: number | null;
  /** What the per-mile table can draw — `runs.data.splits`. A THIRD quantity
   *  again: five whole-mile rows on that same run. */
  splitCount: number | null;
  splitDistanceMi: number | null;
  /** `runs.data.manualCorrection` is present. The totals on this row were
   *  repaired by a human, which changes what the drift record is allowed to
   *  claim — see `readCapture`. */
  correctedManually: boolean;
  /**
   * `runs.data.clockAudit`, the watch-completion route's own drift record.
   *
   * Written by that route ONLY when the check fails, so its presence is
   * already the finding. `pausedSec` and `declinedSec` are deliberately NOT
   * read here: the route computes them as `Number(body.pausedSec) || 0`, no
   * Swift file sends either field, and a zero that means "nobody said" must
   * not be spent as a zero that means "nothing was paused". Only `driftSec`
   * and the two totals are measurements.
   */
  clockAudit: { driftSec: number | null; wallSec: number | null; countedSec: number | null } | null;
}

/* ══════════════════════════════ 3 · execution ═══════════════════════════ */

/**
 * Small counts as words.
 *
 * A coach says "all four reps", not "all 4 of 4 graded pieces". The design
 * contract reserves numerals for MEASUREMENTS — a pace, a heart rate, a
 * distance — and a rep count is not one of those; printing it as a digit makes
 * the sentence read like a report. Ten and up stay numerals because
 * "seventeen" is harder to scan than "17".
 */
export function numberWord(n: number): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  return n >= 0 && n < words.length ? words[n] : String(n);
}

/** Sentence case for a clause that starts a sentence. */
function cap1(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** The word for a session class, for the intended-stimulus line. */
function stimulusFor(input: PostRunInput): string | null {
  const t = (input.plannedTypeDisplay ?? '').trim();
  if (t) return t;
  const raw = (input.plannedType ?? '').trim();
  return raw ? raw : null;
}

/**
 * IS THIS WORK PHASE A STRIDE — the one place that question is answered.
 *
 * Two rungs, most authoritative first, and the rung that answered travels with
 * the answer so a reader is never guessing which one did:
 *
 *   1 · `shape === 'effort'`. This IS the authored `isStrideSegment` marker,
 *       arriving through the grader: `verdict.ts` reads `p.isStrideSegment`
 *       into `byEffort`, and `paceShapeFor` turns `byEffort` into `effort`
 *       before anything else is considered. Nothing else in the phase
 *       vocabulary produces `effort` on a work phase, so when the wrist starts
 *       carrying the marker back this rung answers on its own.
 *
 *   2 · the SPEC's own rep count together with the AUTHORED label. The
 *       marker does not currently survive the round trip — `appendStrides`
 *       sets it, `build-workout.ts` puts it on the prescription wire, the
 *       watch decodes it, and `WatchCompletionPhase` (the outgoing struct)
 *       declares no such property — so every stored phase array in this
 *       database describes six accelerations as ordinary work. Until that is
 *       carried, this rung is what reaches the runner's already-stored runs.
 *
 * Rung 2 is a FALLBACK and is written as one. It is deliberately conjunctive:
 * a label alone can never mint a stride, because the spec must also say the
 * session prescribed some. The label form is `expand-spec.ts`'s own
 * `strideLabelFor`, matched by its sibling `looksLikeStrideLabel`, so the
 * authoring and the recognition cannot drift apart (Rule 16).
 */
export function isStridePhase(p: GradedPhase, stridesPrescribed: number | null): boolean {
  if (p.type !== 'work') return false;
  // 1 · THE GRADER'S OWN ANSWER, which is where the question now lives.
  if (p.isStrideSegment) return true;
  // 2 · the same answer arriving as a shape, for a phase graded before
  //     `GradedPhase.isStrideSegment` existed or by a caller that could not
  //     name the spec. Nothing else in the vocabulary makes a work phase
  //     `effort`.
  if (p.shape === 'effort') return true;
  // 3 · the label rung, for a caller that graded without the spec but can
  //     supply the count here. Conjunctive, always.
  return stridesPrescribed != null && stridesPrescribed > 0 && looksLikeStrideLabel(p.label);
}

/** Which rung answered, for the record. */
function strideBasis(v: WorkoutVerdict, stridesPrescribed: number | null): 'marker' | 'label' {
  return v.phases.some((p) => p.type === 'work' && p.shape === 'effort') ? 'marker' : 'label';
}

/**
 * THE SESSION'S WORK — which does not include its strides.
 *
 * A stride is a form drill appended to an easy day, not a piece of the work.
 * Counting them here is what produced "All seven reps" over a session whose
 * work was one 5.0 mi easy block, and it is the SAME arithmetic the wrist
 * commits independently: `WorkoutEngine.repCountForDisplay` is
 * `workout.phases.filter { $0.type == .work }.count`, which is why the run's
 * own `recoveryExtensions` rows carry `repCount: 7` on a session prescribed as
 * six strides. Two surfaces, one expression, one wrong answer — Rule 16 twice
 * over. This fixes the half that reaches the sentence; the wrist's half is
 * reported for the surface that owns it.
 */
function workPhases(v: WorkoutVerdict, stridesPrescribed: number | null): GradedPhase[] {
  return v.phases.filter((p) => p.type === 'work' && !isStridePhase(p, stridesPrescribed));
}

/**
 * The session-level runner-facing execution read.
 *
 * The STATUS comes off `verdict.session`, which is the canonical grade, plus
 * two facts the grade does not carry: whether the payload was gradable at all
 * and whether the sensors were good enough to grade it. It never re-grades a
 * phase and never compares a pace.
 */
export function readExecution(input: PostRunInput, strides: PostRunStrides | null): PostRunExecution {
  const v = input.verdict;
  const work = workPhases(v, input.stridesPrescribed);
  /* THE SESSION GRADE, OVER THE RIGHT POPULATION (Rule 14).
   *
   * `v.session` is the canonical grade and it is not re-derived here — but it
   * was laddered over EVERY `type: 'work'` phase, and on an easy-plus-strides
   * day that population is wrong: it holds the 5.0 mi easy block AND six
   * 20-second accelerations. That is what put `fasts: 4` and `graded: 7` into
   * a sentence about a single easy block, and it is why the runner read "All
   * seven reps landed, with four quicker than the ceiling."
   *
   * This is not a second grader. `sessionLadder` is THE ladder and its own
   * header exists to be called from exactly here ("Two callers, one ladder —
   * the second implementation of it is the thing this export exists to
   * prevent"). Same function, same per-phase verdicts, graded once in
   * `verdict.ts`; only the SET is corrected. `lateCollapse` and
   * `recoveriesHonest` are taken from the canonical grade rather than
   * recomputed, so nothing about them is re-decided here either.
   *
   * When the session has no strides the two populations are identical and the
   * canonical object is used unchanged — so every other session in the app is
   * byte-for-byte unaffected by this branch. */
  const s = work.length === v.work.count
    ? v.session
    : sessionLadder(work.map((p) => p.verdict), {
        lateCollapse: v.session.lateCollapse,
        recoveriesHonest: v.session.recoveriesHonest,
      });
  const reasons: string[] = [];
  const stimulus = stimulusFor(input);
  /* THE STRIDES ARE APPENDED TO THE SENTENCE, NEVER GRADED INTO IT.
   *
   * One clause, stating completion, after the sentence about the work. A coach
   * mentions that the strides got done; he does not report six 20-second
   * accelerations against a target, because doctrine's own word for them is
   * "Not a workout" (`Research/04` §7.2) and the band is wide precisely so
   * they are not chased. Rule 17 keeps it to a summary: the per-stride rows
   * live in the strides section and are not restated here. */
  const strideClause = strides && strides.completed > 0
    ? ` ${cap1(numberWord(strides.completed))} stride${strides.completed === 1 ? '' : 's'} after${strides.recoveryCount > 0 ? ', walk-backs taken' : ''}.`
    : '';

  // A payload with no phases cannot be graded as a workout. That is a fact
  // about the recording, not a verdict about the runner.
  if (v.basis === 'none' || work.length === 0) {
    reasons.push('NO_PHASE_STRUCTURE_RECORDED');
    const sensor = input.sensorLimited;
    if (sensor) reasons.push('SENSOR_COVERAGE_INSUFFICIENT');
    return {
      status: sensor ? 'SENSOR_LIMITED' : 'INDETERMINATE',
      headline: sensor ? 'Recorded, not graded' : 'Run recorded',
      summary: sensor
        ? 'The sensors did not cover enough of this run to grade it against the session.'
        : `This run carries no session structure, so there is nothing to grade it against.${strideClause}`,
      intendedStimulus: stimulus,
      stimulusDelivered: 'UNKNOWN',
      confidence: 'LOW',
      targetProvenance: input.targetProvenance,
      targetProvenanceNote: null,
      reasons,
    };
  }

  if (s.verdict === 'not_graded') {
    reasons.push('NO_PACE_TARGET_ON_THE_WORK');
    return {
      status: 'INDETERMINATE',
      headline: 'Work done, no target to read it against',
      summary: `The work phases carried no prescribed pace, so this is a record of what was run rather than a grade.${strideClause}`,
      intendedStimulus: stimulus,
      stimulusDelivered: 'UNKNOWN',
      confidence: 'LOW',
      targetProvenance: input.targetProvenance,
      targetProvenanceNote: null,
      reasons,
    };
  }

  /* THE PROVENANCE NOTE (PROVENANCE-1, 2026-09-03), from here down — every
   * remaining branch shows phase-level target language ("asked X",
   * "prescribed range", "On target"/"Slower than target"), so from here on
   * the note travels with it. A self-authored race pacing plan reads
   * "outside the window" the exact same way a coach-prescribed session
   * does; only WHOSE window it was differs, and that is the one fact this
   * app was silent about on the Americas Finest City half. See
   * `PostRunExecution.targetProvenance`'s own doc for the full reasoning. */
  const targetProvenanceNote = input.targetProvenance === 'self_authored'
    ? (input.raceMatched
        ? "These segment targets are the pace plan you set for this race, not one from the app."
        : "This session's targets came from the workout you built on your watch, not from the app's plan.")
    : null;

  // The runner's word for the work, chosen off the SHAPE of the session
  // rather than a template: four one-mile pieces are reps, one continuous
  // block is not, and calling a tempo "rep 1 of 1" is how a screen stops
  // sounding like a coach. A RACE's stages are a third shape again — not
  // repetitions of one thing, so "Most of the reps sat outside the
  // prescribed range" over Point Loma Climb / The Drop / Mission Bay /
  // Harbor Approach is a category error, not a style choice. See
  // `raceMatched`'s own doc comment on `PostRunInput` for why this cannot
  // read `input.plannedType` instead.
  //
  // A FOURTH shape (PORTIONS-1, 2026-09-04): a marathon-specific long run's
  // "10.0 mi easy" + "4.0 mi @ marathon pace" are two work phases same as
  // a rep set is, but they are not repetitions of one thing either — they
  // are two DIFFERENT prescriptions serving two different purposes, and
  // "All two reps stayed under the ceiling" reads as a two-repetition
  // interval set that happens to have two pieces, not as what it actually
  // was. Distinguished from a true rep set by a real structural fact
  // rather than a label guess: reps of one thing share one target pace;
  // an easy-plus-marathon-pace long run's two phases do not, by
  // construction. `input.raceMatched` is checked first — a race's own
  // segments can vary just as much in target pace and already have the
  // more specific word.
  const single = work.length === 1;
  const distinctWorkTargets = new Set(
    work.map((p) => (p.targetSecPerMi != null ? Math.round(p.targetSecPerMi / 5) : null)).filter((t) => t != null),
  );
  const isMultiPurposeStructure = !single && !input.raceMatched && distinctWorkTargets.size > 1;
  const noun = single ? 'block'
    : input.raceMatched ? 'segments'
    : isMultiPurposeStructure ? 'portions'
    : 'reps';
  // "All two portions" reads as a miscount, not a whole set — David's own
  // example language for this exact case was "Both phases" / "Across the
  // two portions". At exactly two, say "both"; three or more still needs
  // the count, where "all N" is the natural English.
  const reps = single ? 'the work block' : work.length === 2 ? `both ${noun}` : `all ${numberWord(work.length)} ${noun}`;

  /* AND THE WORD FOR WHAT IT WAS GRADED AGAINST (2026-09-02).
   *
   * A threshold rep is graded against a WINDOW; an easy or long day's work is
   * graded against a CEILING, which has one edge. Calling a ceiling a window
   * says the runner could have been too slow for it, and doctrine is explicit
   * that an easy run is never failed for being slow. Found by sweeping this
   * composer over the runner's own 40 most recent runs: his 2026-08-30 long
   * read "The work block came in ahead of the window" over a phase whose shape
   * was `ceiling`. */
  const shapes = new Set(work.filter((p) => p.verdict !== 'not_graded').map((p) => p.shape));
  const bound = shapes.size === 1 && shapes.has('ceiling') ? 'ceiling'
    : shapes.size === 1 && shapes.has('window') ? 'window'
    : 'target';
  const insideBound = bound === 'ceiling' ? 'stayed under the ceiling'
    : bound === 'window' ? 'landed inside the window'
    : 'landed on target';
  const aheadOfBound = bound === 'ceiling' ? 'came in ahead of the ceiling'
    : bound === 'window' ? 'came in ahead of the window'
    : 'came in ahead of target';
  const outsideBound = bound === 'ceiling' ? 'ran faster than the ceiling'
    : 'sat outside the prescribed range';

  if (s.verdict === 'incomplete') {
    reasons.push('WORK_PHASE_ENDED_EARLY');
    return {
      status: 'INCOMPLETE',
      headline: 'Session ended early',
      summary: `${cap1(numberWord(s.hits + s.fasts))} of ${numberWord(work.length)} ${noun} ${s.hits + s.fasts === 1 ? 'was' : 'were'} finished before the session stopped.${strideClause}`,
      intendedStimulus: stimulus,
      stimulusDelivered: 'PARTIAL',
      confidence: 'MODERATE',
      targetProvenance: input.targetProvenance,
      targetProvenanceNote,
      reasons,
    };
  }

  if (s.verdict === 'off_target') {
    reasons.push('MOST_WORK_PIECES_FELL_SHORT');
    /* RACE-VOICE-1, 2026-09-04 · "Work landed outside the window" /
     * "sat outside the prescribed range" is internal-composer language —
     * "work", "window", "prescribed range" are this file's own vocabulary
     * for a phase's shape, not words a coach says to a runner about a
     * race. A self-authored race pacing plan gets the direct version:
     * named as the runner's OWN plan (matches `targetProvenanceNote`
     * above, which already says whose targets these are), with an exact
     * count of segments rather than "most of". */
    if (input.raceMatched && input.targetProvenance === 'self_authored') {
      const fellShort = work.filter((p) => p.verdict === 'slow').length;
      return {
        status: 'SLOW',
        headline: 'Slower than your race plan',
        summary: `${cap1(numberWord(fellShort))} of ${numberWord(work.length)} course segments were slower than the pacing plan you set on your Watch.${strideClause}`,
        intendedStimulus: stimulus,
        stimulusDelivered: 'PARTIAL',
        confidence: 'MODERATE',
        targetProvenance: input.targetProvenance,
        targetProvenanceNote,
        reasons,
      };
    }
    return {
      status: 'SLOW',
      headline: 'Work landed outside the window',
      summary: (single
        ? `The work block ${outsideBound}.`
        : `Most of the ${noun} ${outsideBound}.`) + strideClause,
      intendedStimulus: stimulus,
      stimulusDelivered: 'PARTIAL',
      confidence: 'MODERATE',
      targetProvenance: input.targetProvenance,
      targetProvenanceNote,
      reasons,
    };
  }

  if (s.verdict === 'uneven') {
    reasons.push('WORK_PIECES_DISAGREE');
    /* KEY-PHASE-1, 2026-09-04 · replaces the since-deleted `paceShortfalls`
     * check, which INVERTED ceiling semantics: it flagged a ceiling phase
     * running SLOWER than its ceiling as a "shortfall", when doctrine is
     * explicit a ceiling never fails for being slow — "10.0 mi easy
     * averaged 8:48/mi against 8:00/mi prescribed" was reported as a miss
     * when 8:48 is compliant with an 8:00 ceiling by construction. That
     * defect is now impossible by construction too: `MP_PHASE_TOLERANCE_
     * S_PER_MI` (`execution-semantics.ts`) makes `gradeStoredPhases` grade
     * a marathon-pace-labelled phase as a WINDOW, not a ceiling, so a real
     * miss on that phase surfaces as `slow`/`fast` through the SAME ladder
     * every other window phase uses — this branch only NAMES which phase
     * within an `isMultiPurposeStructure` session earned the mixed verdict,
     * it does not re-decide anything `sessionLadder` already decided.
     *
     * Research/04-workout-vocabulary.md §4.1: a marathon-pace long run's
     * whole point is "marathon-specific economy" — the window-shaped phase
     * IS the prescription this session exists for, and a ceiling phase
     * beside it is safety context. Prioritized per that: which block, was
     * its pace compliant with ITS OWN shape, was HR appropriate, then the
     * supporting phase. */
    if (isMultiPurposeStructure) {
      const keyPhases = work.filter((p) => p.shape === 'window' && p.verdict !== 'not_graded');
      if (keyPhases.length > 0) {
        const key = keyPhases[0];
        const support = work.filter((p) => p !== key);
        const keyLabel = key.label ?? 'the key block';
        const keyActual = fmtPaceSlash(key.avgSecPerMi);
        const keyTarget = fmtPaceSlash(key.targetSecPerMi);
        const paceLine = keyActual && keyTarget
          ? key.verdict === 'slow'
            ? `averaged ${keyActual}, outside its ${keyTarget} window`
            : key.verdict === 'fast'
              ? `averaged ${keyActual}, ahead of its ${keyTarget} window`
              : `averaged ${keyActual}, inside its ${keyTarget} window`
          : 'was completed';
        const hrLine = key.avgHr == null ? ''
          : input.workHrCeilingBpm != null
            ? ` HR averaged ${key.avgHr} bpm, ${key.avgHr <= input.workHrCeilingBpm ? 'under' : 'over'} the ${input.workHrCeilingBpm} bpm ceiling.`
            : ` HR averaged ${key.avgHr} bpm.`;
        const supportNames = support.map((p) => p.label).filter((l): l is string => !!l);
        const supportLine = supportNames.length > 0
          ? ` ${cap1(listWords(supportNames))} stayed within ${supportNames.length === 1 ? 'its' : 'their'} own ceiling.`
          : '';
        reasons.push('KEY_PHASE_NAMED');
        return {
          status: 'PARTIAL_PRODUCTIVE',
          headline: key.verdict === 'slow' ? 'Structure completed, pace below target'
            : key.verdict === 'fast' ? 'Structure completed, pace ahead of target'
            : 'Structure completed',
          summary: `${cap1(keyLabel)} ${paceLine}.${hrLine}${supportLine}${strideClause}`,
          intendedStimulus: stimulus,
          stimulusDelivered: 'PARTIAL',
          confidence: 'HIGH',
          targetProvenance: input.targetProvenance,
          targetProvenanceNote,
          reasons,
        };
      }
    }
    return {
      status: 'PARTIAL_PRODUCTIVE',
      headline: 'Mixed set',
      summary: `Some of the ${noun} ${insideBound} and some did not.${strideClause}`,
      intendedStimulus: stimulus,
      stimulusDelivered: 'PARTIAL',
      confidence: 'MODERATE',
      targetProvenance: input.targetProvenance,
      targetProvenanceNote,
      reasons,
    };
  }

  // `executed` — every graded work piece landed. Two sub-cases, and the
  // difference matters to a coach: all of them quicker than the window is not
  // the same session as all of them inside it.
  const allFast = s.fasts === s.graded && s.graded > 0;
  if (allFast) {
    reasons.push('EVERY_WORK_PIECE_QUICKER_THAN_TARGET');
    return {
      status: 'FAST',
      headline: 'Quicker than prescribed throughout',
      summary: (single
        ? `The work block ${aheadOfBound}.`
        : `${cap1(reps)} ${aheadOfBound}.`) + strideClause,
      intendedStimulus: stimulus,
      stimulusDelivered: 'FULL',
      confidence: 'HIGH',
      targetProvenance: input.targetProvenance,
      targetProvenanceNote,
      reasons,
    };
  }
  reasons.push('EVERY_WORK_PIECE_LANDED');
  if (s.recoveriesHonest) reasons.push('RECOVERIES_TAKEN_AS_PRESCRIBED');
  if (!s.lateCollapse) reasons.push('NO_LATE_COLLAPSE');
  /* EASY-VOICE-1, 2026-09-04 · "Work executed" is composer vocabulary — a
   * single ceiling-shaped block (an ordinary easy or long run, no reps to
   * land) is not a "work" that gets "executed", it is a run that got done.
   * By this point in the function the phase has already earned a genuine
   * `hit` (a `fast` ceiling verdict routed to the branch above, and a
   * ceiling can never grade `slow` — `gradeCeilingPhase` has no slow
   * verdict), so "stayed under the ceiling" is asserted only because the
   * grade actually proves it, per Rule 16 — never asserted merely because
   * the session happens to be shaped that way. */
  if (single && bound === 'ceiling') {
    reasons.push('SINGLE_CEILING_BLOCK');
    const runWord = input.plannedType === 'long' ? 'Long run'
      : input.plannedType === 'recovery' ? 'Recovery run'
      : input.plannedType === 'shakeout' ? 'Shakeout'
      : 'Easy run';
    return {
      status: 'CONTROLLED',
      headline: `${runWord} complete`,
      summary: `You kept the run controlled, staying under the pace ceiling.${strideClause}`,
      intendedStimulus: stimulus,
      stimulusDelivered: 'FULL',
      confidence: 'HIGH',
      targetProvenance: input.targetProvenance,
      targetProvenanceNote,
      reasons,
    };
  }
  // CONTROLLED is the word for landed-and-held-together; EXECUTED for landed
  // where the shape of the set is not something this grade can speak to.
  const controlled = s.recoveriesHonest === true && !s.lateCollapse;
  return {
    status: controlled ? 'CONTROLLED' : 'EXECUTED',
    headline: controlled ? 'Controlled work' : 'Work executed',
    summary: (s.fasts > 0
      ? `${cap1(reps)} landed, with ${numberWord(s.fasts)} quicker than the ${bound}.`
      : `${cap1(reps)} ${insideBound}.`) + strideClause,
    intendedStimulus: stimulus,
    stimulusDelivered: 'FULL',
    confidence: 'HIGH',
    targetProvenance: input.targetProvenance,
    targetProvenanceNote,
    reasons,
  };
}

/* ═══════════════════ 3b · strides · 2026-09-02 ══════════════════════════ */

function mi1(n: number): string {
  return n.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
}

/**
 * The strides, as a drill that was DONE — never as a set that was graded.
 *
 * Closure 4 is the whole point of this function: doctrine calls a stride
 * "relaxed", "~85-95% max effort" and "Not a workout" (`Research/04` §7.2), so
 * the only honest things to say about one are that it happened, how long it
 * was, and what the heart rate did. `appendStrides` gives them a 45 s/mi band
 * for exactly this reason — its own comment says "a tight pace gate would turn
 * a form drill into something to chase" — and the screen then chased them
 * anyway, reporting four of the runner's six as deviations for being quick.
 *
 * There is no verdict field on `PostRunStride` and there must not be one. A
 * consumer that wants to grade a stride has to add the concept itself, which
 * is the point at which someone has to justify it against the citation above.
 *
 * Returns NULL — not an empty object — when the session had no strides, so the
 * surface draws nothing rather than a section reading "0 strides".
 */
export function readStrides(input: PostRunInput): PostRunStrides | null {
  const v = input.verdict;
  const phases = v.phases.filter((p) => isStridePhase(p, input.stridesPrescribed));
  if (phases.length === 0) return null;

  const strides: PostRunStride[] = phases.map((p, i) => ({
    ordinal: i + 1,
    label: p.label,
    distanceMi: p.actualDistanceMi,
    durationSec: p.actualDurationSec,
    paceSecPerMi: p.avgSecPerMi,
    avgHr: p.avgHr,
    avgCadence: p.avgCadence,
    completed: p.completed,
  }));
  const completed = strides.filter((s) => s.completed).length;

  /* THE WALK-BACKS ARE PART OF THE DRILL, so they are shown rather than
   * dropped. Doctrine prescribes "Full walk-back or 60-90 s jog — no fatigue
   * between strides", which makes taking them correct execution; and the
   * runner's 2026-09-02 recovery segments carry 0.11-0.12 mi each, which is
   * where a third of his missing 0.98 mi lives. A recovery phase that FOLLOWS
   * a stride is a walk-back; one that follows a rep is not, so the position is
   * what identifies it and not its label. */
  const strideIdx = new Set(phases.map((p) => p.index));
  const walkBacks = v.phases.filter(
    (p) => p.type === 'recovery' && strideIdx.has(p.index - 1),
  );
  const recoveryMi = walkBacks.reduce<number | null>(
    (acc, p) => (p.actualDistanceMi == null ? acc : (acc ?? 0) + p.actualDistanceMi),
    null,
  );

  /* THE SENTENCE. Completion, distance, and nothing that reads as a grade.
   *
   * `prescribed` is stated only when it DISAGREES with what was recorded —
   * saying "six of six" on a session that did six is the kind of arithmetic
   * that reads as a report rather than a coach (Rule 17). */
  const shortOfPrescribed = input.stridesPrescribed != null
    && input.stridesPrescribed > 0
    && completed < input.stridesPrescribed;
  const strideMi = strides.reduce<number | null>(
    (acc, s) => (s.distanceMi == null ? acc : (acc ?? 0) + s.distanceMi),
    null,
  );
  /* RULE 17 · THIS DOES NOT REPEAT THE CARD.
   *
   * The execution sentence above already says the strides were done ("Six
   * strides after, walk-backs taken"). Saying it again here in a longer font
   * is the exact bloat this programme is about, so this section states the one
   * thing the card does NOT carry and the mile table structurally cannot: how
   * much of the run these segments are. On 2026-09-02 that is 0.98 mi — every
   * inch of the distance the five-row mile table left off the screen.
   *
   * The count only appears when it DISAGREES with the prescription, because
   * "six of six" is a report and "you were short two" is coaching. */
  const coveredMi = strideMi != null || recoveryMi != null
    ? Math.round(((strideMi ?? 0) + (recoveryMi ?? 0)) * 100) / 100
    : null;
  const covered = coveredMi != null
    ? `${mi1(coveredMi)} mi of this run is the strides and their walk-backs.`
    : 'The strides and their walk-backs close out the run.';
  const summary = shortOfPrescribed
    ? `${cap1(numberWord(completed))} of ${numberWord(input.stridesPrescribed!)} strides were recorded. ${covered}`
    : covered;

  return {
    prescribed: input.stridesPrescribed,
    recorded: strides.length,
    completed,
    strides,
    recoveryCount: walkBacks.length,
    recoveryDistanceMi: recoveryMi == null ? null : Math.round(recoveryMi * 100) / 100,
    summary,
    basis: strideBasis(v, input.stridesPrescribed),
  };
}

/* ═══════════════════ 3c · capture · Rule 11 on distance ═════════════════ */

/**
 * Does the recording cover the run.
 *
 * The watch-completion route has computed this since it was written, warns to
 * the console in words that could not be clearer — "Distance is integrated
 * from the same clock, so it is short by the same share" — stores the result on
 * the row, and NO SURFACE HAS EVER READ IT. Wired, detected and inert, which is
 * this codebase's signature failure and the one it can least afford on a
 * number the runner reads as a measurement.
 *
 * WHAT IS AND IS NOT A MEASUREMENT HERE. `driftSec`, `wallSec` and `countedSec`
 * are computed from two timestamps and an uploaded total, so they are real.
 * `pausedSec` and `declinedSec` are NOT: the route computes each as
 * `Number(body.pausedSec) || 0`, and no Swift file in this repository sends
 * either field, so both are structurally `0` on every row ever written. Reading
 * that zero as "nothing was paused" would be Rule 11 broken inside the audit
 * that exists to catch dropped time, so this function does not read them and
 * the sentence it writes does not claim they were checked.
 *
 * IT NEVER GUESSES THE MISSING DISTANCE. It says the recording is short and
 * how much wall clock went uncounted. The runner's own watch read 6.41 mi
 * against the 5.98 stored; this function is not told that and must not invent
 * it.
 */
/**
 * The smallest gap between the total and the phases worth calling overtime.
 *
 * A tenth of a mile. Below it the difference is GPS rounding across thirteen
 * phase boundaries, not running — the 2026-09-02 phases each carry two decimal
 * places, so thirteen of them can disagree with the total by a few hundredths
 * without anybody having run anywhere.
 *
 * A presentation threshold over a sensor's resolution, not a coaching decision:
 * nothing categorical about the run turns on it, no verdict reads it, and the
 * only thing that changes across it is whether one sentence is drawn (Rule 9).
 */
const OVERTIME_MIN_MI = 0.1;

export function readCapture(input: PostRunInput): PostRunCapture {
  const total = input.recordedDistanceMi;
  const totalSec = input.recordedDurationSec;
  const structured = input.structuredDistanceMi;
  const structuredSec = input.structuredDurationSec;
  const corrected = input.correctedManually;

  const gapMi = total != null && structured != null ? Math.round((total - structured) * 100) / 100 : null;
  const gapSec = totalSec != null && structuredSec != null ? totalSec - structuredSec : null;
  const hasOvertime = gapMi != null && gapMi >= OVERTIME_MIN_MI;

  const base = {
    totalDistanceMi: total,
    totalDurationSec: totalSec,
    structuredDistanceMi: structured,
    structuredDurationSec: structuredSec,
    overtimeDistanceMi: hasOvertime ? gapMi : null,
    overtimeDurationSec: hasOvertime ? gapSec : null,
    splitCount: input.splitCount,
    splitDistanceMi: input.splitDistanceMi,
    correctedManually: corrected,
    uncountedSec: input.clockAudit?.driftSec ?? null,
  };

  if (total == null || structured == null) {
    return { status: 'UNKNOWN', summary: null, ...base, reasons: ['NO_TOTAL_OR_NO_PHASES_TO_RECONCILE'] };
  }

  if (hasOvertime) {
    /* THE RECONCILIATION SENTENCE · three quantities, one total.
     *
     * Every number in it is present-tense and measured off this row, which is
     * what makes it safe to state precisely — unlike `clockAudit.driftSec`,
     * which is frozen at ingest and, on this very run, is now stale by design
     * (the repair note says so: "clockAudit is left as the original ingest
     * recorded it"). Reading a stale drift as a live shortfall after the total
     * has been fixed would be Rule 10 broken inside the honesty machinery.
     *
     * The overtime is named for what it is. It is real running he did, it
     * belongs to the run, and it belongs to no phase — so it gets a clause of
     * its own and never a fabricated phase or split row. */
    const mileNote = input.splitCount != null && input.splitCount > 0 && input.splitDistanceMi != null
      && total - input.splitDistanceMi >= OVERTIME_MIN_MI
      /* NO "BELOW". Rendered on the simulator against his real row: this
       * sentence draws inside `PostRunLearnedV5`, which sits AFTER the mile
       * table on Today-after-run, so "the mile table below" pointed the runner
       * past it at the log actions. A sentence that describes a layout is
       * wrong the moment the layout moves; this one names the table and lets
       * the eye find it. */
      ? ` The mile table covers the first ${numberWord(input.splitCount)}.`
      : '';
    return {
      status: 'OVERTIME',
      summary:
        `${mi1(total)} mi in total: ${mi1(structured)} mi of the session, `
        + `then ${mi1(gapMi)} mi run on after the last prescribed piece.${mileNote}`,
      ...base,
      reasons: ['TOTAL_EXCEEDS_STRUCTURED_PHASES'],
    };
  }

  /* THE TOTAL ITSELF MAY BE SHORT — but only where nobody has already fixed it.
   *
   * `clockAudit` is written by the watch-completion route ONLY when its check
   * fails, so its presence is the finding. What it cannot know is whether the
   * total it complained about was later repaired, and on this run it was:
   * `data.manualCorrection` records 5.98 → 6.41 from the runner's own watch
   * display. Narrating the stale drift after that would tell him the recording
   * is short when it is no longer short — a confident claim from a value whose
   * anchor has moved (Rule 10), inside the one sentence whose whole job is to
   * be trustworthy about coverage.
   *
   * The magnitude is never stated even when it is: `driftSec` is
   * `completedAt − startedAt − countedSec`, and on a salvaged completion
   * `completedAt` is when the payload was BUILT, not when the runner stopped.
   * Here that is 1637 s against 292 s of real lost running — "about 27 minutes
   * uncounted" would have been five times the truth, stated confidently, in a
   * caveat about honesty (Rule 13 clause 4). */
  const drift = input.clockAudit?.driftSec ?? null;
  if (drift != null && drift > 0 && !corrected) {
    return {
      status: 'SHORT',
      summary:
        `The watch stopped counting before this run ended. It logged ${mi1(total)} mi, and its own clock `
        + `recorded more elapsed time than it counted, so the distance, the splits and the paces below `
        + `cover less than you ran.`,
      ...base,
      reasons: ['WALL_CLOCK_EXCEEDS_COUNTED_TIME'],
    };
  }

  return {
    status: 'RECONCILED',
    summary: null,
    ...base,
    reasons: corrected ? ['TOTALS_CORRECTED_BY_HAND'] : ['PHASES_ACCOUNT_FOR_THE_RUN'],
  };
}

/* ══════════════════════════════ 4 · cost ════════════════════════════════ */

/**
 * The physiological cost, as ONE conclusion.
 *
 * The brief: "summarize cost as one coaching conclusion", not a dashboard.
 * Rule 16 applies hard here — a sentence about heart rate is gated on a heart
 * rate, and a sentence about a ceiling is gated on a ceiling existing. The
 * recap has said "kept it aerobic" over a run whose HR was above its ceiling
 * exactly because that gate was missing.
 */
export function readCost(input: PostRunInput): PostRunCost {
  const reasons: string[] = [];
  const env = input.evidence?.environment ?? null;
  const heatPlausible = env?.hrCostPlausiblyElevated === true;

  /* THE PAIR IS PICKED TOGETHER, so a reading and a ceiling can never be from
   * two different scopes. Work phases first — on a rep session the whole-run
   * mean describes no part of the session honestly. On a steady run there are
   * no work phases and the whole run IS the work. */
  const hasWork = input.verdict.work.count > 0;
  const hr = hasWork ? input.verdict.work.hrAvg : input.wholeRunHrBpm;
  const scope: 'work' | 'overall' | null = hr == null ? null : hasWork ? 'work' : 'overall';
  const ceiling = scope === 'work' ? input.workHrCeilingBpm
    : scope === 'overall' ? input.overallHrCeilingBpm
    : null;
  const word = scope === 'work' ? 'Work heart rate' : 'Heart rate';

  const base = { hrBpm: hr, hrScope: scope, ceilingBpm: ceiling, rpe: input.rpe };

  if (hr == null) {
    reasons.push('NO_HEART_RATE_RECORDED');
    return { status: 'UNKNOWN', summary: null, ...base, reasons };
  }
  if (ceiling == null) {
    // A number with nothing to read it against is not a conclusion. The
    // reading still travels; the SENTENCE does not (Rule 16).
    reasons.push(scope === 'work' ? 'NO_WORK_SCOPED_CEILING_PRESCRIBED' : 'NO_WHOLE_RUN_CEILING_PRESCRIBED');
    return { status: 'UNKNOWN', summary: null, ...base, reasons };
  }

  if (hr <= ceiling) {
    reasons.push('HEART_RATE_UNDER_THE_CEILING');
    return {
      status: 'EXPECTED',
      summary: `${word} averaged ${hr} against a ${ceiling} ceiling.`,
      ...base,
      reasons,
    };
  }
  if (heatPlausible) {
    reasons.push('HEART_RATE_OVER_THE_CEILING', 'CONDITIONS_MAKE_ELEVATED_HR_PLAUSIBLE');
    return {
      status: 'HIGHER_EXPLAINED',
      summary: `${word} averaged ${hr} against a ${ceiling} ceiling, and the conditions account for a rise of that size.`,
      ...base,
      reasons,
    };
  }
  reasons.push('HEART_RATE_OVER_THE_CEILING');
  return {
    status: 'HIGHER_UNEXPLAINED',
    summary: `${word} averaged ${hr} against a ${ceiling} ceiling, with nothing in the conditions to account for it.`,
    ...base,
    reasons,
  };
}

/* ══════════════════════════════ 5 · evidence ════════════════════════════ */

const DOMAIN_FOR_CAPACITY: Record<CapacityName, EvidenceDomain | null> = {
  threshold: 'THRESHOLD',
  high_intensity: 'HIGH_INTENSITY',
  durability: 'DURABILITY',
  // The easy ceiling is a pace belief, not one of the brief's five domains,
  // and a single activity is explicitly forbidden from resetting it. Mapping
  // it onto READINESS or LOAD_TOLERANCE would be inventing a claim.
  easy_ceiling: null,
};

/** The runner's word for a capacity. Never the engine's. */
const DOMAIN_WORD: Record<EvidenceDomain, string> = {
  THRESHOLD: 'threshold range',
  HIGH_INTENSITY: 'speed',
  DURABILITY: 'ability to hold pace late',
  LOAD_TOLERANCE: 'tolerance for this much running',
  READINESS: 'recovery',
};

function listWords(xs: string[]): string {
  if (xs.length === 0) return '';
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/**
 * What the run taught faff.
 *
 * READS the Evidence Engine. Computes nothing: `kind`, `strength`,
 * `anchorEffect` and `anchorMoveCandidate` are all its words, and this only
 * chooses which of them the runner needs.
 */
export function readEvidence(input: PostRunInput): PostRunEvidenceImpact {
  const ev = input.evidence;
  if (!ev) {
    // Rule 11. The read did not happen. That is not "not enough evidence".
    return {
      role: 'UNREAD',
      domains: [],
      runnerSummary: 'This run has not been read into the coaching picture yet.',
      beliefChanged: false,
      planAuthorityEligible: false,
      reasons: ['EVIDENCE_CLASSIFICATION_UNAVAILABLE'],
    };
  }
  if (!ev.eligibility.admissible) {
    return {
      role: 'EXCLUDED',
      domains: [],
      /* THE SENSOR IS THE SUBJECT, AND THE WORDS HAVE TO SAY SO.
       *
       * This read "the recording is not good enough to read", which
       * `lib/faff/coach-lexicon.ts` correctly flags: "not good enough" is a
       * banned term in the SCOLDING band, written to stop this app ever
       * telling the runner he is not good enough. The sentence was about a
       * recording and was honest — and a runner scanning it meets the phrase
       * anyway, on a screen about his own run. The lexicon is right and the
       * copy was wrong; "not clear enough to read" says the identical thing
       * about a sensor and is better English about one. */
      runnerSummary: 'This run is kept in your log but is not used to judge fitness, because the recording is not clear enough to read.',
      beliefChanged: false,
      planAuthorityEligible: false,
      reasons: ev.eligibility.rejections.slice(),
    };
  }

  const supporting: EvidenceDomain[] = [];
  const reasons: string[] = [];
  for (const cap of Object.keys(ev.capacities) as CapacityName[]) {
    const c: CapacityEvidence = ev.capacities[cap];
    if (c.kind !== 'evidence') continue;
    const domain = DOMAIN_FOR_CAPACITY[cap];
    if (!domain) continue;
    supporting.push(domain);
    for (const r of c.reasons) reasons.push(`${cap.toUpperCase()}:${r}`);
  }

  /* ── THE BELIEF MUST ACTUALLY HAVE BEEN SUPPLIED (closure 6, 2026-09-02) ──
   *
   * `BeliefTensionRead` is a discriminated union with three distinct refusals,
   * and this file collapsed all three into `null`:
   *
   *   observation_consistent_with_belief   a MEASUREMENT — we compared, and it
   *                                        agreed
   *   no_comparable_observation            a measurement about the ACTIVITY —
   *                                        nothing in it to compare
   *   no_belief_supplied                   THE READ NEVER HAPPENED
   *
   * The third was the live state of every post-run surface. `load.ts` called
   * `classifyStoredActivity(userId, runId)` with no options, so
   * `currentBelief` was null on every call, so `readBeliefTension` refused with
   * `no_belief_supplied` on every run — and the `CHALLENGES` arm below has
   * therefore never fired for anyone, while the screen went on saying "This
   * supports your current threshold range" as though the belief had been
   * checked against. A sentence asserting a fact about a comparison, printed
   * over a comparison that did not occur (Rule 16), and a field that exists and
   * cannot fire (Rule 21's shape).
   *
   * The fix has two halves and both are required. `load.ts` now resolves the
   * canonical belief through `resolveThresholdCapacity` — the owner CLAUDE.md
   * names — and passes it in. And this arm now refuses out loud when it was
   * not supplied, so the failure can never again be invisible. */
  const beliefUnread = !ev.beliefTension.ok && ev.beliefTension.reason === 'no_belief_supplied';
  if (beliefUnread) reasons.push('CURRENT_BELIEF_NOT_SUPPLIED_TO_CLASSIFIER');
  const tension = ev.beliefTension.ok ? ev.beliefTension : null;
  const words = listWords(supporting.map((d) => DOMAIN_WORD[d]));

  if (tension) {
    // The third outcome. The belief is NOT changed and the type cannot say it
    // was — `anchorEffect` is the single literal `no_change_flag_for_reexamination`.
    return {
      role: 'CHALLENGES',
      domains: supporting.length > 0 ? supporting : [DOMAIN_FOR_CAPACITY[tension.capacity] ?? 'THRESHOLD'],
      runnerSummary: `This sits outside what your current ${DOMAIN_WORD[DOMAIN_FOR_CAPACITY[tension.capacity] ?? 'THRESHOLD']} predicts. It is noted, and the next session like it will settle whether the number moves.`,
      beliefChanged: false,
      planAuthorityEligible: ev.anchorMoveCandidate,
      reasons: [...reasons, ...tension.reasons],
    };
  }

  if (supporting.length === 0) {
    // A measurement, not a shrug: the engine looked at every capacity and
    // found this activity demonstrates none of them. That is the easy-run
    // case and doctrine's own lesson about restraint.
    const load = ev.trainingLoad;
    return {
      role: 'CONTEXT_ONLY',
      domains: [],
      runnerSummary: load.stimulus === 'none'
        ? 'This run does not change what the coach believes about your fitness.'
        : `${load.primaryValue} It does not change what the coach believes about your fitness.`,
      beliefChanged: false,
      planAuthorityEligible: false,
      reasons: reasons.length > 0 ? reasons : ['NO_CAPACITY_DEMONSTRATED'],
    };
  }

  if (ev.anchorMoveCandidate) {
    return {
      role: 'NEW_ANCHOR_CANDIDATE',
      domains: supporting,
      runnerSummary: `This is strong enough on its own to move your ${words}.`,
      beliefChanged: false,
      planAuthorityEligible: true,
      reasons,
    };
  }

  /* "SUPPORTS YOUR CURRENT X" IS A CLAIM ABOUT A COMPARISON.
   *
   * It may only be said when the comparison ran. When the classifier was handed
   * no belief, what is true is narrower and this says the narrower thing: the
   * run demonstrated the capacity. Whether it agrees with the current number is
   * a question nothing answered, so nothing asserts it (Rule 16). */
  if (beliefUnread) {
    return {
      role: 'CORROBORATES',
      domains: supporting,
      runnerSummary: `This run says something about your ${words}. It has not been checked against your current number yet.`,
      beliefChanged: false,
      planAuthorityEligible: false,
      reasons,
    };
  }
  return {
    role: 'CORROBORATES',
    domains: supporting,
    runnerSummary: `This supports your current ${words}. One session is not enough to move ${supporting.length > 1 ? 'them' : 'it'}.`,
    beliefChanged: false,
    planAuthorityEligible: false,
    reasons,
  };
}

/* ══════════════════════════════ 6 · plan ════════════════════════════════ */

/**
 * WHY THE PLAN MOVED, in the runner's own words — when it is honest to say.
 *
 * The defect this closes, from the real 2026-08-16 Americas Finest City
 * half: the evidence sentence said "This supports your current threshold
 * range. One session is not enough to move it" — CORROBORATES,
 * `beliefChanged: false` — directly beside "The plan moved after this run."
 * A runner reads those two sentences as contradicting each other, because
 * nothing said WHY the plan moved if not because of what this run's own
 * evidence just declined to move.
 *
 * The two are not actually in tension — they are two DIFFERENT MECHANISMS
 * answering two different questions, and the real row proves it:
 * `coach_intents` on that date carries `reason: 'vdot_auto_recalc'`, `field:
 * 'vdot'` — a race-result VDOT recalculation off the Daniels equivalency
 * tables, which is a different, more direct computation than the Evidence
 * Engine's per-activity capacity classification (`readEvidence`, above) that
 * produced the "one session is not enough" sentence. The plan moved; the
 * THRESHOLD belief specifically did not; both are true at once, and the
 * runner is owed the sentence that says so rather than left to read a
 * contradiction into two true facts.
 *
 * ONLY THE REASON CODE ALREADY ON `coach_intents.reason` IS READ. Nothing
 * here re-derives whether an adaptation was "really" evidence-driven — that
 * is the Adaptation Engine's own classification, cited verbatim by its own
 * name. An unrecognised reason produces no clause at all (Rule 11: silence
 * over a guess), so this can only ever ADD an honest sentence, never
 * fabricate one for a reason it does not recognise.
 */
// Each string here completes the sentence "The plan changed because ___." —
// a clause, not a prepositional phrase, so `vdot_auto_recalc`'s own full
// clause ("your race result recalculated...") and the others ("of scheduling
// reasons") can share one template without one of them reading as a sentence
// fragment stapled onto another (RACEWORD-1's sibling defect, 2026-09-03: the
// first draft read "The plan changed your race result recalculated your
// fitness baseline directly," which does not parse).
function describeAdaptationCause(reason: string): string | null {
  if (reason === 'vdot_auto_recalc') {
    return 'your race result recalculated your fitness baseline directly';
  }
  if (reason === 'plan_adapt_reschedule' || reason === 'plan_adapt_gap'
    || reason === 'plan_adapt_drop_missed' || reason === 'plan_adapt_missed_noted') {
    return 'of scheduling reasons';
  }
  if (reason === 'plan_adapt_downgrade' || reason === 'plan_adapt_long_floor') {
    return 'training load needed managing';
  }
  if (reason === 'plan_adapt_overridden') {
    return 'you asked for a change';
  }
  return null;
}

export function readPlan(input: PostRunInput, evidence: PostRunEvidenceImpact): PostRunPlanImpact {
  if (!input.hasActivePlan) {
    return { status: 'NO_PLAN', runnerSummary: 'There is no plan for this to change.', changes: [], sealedHistoryChanged: false };
  }
  if (input.adaptations == null) {
    // Rule 11 again: the look failed. Saying "unchanged" would be a claim we
    // did not earn.
    return { status: 'UNKNOWN', runnerSummary: 'Whether the plan moved on this run has not been read yet.', changes: [], sealedHistoryChanged: false };
  }
  if (input.adaptations.length > 0) {
    // THE CLARIFYING CLAUSE, ONLY WHEN THE TWO SENTENCES COULD OTHERWISE
    // READ AS CONTRADICTING EACH OTHER. `evidence.beliefChanged` is false in
    // every branch this engine currently returns (see `readEvidence`
    // above), so gating on it alone would append the clause to every single
    // run with an adaptation — most of which have nothing to reconcile,
    // because the evidence sentence above did not make a claim the plan
    // sentence could contradict (CONTEXT_ONLY, an unread belief, a genuine
    // CHALLENGES). The clause is worth adding specifically when the evidence
    // role told the runner "this did not move something" in so many words —
    // CORROBORATES is the one role that does, which is exactly the role the
    // real defect fired under.
    const causes = input.adaptations
      .map((a) => describeAdaptationCause(a.reason))
      .filter((c): c is string => c != null);
    const clause = evidence.role === 'CORROBORATES' && causes.length > 0
      ? ` The plan changed because ${causes[0]}. That is not the same as this run's own evidence moving the estimate above.`
      : '';
    return {
      status: 'UPDATED',
      runnerSummary: `The plan moved after this run.${clause}`,
      changes: input.adaptations.map((a) => a.display),
      sealedHistoryChanged: false,
    };
  }
  if (evidence.role === 'UNREAD') {
    return { status: 'UNKNOWN', runnerSummary: 'Whether the plan moved on this run has not been read yet.', changes: [], sealedHistoryChanged: false };
  }
  if (evidence.planAuthorityEligible) {
    // The engine says this run COULD move an anchor and nothing has yet. That
    // is a hold awaiting the adaptation pass, not a decision that nothing
    // changes — and Rule 23 is the reason the distinction is real: the pass is
    // scheduled, and a schedule is not a guarantee.
    return {
      status: 'HELD_FOR_EVIDENCE',
      runnerSummary: 'The plan is unchanged for now. This run is strong enough to act on, so the next review will look at it.',
      changes: [],
      sealedHistoryChanged: false,
    };
  }
  return { status: 'UNCHANGED', runnerSummary: 'The plan is unchanged.', changes: [], sealedHistoryChanged: false };
}

/* ══════════════════════════════ 7 · next ════════════════════════════════ */

/**
 * What to do next — and usually NOTHING, because Today already prescribes
 * tomorrow and saying it twice is Rule 17.
 *
 * A sentence appears only when this run produced a reason the plan does not
 * already carry.
 */
export function readNext(execution: PostRunExecution, cost: PostRunCost): PostRunNextAction {
  if (cost.status === 'HIGHER_UNEXPLAINED') {
    return { summary: 'Heart rate ran above the ceiling with no explanation in the conditions. Keep the next easy day genuinely easy.' };
  }
  if (execution.status === 'INCOMPLETE') {
    return { summary: 'Take the next day as written and see how the legs answer.' };
  }
  return { summary: null };
}

/* ══════════════════════════════ 8 · the briefing ════════════════════════ */

function certaintyFor(execution: PostRunExecution, evidence: PostRunEvidenceImpact): Certainty {
  if (evidence.role === 'UNREAD') return 'UNKNOWN';
  if (execution.status === 'INDETERMINATE' || execution.status === 'SENSOR_LIMITED') return 'UNKNOWN';
  if (execution.confidence === 'HIGH') return 'SUPPORTED';
  return 'TENTATIVE';
}

/**
 * The Layer-1 card, as Stage 3's typed explanation.
 *
 * `verdict` is the execution headline plus its sentence; `reason` is the cost
 * when there is one to state; `consequence` is the plan's own word. Nothing is
 * re-worded and nothing is said twice — `layerOne` renders at most two of the
 * three, which is the ceiling that contract already set.
 */
export function buildBriefing(
  input: PostRunInput,
  execution: PostRunExecution,
  cost: PostRunCost,
  evidence: PostRunEvidenceImpact,
  plan: PostRunPlanImpact,
  next: PostRunNextAction,
  decisionVersion: string,
): CoachingExplanation {
  const facts: ExplanationFact[] = [];
  /* RULE 17 · THE HEART RATE IS STATED ONCE.
   *
   * When `cost.summary` exists it already reads "Work heart rate averaged 162
   * against a 164 ceiling", and adding the two numbers back as separate facts
   * made `layerTwo` print the same measurement three times — which is exactly
   * the "average heart rate printed three times on Today" finding this brief
   * opens with, reproduced inside the fix for it. The facts exist for the case
   * where there is a READING and no VERDICT: then they are the only place the
   * number appears. */
  if (cost.summary == null) {
    if (cost.hrBpm != null) {
      facts.push({
        kind: 'OBSERVED',
        code: cost.hrScope === 'work' ? 'work_hr' : 'run_hr',
        display: cost.hrScope === 'work'
          ? `Work heart rate ${cost.hrBpm} bpm.`
          : `Average heart rate ${cost.hrBpm} bpm.`,
      });
    }
    if (cost.ceilingBpm != null) {
      facts.push({ kind: 'STATED', code: 'hr_ceiling', display: `The session asked for a ${cost.ceilingBpm} bpm ceiling.` });
    }
  }
  if (cost.rpe != null) {
    facts.push({ kind: 'STATED', code: 'rpe', display: `You logged the effort at ${cost.rpe} out of 10.` });
  }
  const refusal = evidence.role === 'UNREAD' || execution.status === 'INDETERMINATE' || execution.status === 'SENSOR_LIMITED';

  const whyNot: Array<{ code: string; display: string }> = [];
  if (cost.status === 'UNKNOWN') {
    whyNot.push({
      code: 'cost_not_stated',
      display: cost.hrBpm == null
        ? 'No work heart rate was recorded, so nothing is said about what the session cost.'
        : 'The session set no heart-rate ceiling, so the reading is reported without a verdict.',
    });
  }
  if (evidence.role === 'EXCLUDED') {
    // Same substitution, same reason — see `readEvidence`'s EXCLUDED arm.
    whyNot.push({ code: 'evidence_excluded', display: 'The recording is not clear enough for this run to inform fitness.' });
  }

  return {
    id: `postrun:${input.runId}`,
    modelVersion: EXPLANATION_MODEL_VERSION,
    decisionVersion,
    surfaceEvent: 'TODAY_AFTER',
    intent: refusal ? 'REFUSE' : 'INTERPRET',
    verdict: execution.summary,
    reason: cost.summary ?? undefined,
    consequence: plan.runnerSummary,
    certainty: certaintyFor(execution, evidence),
    facts,
    // An EMPTY list is a real answer — nothing was withheld — and the
    // contract's optional field is satisfied by it. Collapsing empty to
    // `undefined` would make "nothing withheld" and "we never checked"
    // the same value on the wire (Rule 11).
    whyNot,
    accessibilitySummary: `${execution.headline}. ${execution.summary}`,
    detail: {
      headline: execution.headline,
      /* THE "WHY" BODY CARRIES WHAT LAYER 1 DID NOT.
       *
       * `verdict`, `reason` and `consequence` are already the card. Repeating
       * them here is the same sentence twice on one screen, and `layerTwo`
       * renders them alongside these paragraphs. What belongs here is the
       * thing the card has no room for: what the run taught the coach, and any
       * next action the plan does not already say. */
      paragraphs: [evidence.runnerSummary].concat(next.summary ? [next.summary] : []),
      evidenceLabels: evidence.domains.map((d) => DOMAIN_WORD[d]),
    },
  };
}

/* ══════════════════════════════ 9 · the entry point ═════════════════════ */

/**
 * THE composer. One call, one object, and every post-run surface reads it.
 *
 * `decisionVersion` is assembled from the identities of the decisions this
 * object explains, exactly as Stage 3's Today explanation does — so two
 * surfaces rendering the same run can PROVE they render the same decision
 * rather than assert it.
 */
export function composePostRunExperience(input: PostRunInput): PostRunExperienceV1 {
  const strides = readStrides(input);
  const capture = readCapture(input);
  const execution = readExecution(input, strides);
  const cost = readCost(input);
  const evidence = readEvidence(input);
  const plan = readPlan(input, evidence);
  const next = readNext(execution, cost);
  const decisionVersion = [
    `run:${input.runId}`,
    `plan:${input.activePlanId ?? 'no-plan'}`,
    `grade:${input.verdict.sessionClass}/${input.verdict.session.verdict}`,
    `evidence:${input.evidence?.modelVersion ?? 'unread'}`,
  ].join('|');
  const briefing = buildBriefing(input, execution, cost, evidence, plan, next, decisionVersion);
  return {
    version: POST_RUN_MODEL_VERSION,
    runId: input.runId,
    dateISO: input.dateISO,
    decisionVersion,
    execution,
    cost,
    evidence,
    plan,
    next,
    capture,
    strides,
    briefing,
  };
}
