/**
 * lib/adaptation/volume-evidence/respond.ts · STEPS 4-8 AND 10 · THE PATH FROM
 * ADMITTED SURPLUS TO LARGER FUTURE WEEKS.
 *
 * ── THE SHAPE OF THE PATH ─────────────────────────────────────────────────
 *
 *   admitted surplus
 *     -> a fresher DemonstratedLoad                          (belief.ts)
 *     -> resolveLoadProgressionContract, RE-RESOLVED          (the existing owner)
 *     -> a larger plannedFutureLoadMi envelope
 *     -> future UNSEALED ORDINARY weeks raised toward it      (here)
 *     -> detectSimultaneousStressAddition over the PROPOSED sequence
 *     -> what will not fit is DEFERRED, not discarded         (deferral-queue.ts)
 *     -> one sentence the runner can read                     (explain.ts)
 *
 * ── WHAT THIS FILE DOES NOT DO, AND WHY THAT IS THE POINT ─────────────────
 *
 * It does not compute an envelope. `lib/plan/load-progression-contract.ts` is
 * the ONE time-aware answer to "how much load" and it keeps that job entirely;
 * this file hands it fresher evidence and reads the result. A second envelope
 * would be Rule 16 exactly, and the defect that module was written to close.
 *
 * It does not write. Nothing here opens a connection, reads a clock or names a
 * plan writer. `lib/adaptation/_zero_mutation_scan.test.ts` walks
 * `lib/adaptation` recursively, so this directory is inside its guards without
 * a new entry, and `_mileage_responsive.test.ts` proves that reach rather than
 * assuming it.
 *
 * It does not open the seam. `AUTOMATIC_ADAPTATION_AUTHORITY` stays `false`.
 * The owner's ruling of 2026-09-02 stands: "Completed runs may update evidence
 * and generate an advisory comparison, but they must not automatically mutate
 * my live plan." This produces the advisory comparison. Turning it into a
 * mutation is a product decision he has not made and this file has no means to
 * make it.
 *
 * ── STEP 6 · WHAT IS PRESERVED, AND WHY IT IS A LIST AND NOT A RULE ───────
 *
 *     "More mileage this week must not make every later week larger."
 *
 * So a week is raised ONLY when it is future, unsealed, and ORDINARY. Every
 * other week keeps its authored number and records which fact protected it:
 * cutback, taper, race week, recovery block, already at the envelope, or
 * blocked by the one-stressor-at-a-time rule. `PreservationReason` is a closed
 * union so a week cannot be left alone for an unnamed reason.
 *
 * A cutback week is the sharpest case. `Research/00a` §"Volume progression
 * rules" prescribes a down week of 20-30% every 3-4 weeks, and a cutback that
 * silently grows with the weeks around it stops being a cutback. Scaling it
 * proportionally was written first and backed out: the doctrine cell is stated
 * against the weeks it is a reduction FROM, and getting that relationship
 * right is the plan composer's job at the next authoring, not a multiplier
 * here.
 *
 * ── STEP 7 · ONE STRESSOR AT A TIME ───────────────────────────────────────
 *
 * `Research/00a` §"Practical load rules": "Either add mileage OR add intensity
 * in a given week, not both." `detectSimultaneousStressAddition` in
 * `lib/plan/adjudication/adjudicate.ts` already implements exactly this test
 * over a SEQUENCE of weeks, so it is called rather than reimplemented. It is
 * run over the PROPOSED weeks, not the authored ones, because raising a week's
 * mileage is precisely what can turn a legal week into a violating one.
 *
 * ── STEP 10 · NOTHING IS DISCARDED ────────────────────────────────────────
 *
 *     "Evidence must not disappear because one week is full."
 *
 * A raise that cannot land becomes a `QueuedDeferral` from
 * `lib/adaptation/canonical/deferral-queue.ts` — that module's own type, not a
 * second queue. `reconsiderAtBoundary` is what brings it back, and
 * `_mileage_responsive.test.ts` drives a deferred increase through it to prove
 * the round trip.
 *
 * ── RULE 22 · WHAT THIS FILE'S GATE CANNOT FAIL ON ────────────────────────
 *
 * · It cannot fail on a proposal that is well-formed and wrong. This file
 *   moves a week's TOTAL mileage; it does not recompose the days inside it,
 *   because recomposition belongs to the plan composer. A proposal naming the
 *   right weeks and the wrong session shapes would pass everything here.
 * · It cannot fail on a bad `FutureWeek.stressors` list. The one-stressor rule
 *   is only as good as the loader's stressor naming, and a loader that under-
 *   reports stressors makes step 7 silently permissive.
 * · It cannot fail on the seam being shut. Every test here proves an advisory
 *   is correct; none of them proves anything about the plan on the phone.
 * · Rule 15 · the cases that reach each branch are named in
 *   `_mileage_responsive.test.ts` beside each `it`, and the two branches no
 *   corpus case reaches are stated there rather than left dark.
 */
import { roundTo } from '@/lib/format/run';
import type { Magnitude } from '@/lib/adaptation/canonical/decision-record';
import type { QueuedDeferral } from '@/lib/adaptation/canonical/deferral-queue';
import {
  detectSimultaneousStressAddition,
  type PlannedWeek,
  type SimultaneousStressAddition,
} from '@/lib/plan/adjudication/adjudicate';
import {
  resolveLoadProgressionContract,
  type LoadProgressionContract,
} from '@/lib/plan/load-progression-contract';
import { asDemonstratedLoad } from './belief';
import { clamp01 } from './weight';
import {
  CONTRACT_DOC,
  MILEAGE_RESPONSIVE_LEVER,
  VOLUME_MAX_STEP_FRAC,
  VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE,
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
  type DemonstratedVolumeBelief,
  type FutureWeek,
  type FutureWeekChange,
  type PreservationReason,
  type SurplusAdmission,
  type WeekSurplus,
} from './contract';
import { explainVolumeResponse } from './explain';

/**
 * Doctrine's own citation for the one-stressor rule, resolved here so the
 * proposal carries it and nothing downstream has to re-derive it.
 */
export const ONE_STRESSOR_CITATION =
  'Research/00a-distance-running-training.md §"Practical load rules" · '
  + '"Either add mileage OR add intensity in a given week, not both"';

/** Phases in which more volume is the point. Step 5's second clause. */
export type PhaseIntent = 'BUILD' | 'PEAK' | 'TAPER' | 'RACE_WEEK' | 'RECOVERY' | 'UNKNOWN';

/**
 * `Research/00a` §"Volume progression rules" is a statement about BUILDING.
 * A taper exists to shed accumulated fatigue and a recovery block exists to
 * repay it, so "the runner absorbed more than we asked" is not a reason to
 * make either of them bigger. PEAK is included because a peak week is still a
 * building week; RACE_WEEK and TAPER are not.
 */
export const PHASES_THAT_BENEFIT_FROM_MORE_VOLUME: ReadonlySet<PhaseIntent> =
  new Set<PhaseIntent>(['BUILD', 'PEAK']);

export interface VolumeResponseInput {
  readonly asOfISO: string;
  readonly athleteId: string;
  readonly planVersion: string;
  readonly evidenceVersion: string;
  /** The week the surplus was run in. */
  readonly week: WeekSurplus;
  readonly admission: SurplusAdmission;
  readonly beliefBefore: DemonstratedVolumeBelief;
  readonly beliefAfter: DemonstratedVolumeBelief;
  /** Weeks from `asOfISO` forward, ascending, INCLUDING sealed and protected ones. */
  readonly futureWeeks: readonly FutureWeek[];
  /** The week immediately before the first future week, for the sequence test. */
  readonly weekBeforeFirstFuture: FutureWeek | null;
  readonly phase: PhaseIntent;
  /** `TIER_TARGETS[cat].developing.peakWeeklyMileageBand[0]`, passed not looked up. */
  readonly distanceFloorMi: number;
  readonly templatePeakBandMi: readonly [number, number] | null;
  /**
   * CONTINUOUS-EVIDENCE-1 · HOW MUCH OF A FULL DOCTRINAL STEP THE ACCUMULATED
   * EVIDENCE HAS BOUGHT. `CapacityAccumulation.progressionFraction`, in [0, 1].
   *
   * This is what stops the accumulation bar from becoming the next cliff. The
   * unlock is not a gate the proposal passes through, it is the SCALE the
   * proposal is multiplied by, so a runner holding a third of the evidence
   * gets a third of the step rather than nothing at all.
   *
   * REQUIRED, not defaulted. A caller that has not accumulated any evidence
   * must say `0` rather than omit the field: Rule 11, and defaulting an absent
   * measurement to the permissive value is the exact coercion that let a
   * zero-quality-density week read as "no signal" and answer with full
   * quality.
   */
  readonly progressionFraction: number;
  /** Upward steps already taken in this cutback cycle. */
  readonly stepsTakenThisCycle: number;
  /** Where a deferred proposal would be reconsidered. */
  readonly nextBoundaryISO: string | null;
}

export interface VolumeResponse {
  readonly asOfISO: string;
  readonly admission: SurplusAdmission;
  readonly beliefBefore: DemonstratedVolumeBelief;
  readonly beliefAfter: DemonstratedVolumeBelief;
  /** The envelope struck off the OLD belief. */
  readonly contractBefore: LoadProgressionContract;
  /** The envelope struck off the NEW belief. This is what makes weeks larger. */
  readonly contractAfter: LoadProgressionContract;
  readonly weeks: readonly FutureWeekChange[];
  /** Weeks that would have been raised and could not be, yet. */
  readonly deferred: readonly QueuedDeferral[];
  readonly simultaneousStressFindings: readonly SimultaneousStressAddition[];
  /** Step 8. One sentence, composed once, in the runner's language. */
  readonly explanation: string;
  /** Every mile this response would add across the whole block. */
  readonly totalAddedMi: number;
}

const preserve = (
  w: FutureWeek,
  reason: PreservationReason,
  why: string,
): FutureWeekChange => ({
  weekStartISO: w.weekStartISO,
  beforeMi: w.prescribedMi,
  afterMi: w.prescribedMi,
  deltaMi: 0,
  preserved: reason,
  why,
});

/** A `FutureWeek` in the shape the adjudication layer's sequence test reads. */
export function asPlannedWeek(w: FutureWeek, weeklyMi: number): PlannedWeek {
  return {
    weekStartISO: w.weekStartISO,
    weeklyMi,
    longestMi: w.longestMi,
    stressors: w.stressors,
    mpMi: w.mpMi,
    isTaper: w.isTaper,
    isRaceWeek: w.isRaceWeek,
  };
}

/**
 * THE RESPONSE.
 *
 * Note the ORDER of the guards, which is the argument:
 *
 *  1 · the admission, because an unadmitted surplus changes nothing at all;
 *  2 · the phase, because a taper does not get bigger for any reason;
 *  3 · the cadence bound, checked ONCE above the per-week walk rather than
 *      inside it — the exact placement bug that made
 *      `VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE` govern only the upward path in
 *      `weekly-volume.ts` and let one piece of evidence be spent seven times;
 *  4 · per week: past, sealed, protected, at the envelope, then the raise;
 *  5 · the one-stressor sequence test, over the PROPOSED weeks;
 *  6 · deferral of everything that could not land.
 */
export function respondToVolumeEvidence(input: VolumeResponseInput): VolumeResponse {
  /* RULE 9 and RULE 11, and `plannedPeakBound`'s own note is the argument:
   * `null` and `0` are different KINDS of answer here. `null` means THIS CALLER
   * HAS NO CALENDAR, which is a data-presence fact; `0` means a calendar exists
   * and holds no climbing weeks, which is a measurement and bounds the peak at
   * what the runner is carrying now. Writing this as `climbWeeks > 0 ?
   * climbWeeks : null` erased the second into the first, and COERCION-1 caught
   * it on the first prebuild -- the same shape as the `scheduledMi >= 5`
   * mileage-proxy-for-a-data-presence-question that Rule 9 is named for. */
  const hasCalendar = input.futureWeeks.length > 0;
  const climbWeeks = input.futureWeeks.filter((w) => !w.isTaper && !w.isRaceWeek && !w.isCutback).length;
  const climbWeeksToPeak = hasCalendar ? climbWeeks : null;

  const contractBefore = resolveLoadProgressionContract({
    demonstrated: asDemonstratedLoad(input.beliefBefore),
    climbWeeksToPeak,
    distanceFloorMi: input.distanceFloorMi,
    templatePeakBandMi: input.templatePeakBandMi,
  });
  const contractAfter = resolveLoadProgressionContract({
    demonstrated: asDemonstratedLoad(input.beliefAfter),
    climbWeeksToPeak,
    distanceFloorMi: input.distanceFloorMi,
    templatePeakBandMi: input.templatePeakBandMi,
  });

  const nothingMoves = (reason: PreservationReason, why: string): VolumeResponse => {
    const weeks = input.futureWeeks.map((w) => preserve(w, reason, why));
    return {
      asOfISO: input.asOfISO,
      admission: input.admission,
      beliefBefore: input.beliefBefore,
      beliefAfter: input.beliefAfter,
      contractBefore,
      contractAfter,
      weeks,
      deferred: [],
      simultaneousStressFindings: [],
      explanation: explainVolumeResponse({
        admission: input.admission,
        addedMi: 0,
        weeksRaised: 0,
        firstRaisedWeekISO: null,
        blockedBy: reason,
        phase: input.phase,
        progressionFraction: clamp01(input.progressionFraction),
      }),
      totalAddedMi: 0,
    };
  };

  /* 1 · the admission. */
  if (!input.admission.admitted) {
    return nothingMoves('ALREADY_AT_OR_ABOVE_THE_ENVELOPE',
      'The surplus was not admitted as volume evidence, so no week moves.');
  }

  /* 2 · the phase. Step 5's second clause: the added work was absorbed AND the
   *     phase benefits from more volume. */
  if (!PHASES_THAT_BENEFIT_FROM_MORE_VOLUME.has(input.phase)) {
    const reason: PreservationReason = input.phase === 'RACE_WEEK'
      ? 'RACE_WEEK' : input.phase === 'TAPER' ? 'TAPER_WEEK' : 'RECOVERY_BLOCK';
    return nothingMoves(reason,
      `The block is in ${input.phase}. More volume is not what this phase is for.`);
  }

  /* 3 · the cadence bound, ABOVE the walk. */
  if (input.stepsTakenThisCycle >= VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE) {
    return nothingMoves('ALREADY_AT_OR_ABOVE_THE_ENVELOPE',
      `A volume step has already been taken in this cutback cycle `
      + `(VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE = ${VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE}).`);
  }

  // Hoisted after the guard above: TypeScript's narrowing of a discriminated
  // union does not survive into the `.map` callback below, and re-asserting it
  // there with a non-null assertion would be exactly the Rule 11 escape hatch
  // the union exists to remove.
  const admittedMi = input.admission.mi;

  /* ── WHAT ACTUALLY CAUSES A RAISE, STATED PLAINLY ──────────────────────
   *
   * The ADMISSION is the causal link, not the size of the belief's move. A
   * week can be admitted, raise no belief number (because the runner has run
   * a bigger week before), and still raise future weeks, whenever the plan
   * sits below the envelope his existing evidence already supports.
   *
   * That is deliberate and it is the mission statement: "current fitness is a
   * SAFETY FLOOR, not a ceiling", and "the plan has to push us more and more".
   * Evidence that he absorbed extra work is new information about TODAY even
   * when the peak number is unchanged, and a plan authored below what the
   * runner already demonstrates is the defect, not the baseline.
   *
   * What stops it becoming "add the same amount forever", which the owner
   * ruled out in as many words, is the cadence bound checked immediately
   * above: `VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE` is 1, so the envelope is
   * spent once per cutback cycle and then the block has to be run before it
   * can be spent again. `_mileage_responsive.test.ts` asserts both halves.
   */

  /* 4 · the per-week walk. */
  const envelope = contractAfter.plannedFutureLoadMi;
  const changes: FutureWeekChange[] = [];
  const proposedByWeek = new Map<string, number>();
  let climbIndex = 0;

  for (const w of input.futureWeeks) {
    if (w.weekStartISO < input.asOfISO) {
      changes.push(preserve(w, 'IN_THE_PAST', 'Past weeks are never rewritten.'));
      proposedByWeek.set(w.weekStartISO, w.prescribedMi);
      continue;
    }
    if (w.sealed) {
      changes.push(preserve(w, 'SEALED', 'A completed run has already matched a prescription in this week.'));
      proposedByWeek.set(w.weekStartISO, w.prescribedMi);
      continue;
    }
    if (w.isRaceWeek) {
      changes.push(preserve(w, 'RACE_WEEK', 'A race week keeps the shape it was authored with.'));
      proposedByWeek.set(w.weekStartISO, w.prescribedMi);
      continue;
    }
    if (w.isTaper) {
      changes.push(preserve(w, 'TAPER_WEEK', 'A taper exists to shed fatigue, so it does not grow.'));
      proposedByWeek.set(w.weekStartISO, w.prescribedMi);
      continue;
    }
    if (w.isCutback) {
      changes.push(preserve(w, 'CUTBACK_WEEK',
        'A down week is prescribed at 20 to 30 per cent below the weeks around it. '
        + 'Growing it would stop it being one.'));
      proposedByWeek.set(w.weekStartISO, w.prescribedMi);
      continue;
    }

    // The envelope entry for this CLIMBING week. Index 0 is the next climbing
    // week, which is what `plannedFutureLoadMi` documents itself as.
    const ceiling = climbIndex < envelope.length ? envelope[climbIndex] : null;
    climbIndex += 1;

    if (ceiling == null) {
      changes.push(preserve(w, 'ALREADY_AT_OR_ABOVE_THE_ENVELOPE',
        'The envelope does not reach this far, so nothing bounds a raise here.'));
      proposedByWeek.set(w.weekStartISO, w.prescribedMi);
      continue;
    }

    // The step is bounded on THREE sides, and by the smallest of them:
    //   · the doctrine step cap, the same constant the downward path uses;
    //   · the envelope, which is what the fresher belief actually moved;
    //   · CONTINUOUS-EVIDENCE-1 · how much evidence has actually accumulated.
    //
    // The third factor is the one that makes this whole path continuous in the
    // evidence rather than in the envelope alone. `VOLUME_MAX_STEP_FRAC` is
    // what a runner gets for a FULL cycle's worth of demonstrated growth; a
    // runner holding 28 per cent of that gets 28 per cent of the step. Rule 9:
    // every one of the three is a `min` over a continuous quantity, so a hair
    // more evidence produces a hair more mileage and never a different KIND of
    // week, and there is no point anywhere on the path where zero evidence
    // becomes full evidence.
    const stepCap = w.prescribedMi * VOLUME_MAX_STEP_FRAC * clamp01(input.progressionFraction);
    const target = Math.min(w.prescribedMi + stepCap, ceiling);
    if (target <= w.prescribedMi + 1e-9) {
      changes.push(preserve(w, 'ALREADY_AT_OR_ABOVE_THE_ENVELOPE',
        `This week is already at ${roundTo(w.prescribedMi)} mi, at or above the `
        + `${roundTo(ceiling)} mi the evidence supports for it.`));
      proposedByWeek.set(w.weekStartISO, w.prescribedMi);
      continue;
    }

    const after = roundTo(target);
    changes.push({
      weekStartISO: w.weekStartISO,
      beforeMi: w.prescribedMi,
      afterMi: after,
      deltaMi: roundTo(after - w.prescribedMi),
      preserved: null,
      why: `The evidence supports ${roundTo(ceiling)} mi for this week and the step is `
        + `capped at ${Math.round(VOLUME_MAX_STEP_FRAC * 100)} per cent.`,
    });
    proposedByWeek.set(w.weekStartISO, after);
  }

  /* 5 · one stressor at a time, over the PROPOSED sequence. */
  const ordered = [...input.futureWeeks].sort((a, b) => a.weekStartISO.localeCompare(b.weekStartISO));
  const findings: SimultaneousStressAddition[] = [];
  const blockedWeeks = new Set<string>();
  for (let i = 0; i < ordered.length; i += 1) {
    // SIGNATURE-MERGE (2026-09-05) · this reader took a single previous week
    // when this file was written, and now takes the PREFIX of prior weeks: the
    // single previous week is poisoned by any planned cutback, which
    // misreported four of thirteen weeks on the live block. Build the prefix
    // from the same proposed values the rest of this walk uses, so the baseline
    // reflects what this responder is proposing rather than what was authored.
    const priorSource = i === 0
      ? (input.weekBeforeFirstFuture == null ? [] : [input.weekBeforeFirstFuture])
      : ordered.slice(0, i);
    if (priorSource.length === 0) continue;
    const priorWeeks = priorSource.map((w) =>
      asPlannedWeek(w, proposedByWeek.get(w.weekStartISO) ?? w.prescribedMi));
    const thisMi = proposedByWeek.get(ordered[i].weekStartISO) ?? ordered[i].prescribedMi;
    const finding = detectSimultaneousStressAddition(
      asPlannedWeek(ordered[i], thisMi),
      priorWeeks,
    );
    if (finding != null) {
      findings.push(finding);
      blockedWeeks.add(ordered[i].weekStartISO);
    }
  }

  /* 6 · everything that could not land is deferred, never discarded. */
  const deferred: QueuedDeferral[] = [];
  const finalChanges: FutureWeekChange[] = changes.map((c) => {
    if (!blockedWeeks.has(c.weekStartISO) || c.preserved != null) return c;
    const finding = findings.find((f) => f.weekStartISO === c.weekStartISO)!;
    const magnitude: Magnitude = {
      unit: 'weekly_mi',
      value: c.deltaMi,
      limit: roundTo(c.beforeMi * VOLUME_MAX_STEP_FRAC),
      limitConstant: 'VOLUME_MAX_STEP_FRAC',
      limitCitation: `${CONTRACT_DOC} · Weekly volume`,
    };
    const idempotencyKey = `${input.athleteId}·${input.planVersion}·${input.evidenceVersion}`
      + `·${MILEAGE_RESPONSIVE_LEVER}·${c.weekStartISO}`;
    deferred.push({
      queueId: `${input.athleteId} · ${MILEAGE_RESPONSIVE_LEVER} · ${idempotencyKey}`,
      athleteId: input.athleteId,
      planVersion: input.planVersion,
      evidenceVersion: input.evidenceVersion,
      lever: MILEAGE_RESPONSIVE_LEVER,
      beforeValue: c.beforeMi,
      proposedAfterValue: c.afterMi,
      magnitude,
      evidence: [{
        activityId: `week:${input.week.weekStartISO}`,
        dateISO: input.week.weekStartISO,
        what: `${admittedMi} mi of admitted surplus`,
        grade: null,
        weight: 1,
      }],
      newestEvidenceISO: input.week.weekStartISO,
      // The contract's own nearest rule. Doctrine's "one stressor at a time"
      // and the contract's "one material lever per cycle" are the same idea at
      // two scales, and inventing a seventh `DeferralRule` member for this
      // would be a second vocabulary for one fact (Rule 16).
      reason: 'ONE_MATERIAL_LEVER_PER_CYCLE',
      reasonDetail: `${finding.why} ${ONE_STRESSOR_CITATION}`,
      queuedAtISO: input.asOfISO,
      nextBoundaryISO: input.nextBoundaryISO,
      idempotencyKey,
    });
    return {
      ...c,
      afterMi: c.beforeMi,
      deltaMi: 0,
      preserved: 'SIMULTANEOUS_VOLUME_AND_INTENSITY' as PreservationReason,
      why: `${finding.why} The increase is held, not dropped.`,
    };
  });

  const raised = finalChanges.filter((c) => c.deltaMi > 0);
  const totalAddedMi = roundTo(raised.reduce((a, c) => a + c.deltaMi, 0));

  return {
    asOfISO: input.asOfISO,
    admission: input.admission,
    beliefBefore: input.beliefBefore,
    beliefAfter: input.beliefAfter,
    contractBefore,
    contractAfter,
    weeks: finalChanges,
    deferred,
    simultaneousStressFindings: findings,
    explanation: explainVolumeResponse({
      admission: input.admission,
      addedMi: totalAddedMi,
      weeksRaised: raised.length,
      firstRaisedWeekISO: raised[0]?.weekStartISO ?? null,
      blockedBy: raised.length === 0
        ? (finalChanges.find((c) => c.preserved != null)?.preserved ?? null)
        : null,
      phase: input.phase,
      progressionFraction: clamp01(input.progressionFraction),
    }),
    totalAddedMi,
  };
}

/** Re-exported so a caller and a test read the same numbers (Rule 16). */
export const VOLUME_EVIDENCE_CONSTANTS = {
  VOLUME_MAX_STEP_FRAC,
  VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE,
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
} as const;
