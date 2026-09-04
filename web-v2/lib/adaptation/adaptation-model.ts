/**
 * The adaptation model · "how well is this athlete absorbing the training?"
 *
 * System B of the three-model split in `Design/adaptive-progression-engine.md`.
 * This is the system that decides whether the athlete has EARNED more training
 * stress. It is explicitly allowed to move faster than the fitness model,
 * because absorbing training and demonstrating race fitness are different
 * claims on different timescales.
 *
 * ## Why this file exists
 *
 * Every signal below was already computed somewhere in this codebase before
 * this module was written. Sixteen of them. What was missing was anything that
 * aggregated them into a verdict — so they drained into `projectedVdot` via
 * `executionQualityFromTestPoints`, where missing workouts made the PREDICTED
 * RACE TIME worse instead of making the NEXT WORKOUT easier. That is backwards.
 * Poor absorption is a prescription problem, not a forecasting problem.
 *
 * This module is the correct consumer. It is pure: callers assemble an
 * `AdaptationInput` from the existing readers and get a verdict back. No I/O,
 * no database, no clock.
 *
 * ## Three rules that shape the whole design
 *
 * 1 · **Absence of evidence is not evidence of poor adaptation.** A runner with
 *     no HR strap, or three weeks into a new account, must not be held back
 *     because we cannot see them. Unknown dimensions are excluded from the
 *     mean, never scored as zero. Too little evidence returns `normal` with low
 *     confidence — proceed as planned — not `marginal`.
 *
 * 2 · **Readiness is not an input at any timescale** (2026-09-02). This used
 *     to admit a sustained multi-week readiness deviation as the weakest
 *     dimension, on the reasoning that the boundary was timescale rather than
 *     kind. The owner has since ruled that he decides how ready he is, so the
 *     boundary is kind: no HRV, RHR, sleep or readiness-snapshot signal reaches
 *     this verdict, at any window length. `recoveryPctOfExpected` stays,
 *     because bouncing back between hard sessions is measured from what the
 *     runner RAN, not from how a morning read.
 *
 * 3 · **`strong` requires repeated evidence.** A single good session cannot
 *     unlock acceleration. The doctrine names this explicitly: "single good
 *     day, or repeated positive evidence?" The `trend` dimension is a gate on
 *     the top band, not just another term in the average.
 *
 * There are no vetoes. Pain, injury and illness used to force PROTECT here;
 * they were the app deciding the runner was not up to his training off a
 * symptom he had logged, and they are gone with the detectors that fed them
 * (2026-09-02). Every structural limit this verdict feeds — the ramp caps, the
 * spike guard, the dosing caps, the one-primary-stressor rule — reads absorbed
 * training load and is untouched.
 *
 * ## The execution dimension reads STATES, not a headcount
 *
 * It used to score completion as the share of key sessions with a run on the
 * date. That predicate cannot tell `EQUIVALENT` from `MISSED`: a runner who
 * swapped 5 × 1 mile for 3 × 2 because the track was closed, and a runner who
 * skipped the session and jogged two miles, both scored 1.0.
 *
 * `Design/execution-memory-firing.md` rule 4 draws the distinction the old gate
 * collapsed — **partial work earns training credit without earning progression
 * credit** — and it needs two currencies, not one band cap:
 *
 *   · TRAINING credit    · how much of the intended stimulus was delivered.
 *                          60% completed is not zero.
 *   · PROGRESSION credit · whether a session demonstrated room for MORE. Only
 *                          a fully delivered stimulus does.
 *
 * The two enter the model differently. Training credit is the dimension's
 * completion term — a stimulus-weighted share in the slot the headcount used
 * to occupy. Progression credit is a GATE on `strong`, the band that licenses
 * asking for more, sitting beside the trend gate rather than in the average.
 *
 * A block of honest partial sessions therefore lands where it belongs: not
 * penalised as misses, and not read as room to accelerate.
 */

import type { ExecutionState } from '@/lib/execution/interpret';

/** The five dimensions the doctrine's progression gate names. */
export type AdaptationDimension =
  | 'execution'
  | 'internal_cost'
  | 'recovery'
  | 'consistency'
  | 'trend';

export type AdaptationBand = 'strong' | 'normal' | 'marginal' | 'poor';

/** The control-loop decision. `Design/adaptive-progression-engine.md` §control loop. */
export type CycleDecision = 'STAY' | 'PROGRESS' | 'MODIFY' | 'PROTECT';

/**
 * Why the model returned what it did, in a form a coach line can be built from
 * and a human can falsify.
 */
export interface DimensionRead {
  dimension: AdaptationDimension;
  /** −2 (poor) … +2 (strong). Null when we cannot see this dimension. */
  score: number | null;
  /** How much this dimension counted toward the verdict. 0 when unknown. */
  weight: number;
  /** One plain line stating what was observed. Empty when unknown. */
  detail: string;
}

export interface AdaptationVerdict {
  band: AdaptationBand;
  /** How much to trust the band. Driven by how many dimensions were readable
   *  and how much evidence sat behind them. */
  confidence: 'high' | 'medium' | 'low';
  decision: CycleDecision;
  /**
   * What the prescription model should do with the planned overload step.
   * 1.0 = take the planned step. 0 = hold. Negative = back off.
   * `strong` exceeds 1.0 only when the trend gate has also passed.
   */
  stepMultiplier: number;
  dimensions: DimensionRead[];
  /** One line in the coach register. Never a scold, never a cheer. */
  summary: string;
  /**
   * Rule 11 · whether the verdict above is a READ or a REFUSAL.
   *
   * `false` exactly when fewer than `MIN_DIMENSIONS_FOR_VERDICT` dimensions were
   * readable: the classifier then returns `normal` / `PROGRESS` / step 1 so the
   * CALENDAR's own planned step proceeds ("proceed as planned", rule 1 in the
   * header). That is the right answer for the progression pass, which is
   * deciding whether to take a step the plan already authored. It is the WRONG
   * answer for anything that wants to add load BEYOND the plan — the Adaptation
   * Engine's VOLUME and DURATION levers read `decision === 'PROGRESS'` as "the
   * absorption model permits more", and until this field existed a runner the
   * model could not see at all cleared that gate. "We could not judge" and "we
   * judged, and it permits" are opposite facts; this field keeps them apart.
   *
   * OPTIONAL in the type for one reason only: every producer is
   * `classifyAdaptation` (which always sets it), while a dozen hand-built
   * fixtures across `lib/plan`, `lib/prescription` and `lib/doctrine` construct
   * verdicts by literal and predate the field. An absent value therefore means
   * "a fixture that did not say", never "insufficient" — the engine's gate
   * treats only an explicit `false` as a refusal, so no consumer becomes
   * quietly stricter on a legacy literal. `_adaptation_model.test.ts` pins that
   * the classifier sets it on every branch.
   */
  evidenceSufficient?: boolean;
}

/* ------------------------------------------------------------------ inputs */

/**
 * Everything the model reads, normalised. Every field is nullable: the caller
 * supplies what the runner's data actually supports and the model degrades
 * honestly. Field-by-field provenance is in the doc comments so a future
 * caller wires the right reader rather than inventing a lookalike.
 */
/**
 * One key session, as `interpretExecution` read it. The unit the execution
 * dimension scores.
 */
export interface KeySessionRead {
  /** Doctrine's seven states. */
  state: ExecutionState;
  /** 0..1 · how much of the intended stimulus was delivered. */
  stimulusCompletion: number;
  /** `earnsProgressionCredit(read)` — whether this session demonstrated room
   *  for more, which is a different question from whether it was useful. */
  earnsProgression: boolean;
  /** From `ExecutionRead.telemetryCompromised` (RULE8CLOSE-1). A real
   *  session an app-side capture failure left partly unreadable — never a
   *  runner shortfall. Excluded from the training-credit average below,
   *  exactly like `MISSED`: real evidence that cannot be graded is not the
   *  same fact as no evidence, and it is narrated separately, but neither one
   *  is scored as a demonstrated failure. */
  telemetryCompromised?: boolean;
}

export interface AdaptationInput {
  /* --- execution ------------------------------------------------------- */
  /**
   * Every key session in the window, interpreted. From
   * `loadKeySessionExecutions` (`lib/execution/load.ts`), which reconstructs
   * the planned and actual stimulus and calls `interpretExecution`.
   *
   * Sessions whose work could not be described are dropped by the loader
   * rather than passed as a state — an unreadable session is missing evidence,
   * never a failed one. Pass null when none was readable; the dimension then
   * scores on target adherence alone rather than inventing a completion.
   */
  keySessionExecutions: KeySessionRead[] | null;
  /**
   * Key sessions prescribed in the window, and how many were run at all.
   *
   * NARRATION ONLY — this pair no longer scores anything. It is the sentence
   * the runner recognises ("9 of 11 key sessions run"), kept beside the states
   * that actually drive the verdict. Scoring off it is the bug this dimension
   * was rewritten to remove: "a run exists on that date" is true of an
   * equivalent session, a session cut in half, and a two-mile jog alike.
   */
  keySessionsPlanned: number | null;
  keySessionsCompleted: number | null;
  /** Per-session target verdicts, newest last. From
   *  `judgeTestPointExecution` (`lib/training/goal-projection.ts`) —
   *  already heat-adjusted, already basis-laddered. Null verdicts (the
   *  honest-abstain case) should be filtered out by the caller, not passed. */
  targetVerdicts: Array<'on' | 'fast' | 'slow'> | null;
  /** Rep-level shape on the most recent interval sessions. From
   *  `intervalPacing()` (`lib/coach/run-recap.ts`). */
  repConsistency: Array<'even' | 'fading' | 'negative'> | null;

  /* --- internal cost --------------------------------------------------- */
  /** Sessions where the runner reported RPE, and how many read as harder than
   *  the session should have been. From the acknowledge/check-in path
   *  (`lib/coach/acknowledge.ts`). */
  rpeReported: number | null;
  rpeHarderThanExpected: number | null;
  /** Aerobic decoupling verdicts over the window, newest last. From
   *  `computeAerobicDecoupling` (`lib/training/aerobic-decoupling.ts`). */
  decouplingVerdicts: Array<'race-ready' | 'building' | 'poor'> | null;
  /** Late-run HR drift in bpm on long runs, newest last. From
   *  `computeHrThirds` (`lib/coach/hr-thirds.ts`). Only measured thirds —
   *  the caller must drop `source: 'estimated'` rows. */
  lateDriftBpm: number[] | null;
  /** Whether easy-day discipline has an ESTABLISHED finding, and on what read.
   *  From `detectEasyDiscipline` (`lib/coach/easy-discipline.ts`).
   *  `in_band_but_high_hr` is NOT a discipline failure — it points at the pace
   *  band, not the runner — so it does not cost the runner here. */
  easyDiscipline: { established: boolean; read: 'ran_faster_than_band' | 'in_band_but_high_hr' | 'pace_only' | null } | null;

  /* --- recovery -------------------------------------------------------- */
  /** How the runner is tracking against their own expected bounce-back after
   *  hard sessions. From `computeRecoveryPhase` (`lib/coach/recovery-phase.ts`).
   *  Pass null when `dataInsufficient` — do not pass a defaulted zero. */
  recoveryPctOfExpected: number | null;

  /* --- consistency ----------------------------------------------------- */
  /** Planned vs actual weekly mileage over recent complete weeks, newest last. */
  weeklyPlannedMi: number[] | null;
  weeklyActualMi: number[] | null;
  /** Training-form band. From `computeTrainingForm` (`lib/coach/training-form.ts`). */
  trainingForm: 'DETRAINING' | 'RACE-READY' | 'PRODUCTIVE' | 'LOADED' | 'OVERREACH' | 'BUILDING' | null;

  /* --- trend ----------------------------------------------------------- */
  /** Distinct weeks that contributed any judged evidence. The gate that stops
   *  one good Tuesday reading as `strong`. */
  distinctEvidenceWeeks: number | null;
  /** Times the plan adapter downgraded a session in the window. Sustained
   *  downgrades mean the runner is not absorbing the plan as designed —
   *  `lib/training/goal-projection.ts:1551` already names this correctly and
   *  routes it to the wrong consumer. This is the right consumer. */
  adapterDowngrades: number | null;

  /* --- narration context (optional) ------------------------------------ */
  /**
   * Set when TODAY itself falls inside a doctrine-prescribed taper, race-day,
   * or post-race recovery window (`activePrescribedWindow` against
   * `loadPrescribedWindows`, `lib/training/normal-window.ts`).
   *
   * NARRATION ONLY — the mirror, for what the classifier SAYS, of Rule 8's
   * corollary for what it SCORES. It changes nothing about the band, the
   * decision or any dimension's score; the literal execution/internal-cost/
   * recovery/consistency/trend reads are exactly as absorbed either way. What
   * it changes is which sentence `summarise()` reaches for on a HOLD-shaped
   * band: a runner three days post-race is better told "you just raced" than
   * handed a reconstructed narrative built from sessions weeks distant that
   * a widened, filtered lookback had to reach past THIS SAME window to find
   * (`docs/reports/adaptation-reason-honesty-fix-2026-09-01.md`). The more
   * proximate, more honestly-recognisable fact about this week wins.
   *
   * Optional, and left `undefined` by every existing caller/fixture: only a
   * caller that has already resolved the runner's prescribed windows for
   * today can honestly populate it. Today that is
   * `loadRepresentativeExecutionInput` alone — the reader whose lookback
   * widening is what creates the reaching-back risk in the first place.
   * `loadAdaptationInput` (the live, unpromoted reader) reads a fixed 42-day
   * window with no extension, so it never needed to reach past a recovery
   * block to find evidence, and leaving it `undefined` there is correct, not
   * an oversight.
   */
  recentPrescribedWindow?: {
    kind: 'taper' | 'post_race_recovery';
    raceSlug: string;
    /** Negative while tapering, 0 on race day, positive during recovery. */
    daysSinceRace: number;
  } | null;
}

/* -------------------------------------------------------------- constants */

/**
 * Dimension weights. Execution and internal cost carry the most because they
 * are the most direct read on whether the last block of training landed.
 * Recovery is deliberately light. It now reads only the runner's measured
 * bounce-back between hard sessions, and it should colour a verdict rather
 * than drive one.
 */
export const DIMENSION_WEIGHTS: Record<AdaptationDimension, number> = {
  execution: 0.30,
  internal_cost: 0.25,
  consistency: 0.20,
  trend: 0.15,
  recovery: 0.10,
};

/** Band edges on the weighted mean of known dimensions, −2 … +2. */
export const BAND_EDGES = {
  /** ≥ this and the trend gate passed → strong. */
  strong: 0.75,
  /** ≥ this → normal. */
  normal: -0.25,
  /** ≥ this → marginal. Below it → poor. */
  marginal: -1.1,
} as const;

/** Fewer readable dimensions than this and the model refuses to judge. */
export const MIN_DIMENSIONS_FOR_VERDICT = 2;

/** Week-to-week spread (SD of the planned-vs-actual ratio) above which the
 *  block is described as interrupted rather than steady. */
export const CONSISTENCY_SPREAD_NOTE = 0.2;

/** `strong` requires evidence spread over at least this many distinct weeks. */
export const MIN_WEEKS_FOR_STRONG = 3;

/**
 * Execution is a gate, not merely a term in the mean.
 *
 * A runner can miss half their key sessions and still show pristine heart
 * rate, recovery and decoupling — because the stimulus that would have taxed
 * those systems was never delivered. Averaging reads that as "absorbing well"
 * and licenses more stress, which is exactly backwards: you cannot earn more
 * training by not doing the training. Below these edges the band is capped
 * regardless of how good everything else looks.
 *
 * This mirrors the trend gate on `strong`. Both encode the same idea — some
 * dimensions carry a veto over the top bands rather than a vote in the average.
 */
export const EXECUTION_GATE = {
  /** At or below this, the band cannot exceed `marginal`. */
  capMarginal: -0.5,
  /** At or below this, the band cannot exceed `poor`. */
  capPoor: -1.5,
} as const;

/**
 * The second currency, and the half the old single band cap could not express.
 *
 * Doctrine rule 4: partial work can be useful without earning progression.
 * Training credit keeps an honest partial block out of `marginal` — the work
 * happened and it counted. It must not also unlock `strong`, because `strong`
 * means "there is room to ask for more" and a session that was cut short
 * demonstrated the opposite.
 *
 * So the top band takes a share gate of its own, exactly like the trend gate
 * beside it: fewer than this share of key sessions delivering a FULL stimulus
 * and the block cannot read as strong, however good everything else looks.
 *
 * The value is the same edge `shareToScore` puts the dimension scale's zero at
 * (0.6). Below six in ten sessions fully delivered, the honest description is
 * "you are absorbing this", not "there is room for more".
 */
export const PROGRESSION_GATE = {
  strongMinShare: 0.6,
} as const;

/* --------------------------------------------------------------- helpers */

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Maps a 0..1 "share that went well" onto the −2..+2 dimension scale. */
function shareToScore(share: number): number {
  return clamp((share - 0.6) * 5, -2, 2);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/* ------------------------------------------------------------- dimensions */

/**
 * The key sessions that count toward compliance.
 *
 * `EXTRA` is dropped, and that is doctrine rather than tidiness: extra work is
 * DATA, not achievement, and "more work is not evidence that more work was
 * appropriate". Letting an unplanned run raise the compliance share would make
 * a runner who ignored the plan and ran extra read as absorbing it well.
 */
function compliantSessions(reads: KeySessionRead[]): KeySessionRead[] {
  return reads.filter((r) => r.state !== 'EXTRA');
}

/**
 * Share of key sessions that delivered a full stimulus.
 *
 * Exported because the band gate in `classifyAdaptation` needs it and the
 * dimension read cannot carry it — `DimensionRead` is a fixed shape, and
 * widening it for one consumer would put a second definition of this number in
 * the codebase. Null when there is nothing to read.
 */
export function progressionCreditShare(input: AdaptationInput): number | null {
  const reads = input.keySessionExecutions ? compliantSessions(input.keySessionExecutions) : [];
  if (reads.length === 0) return null;
  return reads.filter((r) => r.earnsProgression).length / reads.length;
}

function readExecution(input: AdaptationInput): DimensionRead {
  const parts: number[] = [];
  const notes: string[] = [];

  /* TRAINING credit · how much of the intended stimulus landed, summed over
   * the sessions rather than counted. A session cut to 60% contributes 0.6 —
   * not the 1.0 the old headcount gave it for having a run on the date, and
   * not the 0 a strict completion test would.
   *
   * Exactly ONE part, in the same slot the headcount occupied. That matters:
   * this list is averaged flat, so adding a second completion term would
   * silently halve the weight of the target-adherence and rep-shape signals
   * beside it and lift the whole dimension off the `EXECUTION_GATE` edges the
   * caps are calibrated against. It did, on the first cut of this change: a
   * runner who missed three of eight sessions and ran the rest slow with
   * fading reps came out `strong`.
   *
   * The other currency — progression credit — is a GATE on the top band rather
   * than a term in the mean, for the same reason the trend gate is. See
   * `PROGRESSION_GATE`.
   *
   * `MISSED` is excluded from the average itself (2026-09-04, RULE8CLOSE-1):
   * a session with no run at all carries `stimulusCompletion: 0` at the type
   * level (`lib/execution/interpret.ts`), which is a real fact about training
   * load delivered, but averaging it flat into this dimension made "no
   * evidence" indistinguishable from "attempted and got 0% of the intended
   * work" — the two are opposite facts (Rule 11) and this dimension's own
   * header states the rule that closes the gap: "absence of evidence is not
   * evidence of poor adaptation... unknown dimensions are excluded from the
   * mean, never scored as zero." That principle applied to whole dimensions
   * (no HR strap, three weeks old) but not to individual missed sessions
   * inside a dimension that had other data — a real hill session run at 4.71
   * of 6mi could still be dragged toward `marginal`/`poor` by a SEPARATE
   * day's absence, through the exact `EXECUTION_GATE` cap below, which reads
   * as "the runner's capacity looks worse" for a day that produced no
   * evidence at all. `REPLACED` (raced instead) and `PARTIAL_FAILED` (a real,
   * poorly-executed attempt) both stay in the average — both are real
   * evidence, unlike an absence. */
  const reads = input.keySessionExecutions ? compliantSessions(input.keySessionExecutions) : [];
  const attempted = reads.filter((r) => r.state !== 'MISSED' && !r.telemetryCompromised);
  if (attempted.length > 0) {
    const training = attempted.reduce((a, r) => a + clamp(r.stimulusCompletion, 0, 1), 0) / attempted.length;
    parts.push(shareToScore(training));
  }
  if (reads.length > 0) {
    const full = reads.filter((r) => r.earnsProgression).length;
    const missed = reads.filter((r) => r.state === 'MISSED').length;
    const compromised = reads.filter((r) => r.telemetryCompromised && r.state !== 'MISSED').length;
    // Named rather than swept into "partial": a race is not a session the
    // runner half-did, and reading it as one is the misdescription the states
    // exist to end.
    const replaced = reads.filter((r) => r.state === 'REPLACED').length;
    const partial = reads.length - full - missed - replaced - compromised;
    const bits = [`${full} of ${reads.length} key sessions delivered the full stimulus`];
    if (partial > 0) bits.push(`${partial} partial`);
    if (replaced > 0) bits.push(`${replaced} replaced by a race`);
    // "not run" is schedule-completion reporting, per David's ruling — named
    // here, never folded into the score above.
    if (missed > 0) bits.push(`${missed} not run`);
    // Real, but its own data cannot grade it — named separately from
    // "partial" so the two are never conflated in what the runner reads.
    if (compromised > 0) bits.push(`${compromised} telemetry-compromised`);
    notes.push(bits.join(' · '));
  } else if (
    input.keySessionsPlanned != null && input.keySessionsPlanned > 0
    && input.keySessionsCompleted != null
  ) {
    // Narration only — no score. See the field docs: counting runs on dates is
    // exactly the read this dimension was rewritten to stop trusting, and a
    // block we cannot interpret is missing evidence rather than a bad block.
    notes.push(`${input.keySessionsCompleted} of ${input.keySessionsPlanned} key sessions run`);
  }

  if (input.targetVerdicts && input.targetVerdicts.length > 0) {
    const v = input.targetVerdicts;
    // 'fast' is not a win. Running quality faster than target is its own
    // problem and the doctrine treats it as evidence about the prescription,
    // not evidence of adaptation. Only 'on' counts as hitting the session.
    const onTarget = v.filter((x) => x === 'on').length;
    const share = onTarget / v.length;
    parts.push(shareToScore(share));
    notes.push(`${onTarget} of ${v.length} quality sessions on target`);
  }

  if (input.repConsistency && input.repConsistency.length > 0) {
    const r = input.repConsistency;
    const holding = r.filter((x) => x !== 'fading').length;
    const share = holding / r.length;
    // Rep shape is the weakest execution signal — half weight via averaging in
    // as a single part is already appropriate, but fading reps are a real read
    // on whether the session was the right size.
    parts.push(shareToScore(share));
    if (r.length - holding > 0) notes.push(`reps faded in ${r.length - holding} of ${r.length}`);
  }

  if (parts.length === 0) {
    return { dimension: 'execution', score: null, weight: 0, detail: '' };
  }
  return {
    dimension: 'execution',
    score: parts.reduce((a, b) => a + b, 0) / parts.length,
    weight: DIMENSION_WEIGHTS.execution,
    detail: notes.join(' · '),
  };
}

function readInternalCost(input: AdaptationInput): DimensionRead {
  const parts: number[] = [];
  const notes: string[] = [];

  if (input.rpeReported != null && input.rpeReported > 0 && input.rpeHarderThanExpected != null) {
    const share = 1 - clamp(input.rpeHarderThanExpected / input.rpeReported, 0, 1);
    parts.push(shareToScore(share));
    if (input.rpeHarderThanExpected > 0) {
      notes.push(`${input.rpeHarderThanExpected} of ${input.rpeReported} sessions felt harder than prescribed`);
    }
  }

  if (input.decouplingVerdicts && input.decouplingVerdicts.length > 0) {
    const d = input.decouplingVerdicts;
    const good = d.filter((x) => x !== 'poor').length;
    parts.push(shareToScore(good / d.length));
    const poor = d.length - good;
    if (poor > 0) notes.push(`aerobic decoupling poor on ${poor} of ${d.length}`);
  }

  if (input.lateDriftBpm && input.lateDriftBpm.length > 0) {
    // 8 bpm is the existing warn edge in hr-thirds. Below it reads clean;
    // well above it reads as the session costing more than it should.
    const mean = input.lateDriftBpm.reduce((a, b) => a + b, 0) / input.lateDriftBpm.length;
    parts.push(clamp((8 - mean) / 4, -2, 2));
    if (mean > 8) notes.push(`late HR drift averaging ${Math.round(mean)} bpm`);
  }

  if (input.easyDiscipline?.established && input.easyDiscipline.read === 'ran_faster_than_band') {
    // Easy days run hard is a real cost signal: it is how the workouts get
    // worse. `in_band_but_high_hr` deliberately does not land here.
    parts.push(-1);
    notes.push('easy days running above the aerobic ceiling');
  }

  if (parts.length === 0) {
    return { dimension: 'internal_cost', score: null, weight: 0, detail: '' };
  }
  return {
    dimension: 'internal_cost',
    score: parts.reduce((a, b) => a + b, 0) / parts.length,
    weight: DIMENSION_WEIGHTS.internal_cost,
    detail: notes.join(' · ') || 'internal cost tracking normal',
  };
}

function readRecovery(input: AdaptationInput): DimensionRead {
  const parts: number[] = [];
  const notes: string[] = [];

  if (input.recoveryPctOfExpected != null) {
    // 1.0 = recovering exactly on the expected clock for the anchor session.
    parts.push(clamp((input.recoveryPctOfExpected - 0.85) * 6, -2, 2));
    if (input.recoveryPctOfExpected < 0.85) {
      notes.push(`bouncing back slower than usual after hard days`);
    }
  }

  // 2026-09-02 · a sustained readiness deviation used to contribute here.
  // Removed with the rest of readiness's influence on training decisions; see
  // rule 2 in the header. This dimension now reads only the runner's measured
  // bounce-back between hard sessions.

  if (parts.length === 0) {
    return { dimension: 'recovery', score: null, weight: 0, detail: '' };
  }
  return {
    dimension: 'recovery',
    score: parts.reduce((a, b) => a + b, 0) / parts.length,
    weight: DIMENSION_WEIGHTS.recovery,
    detail: notes.join(' · ') || 'recovering on schedule',
  };
}

function readConsistency(input: AdaptationInput): DimensionRead {
  const parts: number[] = [];
  const notes: string[] = [];

  const planned = input.weeklyPlannedMi;
  const actual = input.weeklyActualMi;
  if (planned && actual && planned.length > 0 && planned.length === actual.length) {
    const ratios = planned
      .map((p, i) => (p > 0 ? actual[i] / p : null))
      .filter((r): r is number => r != null);
    if (ratios.length > 0) {
      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      // Both directions matter. Chronically over-running the plan is not
      // adaptation, it is a different failure — so the score peaks at ~1.0 and
      // falls away on both sides rather than rewarding overshoot.
      parts.push(clamp(2 - Math.abs(mean - 1.0) * 8, -2, 2));
      notes.push(`weekly volume averaging ${pct(mean)} of plan`);

      // The mean alone hides the shape. 100/100/100/10/100/70 and a steady 80%
      // both average ~80%, and they are not the same runner: one is absorbing
      // a consistent load, the other had the block interrupted. This dimension
      // is called consistency, so the spread has to count.
      if (ratios.length >= 3) {
        const variance = ratios.reduce((a, r) => a + (r - mean) ** 2, 0) / ratios.length;
        const spread = Math.sqrt(variance);
        parts.push(clamp(2 - spread * 8, -2, 2));
        if (spread > CONSISTENCY_SPREAD_NOTE) {
          const worst = Math.min(...ratios);
          notes.push(`one week at ${pct(worst)} of plan against a ${pct(mean)} average`);
        }
      }
    }
  }

  if (input.trainingForm) {
    const formScore: Record<NonNullable<AdaptationInput['trainingForm']>, number> = {
      PRODUCTIVE: 1.5,
      'RACE-READY': 1,
      BUILDING: 0.5,
      LOADED: 0,
      OVERREACH: -1.5,
      DETRAINING: -1,
    };
    parts.push(formScore[input.trainingForm]);
    if (input.trainingForm === 'OVERREACH' || input.trainingForm === 'DETRAINING') {
      notes.push(`training load reads ${input.trainingForm.toLowerCase()}`);
    }
  }

  if (parts.length === 0) {
    return { dimension: 'consistency', score: null, weight: 0, detail: '' };
  }
  return {
    dimension: 'consistency',
    score: parts.reduce((a, b) => a + b, 0) / parts.length,
    weight: DIMENSION_WEIGHTS.consistency,
    detail: notes.join(' · ') || 'training load steady',
  };
}

function readTrend(input: AdaptationInput): DimensionRead {
  const parts: number[] = [];
  const notes: string[] = [];

  if (input.distinctEvidenceWeeks != null) {
    // Not a quality judgement — a breadth judgement. Evidence spread across
    // weeks is worth more than the same volume of evidence from one week.
    parts.push(clamp((input.distinctEvidenceWeeks - 2) * 0.8, -2, 2));
  }

  if (input.adapterDowngrades != null) {
    parts.push(clamp(1 - input.adapterDowngrades * 0.9, -2, 1));
    if (input.adapterDowngrades >= 2) {
      notes.push(`plan downgraded ${input.adapterDowngrades} times`);
    }
  }

  if (parts.length === 0) {
    return { dimension: 'trend', score: null, weight: 0, detail: '' };
  }
  return {
    dimension: 'trend',
    score: parts.reduce((a, b) => a + b, 0) / parts.length,
    weight: DIMENSION_WEIGHTS.trend,
    detail: notes.join(' · ') || 'evidence consistent across recent weeks',
  };
}

/* ------------------------------------------------------------------ model */

/**
 * Classify how well the athlete is absorbing training.
 *
 * Pure. Assemble `AdaptationInput` from the existing readers named in the
 * field docs and call this. Returns `normal` with low confidence when there is
 * not enough to judge — never `marginal`, never `poor`. Silence about a runner
 * we cannot see is not a finding about that runner.
 */
export function classifyAdaptation(input: AdaptationInput): AdaptationVerdict {
  const dimensions: DimensionRead[] = [
    readExecution(input),
    readInternalCost(input),
    readRecovery(input),
    readConsistency(input),
    readTrend(input),
  ];

  /* 2026-09-02 · THE VETOES ARE GONE, and this comment is the record of it.
   *
   * An injury row, an open illness episode, or a niggle at 7/10 used to force
   * `poor` / PROTECT here regardless of how the training itself read. Every one
   * of those is the runner telling the app something about his own body, and
   * the ruling is that what he does with that is his call. So the model grades
   * TRAINING and nothing else, and this function no longer has a branch that
   * can be reached without reading a dimension.
   *
   * This makes the model strictly less able to hold a runner back. That is the
   * intended direction and it removes no structural limit: nothing downstream
   * of this verdict is the thing that stops an unsafe week — the ramp caps, the
   * ACWR read, the spike guard and the dosing caps do that, from absorbed load,
   * and they are untouched.
   */

  /* --- aggregate over KNOWN dimensions only ----------------------------- */
  const known = dimensions.filter((d) => d.score != null);
  if (known.length < MIN_DIMENSIONS_FOR_VERDICT) {
    return {
      band: 'normal',
      confidence: 'low',
      decision: 'PROGRESS',
      stepMultiplier: 1,
      dimensions,
      summary: 'Not enough training evidence yet to read how you are absorbing the work. Proceeding as planned.',
      // THE REFUSAL, named. `PROGRESS` above means "take the calendar's own
      // step", not "this runner has demonstrated room for more" · see the
      // field's doc comment.
      evidenceSufficient: false,
    };
  }

  const totalWeight = known.reduce((a, d) => a + d.weight, 0);
  const mean = known.reduce((a, d) => a + d.score! * d.weight, 0) / totalWeight;

  /* --- band, with the trend gate on `strong` ---------------------------- */
  const weeks = input.distinctEvidenceWeeks ?? 0;
  const trendGatePassed = weeks >= MIN_WEEKS_FOR_STRONG;

  /* Doctrine rule 4 · the second gate on `strong`. Training credit is not
   * progression credit, so a block carried by partial sessions may read as
   * `normal` — the work counted — and may not read as room for more. Null
   * (nothing interpretable) does not block: absence of evidence is not
   * evidence of poor adaptation, and that rule outranks this gate. */
  const progressionShare = progressionCreditShare(input);
  const progressionGatePassed =
    progressionShare == null || progressionShare >= PROGRESSION_GATE.strongMinShare;

  let band: AdaptationBand;
  if (mean >= BAND_EDGES.strong && trendGatePassed && progressionGatePassed) band = 'strong';
  else if (mean >= BAND_EDGES.normal) band = 'normal';
  else if (mean >= BAND_EDGES.marginal) band = 'marginal';
  else band = 'poor';

  /* --- execution gate · you cannot progress on work you did not do ------- */
  const execution = dimensions.find((d) => d.dimension === 'execution');
  if (execution?.score != null) {
    const order: AdaptationBand[] = ['poor', 'marginal', 'normal', 'strong'];
    const capTo = (cap: AdaptationBand) => {
      if (order.indexOf(band) > order.indexOf(cap)) band = cap;
    };
    if (execution.score <= EXECUTION_GATE.capPoor) capTo('poor');
    else if (execution.score <= EXECUTION_GATE.capMarginal) capTo('marginal');
  }

  /* --- confidence ------------------------------------------------------- */
  const confidence: AdaptationVerdict['confidence'] =
    known.length >= 4 && weeks >= MIN_WEEKS_FOR_STRONG
      ? 'high'
      : known.length >= 3
        ? 'medium'
        : 'low';

  /* --- decision and step ------------------------------------------------ */
  const recovery = dimensions.find((d) => d.dimension === 'recovery');
  const recoveryPoor = recovery?.score != null && recovery.score <= -1;

  let decision: CycleDecision;
  let stepMultiplier: number;
  if (band === 'strong') {
    decision = 'PROGRESS';
    stepMultiplier = 1.25;
  } else if (band === 'normal') {
    decision = 'PROGRESS';
    stepMultiplier = 1;
  } else if (band === 'marginal') {
    decision = 'STAY';
    stepMultiplier = 0;
  } else {
    decision = recoveryPoor ? 'PROTECT' : 'MODIFY';
    stepMultiplier = -0.5;
  }

  return {
    band,
    confidence,
    decision,
    stepMultiplier,
    dimensions,
    summary: summarise(band, mean, dimensions, trendGatePassed, progressionGatePassed, input.recentPrescribedWindow),
    evidenceSufficient: true,
  };
}

/**
 * The proximate, honestly-recognisable reason for a HOLD-shaped band when
 * today sits inside a prescribed taper or post-race recovery window —
 * preferred over reaching into a dimension's reconstructed detail, per
 * `AdaptationInput.recentPrescribedWindow`'s own doc comment. Null when no
 * such context was supplied (every caller except
 * `loadRepresentativeExecutionInput`) or when it was supplied but empty.
 */
function proximateHoldReason(
  ctx: AdaptationInput['recentPrescribedWindow'],
): string | null {
  if (!ctx) return null;
  if (ctx.kind === 'post_race_recovery') {
    if (ctx.daysSinceRace === 0) return 'you raced today, and today is not a day to add stimulus';
    const days = ctx.daysSinceRace === 1 ? '1 day' : `${ctx.daysSinceRace} days`;
    return `you are ${days} past your race and still inside the scheduled recovery window — this is expected, not a shortfall`;
  }
  const days = Math.abs(ctx.daysSinceRace) === 1 ? '1 day' : `${Math.abs(ctx.daysSinceRace)} days`;
  return `you are ${days} out from your race, inside the taper`;
}

/**
 * The one line a coach surface can render. Register per `Design/coach-voice-brief.md`:
 * observation, then what it means for the next block of training. No praise, no
 * scold, no exclamation marks.
 */
function summarise(
  band: AdaptationBand,
  mean: number,
  dimensions: DimensionRead[],
  trendGatePassed: boolean,
  progressionGatePassed: boolean,
  recentPrescribedWindow?: AdaptationInput['recentPrescribedWindow'],
): string {
  const weakest = dimensions
    .filter((d) => d.score != null && d.detail)
    .sort((a, b) => a.score! - b.score!)[0];

  switch (band) {
    case 'strong':
      return 'You are absorbing this block well. The work is landing and there is room to ask for more.';
    case 'normal':
      if (mean >= BAND_EDGES.strong && !progressionGatePassed) {
        // The distinction doctrine rule 4 exists for, said out loud: the work
        // counted, and it did not demonstrate room for more.
        return 'The work you did is landing, but too much of it came in short of the session to call it room for more. Staying on the planned progression.';
      }
      if (!trendGatePassed && mean >= BAND_EDGES.strong) {
        return 'Recent sessions look good, but it is not yet enough weeks to call it a trend. Staying on the planned progression.';
      }
      return 'Training is landing about as expected. Continuing on the planned progression.';
    case 'marginal': {
      // A runner still inside a doctrine-prescribed taper or post-race
      // recovery window is a more proximate, more honestly-recognisable
      // reason to hold than any dimension's reconstructed detail — which,
      // for a reader that widened its lookback to stay representative, can
      // describe evidence weeks old (see `proximateHoldReason`'s own doc
      // comment). Never changes the band or the decision — narration only.
      const proximate = proximateHoldReason(recentPrescribedWindow);
      if (proximate) return `Holding the current stimulus rather than adding to it — ${proximate}.`;
      return weakest?.detail
        ? `Holding the current stimulus rather than adding to it — ${weakest.detail}.`
        : 'Holding the current stimulus rather than adding to it. The last block has not been fully absorbed yet.';
    }
    case 'poor':
      return weakest?.detail
        ? `The current load is not producing the response it should — ${weakest.detail}. Backing off is the productive move here.`
        : 'The current load is not producing the response it should. Backing off is the productive move here.';
  }
}
