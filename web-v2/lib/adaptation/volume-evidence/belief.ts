/**
 * lib/adaptation/volume-evidence/belief.ts · STEP 3 · THE DEMONSTRATED-VOLUME
 * BELIEF, AND THE ONE THING IT IS NOT ALLOWED TO BE.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * `lib/plan/load-progression-contract.ts` already types this belief:
 * `DemonstratedLoad { peakWeeklyMi, sustainedWeeklyMi, heldWeeklyMi,
 * meanWeeklyMi, asOfISO }`, and its own header promises
 * "demonstratedLoadAfterEachWeek — recomputed from completed weeks, which is
 * what moves every number above."
 *
 * NOTHING RECOMPUTES IT. `resolveLoadProgressionContract` has exactly one
 * caller in the app, `lib/plan/generate.ts:11633`, at AUTHORING. The envelope
 * is struck once off whatever the runner had demonstrated the day the block
 * was written, and no completed week has ever moved it. That is the gap this
 * file closes, and it closes it by producing a NEW `DemonstratedLoad` for the
 * EXISTING owner to re-resolve, not by computing a second envelope (Rule 16,
 * and `docs/BRAIN_CONSTITUTION.md`'s one-question-one-owner table).
 *
 * ── RULE 8, PER READER, WITH THE SIDE NAMED ───────────────────────────────
 *
 * "Filter a reader that asks what the runner CAN DO. Do not filter one that
 * asks what the runner HAS RECENTLY ABSORBED."
 *
 *   peakWeeklyMi              CAPABILITY  · FILTERED
 *   sustainedWeeklyMi         CAPABILITY  · FILTERED
 *   heldWeeklyMi              CAPABILITY  · FILTERED
 *   meanWeeklyMi              CAPABILITY  · FILTERED
 *   absorbedWeeklyMiUnfiltered  ABSORBED LOAD · NOT FILTERED, on purpose
 *
 * The filter is applied UPSTREAM, by `classifyWeekSurplus`, which marks a
 * week `prescribedNonNormal` and refuses its `admissibleSurplusMi`. This file
 * therefore never has to remember to filter, which is the point:
 * `lib/training/normal-window.ts` is the app's one definition and the reason
 * it exists is that no reader should have to get this right alone.
 *
 * `absorbedWeeklyMiUnfiltered` is carried because Rule 8's corollary is
 * explicit that over-applying the rule makes a safety guard MORE PERMISSIVE in
 * exactly the situation it exists for. Nothing in this directory spends it as
 * capability; it exists so a downstream guard has the literal recent number
 * under a name that says which question it answers.
 *
 * ── WHAT MOVES AND WHAT DOES NOT ──────────────────────────────────────────
 *
 * A belief moves ONLY on `SurplusAdmission.admitted === true`. An admission
 * that refused, for either reason, leaves every number exactly where it was
 * and records why. This is the clause that stops the mechanical reading the
 * owner ruled out ("I ran extra, therefore add the same amount forever"): the
 * surplus does not become the new prescription, it becomes evidence that the
 * runner's demonstrated MAXIMUM is higher than the engine believed, and the
 * envelope owner decides what to do about that.
 *
 * ── RULE 22 · WHAT THIS FILE'S GATE CANNOT FAIL ON ────────────────────────
 *
 * · It cannot fail on a belief that was WRONG TO START WITH. Everything here
 *   is a monotone update over `prior`, so a prior struck off a bad window
 *   stays bad and this file will faithfully raise it.
 * · It cannot fail on a surplus that is real but was earned in a way that will
 *   not repeat (a one-off event, a downhill route, a group run). Nothing here
 *   asks WHY the week was big.
 * · It cannot see a runner getting fitter without running further. A pace
 *   improvement at constant volume moves nothing here, correctly, and the
 *   threshold lever owns that question.
 * · Rule 15 · the case that reaches every branch: `_mileage_responsive.test.ts`
 *   "two consecutive successfully absorbed higher-volume weeks" is the only
 *   test that reaches the SECOND `raise` of `peakWeeklyMi`, and the
 *   "missed week" case is the only one that reaches the no-move branch with a
 *   readable, complete, non-recovery week behind it.
 */
import { roundTo } from '@/lib/format/run';
import type { IncludedEvidence } from '@/lib/adaptation/canonical/decision-record';
import type { DemonstratedLoad } from '@/lib/plan/load-progression-contract';
import {
  type BeliefMove,
  type DemonstratedVolumeBelief,
  type LowWeekReading,
  type SurplusAdmission,
  type WeekSurplus,
} from './contract';

export interface BeliefUpdateInput {
  readonly asOfISO: string;
  /** What the engine believed before this evidence arrived. */
  readonly prior: DemonstratedVolumeBelief;
  /** The week the surplus was run in. */
  readonly week: WeekSurplus;
  readonly admission: SurplusAdmission;
  /**
   * Every representative week in the look-back, most recent LAST, so
   * `sustained` can be the rank-3 order statistic `sustainedWeeklyMileage`
   * already owns rather than a second definition of "repeatedly".
   */
  readonly representativeWeeklyMi: readonly number[];
  /** Rule 8's corollary. Every week, INCLUDING taper and recovery. */
  readonly allWeeklyMiUnfiltered: readonly number[];
  /** The rank the sustained reading uses. `SUSTAINED_WEEK_RANK` in normal-window.ts. */
  readonly sustainedRank: number;
  /** The downward reading for this week, when one was taken. */
  readonly lowWeek: LowWeekReading | null;
}

/** An empty prior. Rule 11: every field is null for "never measured", never 0. */
export function unmeasuredBelief(asOfISO: string): DemonstratedVolumeBelief {
  return {
    asOfISO,
    peakWeeklyMi: null,
    sustainedWeeklyMi: null,
    heldWeeklyMi: null,
    meanWeeklyMi: null,
    absorbedWeeklyMiUnfiltered: null,
    moves: [],
  };
}

/**
 * The rank-`k` week, descending, or null when there are not enough weeks to
 * ask. Deliberately the SAME shape as `sustainedFromWeeks` in
 * `lib/training/normal-window.ts` — a rank statistic, not a mean — because
 * "what he has reached repeatedly" has one owner and this must not become a
 * second definition of it.
 */
export function rankWeek(weeklyMi: readonly number[], rank: number): number | null {
  if (weeklyMi.length < rank) return null;
  const sorted = [...weeklyMi].sort((a, b) => b - a);
  return roundTo(sorted[rank - 1]);
}

function evidenceFrom(week: WeekSurplus, mi: number): IncludedEvidence[] {
  return [{
    activityId: `week:${week.weekStartISO}`,
    dateISO: week.weekStartISO,
    what: `${roundTo(week.completedMi.ok ? week.completedMi.value : 0)} mi run against `
      + `${roundTo(week.prescribedMi)} mi prescribed, ${roundTo(mi)} mi of admitted surplus`,
    grade: null,
    weight: 1,
  }];
}

/**
 * THE UPDATE.
 *
 * Monotone by construction on the upward path: every field is a `max` against
 * the prior, so this function cannot lower a belief no matter what evidence it
 * is handed. Lowering is `applyCapacityLoss` below, it is a separate function
 * on purpose, and it is the only thing in this directory that can move a
 * number down. Rule 9: there is no comparison of two computed quantities here
 * that switches a behaviour, so there is no cliff.
 */
export function updateDemonstratedVolume(input: BeliefUpdateInput): DemonstratedVolumeBelief {
  const { prior, week, admission } = input;
  const moves: BeliefMove[] = [];

  const absorbed = input.allWeeklyMiUnfiltered.length > 0
    ? roundTo(Math.max(...input.allWeeklyMiUnfiltered))
    : prior.absorbedWeeklyMiUnfiltered;

  if (!admission.admitted) {
    // NOT a no-op on `absorbedWeeklyMiUnfiltered`: Rule 8's corollary says the
    // taper happened and the guards must keep reading the literal number. Only
    // the CAPABILITY fields are held.
    return { ...prior, asOfISO: input.asOfISO, absorbedWeeklyMiUnfiltered: absorbed, moves: [] };
  }

  const completed = week.completedMi.ok ? roundTo(week.completedMi.value) : null;

  const raise = (
    field: BeliefMove['field'],
    from: number | null,
    candidate: number | null,
    because: string,
  ): number | null => {
    if (candidate == null) return from;
    if (from != null && candidate <= from) return from;
    moves.push({ field, fromMi: from, toMi: candidate, because, evidence: evidenceFrom(week, admission.mi) });
    return candidate;
  };

  const peak = raise(
    'peakWeeklyMi', prior.peakWeeklyMi, completed,
    'The week was run, admitted as evidence, and is larger than any representative week before it.',
  );
  const sustained = raise(
    'sustainedWeeklyMi', prior.sustainedWeeklyMi,
    rankWeek(input.representativeWeeklyMi, input.sustainedRank),
    `The rank-${input.sustainedRank} representative week rose, so this volume has now been reached repeatedly.`,
  );
  const held = raise(
    'heldWeeklyMi', prior.heldWeeklyMi, completed,
    'This is what the runner is demonstrably carrying now.',
  );
  const mean = raise(
    'meanWeeklyMi', prior.meanWeeklyMi,
    input.representativeWeeklyMi.length > 0
      ? roundTo(input.representativeWeeklyMi.reduce((a, b) => a + b, 0) / input.representativeWeeklyMi.length)
      : null,
    'The representative trailing mean rose.',
  );

  return {
    asOfISO: input.asOfISO,
    peakWeeklyMi: peak,
    sustainedWeeklyMi: sustained,
    heldWeeklyMi: held,
    meanWeeklyMi: mean,
    absorbedWeeklyMiUnfiltered: absorbed,
    moves,
  };
}

/**
 * THE ONLY DOWNWARD PATH IN THIS DIRECTORY, and it cannot touch the peak.
 *
 * `RULE_21_THRESHOLD_LEDGER` row 7 carries the argument in full. The short
 * version: a peak is a MAXIMUM, a week the runner has actually run is a
 * permanent fact about him, and `Research/00a` §"Volume progression rules"
 * states base growth per training CYCLE rather than per week, so a single week
 * is the wrong window in which to revise a cycle-scale belief in EITHER
 * direction.
 *
 * This is the one deliberate asymmetry in the directory and it favours the
 * runner, which is the direction Rule 22 says to check. The downward machinery
 * this does NOT duplicate already exists and is untouched: `volume_overshoot`
 * in `lib/plan/adapt.ts`, and the REGRESS branch of
 * `lib/adaptation/canonical/levers/weekly-volume.ts`.
 */
export function applyCapacityLoss(
  belief: DemonstratedVolumeBelief,
  reading: LowWeekReading,
  observedWeeklyMi: number,
  asOfISO: string,
): DemonstratedVolumeBelief {
  if (!reading.mayLowerBelief) return { ...belief, asOfISO, moves: [] };
  const moves: BeliefMove[] = [];
  const lower = (field: BeliefMove['field'], from: number | null): number | null => {
    if (from == null || observedWeeklyMi >= from) return from;
    moves.push({
      field,
      fromMi: from,
      toMi: roundTo(observedWeeklyMi),
      because: reading.detail,
      evidence: [],
    });
    return roundTo(observedWeeklyMi);
  };
  return {
    ...belief,
    asOfISO,
    // peakWeeklyMi is deliberately absent from this list.
    sustainedWeeklyMi: lower('sustainedWeeklyMi', belief.sustainedWeeklyMi),
    heldWeeklyMi: lower('heldWeeklyMi', belief.heldWeeklyMi),
    meanWeeklyMi: lower('meanWeeklyMi', belief.meanWeeklyMi),
    moves,
  };
}

/**
 * The belief, in the shape `lib/plan/load-progression-contract.ts` already
 * consumes. This is the whole handshake: the envelope owner keeps its
 * arithmetic and gains a fresher input.
 *
 * `absorbedWeeklyMiUnfiltered` is NOT passed through. `DemonstratedLoad` is a
 * CAPABILITY type — every one of its four fields is spent as a bound on what
 * may be planned — and handing it an unfiltered number would put a taper week
 * back into exactly the reader Rule 8 was written about.
 */
export function asDemonstratedLoad(b: DemonstratedVolumeBelief): DemonstratedLoad {
  return {
    peakWeeklyMi: b.peakWeeklyMi,
    sustainedWeeklyMi: b.sustainedWeeklyMi,
    heldWeeklyMi: b.heldWeeklyMi,
    meanWeeklyMi: b.meanWeeklyMi,
    asOfISO: b.asOfISO,
  };
}
