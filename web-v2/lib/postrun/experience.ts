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

function workPhases(v: WorkoutVerdict): GradedPhase[] {
  return v.phases.filter((p) => p.type === 'work');
}

/**
 * The session-level runner-facing execution read.
 *
 * The STATUS comes off `verdict.session`, which is the canonical grade, plus
 * two facts the grade does not carry: whether the payload was gradable at all
 * and whether the sensors were good enough to grade it. It never re-grades a
 * phase and never compares a pace.
 */
export function readExecution(input: PostRunInput): PostRunExecution {
  const v = input.verdict;
  const s = v.session;
  const work = workPhases(v);
  const reasons: string[] = [];
  const stimulus = stimulusFor(input);

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
        : 'This run carries no session structure, so there is nothing to grade it against.',
      intendedStimulus: stimulus,
      stimulusDelivered: 'UNKNOWN',
      confidence: 'LOW',
      reasons,
    };
  }

  if (s.verdict === 'not_graded') {
    reasons.push('NO_PACE_TARGET_ON_THE_WORK');
    return {
      status: 'INDETERMINATE',
      headline: 'Work done, no target to read it against',
      summary: 'The work phases carried no prescribed pace, so this is a record of what was run rather than a grade.',
      intendedStimulus: stimulus,
      stimulusDelivered: 'UNKNOWN',
      confidence: 'LOW',
      reasons,
    };
  }

  // The runner's word for the work, chosen off the SHAPE of the session
  // rather than a template: four one-mile pieces are reps, one continuous
  // block is not, and calling a tempo "rep 1 of 1" is how a screen stops
  // sounding like a coach.
  const single = work.length === 1;
  const noun = single ? 'block' : 'reps';
  const reps = single ? 'the work block' : `all ${numberWord(work.length)} ${noun}`;

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
      summary: `${cap1(numberWord(s.hits + s.fasts))} of ${numberWord(work.length)} ${noun} ${s.hits + s.fasts === 1 ? 'was' : 'were'} finished before the session stopped.`,
      intendedStimulus: stimulus,
      stimulusDelivered: 'PARTIAL',
      confidence: 'MODERATE',
      reasons,
    };
  }

  if (s.verdict === 'off_target') {
    reasons.push('MOST_WORK_PIECES_FELL_SHORT');
    return {
      status: 'SLOW',
      headline: 'Work landed outside the window',
      summary: single
        ? `The work block ${outsideBound}.`
        : `Most of the ${noun} ${outsideBound}.`,
      intendedStimulus: stimulus,
      stimulusDelivered: 'PARTIAL',
      confidence: 'MODERATE',
      reasons,
    };
  }

  if (s.verdict === 'uneven') {
    reasons.push('WORK_PIECES_DISAGREE');
    return {
      status: 'PARTIAL_PRODUCTIVE',
      headline: 'Mixed set',
      summary: `Some of the ${noun} ${insideBound} and some did not.`,
      intendedStimulus: stimulus,
      stimulusDelivered: 'PARTIAL',
      confidence: 'MODERATE',
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
      summary: single
        ? `The work block ${aheadOfBound}.`
        : `${cap1(reps)} ${aheadOfBound}.`,
      intendedStimulus: stimulus,
      stimulusDelivered: 'FULL',
      confidence: 'HIGH',
      reasons,
    };
  }
  reasons.push('EVERY_WORK_PIECE_LANDED');
  if (s.recoveriesHonest) reasons.push('RECOVERIES_TAKEN_AS_PRESCRIBED');
  if (!s.lateCollapse) reasons.push('NO_LATE_COLLAPSE');
  // CONTROLLED is the word for landed-and-held-together; EXECUTED for landed
  // where the shape of the set is not something this grade can speak to.
  const controlled = s.recoveriesHonest === true && !s.lateCollapse;
  return {
    status: controlled ? 'CONTROLLED' : 'EXECUTED',
    headline: controlled ? 'Controlled work' : 'Work executed',
    summary: s.fasts > 0
      ? `${cap1(reps)} landed, with ${numberWord(s.fasts)} quicker than the ${bound}.`
      : `${cap1(reps)} ${insideBound}.`,
    intendedStimulus: stimulus,
    stimulusDelivered: 'FULL',
    confidence: 'HIGH',
    reasons,
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
      runnerSummary: 'This run is kept in your log but is not used to judge fitness, because the recording is not good enough to read.',
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
    return {
      status: 'UPDATED',
      runnerSummary: 'The plan moved after this run.',
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
    whyNot.push({ code: 'evidence_excluded', display: 'The recording is not good enough for this run to inform fitness.' });
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
  const execution = readExecution(input);
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
    briefing,
  };
}
