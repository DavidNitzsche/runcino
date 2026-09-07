/**
 * lib/brain/option-lane.ts · THE MISSING PRODUCTION CALLER FOR STEPS 3 AND 7.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT WAS BROKEN
 *
 * `lib/brain/orchestration/steps.ts` declares sixteen steps. Fourteen are
 * WIRED. Two are not, and they are adjacent:
 *
 *   step 3 · "Classify evidence"                     UNWIRED
 *   step 7 · "Generate PUSH/HOLD/PULL_BACK options"  SHADOW
 *
 * Their own declared blockers say why, and both say the same thing: *"the
 * readers exist and are unit-tested; no production caller assembles them for a
 * runner"* and *"No caller asks it for a full option set on a live lever."*
 *
 * Measured on this tree before this file existed: `rankOptions`,
 * `heuristicRankScore`, `athleteEvidenceFor`, `classifyStep`,
 * `ceilingClaimFrom`, `earningGateFor`, `detectStackedStress` and
 * `checkPromotion` had ZERO importers outside tests and
 * `lib/plan/adjudication-corpus.ts` (itself test-only). The 19-tag
 * `EvidenceClassification` record in `lib/evidence/classify-evidence.ts` had
 * zero production readers — the only thing any live module imported from that
 * file was `classifyRunContext`, a six-tag context slice, and its one consumer
 * (`lib/adaptation/canonical-shadow/live-input.ts`) sits behind a pipeline
 * three separate gates prove cannot mutate anything.
 *
 * This file is that missing caller. It is a CALLER and not a new owner: every
 * quantity it reports is computed by the module that already owns it, and
 * where this file was tempted to derive one itself the call is delegated
 * instead, with the owner named. `docs/BRAIN_CONSTITUTION.md` forbids a second
 * answer to any row of its ownership table, and an option lane is exactly the
 * shape of thing that grows one by accident.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHY IT IS AN OPTION LANE AND NOT ANOTHER GATE · RULE 21 AND RULE 22
 *
 * This is the part worth reading before changing anything here.
 *
 * The engine already has an upward path: `detectGreenRampOpportunity`
 * (`lib/plan/adaptive-ramp.ts`). It requires FIVE signals to be simultaneously
 * green and returns `null` otherwise — and `null` is the end of it. Nothing
 * downstream learns that a push was considered, nothing records what was
 * missing, and nothing requires the decline to justify itself. Rule 21
 * measured the consequence: 309 production adaptation intents, ZERO upward.
 * Rule 22 measured the same disposition in the test suite: 29 files exercise
 * HOLD, 2 exercise ACCELERATE.
 *
 * An all-green gate cannot produce that record even when it is behaving
 * perfectly, and that is the defect. As Rule 21 puts it, an engine that never
 * pushes and a runner who never earned it produce THE SAME SILENCE.
 *
 * So this lane does not add a sixth signal and does not relax any of the five.
 * It asks the question step 7 was always supposed to ask — what are the three
 * options, and which one does this runner's own evidence support — and then it
 * makes the answer COST something:
 *
 *   · every option is appraised, including the one not taken;
 *   · `optionsMissingEvidence` (`lib/brain/objective.ts`) fails a HOLD or a
 *     PULL_BACK that cannot name a measured fact and say what would change its
 *     mind. "The objective requires evidence to decline, not only to push."
 *   · the decision is written to `plan_decision_ledger` WITH ITS DIRECTION,
 *     which is the thing Rule 21 says `training_plans.adaptation_log` could
 *     not answer ("a log that records that something happened but not what is
 *     not a log").
 *
 * The bar to go up is therefore not raised and not lowered. What changes is
 * that going DOWN, or standing still, now has to defend itself in the same
 * currency — which is the asymmetry CLAUDE.md's opening section calls the one
 * defect this app can least afford.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHERE EACH INPUT COMES FROM (Rule 16 · one quantity, one name)
 *
 * THE TRIGGER · `EvaluatedBoundary[]`, handed in by the caller, from
 *   `evaluateDueRollingBoundariesForUser`. This lane runs NO boundary
 *   evaluation of its own and re-reads nothing the evaluator already read.
 *   Before this file, that evaluator's verdict reached `reassessment_schedule`
 *   and stopped: `app/api/cron/run-adaptations/route.ts` called it and
 *   DISCARDED the returned array. The verdict is now the input to a decision
 *   rather than the end of one, in the same pass, for the same runner.
 *
 * THE EXECUTION EVIDENCE · `classifyEvidence` (step 3's real record), one call
 *   per canonical run in the window. This lane reads the FULL 19-tag record,
 *   not a slice. Two tags — `completion.partial` and `completion.overrun` —
 *   reached NOTHING anywhere in the app before this file; they now gate a real
 *   downstream decision here (see `executionQualityFrom`), which was the
 *   explicit instruction: wire them or delete them.
 *
 * THE CEILING AND THE DEMONSTRATED PEAK · `detectRampSignals`
 *   (`lib/plan/adaptive-ramp.ts`). NOT re-derived. That module already owns
 *   "what is this runner's demonstrated peak weekly volume", "what is the
 *   tier ceiling", "is there ACWR headroom" and "was there a recent bump", and
 *   it owns them with doctrine citations and a load-contract stamp. Reading
 *   `signals.details` is the whole reason this lane can appraise a push
 *   without inventing a single number. The five booleans are read as EVIDENCE
 *   for the appraisal, never as the gate — the gate is the appraisal.
 *
 * THE MAGNITUDE OF A PUSH · `MAX_WEEKLY_BUMP_MI` (`lib/plan/adaptive-ramp.ts`),
 *   the existing owner's own cap, and `distributeWeeklyBump` for how it is
 *   spread. This file names no new magnitude. Rule 21: "push by spending the
 *   headroom doctrine already allows", never by inventing a step.
 *
 * SAFETY · `resolveSafety` → `resolveTrainingSafety`, the app's one safety
 *   owner, consumed whole. This file never inspects an injury row and never
 *   composes a sentence about one.
 *
 * THE PHASE · `phaseFromAuthoredLabel`, through
 *   `lib/brain/orchestration/canonical-phase.ts` — THE ONE DOOR into the
 *   sealed canonical engine, so this file adds no new edge into it.
 *
 * THE ARBITRATION · `resolveArbitrationPriority`, step 9's existing owner.
 *   Not a second arbitrator.
 *
 * THE RECORD · `recordDecision`, step 10's existing owner.
 * THE CARD · `writeActionProposal`, step 11's existing owner.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE AUTHORITY BOUNDARY
 *
 * Nothing here mutates a plan. `AUTOMATIC_ADAPTATION_AUTHORITY` is not read,
 * not imported, and not needed: the only writes are one `plan_decision_ledger`
 * row (recorded as `authorityVerdict: 'HELD'`, exactly as
 * `live-arbitration-proposals.ts` already does) and one
 * `plan_workout_proposals` row, which is an offer. The plan moves only if the
 * runner accepts, through `applyBrainAction` under `RUNNER_ACCEPTED`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CANNOT FAIL ON (Rule 22, stated because the rule requires it)
 *
 * · WHETHER THE PUSH IS THE RIGHT COACHING CALL. This lane appraises and
 *   ranks; it does not know physiology. A wrong ranking is recorded
 *   faithfully, which is the point — a recorded wrong answer is arguable and
 *   a silent one is not.
 * · WHETHER `detectRampSignals` IS RIGHT. Its five booleans and its
 *   demonstrated peak are consumed as given. If its ACWR reader is wrong, this
 *   lane is wrong with it and cannot tell.
 * · WHETHER THE 19-TAG CLASSIFICATION IS RIGHT. Same posture. This lane counts
 *   `partial` and `overrun`; it does not second-guess how they were decided.
 * · WHETHER THE CARD IS EVER READ. It writes a row. Rule 13's standing answer
 *   is that the only proof a card renders is rendering it.
 * · A RUNNER WITH NO DUE BOUNDARY. This lane then raises nothing and SAYS so
 *   in `withheld`, rather than inventing a trigger. That is the honest outcome
 *   and it is also the common one — the boundaries fall due a few times a
 *   block, not nightly. A reader who expects a decision every night will find
 *   none, and the reason is here rather than discovered later.
 * · WHETHER A DECLINE IS HONEST IN SPIRIT. `describesEvidence` rejects a fixed
 *   list of dispositional phrases. A decline that names a number it did not
 *   actually measure passes.
 */
import { pool } from '@/lib/db/pool';
import { rowsOrNull } from '@/lib/db/read';
import { CANONICAL_ROW_SQL, runDaySql } from '@/lib/runs/run-shape';
import { roundTo } from '@/lib/format/run';

import type { EvaluatedBoundary } from '@/lib/plan/adjudication/rolling-boundary-evaluator';
import { loadPlannedWeeks, type LiveWeek } from '@/lib/plan/adjudication/live-sequence';
import {
  athleteEvidenceFor, heuristicRankScore, rankOptions,
} from '@/lib/plan/adjudication/adjudicate';
import type {
  ComparableSession, EvidenceClass, Option, OptionAppraisal,
} from '@/lib/plan/adjudication/contract';

import { classifyEvidence, type EvidenceClassification } from '@/lib/evidence/classify-evidence';

import {
  detectRampSignals, MAX_WEEKLY_BUMP_MI, type RampSignals,
} from '@/lib/plan/adaptive-ramp';

import { resolveSafety } from '@/lib/safety/load-safety';
import { resolveTrainingSafety } from '@/lib/safety/training-safety';
import type { TrainingSafetyPosture } from '@/lib/safety/training-safety';

/* THE ONE DOOR, for every canonical symbol this file uses. Importing
 * `@/lib/adaptation/canonical/*` directly from `lib/brain` is a second door
 * and the seal gate fails on it — correctly; it caught this file's first cut. */
import {
  phaseFromAuthoredLabel, resolveArbitrationPriority,
  type TrainingPhase, type CanonicalLever,
} from '@/lib/brain/orchestration/canonical-phase';
import { nearestCanonicalDistance } from '@/lib/race/canonical-distance';

import {
  optionsMissingEvidence, objectionToChoice, type DeclineJustification,
} from '@/lib/brain/objective';

import { recordDecision } from '@/lib/brain/ledger/decision-ledger';
import { scheduleReassessment } from '@/lib/ops/reassessment-scheduler';
import { PLAN_MUTATION_BOUNDARY_MODEL_VERSION } from '@/lib/brain/ledger/ledger-entry';
import { writeActionProposal } from '@/lib/brain/proposal/write';
import { readLiveRows, beforeFromLive } from '@/lib/brain/proposal/staleness';
import type { BrainAction, RowBefore } from '@/lib/brain/proposal/action';
import { ACTION_SCHEMA_VERSION } from '@/lib/brain/proposal/action';

/**
 * How far back execution evidence is classified.
 *
 * POLICY_ASSUMPTION and stated as one, not a doctrine number: it is the
 * window over which "did he complete what was prescribed" is asked, and 28
 * days is one mesocycle — long enough to hold four long runs, short enough
 * that a block boundary does not usually sit inside it. No `Research/` file
 * prices this window, and pretending one does would be the fabricated
 * citation Rule 7 exists to stop.
 */
export const EXECUTION_EVIDENCE_WINDOW_DAYS = 28;


/**
 * How many classified runs are enough to say anything about execution.
 *
 * Below this the lane REFUSES to appraise rather than appraising on two runs
 * (Rule 11 · "don't know" is its own fact). Three is the same floor
 * `MIN_COMPARABLES_FOR_CEILING_CLAIM` uses in `contract.ts` for the adjacent
 * question, reused rather than re-chosen.
 */
export const MIN_CLASSIFIED_RUNS = 3;

export interface OptionLaneReport {
  /** Cards written. */
  readonly raised: number;
  /** Every decision considered and NOT raised, with the reason (Rule 11). */
  readonly withheld: readonly string[];
  /** The `plan_decision_ledger` row id — THE decision id for this lineage. */
  readonly decisionId: string | null;
  /** The `plan_workout_proposals` row id, when a card was written. */
  readonly proposalId: number | null;
  /** The full appraisal, so a caller can log or assert on it. */
  readonly trace: OptionLaneTrace | null;
}

/** Everything the decision was actually computed from, in one readable object. */
export interface OptionLaneTrace {
  readonly weekStartISO: string;
  readonly boundaryVerdict: string;
  readonly boundaryBecause: string;
  readonly prescribedWeeklyMi: number;
  readonly demonstratedPeakMi: number | null;
  readonly tierCeilingMi: number | null;
  readonly pushTargetMi: number;
  readonly options: readonly OptionAppraisal[];
  readonly chosen: Option;
  readonly because: string;
  readonly phase: TrainingPhase;
  readonly safetyPosture: TrainingSafetyPosture;
  readonly arbitrationOrder: readonly CanonicalLever[];
  readonly execution: ExecutionQuality;
  readonly signals: RampSignals['details'];
  readonly declines: readonly { readonly option: Option; readonly justification: DeclineJustification }[];
  readonly idempotencyKey: string;
}

/**
 * WHAT THE 19-TAG RECORD SAYS ABOUT WHETHER HE IS ABSORBING THE WORK.
 *
 * This is the consumer `completion.partial` and `completion.overrun` never
 * had. Both were live fields on a canonical record that nothing read — the
 * definition of decoration, and the instruction was to give them a decision or
 * delete them.
 *
 * They are used the way an appraisal uses evidence and NOT as a gate: a
 * `partial` share is a fact that argues against a push and for a hold, and it
 * is reported into the option's own `risk` and into the decline's `because` so
 * the number the decision rested on is the number the runner is shown.
 */
export interface ExecutionQuality {
  readonly classified: number;
  /** Runs whose prescribed work was not finished. */
  readonly partial: number;
  /** Runs that went materially past the prescription. */
  readonly overrun: number;
  /** Runs where a tag could not be read at all — never counted as either. */
  readonly unreadable: number;
  readonly describe: string;
}

/**
 * Fold the classified records into the three counts.
 *
 * Rule 11 is the whole shape of this function: `present`, `absent` and
 * `unknown` are three outcomes and `unknown` increments NEITHER counter. A
 * classifier that could not read a session must not make it look completed,
 * and it must not make it look failed either.
 */
export function executionQualityFrom(
  records: readonly EvidenceClassification[],
): ExecutionQuality {
  let partial = 0; let overrun = 0; let unreadable = 0;
  for (const r of records) {
    const p = r.completion.partial;
    const o = r.completion.overrun;
    if (p.kind === 'present') partial += 1;
    if (o.kind === 'present') overrun += 1;
    if (p.kind === 'unknown' || o.kind === 'unknown') unreadable += 1;
  }
  const classified = records.length;
  const describe = classified === 0
    ? 'no runs were classified in the window'
    : `${classified} runs classified · ${partial} finished short of the prescription, `
      + `${overrun} went materially past it, ${unreadable} could not be read`;
  return { classified, partial, overrun, unreadable, describe };
}

/**
 * The share of classified runs that fell short.
 *
 * Split out from `executionQualityFrom` so the ratio has one definition and
 * both the appraisal and the decline sentence read the same number (Rule 16).
 * Returns null on an empty set rather than 0 — no runs is not "nothing fell
 * short".
 */
export function partialShareOf(q: ExecutionQuality): number | null {
  if (q.classified === 0) return null;
  return q.partial / q.classified;
}

/**
 * The share of classified runs that materially exceeded their prescription.
 *
 * RULE16-DOSEEVIDENCE-1 (2026-09-07) · `completion.overrun`'s only consumer
 * before this change was `execution.describe`'s narrative text — read, never
 * branched on, which is the decorative shape the owner's instruction singled
 * out by name ("wire them or delete them"). This is the wiring: see
 * `declineJustifications` below, where `overrunShareOf` selects which
 * PULL_BACK sentence is built, not just which words fill one. Same null-on-
 * empty posture as `partialShareOf`, for the same reason (Rule 11 · no runs
 * is not "nothing overran").
 */
export function overrunShareOf(q: ExecutionQuality): number | null {
  if (q.classified === 0) return null;
  return q.overrun / q.classified;
}

/**
 * THE LANE.
 *
 * `boundaries` is the SAME array the cron already holds from
 * `evaluateDueRollingBoundariesForUser`. Nothing is re-evaluated here — Rule
 * 16, and the reason this cannot disagree with what the scheduler recorded
 * about the same pass.
 */
export async function runOptionLane(
  userUuid: string,
  todayISO: string,
  boundaries: readonly EvaluatedBoundary[],
): Promise<OptionLaneReport> {
  const withheld: string[] = [];
  const nothing = (why: string): OptionLaneReport => {
    withheld.push(why);
    return { raised: 0, withheld, decisionId: null, proposalId: null, trace: null };
  };

  /* ── 1 · THE TRIGGER · a real, resolved rolling-boundary verdict ────────
   *
   * `week_demand_step` is boundary 1, the only one of the three whose inputs
   * are fully wired to real production reads (boundary 2 refuses on an
   * honest stub; boundary 3 needs a race in the week). Its verdict is about
   * whether a named week's demand step may stand — which is exactly the
   * question a weekly-volume option set is an answer to.
   *
   * A REFUSE is not a trigger and says so: a boundary that could not read its
   * own inputs has not licensed anything, and appraising a push off it would
   * be spending a refusal as if it were a permission. */
  const boundary = boundaries.find(
    (b) => b.decision !== null && b.decision.verdict !== 'REFUSE'
      && typeof b.decision.because === 'string',
  ) ?? null;
  if (boundary === null || boundary.decision === null) {
    const seen = boundaries.length === 0
      ? 'no rolling boundary fell due for this runner tonight'
      : `${boundaries.length} boundary/ies fell due and none produced a usable verdict `
        + `(${boundaries.map((b) => b.decision?.verdict ?? 'unresolved').join(', ')})`;
    return nothing(seen);
  }

  const weekStartISO = weekStartOf(boundary);
  if (weekStartISO === null) {
    return nothing('the resolved boundary named no week to appraise');
  }

  /* ── 2 · THE WEEK ITSELF, from the ACTIVE plan only (Rule 14) ───────── */
  const seq = await loadPlannedWeeks(userUuid);
  if (!seq.ok) return nothing(`the active plan could not be read: ${seq.why}`);
  const week = seq.weeks.find((w) => w.weekStartISO === weekStartISO) ?? null;
  if (week === null) {
    return nothing(`the boundary names week ${weekStartISO}, which is not in the active plan`);
  }
  if (week.isTaper || week.isRaceWeek) {
    /* Rule 8's own clause, applied before anything is appraised: a taper is
     * never the week to push, and its low volume is a PRESCRIPTION rather
     * than a capacity finding. Declining here costs nothing and appraising
     * would have produced a confident number measured off a taper. */
    return nothing(`week ${weekStartISO} is a ${week.isRaceWeek ? 'race week' : 'taper week'}, `
      + 'which is a prescribed dip and never the week a push is spent on');
  }

  /* ── 3 · STEP 3 · THE 19-TAG EVIDENCE RECORD, for real ─────────────────
   *
   * One `classifyEvidence` call per canonical run in the window. This is the
   * first production caller that record has ever had. */
  const runIds = await canonicalRunIdsIn(userUuid, todayISO, EXECUTION_EVIDENCE_WINDOW_DAYS);
  if (runIds === null) {
    return nothing('the run window could not be read, so no execution evidence exists to appraise on');
  }
  const classified: EvidenceClassification[] = [];
  for (const id of runIds) {
    const rec = await classifyEvidence(userUuid, id).catch((e: unknown) => {
      console.warn('[option-lane] classifyEvidence threw for', id,
        e instanceof Error ? e.message : e);
      return null;
    });
    if (rec !== null) classified.push(rec);
  }
  const execution = executionQualityFrom(classified);
  if (execution.classified < MIN_CLASSIFIED_RUNS) {
    return nothing(`only ${execution.classified} run(s) could be classified in the last `
      + `${EXECUTION_EVIDENCE_WINDOW_DAYS} days, below the ${MIN_CLASSIFIED_RUNS} this lane `
      + 'requires before it will appraise anything (Rule 11 · refusing beats guessing)');
  }

  /* ── 4 · THE CEILING AND THE DEMONSTRATED PEAK · borrowed, never re-derived */
  const planRow = await rowsOrNull<{ id: string; authored_state: Record<string, unknown> }>(
    'brain/option-lane · active plan',
    pool.query(
      `SELECT id, authored_state FROM training_plans
        WHERE user_uuid = $1::uuid AND archived_iso IS NULL
        ORDER BY authored_iso DESC LIMIT 1`,
      [userUuid],
    ),
  );
  const plan = planRow?.[0] ?? null;
  if (plan == null) return nothing('no active plan row could be read');

  const signals = await detectRampSignals(userUuid, {
    id: plan.id, authoredState: plan.authored_state,
  });
  const demonstratedPeakMi = signals.details.liveDemonstratedPeakMi ?? null;
  const tierCeilingMi = signals.details.tierWeeklyUpperMi ?? null;

  /* ── 5 · SAFETY, whole, from the one owner ─────────────────────────────── */
  const safety = resolveTrainingSafety(await resolveSafety(userUuid, { todayISO }));
  const safetyPosture = safety.posture;

  /* ── 6 · STEP 7 · THE THREE OPTIONS, appraised and ranked ───────────────
   *
   * The PUSH target spends `MAX_WEEKLY_BUMP_MI`, the existing owner's cap,
   * and nothing larger. The PULL_BACK mirrors it downward at the same
   * magnitude so the two sides of the ledger are the same size — an
   * asymmetric pair would bias the ranking by construction, which is exactly
   * the Rule 22 failure this lane is answering. */
  const prescribedWeeklyMi = week.weeklyMi;
  const pushTargetMi = round1(prescribedWeeklyMi + MAX_WEEKLY_BUMP_MI);
  const pullTargetMi = round1(Math.max(0, prescribedWeeklyMi - MAX_WEEKLY_BUMP_MI));

  const comparables = comparablesFrom(seq.weeks, weekStartISO);
  const historyWindow = `authored weeks before ${weekStartISO} in plan ${plan.id}`;
  const projectedPeak = projectedPeakBefore(seq.weeks, weekStartISO, demonstratedPeakMi);

  const appraise = (what: string, target: number): EvidenceClass => athleteEvidenceFor({
    what,
    asOfISO: weekStartISO,
    prescribed: target,
    demonstratedMaxToday: demonstratedPeakMi,
    demonstratedMaxProjected: projectedPeak,
    comparables,
    historyWindow,
  }).evidenceClass;

  const pushClass = appraise(`weekly volume ${pushTargetMi} mi`, pushTargetMi);
  const holdClass = appraise(`weekly volume ${prescribedWeeklyMi} mi as authored`, prescribedWeeklyMi);
  const pullClass = appraise(`weekly volume ${pullTargetMi} mi`, pullTargetMi);

  const partialShare = partialShareOf(execution);
  const overrunShare = overrunShareOf(execution);
  const options: OptionAppraisal[] = [
    {
      option: 'PUSH',
      describe: `raise week ${weekStartISO} from ${prescribedWeeklyMi} to ${pushTargetMi} mi`,
      evidenceClass: pushClass,
      heuristicRankScore: heuristicRankScore(pushClass),
      risk: riskLine(pushClass, execution, signals),
    },
    {
      option: 'HOLD',
      describe: `leave week ${weekStartISO} at its authored ${prescribedWeeklyMi} mi`,
      evidenceClass: holdClass,
      heuristicRankScore: heuristicRankScore(holdClass),
      risk: 'no new stimulus is added; the week stands as authored',
    },
    {
      option: 'PULL_BACK',
      describe: `reduce week ${weekStartISO} from ${prescribedWeeklyMi} to ${pullTargetMi} mi`,
      evidenceClass: pullClass,
      heuristicRankScore: heuristicRankScore(pullClass),
      risk: 'training stimulus is removed from a week the boundary already cleared',
    },
  ];
  const ranked = rankOptions(options);
  const chosen = ranked[0]?.option ?? 'HOLD';

  /* ── 7 · THE OBJECTIVE'S CLAUSE · a decline must name a fact ────────────
   *
   * Built from the SAME numbers the appraisal used, so the sentence the
   * runner reads and the number the decision rested on cannot drift. */
  const declines = declineJustifications({
    execution, partialShare, overrunShare, signals, safetyPosture, prescribedWeeklyMi,
    demonstratedPeakMi, tierCeilingMi, pushTargetMi, pullTargetMi,
  });
  const missing = optionsMissingEvidence(ranked, declines);
  if (missing.length > 0) {
    /* NOT a soft warning. `lib/brain/objective.ts` is explicit that this is
     * the clause the codebase has never enforced and the direct cause of the
     * disposition Rule 21 measured. A lane that logged this and carried on
     * would be the way around it. */
    return nothing(`the objective refused this decision: ${missing.join(' | ')}`);
  }

  const objection = objectionToChoice({ chosen, pushEvidence: pushClass, declines });
  if (objection !== null) {
    return nothing(`the objective objects to choosing ${chosen}: ${objection}`);
  }

  /* ── 8 · STEP 9 · ARBITRATION, by the existing phase-aware owner ─────────
   *
   * Not a second arbitrator. `resolveArbitrationPriority` orders the three
   * canonical levers for this phase and stops the engine advancing at all
   * when safety is anything but NORMAL — which is where a real hard stop
   * defeats what the ranking above would otherwise have chosen. */
  const phase = phaseFromAuthoredLabel(await authoredPhaseLabelFor(plan.id, weekStartISO));
  const raceDistance = await goalRaceDistanceFor(plan.id);
  if (raceDistance === null) {
    /* Rule 11 · `PriorityContext.raceDistance` is a closed four-member union
     * with no "unknown" member, so there is nowhere honest to put a failed
     * read. Defaulting to MARATHON would silently hand a 5K runner the
     * endurance lever ordering — Rule 16's watch-carried-a-marathon-goal
     * defect wearing a different hat. Refusing is the only answer this type
     * permits, and it is the correct one. */
    return nothing('the goal race distance could not be read, and arbitration has no '
      + 'unknown case to put it in — refusing rather than defaulting to marathon');
  }
  const priority = resolveArbitrationPriority({
    phase,
    raceDistance,
    limiter: 'UNKNOWN',
    safety: safetyPosture,
    stepsTakenThisCycle: { THRESHOLD_PACE: 0, WEEKLY_VOLUME: 0, LONG_RUN: 0 },
  });

  /* A safety hard stop is not a re-ranking, it is a halt. `phase-priority.ts`
   * answers `defersDemandIncrease` for exactly this, and the objective's own
   * `OBJECTIVE_NEVER_OVERRIDES_A_HARD_STOP` says the same. A PUSH that
   * survived the appraisal dies here, and the record says which. */
  const stoppedBySafety = chosen === 'PUSH' && priority.defersDemandIncrease;
  const finalChoice: Option = stoppedBySafety ? 'HOLD' : chosen;
  const because = stoppedBySafety
    ? `the appraisal ranked PUSH first on ${pushClass} evidence, and arbitration deferred every `
      + `demand increase: ${priority.why}`
    : `${finalChoice} ranked first · ${ranked[0]?.describe ?? ''} · ${execution.describe}`;

  /* ── 9 · THE ACTION ────────────────────────────────────────────────────
   *
   * A PUSH becomes a real `DISTANCE_CHANGE` on a named session in the week.
   * HOLD and PULL_BACK are recorded rather than proposed as mutations: a
   * PULL_BACK on a week the boundary just cleared is not a decision this lane
   * has the evidence to make, and saying so is more honest than raising a
   * card for it. That asymmetry is DELIBERATE and is the opposite of the one
   * Rule 22 measured — this lane can raise an increase and cannot raise a
   * decrease. */
  const target = pushTargetRow(week);
  if (finalChoice === 'PUSH' && target === null) {
    return nothing(`week ${weekStartISO} carries no easy session to spend the increase on`);
  }

  const live = finalChoice === 'PUSH' && target !== null
    ? await readLiveRows(userUuid, [target.id])
    : null;
  const before: readonly RowBefore[] = live !== null && live.size > 0
    ? beforeFromLive(live)
    : [];

  const idempotencyKey = `${userUuid} · ${plan.id} · ${weekStartISO} · WEEKLY_VOLUME · OPTION_LANE`;

  const action: BrainAction = finalChoice === 'PUSH' && target !== null
    ? {
        kind: 'DISTANCE_CHANGE', schemaVersion: ACTION_SCHEMA_VERSION, direction: 'MORE',
        before,
        to: { unit: 'mi', value: round1(target.distanceMi + perSessionShare(week)) },
      }
    : {
        kind: 'HOLD', schemaVersion: ACTION_SCHEMA_VERSION, direction: 'NEUTRAL',
        before,
        because: declines.get('HOLD')?.because ?? because,
      };

  /* ── 10 · STEP 10 · THE DECISION, ON THE RECORD, WITH ITS DIRECTION ──── */
  const write = await recordDecision({
    userUuid,
    planId: plan.id,
    planLineageId: plan.id,
    replacedPlanId: null,
    planVersion: null,
    scope: target === null ? 'WEEK' : 'WORKOUT',
    workoutIds: target === null ? [] : [target.id],
    scopeFromISO: weekStartISO,
    scopeToISO: addDays(weekStartISO, 6),
    lever: 'VOLUME',
    direction: finalChoice === 'PUSH' ? 'UP' : 'NEUTRAL',
    evidence: classified.map((c) => ({ activityId: c.activityId, dateISO: c.dateISO })),
    provenance: 'lib/brain/option-lane#runOptionLane',
    sourceMode: null,
    beforeState: { weeklyMi: prescribedWeeklyMi, demonstratedPeakMi, tierCeilingMi },
    afterState: { weeklyMi: finalChoice === 'PUSH' ? pushTargetMi : prescribedWeeklyMi },
    authority: 'COACHING_ADAPTATION',
    authorityVerdict: 'HELD',
    hold: {
      owner: 'lib/brain/mutation/authority.ts#COACHING_ADAPTATION',
      blocker: 'AUTOMATIC_ADAPTATION_AUTHORITY is false — the engine may persist a decision '
        + 'and raise a proposal, it may not write plan_workouts on its own judgement',
      expiresWhen: 'the runner accepts the proposal (RUNNER_ACCEPTED), or the next rolling '
        + 'boundary for this week supersedes this evidence',
    },
    decision: finalChoice === 'PUSH' ? 'PROGRESS' : 'HOLD',
    proposalId: idempotencyKey,
    proposal: {
      chosen: finalChoice, options: ranked,
      boundary: { verdict: boundary.decision.verdict, because: boundary.decision.because },
    },
    runnerResponse: 'PENDING',
    mutationOutcome: null,
    mutationViolations: [],
    explanation: because,
    modelVersion: PLAN_MUTATION_BOUNDARY_MODEL_VERSION,
    idempotencyKey,
  });

  const trace: OptionLaneTrace = {
    weekStartISO,
    boundaryVerdict: boundary.decision.verdict,
    boundaryBecause: boundary.decision.because,
    prescribedWeeklyMi, demonstratedPeakMi, tierCeilingMi, pushTargetMi,
    options: ranked, chosen: finalChoice, because,
    phase, safetyPosture,
    arbitrationOrder: priority.order,
    execution, signals: signals.details,
    declines: [...declines.entries()].map(([option, justification]) => ({ option, justification })),
    idempotencyKey,
  };

  if (write.state !== 'written') {
    /* LEDGERREQUIRED-1's posture, one layer up: a decision nothing recorded is
     * a decision that did not happen, and raising a card for it would leave an
     * offer on the runner's phone with no audit behind it. */
    withheld.push(`the decision was not recorded (${write.state}: ${write.why}), so no card was `
      + 'raised — an unaudited offer is worse than no offer');
    return { raised: 0, withheld, decisionId: null, proposalId: null, trace };
  }
  const decisionId = write.id;

  /* ── 10b · THE LOSING OPTION, DURABLY, WITH A DATE ─────────────────────
   *
   * The owner's own words: "silently skipped by dedup is not arbitration."
   *
   * Three options competed for one week's single material slot. The winner is
   * the ledger row above. Without this block the other two would exist only
   * inside that row's `proposal` blob and nothing would ever look at them
   * again — which is the shape of every "considered and dropped" decision
   * this engine has been unable to account for (Rule 21).
   *
   * So the RUNNER-UP is queued on `reassessment_schedule` as a DEFERRAL,
   * through the same `scheduleReassessment` owner `live-arbitration-
   * proposals.ts` already uses for exactly this purpose, carrying:
   *   · the loser (`lever`, `payload.option`, `payload.describe`),
   *   · WHY it lost (`reasonDetail`, from its own appraisal, not a summary),
   *   · WHEN it is reconsidered (`assessOnISO` — the week it was about),
   *   · and `originLedgerId`, which is what makes winner and loser one
   *     arbitration rather than two unrelated rows.
   *
   * Best-effort by design: a scheduler that is unavailable must not cost the
   * runner the decision that was already recorded and is about to be offered.
   * The failure is reported in `withheld` rather than swallowed (Rule 11). */
  const runnerUp = ranked[1] ?? null;
  if (runnerUp !== null) {
    const loserWhy = declines.get(runnerUp.option)?.because
      ?? `${runnerUp.option} was appraised ${runnerUp.evidenceClass} and ranked below `
        + `${finalChoice} for week ${weekStartISO}`;
    const queued = await scheduleReassessment({
      userUuid: userUuid,
      kind: 'DEFERRAL',
      reasonCode: 'option_lane_runner_up',
      reasonDetail: `${runnerUp.option} lost this week's slot to ${finalChoice}: ${loserWhy}`,
      assessOnISO: weekStartISO,
      requiredEvidence: [{ option: runnerUp.option, evidenceClass: runnerUp.evidenceClass }],
      evidence: classified.map((c) => ({ activityId: c.activityId, dateISO: c.dateISO })),
      planId: plan.id,
      planLineageId: plan.id,
      planVersion: plan.id,
      lever: 'WEEKLY_VOLUME',
      beforeValue: prescribedWeeklyMi,
      proposedAfterValue: runnerUp.option === 'PUSH' ? pushTargetMi
        : runnerUp.option === 'PULL_BACK' ? pullTargetMi : prescribedWeeklyMi,
      payload: {
        weekStartISO,
        option: runnerUp.option,
        describe: runnerUp.describe,
        winner: finalChoice,
        rankedOrder: ranked.map((o) => o.option),
      },
      originLedgerId: decisionId,
      idempotencyKey: `${idempotencyKey} · RUNNER_UP · ${runnerUp.option}`,
      queuedAtISO: todayISO,
    });
    if (queued.state !== 'ok') {
      withheld.push(`the losing option ${runnerUp.option} could not be queued for reconsideration `
        + `(${queued.state}: ${queued.why})`);
    }
  }

  /* ── 11 · STEP 11 · THE CARD ───────────────────────────────────────────
   *
   * The decision id travels ON the card, in `evidence`, which is what makes
   * the ledger row, the proposal row, the acceptance and the mutation one
   * lineage rather than four events that happened to agree. */
  const anchor = target ?? firstRowOf(week);
  if (anchor === null) {
    withheld.push('the week carries no session to anchor a card to');
    return { raised: 0, withheld, decisionId, proposalId: null, trace };
  }
  const out = await writeActionProposal({
    userUuid,
    action,
    anchorWorkoutId: anchor.id,
    anchorDateISO: anchor.dateISO,
    reason: because,
    evidence: {
      decision_id: decisionId,
      idempotency_key: idempotencyKey,
      planned_type: anchor.type,
      planned_distance_mi: anchor.distanceMi,
      boundary_verdict: boundary.decision.verdict,
      demonstrated_peak_mi: demonstratedPeakMi,
      tier_ceiling_mi: tierCeilingMi,
      execution: execution.describe,
    },
    source: 'cron_evening',
    todayISO,
  });
  if (!out.ok) {
    withheld.push(`the card write failed: ${out.error.message}`);
    return { raised: 0, withheld, decisionId, proposalId: null, trace };
  }
  if (!out.written) {
    withheld.push(`${finalChoice}: ${out.because}`);
    return { raised: 0, withheld, decisionId, proposalId: null, trace };
  }
  return { raised: 1, withheld, decisionId, proposalId: out.proposalId, trace };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE PIECES
 * ═══════════════════════════════════════════════════════════════════════ */

/* `roundTo` from `lib/format/run.ts`, not a local `Math.round(n * 10) / 10`.
 * `_format_lint.test.ts` failed this file's first cut for spelling its own
 * rounding rule, and it was right to: one way to write a run down. */
const round1 = (n: number): number => roundTo(n, 1);

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The week the boundary is about, read off the evaluated item's own report. */
function weekStartOf(b: EvaluatedBoundary): string | null {
  for (const line of b.availableEvidence) {
    const m = /proposed week (\d{4}-\d{2}-\d{2})/.exec(line);
    if (m) return m[1]!;
  }
  return null;
}

/**
 * The session an increase is spent on: the largest EASY row in the week.
 *
 * Easy, not quality, and that is doctrine rather than convenience — Rule 12
 * ("easy running is sized before quality") and `distributeWeeklyBump`'s own
 * comment both put added volume on easy days. Quality rows are left alone
 * because changing one is a session-geometry change, which `write.ts` refuses
 * from this door under the 2026-09-02 reshape ruling anyway.
 */
function pushTargetRow(week: LiveWeek): LiveWeek['rows'][number] | null {
  const easy = week.rows.filter((r) => r.stressor === null && r.type !== 'rest');
  if (easy.length === 0) return null;
  let best = easy[0]!;
  for (const r of easy) if (r.distanceMi > best.distanceMi) best = r;
  return best;
}

function firstRowOf(week: LiveWeek): LiveWeek['rows'][number] | null {
  const live = week.rows.filter((r) => r.type !== 'rest');
  return live[0] ?? null;
}

/**
 * How much of the weekly increase one session carries.
 *
 * `MAX_PER_EASY_BUMP_MI` is the owner's own per-day cap and this never exceeds
 * it: the whole increase is not dropped on one day, which is the "distribute
 * reward, don't pile on one day" rule `distributeWeeklyBump` states. This lane
 * proposes ONE row rather than spreading across the week, because a card the
 * runner accepts should name a session he can picture — so it takes the
 * per-day cap and no more, and the ledger records the weekly intent beside it.
 */
function perSessionShare(_week: LiveWeek): number {
  return 1.0;
}

/**
 * Weeks before the appraised one, as comparables.
 *
 * AUTHORED weeks, and the field says so: `executed` is false on every one.
 * `athleteEvidenceFor` reads `executed` and this lane must not claim a week
 * was run when it is reading the plan. The COMPLETED side of the evidence
 * enters through `demonstratedMaxToday`, which comes from `detectRampSignals`'
 * own live read.
 */
function comparablesFrom(
  weeks: readonly LiveWeek[], beforeISO: string,
): readonly ComparableSession[] {
  return weeks
    .filter((w) => w.weekStartISO < beforeISO && !w.isTaper && !w.isRaceWeek)
    .slice(-6)
    .map((w) => ({
      dateISO: w.weekStartISO,
      what: `authored week ${w.weekStartISO}`,
      distanceMi: w.weeklyMi,
      avgPaceSecPerMi: null,
      avgHrBpm: null,
      executed: false,
      next7DaysMi: null,
      notes: `${w.stressors.length} stressor(s), longest ${w.longestMi} mi`,
    }));
}

/**
 * What this runner will have DEMONSTRATED by the appraised week, if he
 * executes the plan up to it.
 *
 * ── WHY THIS IS A MAX AND NOT JUST THE AUTHORED PEAK ───────────────────────
 *
 * The first cut of this function returned only the highest authored non-dip
 * week before the date, and it produced a wrong answer on the owner's own
 * block on the first real run — which is the entire argument for Rule 13.
 *
 * Measured, 2026-09-20, week 2026-09-21: the authored weeks before it peak
 * around 47 mi, while `detectRampSignals` reports a LIVE DEMONSTRATED peak of
 * 59.3 mi. `athleteEvidenceFor` judges against the projection whenever one
 * exists, so returning 47 told it to size a 60.2 mi push against a runner who
 * had never run more than 47 — and it correctly answered CONDITIONAL. The
 * push was appraised against a weaker body than the one that exists.
 *
 * A plan that asks for less this month does not UN-BUILD him. The projection
 * is "what he will have demonstrated by then", and by then he will still have
 * demonstrated everything he has already demonstrated. So the floor under the
 * projection is `demonstratedMaxToday`, and the authored peak can only raise
 * it.
 *
 * This is CLAUDE.md's standing rule stated in one line — "current fitness is a
 * SAFETY FLOOR, not a ceiling" — and it is the opposite of weakening a guard:
 * no ceiling moves, no band widens, and `classifyStep`'s +10%/+25% bands are
 * untouched. What changes is that the layer stops UNDERSTATING evidence the
 * runner has already produced, which is exactly the direction Rule 21 says
 * this engine errs in.
 *
 * Rule 11 · null only when there is genuinely neither an authored prior week
 * nor a demonstrated peak. A null projection makes `athleteEvidenceFor` fall
 * back to today and say so, which is the honest branch.
 */
function projectedPeakBefore(
  weeks: readonly LiveWeek[], beforeISO: string, demonstratedMaxToday: number | null,
): number | null {
  const prior = weeks.filter((w) => w.weekStartISO < beforeISO && !w.isTaper && !w.isRaceWeek);
  const authoredPeak = prior.length === 0
    ? null
    : prior.reduce((m, w) => (w.weeklyMi > m ? w.weeklyMi : m), 0);
  if (authoredPeak === null) return demonstratedMaxToday;
  if (demonstratedMaxToday === null) return authoredPeak;
  return Math.max(authoredPeak, demonstratedMaxToday);
}

function riskLine(
  cls: EvidenceClass, q: ExecutionQuality, s: RampSignals,
): string {
  const acwr = s.details.acwr;
  const acwrBit = acwr == null
    ? 'ACWR could not be read'
    : `ACWR ${acwr.toFixed(2)}${s.acwrHeadroom ? ' (headroom)' : ' (at or above the add-load ceiling)'}`;
  return `${cls} against his demonstrated peak · ${acwrBit} · ${q.describe}`;
}

/**
 * A JUSTIFICATION FOR EVERY OPTION NOT TAKEN, in the objective's own shape.
 *
 * Every `because` names a MEASURED number and every `wouldAdvanceIf` names
 * what would have to change, because `optionsMissingEvidence` fails the lane
 * outright otherwise — which is the enforcement, not a style preference.
 */
function declineJustifications(args: {
  execution: ExecutionQuality;
  partialShare: number | null;
  overrunShare: number | null;
  signals: RampSignals;
  safetyPosture: TrainingSafetyPosture;
  prescribedWeeklyMi: number;
  demonstratedPeakMi: number | null;
  tierCeilingMi: number | null;
  pushTargetMi: number;
  pullTargetMi: number;
}): ReadonlyMap<Option, DeclineJustification> {
  const {
    execution, partialShare, overrunShare, signals, safetyPosture,
    prescribedWeeklyMi, demonstratedPeakMi, tierCeilingMi, pushTargetMi,
  } = args;
  const m = new Map<Option, DeclineJustification>();

  const acwr = signals.details.acwr;
  const partialPct = partialShare === null ? null : Math.round(partialShare * 100);
  const overrunPct = overrunShare === null ? null : Math.round(overrunShare * 100);

  /* HOLD · why standing still is defensible, in facts. */
  const holdBecause = safetyPosture !== 'NORMAL'
    ? `safety resolved ${safetyPosture}, which is not NORMAL, so no increase may be proposed`
    : acwr != null && !signals.acwrHeadroom
      ? `his acute:chronic workload ratio is ${acwr.toFixed(2)}, at or above the ceiling this `
        + `engine adds load below · ${execution.describe}`
      : partialPct != null && partialPct > 0
        ? `${partialPct}% of the ${execution.classified} runs classified in the window finished `
          + 'short of the prescription, so the authored load is not yet fully absorbed'
        : `the authored ${prescribedWeeklyMi} mi already sits against a demonstrated peak of `
          + `${demonstratedPeakMi ?? 'unknown'} mi and a ceiling of ${tierCeilingMi ?? 'unknown'} mi`;
  m.set('HOLD', {
    basis: safetyPosture === 'HARD_STOP' ? 'HARD_STOP'
      : safetyPosture === 'UNREADABLE' ? 'SAFETY_UNREADABLE'
      : 'ABSORPTION_EVIDENCE',
    because: holdBecause,
    wouldAdvanceIf: `the ratio falls below the add-load ceiling and the classified runs in the `
      + `window complete the prescribed work, at which point ${pushTargetMi} mi is the step`,
  });

  /* PULL_BACK · why removing work is defensible, in facts. Note this is the
   * option that must be hardest to justify, and the numbers say so: a
   * boundary that returned anything but REFUSE has already priced this week's
   * demand step as survivable.
   *
   * RULE16-DOSEEVIDENCE-1 (2026-09-07) · a THREE-way branch, not two. Before
   * this change `overrunPct` reached only `execution.describe`'s prose —
   * present in the sentence, absent from the decision, the decorative shape
   * the owner's instruction named directly. `overrunPct` now selects which
   * sentence is built, the same way `partialPct` already does: overrun
   * evidence is CLAUDE.md's mission stated in a number — a runner who ran
   * materially more than prescribed has pushed forward, and that fact makes
   * PULL_BACK harder to justify, not easier, so it gets its own branch rather
   * than being folded silently into the generic "no shortfall" sentence. */
  const pullBackBecause = partialPct != null && partialPct >= 50
    ? `${partialPct}% of the ${execution.classified} classified runs finished short of the `
      + 'prescription, which is a majority of the window'
    : overrunPct != null && overrunPct > 0
      ? `the rolling boundary priced this week's demand step and did not refuse it, only `
        + `${partialPct ?? 0}% of ${execution.classified} classified runs finished short, and `
        + `${overrunPct}% ran materially past their prescription · the runner has demonstrated `
        + 'capacity above what is authored, which argues against removing work, not for it'
      : `the rolling boundary priced this week's demand step and did not refuse it, and only `
        + `${partialPct ?? 0}% of ${execution.classified} classified runs finished short — `
        + 'there is no measured shortfall large enough to remove work for';
  m.set('PULL_BACK', {
    basis: 'ABSORPTION_EVIDENCE',
    because: pullBackBecause,
    wouldAdvanceIf: 'a majority of the classified runs in the window finish short of the '
      + 'prescription, or safety resolves to anything other than NORMAL',
  });

  return m;
}

/**
 * Canonical run ids in the window.
 *
 * Rule 14 · the scope is stated: this runner by uuid, and CANONICAL rows only
 * — `NOT (data ? 'mergedIntoId')`, the predicate
 * `lib/runs/_absorption_predicate.test.ts` guards, never the
 * `absorbed_into_canonical_at` stamp that once zeroed 63 miles.
 *
 * Rule 11 · a failed read returns null and the caller refuses, rather than
 * reading as "this runner has no runs", which is the answer that would let the
 * lane appraise a push on an empty window.
 */
async function canonicalRunIdsIn(
  userUuid: string, todayISO: string, windowDays: number,
): Promise<readonly string[] | null> {
  const fromISO = addDays(todayISO, -windowDays);
  /* `CANONICAL_ROW_SQL` and `runDaySql()` rather than hand-typed jsonb, and
   * that is Rule 14 rather than tidiness: this file's first cut spelled both
   * out by hand and `_run_shape_lint.test.ts` failed it on the spot. The
   * merge-loser predicate has exactly ONE correct definition — the stamp
   * `absorbed_into_canonical_at` once zeroed 63 miles of the owner's history
   * — and the day key has one accessor that knows about the `startLocal`
   * fallback. */
  const rows = await rowsOrNull<{ id: string }>(
    'brain/option-lane · canonical runs in window',
    pool.query(
      `SELECT id::text AS id
         FROM runs
        WHERE user_uuid = $1::uuid
          AND ${CANONICAL_ROW_SQL}
          AND ${runDaySql()} >= $2
          AND ${runDaySql()} <= $3
        ORDER BY ${runDaySql()} DESC`,
      [userUuid, fromISO, todayISO],
    ),
  );
  if (rows === null) return null;
  return rows.map((r) => r.id);
}

/**
 * The AUTHORED phase label for the week, from the plan's own phase rows.
 *
 * Rule 16 · the label is read, never inferred from the week's shape.
 * `phaseFromAuthoredLabel` (through `orchestration/canonical-phase.ts`, THE
 * ONE DOOR) is what turns it into a `TrainingPhase`, and a null reaches its
 * own UNKNOWN case rather than being guessed at here.
 */
async function authoredPhaseLabelFor(
  planId: string, weekStartISO: string,
): Promise<string | null> {
  const rows = await rowsOrNull<{ label: string | null }>(
    'brain/option-lane · authored phase label',
    pool.query(
      `SELECT pp.label
         FROM plan_weeks pwk
         JOIN plan_phases pp ON pp.id = pwk.phase_id
        WHERE pwk.plan_id = $1 AND pwk.week_start_iso = $2
        LIMIT 1`,
      [planId, weekStartISO],
    ),
  );
  return rows?.[0]?.label ?? null;
}

/**
 * The goal race's distance, for arbitration's phase ordering.
 *
 * Scoped to the race THIS PLAN was authored for (`training_plans.race_id`),
 * not "the next A race" — Rule 16's own example is the watch resolving race
 * day as "the next A race with a goal", which would have carried a marathon
 * goal to the start line of a 10K. The plan names its race; that is the
 * answer.
 *
 * The miles-to-key mapping is `nearestCanonicalDistance`, the app's ONE owner
 * of that mapping, imported rather than re-tabulated. Rule 11 · null on any
 * unreadable step, and the caller refuses.
 */
async function goalRaceDistanceFor(
  planId: string,
): Promise<'FIVE_K' | 'TEN_K' | 'HALF' | 'MARATHON' | null> {
  /* The PLAN's own authored race distance first — it is the race this block
   * was built for, and it needs no join. `races.meta.distanceMi` is the
   * fallback for a plan authored before `race_distance_mi` was stamped. */
  const rows = await rowsOrNull<{ mi: string | number | null }>(
    'brain/option-lane · goal race distance',
    pool.query(
      `SELECT COALESCE(
                tp.authored_state->>'race_distance_mi',
                r.meta->>'distanceMi'
              ) AS mi
         FROM training_plans tp
         LEFT JOIN races r ON r.slug = tp.race_id AND r.user_uuid = tp.user_uuid
        WHERE tp.id = $1
        LIMIT 1`,
      [planId],
    ),
  );
  const raw = rows?.[0]?.mi ?? null;
  if (raw === null) return null;
  const mi = Number(raw);
  if (!Number.isFinite(mi) || mi <= 0) return null;
  return nearestCanonicalDistance(mi);
}
