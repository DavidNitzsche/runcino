/**
 * lib/plan/volume-evidence-proposal.ts · VOLUMESEAM-1 · THE SEAM. WHERE
 * "THE RUNNER RAN MORE THAN PRESCRIBED" BECOMES SOMETHING HE CAN ACTUALLY
 * ANSWER ON HIS PHONE.
 *
 * ── WHAT WAS WRONG, MEASURED ──────────────────────────────────────────────
 *
 * `lib/adaptation/volume-evidence/` computes the whole path — classify the
 * surplus, admit it against five conditions, weigh it continuously, accumulate
 * it across weeks, recompute the belief, re-resolve the load contract, propose
 * larger future weeks, defer what will not fit, and say one sentence about it.
 * Nine modules, ~2,800 lines, a doctrine registry entry, three gates and a
 * real-history replay.
 *
 * Grepped on 2026-09-05, its importers outside its own directory were:
 * four vitest configs, one allowlist in `_cannot_mutate.test.ts`, one audit
 * registry, one ownership table, and prose. **Not one line of production code.**
 * It was arithmetic in a jar. The owner's word for it was "an orphaned module",
 * and the instruction was to prove it changes the operating belief rather than
 * calculating inside one.
 *
 * This file and `volume-evidence-loader.ts` are that proof, and they are
 * deliberately the ONLY two. `lib/adaptation/_zero_mutation_scan.test.ts`
 * forbids anything under `lib/adaptation` from naming a plan writer, which is
 * correct and stays; so the seam lives here, in `lib/plan`, and is recorded in
 * that gate's `PERMITTED_EXTERNAL_IMPORTS` ratchet with its reason spelled out.
 *
 * ── WHAT IT MAY AND MAY NOT DO · THE AUTHORITY BOUNDARY ───────────────────
 *
 * It RAISES A CARD. It does not touch `plan_workouts`.
 *
 * `AUTOMATIC_ADAPTATION_AUTHORITY` is `false` and nothing here reads it, names
 * it or opens it. The only writer this file knows about is
 * `writeWorkoutProposals`, which inserts into `plan_workout_proposals` and
 * nothing else. A row in that table is an OFFER; the plan changes when, and
 * only when, the runner taps accept and
 * `POST /api/plan/workout-proposals/[id]/accept` calls `applyBrainAction`
 * under `RUNNER_ACCEPTED`. That is PROPOSEUP-2's split, restated: "the seal
 * says this lever may not CHANGE the live plan. It has never said the runner
 * may not be OFFERED the change."
 *
 * ── WHY `mark_upgrade` AND NOT A NEW ACTION KIND ──────────────────────────
 *
 * Because the lane already exists and every one of `_action_completeness`'s
 * eleven facets is already satisfied for it. `mark_upgrade` carries `bumps`,
 * `actionFromAdaptation` turns each into a `DISTANCE_CHANGE` with
 * `direction: 'MORE'`, `executorFor` routes it to `ADAPTATION_PIPELINE`,
 * accept applies it under `RUNNER_ACCEPTED`, `ledgerFacetsOf` records it,
 * `undoWritesFor` reverses it, `watchBehaviorOf` reloads the wrist and
 * `v5-action-render` draws it in signal orange as an increase.
 *
 * Inventing a twenty-second kind for the same physical change — a plan row's
 * `distance_mi` going up — would be Rule 16 with extra steps, and would put
 * eleven new facet cells and a ratchet bump between this evidence and the
 * runner. The EVIDENCE is new; the CHANGE is not.
 *
 * ── WHAT THIS LANE ADDS THAT `adaptive-ramp` COULD NOT ────────────────────
 *
 * `proposeAdaptiveBump` reads five signals: `acwrHeadroom`,
 * `lastQualityOnPace`, `lastLongClean`, `belowTierUpper`, `noBumpRecent`.
 * **None of them is "the runner ran more than prescribed."** Worse, the first
 * one runs the wrong way: extra mileage raises acute load, raises ACWR, and
 * CLOSES the gate. So on the existing lane, running more made a bump LESS
 * likely, which is Rule 21's signature inverted into the mechanism itself.
 *
 * This lane is driven by demonstrated volume evidence and by nothing else, and
 * its size is `progressionFraction` — a continuous number in [0, 1] that is
 * how much of a doctrinal step the accumulated evidence has actually bought.
 * Rule 9: a hair more evidence produces a hair more mileage, at every point
 * on the path, and there is nowhere that zero evidence becomes full evidence.
 *
 * ── RULE 22 · WHAT THIS FILE'S GATE CANNOT FAIL ON ────────────────────────
 *
 * · It cannot fail on a card the runner never taps. Everything here ends at a
 *   pending row. Whether the plan on his phone changes is his decision, and no
 *   test in this repo can make it for him.
 * · It cannot fail on a well-formed proposal that is coaching nonsense. It
 *   moves `distance_mi` on rows the distributor picked; it does not recompose
 *   the week. A raise landing on the wrong sessions would pass everything here.
 * · It cannot fail on a WRONG LOADER. Every Rule 8 flag, every prescription and
 *   every canonical filter arrives from `volume-evidence-loader.ts`. Its own
 *   header states what it cannot see.
 * · It cannot fail on `writeWorkoutProposals` writing one card PER ROW rather
 *   than one per decision. A three-row raise is three cards, which is Rule 17
 *   tension this lane INHERITS from the proposal table's shape (it has no
 *   decision id) rather than introduces. Named here so it is a known gap and
 *   not a surprise.
 * · It cannot fail on the ledger. Nothing here writes `plan_decision_ledger`;
 *   that table's migration is unapplied and `recordDecision` answers
 *   `table_absent`. The card carries its evidence in `plan_workout_proposals
 *   .evidence` so the decision is reconstructible either way.
 */
import { roundTo } from '@/lib/format/run';
import { runnerToday } from '@/lib/runtime/runner-tz';
import type { AdaptationAction, AdaptationTrigger } from '@/lib/plan/adapt';
import { distributeWeeklyBump } from '@/lib/plan/adaptive-ramp';
import { writeWorkoutProposals } from '@/lib/plan/workout-proposals';
import { loadVolumeEvidence, type FutureRow, type VolumeEvidenceWindow } from '@/lib/plan/volume-evidence-loader';
// THE SEAM · recorded in `_zero_mutation_scan.test.ts`'s permitted-imports
// ratchet. These are READERS; the directory owns no writer and names none.
import { demonstratedLoadAfterEachWeek } from '@/lib/adaptation/volume-evidence/after-each-week';
import { respondToVolumeEvidence, type VolumeResponse } from '@/lib/adaptation/volume-evidence/respond';

/**
 * What the lane decided, in full, whether or not a card was written.
 *
 * Rule 11 and Rule 21's observability clause together: "a log that records
 * that something happened but not what is not a log." Every exit below is
 * NAMED, so "the evidence said no" and "the read failed" and "he has not
 * earned a step yet" are three different answers a caller can report, rather
 * than one silent zero.
 */
export type VolumeProposalOutcome =
  | {
    readonly kind: 'PROPOSED'; readonly cards: number; readonly detail: VolumeProposalDetail;
    readonly action: AdaptationAction; readonly trigger: AdaptationTrigger;
  }
  | { readonly kind: 'NOTHING_TO_PROPOSE'; readonly because: string; readonly detail: VolumeProposalDetail }
  | { readonly kind: 'NO_ADMITTED_EVIDENCE'; readonly because: string }
  | { readonly kind: 'REFUSED'; readonly because: string };

/**
 * The same taxonomy WITHOUT the card count, which only the writer knows.
 * `decideVolumeRaise` returns this; `proposeVolumeEvidenceRaise` adds `cards`.
 */
export type VolumeDecision =
  | {
    readonly kind: 'PROPOSED'; readonly detail: VolumeProposalDetail;
    readonly action: AdaptationAction; readonly trigger: AdaptationTrigger;
  }
  | { readonly kind: 'NOTHING_TO_PROPOSE'; readonly because: string; readonly detail: VolumeProposalDetail }
  | { readonly kind: 'NO_ADMITTED_EVIDENCE'; readonly because: string }
  | { readonly kind: 'REFUSED'; readonly because: string };

export interface VolumeProposalDetail {
  readonly asOfISO: string;
  /** [0, 1]. How much of a full doctrinal volume step the evidence has bought. */
  readonly progressionFraction: number;
  /** Σ confirmed units × recency. What may actually be spent today. */
  readonly confirmedUnits: number;
  /** Σ units × recency. Everything the running was worth, confirmed or not. */
  readonly recordedUnits: number;
  /** The week whose surplus is being spent. */
  readonly evidenceWeekISO: string;
  readonly admittedMi: number;
  /** The belief before and after, so a caller can show the move. */
  readonly peakBeforeMi: number | null;
  readonly peakAfterMi: number | null;
  /** CHANNEL 2, carried separately. Excess miles the legs absorbed. */
  readonly fatigueExcessMi: number;
  /** What the responder proposed across the whole block, before decomposition. */
  readonly totalAddedMi: number;
  readonly weeksRaised: number;
  readonly deferredRaises: number;
  /** The week a card was actually raised against, when one was. */
  readonly landedWeekISO: string | null;
  /** The week's total before and after the proposed raise. Null when none landed. */
  readonly weekBeforeMi: number | null;
  readonly weekAfterMi: number | null;
  readonly bumps: readonly { readonly workoutId: string; readonly fromMi: number; readonly toMi: number }[];
  readonly explanation: string;
  readonly population: VolumeEvidenceWindow['population'];
}

/**
 * The trigger this lane reports under. Distinct from `adaptive_ramp` on
 * purpose: Rule 21 asks that an adaptation record "what it did, in which
 * direction, and on what evidence", and two upward volume lanes filed under
 * one kind would make "which one fired" unanswerable from the log, which is
 * exactly the ambiguity that let a zero-upgrade engine survive 309 intents.
 */
export const VOLUME_EVIDENCE_TRIGGER = 'volume_evidence' as const;

/**
 * RUN THE LANE.
 *
 * `asOfISO` is optional and resolves to the RUNNER's today, not the server's.
 * A Pacific runner's day rolls over at 5pm UTC, and a lane that read
 * `CURRENT_DATE` would spend the wrong week for seven hours out of every
 * twenty-four (`lib/runtime/runner-tz.ts`, and the defect it was written for).
 */
export async function proposeVolumeEvidenceRaise(
  userUuid: string,
  opts: { asOfISO?: string; dryRun?: boolean } = {},
): Promise<VolumeProposalOutcome> {
  const asOfISO = opts.asOfISO ?? await runnerToday(userUuid);

  const read = await loadVolumeEvidence(userUuid, asOfISO);
  if (!read.ok) return { kind: 'REFUSED', because: read.because };

  const decision = decideVolumeRaise(read.window);
  if (decision.kind !== 'PROPOSED' || opts.dryRun === true) {
    return decision.kind === 'PROPOSED' ? { ...decision, cards: 0 } : decision;
  }

  /* ── 5 · THE CARD ───────────────────────────────────────────────────
   *
   * `why` is the responder's own sentence, composed once, in the runner's
   * language (Rule 17: it is not restated here). The trigger's evidence blob
   * carries the numbers a later reader needs to reconstruct the decision,
   * which is Rule 21's observability clause on the one surface that survives
   * a plan rebuild. */
  const cards = await writeWorkoutProposals(userUuid, [decision.action], [decision.trigger]);
  console.log(
    `[volume-evidence] PROPOSED ${cards} card(s) raising ${decision.detail.landedWeekISO} to `
    + `${decision.detail.weekAfterMi} mi on `
    + `${roundTo(decision.detail.progressionFraction * 100)} per cent of a full step. `
    + 'The plan is unchanged until he accepts.',
  );
  return { kind: 'PROPOSED', cards, detail: decision.detail, action: decision.action, trigger: decision.trigger };
}

/**
 * THE DECISION, WITH NO DATABASE AND NO CLOCK IN IT.
 *
 * Split out from the function above 2026-09-05 so `_volume_seam.test.ts` can
 * drive the WHOLE lane on constructed histories and assert every clause of the
 * owner's specification, rather than asserting the pieces separately and
 * hoping they compose. Rule 15's standard, applied to this file: a mechanism
 * no case can reach is untested, and a mechanism only reachable behind a
 * production database is reachable by nothing that runs in CI.
 *
 * Everything downstream of the read lives here. `proposeVolumeEvidenceRaise`
 * is now the read, this, and one write.
 */
export function decideVolumeRaise(w: VolumeEvidenceWindow): VolumeDecision {
  const asOfISO = w.asOfISO;

  /* ── 1 · THE BELIEF, RECOMPUTED FROM COMPLETED WEEKS ────────────────
   *
   * This is the sentence `load-progression-contract.ts` has promised since
   * 2026-09-02 and never kept. It is kept here. */
  const recompute = demonstratedLoadAfterEachWeek({
    asOfISO,
    weeks: w.weeks,
    sustainedRank: w.sustainedRank,
    minConsecutiveWeeksForLoss: w.minConsecutiveWeeksForLoss,
  });
  if (!recompute.ok) return { kind: 'REFUSED', because: recompute.because };

  /* ── 2 · THE NEWEST ADMITTED WEEK ───────────────────────────────────
   *
   * The responder is stated about ONE week's surplus, and the accumulated
   * ledger arrives beside it as `progressionFraction`. So the week to spend is
   * the most recent one the five conditions admitted; older admitted weeks are
   * not lost, they are IN the ledger, recency-weighted, which is what makes
   * "repeated modest overruns accumulate" true rather than aspirational. */
  let idx = -1;
  for (let i = recompute.readings.length - 1; i >= 0; i -= 1) {
    if (recompute.readings[i].admission.admitted) { idx = i; break; }
  }
  if (idx < 0) {
    const unreadable = recompute.accumulation.unreadableWeeks.length;
    return {
      kind: 'NO_ADMITTED_EVIDENCE',
      /* Rule 11, in the sentence itself. "He ran no extra" and "we could not
       * read whether he did" are different facts and must not share a line. */
      because: `No week in the ${w.weeks.length}-week window was admitted as volume evidence`
        + (unreadable > 0
          ? `, and ${unreadable} of them could not be read at all. That is a refusal, not a runner who ran nothing extra.`
          : '. The runner did not run materially more than prescribed in any representative week.'),
    };
  }
  const reading = recompute.readings[idx];
  const admission = reading.admission;
  if (!admission.admitted) {
    return { kind: 'REFUSED', because: 'The admitted week stopped being admitted between two reads.' };
  }
  const beliefBefore = idx === 0
    ? recompute.beliefAfterEachWeek[0]
    : recompute.beliefAfterEachWeek[idx - 1];

  /* CHANNEL 2, summed. Rule 11 in the fold itself: a week whose excess could
   * not be read contributes nothing to this total and is NOT counted as a week
   * with zero excess, which is why the refusal is skipped rather than
   * coerced to 0. */
  const fatigueExcessMi = roundTo(recompute.fatigue.reduce(
    (a, f) => a + (f.excessMi.ok ? f.excessMi.value : 0), 0));
  const baseDetail = {
    asOfISO,
    progressionFraction: recompute.accumulation.progressionFraction,
    confirmedUnits: recompute.accumulation.totalUnits,
    recordedUnits: recompute.accumulation.recordedUnits,
    evidenceWeekISO: reading.weekStartISO,
    admittedMi: admission.mi,
    peakBeforeMi: beliefBefore.peakWeeklyMi,
    peakAfterMi: recompute.belief.peakWeeklyMi,
    fatigueExcessMi,
    population: w.population,
  };

  /* ── 3 · THE RESPONSE · larger future weeks, or a named reason not ── */

  const response: VolumeResponse = respondToVolumeEvidence({
    asOfISO,
    athleteId: w.athleteId,
    planVersion: w.planId,
    evidenceVersion: `${reading.weekStartISO}·${recompute.accumulation.totalUnits.toFixed(5)}`,
    week: reading.surplus,
    admission,
    beliefBefore,
    beliefAfter: recompute.belief,
    futureWeeks: w.futureWeeks,
    weekBeforeFirstFuture: w.weekBeforeFirstFuture,
    phase: w.phase,
    distanceFloorMi: w.distanceFloorMi,
    templatePeakBandMi: w.templatePeakBandMi,
    progressionFraction: recompute.accumulation.progressionFraction,
    /* DETERIORATION-SEVERITY-1 · carried for the runner's SENTENCE only. The
     * discount is already inside `progressionFraction`; this says why. */
    deteriorationWeight: reading.capacity.deteriorationWeight,
    stepsTakenThisCycle: w.stepsTakenThisCycle,
    nextBoundaryISO: w.nextBoundaryISO,
  });

  const detail = (extra: Partial<VolumeProposalDetail>): VolumeProposalDetail => ({
    ...baseDetail,
    totalAddedMi: response.totalAddedMi,
    weeksRaised: response.weeks.filter((c) => c.deltaMi > 0).length,
    deferredRaises: response.deferredRaises.length,
    landedWeekISO: null,
    weekBeforeMi: null,
    weekAfterMi: null,
    bumps: [],
    explanation: response.explanation,
    ...extra,
  });

  const raised = response.weeks.filter((c) => c.deltaMi > 0);
  if (raised.length === 0) {
    return {
      kind: 'NOTHING_TO_PROPOSE',
      because: response.explanation,
      detail: detail({}),
    };
  }

  /* ── 4 · DECOMPOSE THE FIRST RAISED WEEK INTO EXACT ROW CHANGES ─────
   *
   * ONE WEEK, not all of them, and the reason is doctrine rather than
   * timidity. `VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE` is 1, so the envelope is
   * spent once per cutback cycle; and `Research/00a` §"Practical load rules"
   * is "either add mileage OR add intensity in a given week". Offering four
   * weeks of raises at once would spend a cycle's one step four times over
   * and hand the runner four decisions where the engine made one.
   *
   * The later weeks are not discarded. They are re-derived on the next run
   * from the same evidence, against a plan that has by then absorbed this
   * week, and anything blocked by the one-stressor rule is already a
   * `QueuedDeferral` on `response.deferredRaises` with a `nextBoundaryISO`. */
  const target = raised[0];
  const rows = w.futureRowsByWeek.get(target.weekStartISO) ?? [];
  if (rows.length === 0) {
    return {
      kind: 'NOTHING_TO_PROPOSE',
      because: `The week beginning ${target.weekStartISO} would take `
        + `${roundTo(target.deltaMi)} more miles, and it holds no session a raise could land on.`,
      detail: detail({ landedWeekISO: target.weekStartISO }),
    };
  }

  /* The long-run ceiling for this week. Rule 21's "spend the headroom doctrine
   * already allows, never weaken a guard": the envelope the load contract
   * struck is the bound, and the long run may not exceed the week's own
   * longest by more than the distributor's cap. Passed as the plan's authored
   * longest so a raise cannot invent a long run the block never intended. */
  const longUpperMi = Math.max(...rows.map((r) => r.distanceMi ?? 0));

  const spread = distributeWeeklyBump(
    rows.filter((r) => r.distanceMi != null)
      .map((r) => ({ id: r.planWorkoutId, type: r.type, distanceMi: r.distanceMi as number })),
    { budgetMi: target.deltaMi, longUpperMi: longUpperMi + 1 },
  );
  if (spread.bumps.length === 0) {
    return {
      kind: 'NOTHING_TO_PROPOSE',
      because: `The week beginning ${target.weekStartISO} would take `
        + `${roundTo(target.deltaMi)} more miles, and none of its sessions is one this lane may grow. `
        + 'A raise lands on the long run and on easy days, never on a quality session.',
      detail: detail({ landedWeekISO: target.weekStartISO }),
    };
  }

  const bumps = spread.bumps.map((b) => ({
    workoutId: b.workoutId, fromMi: b.oldDistanceMi, toMi: b.newDistanceMi,
  }));
  const landed = detail({
    landedWeekISO: target.weekStartISO,
    weekBeforeMi: target.beforeMi,
    weekAfterMi: target.afterMi,
    bumps,
  });

  const action: AdaptationAction = {
    kind: 'mark_upgrade',
    workoutIds: spread.bumps.map((b) => b.workoutId),
    bumps: spread.bumps.map((b) => ({ workoutId: b.workoutId, newDistanceMi: b.newDistanceMi })),
    why: response.explanation,
    sourceTrigger: VOLUME_EVIDENCE_TRIGGER,
  };
  const trigger: AdaptationTrigger = {
    kind: VOLUME_EVIDENCE_TRIGGER,
    /* `info`, not `warn`. An offer of more work is not a warning, and the
     * ramp lane made the same call for the same reason. */
    severity: 'info',
    reason: response.explanation,
    /* RULE 21's OBSERVABILITY CLAUSE, on the surface that survives a rebuild.
     * "A log that records that something happened but not what is not a log."
     * Everything a later reader needs to reconstruct WHY this offer was made,
     * in which DIRECTION, and on WHAT EVIDENCE. */
    evidence: {
      lane: 'volume_evidence',
      direction: 'MORE',
      evidence_week: reading.weekStartISO,
      admitted_surplus_mi: admission.mi,
      progression_fraction: roundTo(recompute.accumulation.progressionFraction * 1000) / 1000,
      confirmed_units: recompute.accumulation.totalUnits,
      recorded_units: recompute.accumulation.recordedUnits,
      provisional_units: recompute.accumulation.provisionalUnits,
      unreadable_weeks: recompute.accumulation.unreadableWeeks,
      week_raised: target.weekStartISO,
      week_before_mi: target.beforeMi,
      week_after_mi: target.afterMi,
      weekly_bump_mi: roundTo(spread.weeklyBumpMi),
      long_bump_mi: roundTo(spread.longBumpMi),
      demonstrated_peak_before_mi: beliefBefore.peakWeeklyMi,
      demonstrated_peak_after_mi: recompute.belief.peakWeeklyMi,
      fatigue_excess_mi: fatigueExcessMi,
      deferred_raises: response.deferredRaises.length,
    },
  };

  return { kind: 'PROPOSED', detail: landed, action, trigger };
}

/**
 * The cron entry point. Same posture as `proposeAdaptiveBump`: it returns the
 * number of cards and never throws into the surrounding pass.
 *
 * Rule 11 · a swallowed error here would be indistinguishable from a runner
 * with no evidence, so the outcome is LOGGED with its own name before the
 * count is returned. `run-adaptations` reads the count; the log is what makes
 * "why did nothing happen" answerable without a replay.
 */
export async function runVolumeEvidenceLane(userUuid: string): Promise<number> {
  let outcome: VolumeProposalOutcome;
  try {
    outcome = await proposeVolumeEvidenceRaise(userUuid);
  } catch (e) {
    console.error('[volume-evidence] the lane threw:', e instanceof Error ? e.message : e);
    return 0;
  }
  switch (outcome.kind) {
    case 'PROPOSED':
      return outcome.cards;
    case 'NOTHING_TO_PROPOSE':
      console.log(`[volume-evidence] evidence stands and no week moves · ${outcome.because}`);
      return 0;
    case 'NO_ADMITTED_EVIDENCE':
      console.log(`[volume-evidence] ${outcome.because}`);
      return 0;
    case 'REFUSED':
      console.log(`[volume-evidence] REFUSED · ${outcome.because}`);
      return 0;
  }
}

/** Kept beside the lane so a probe and the cron read the same shape (Rule 16). */
export type { VolumeEvidenceWindow, FutureRow };
