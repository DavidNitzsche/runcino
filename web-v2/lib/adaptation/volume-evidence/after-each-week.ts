/**
 * lib/adaptation/volume-evidence/after-each-week.ts · VOLUMESEAM-1 ·
 * `demonstratedLoadAfterEachWeek`, WHICH WAS A PROMISE AND IS NOW A FUNCTION.
 *
 * ── THE DEAD END THIS CLOSES ──────────────────────────────────────────────
 *
 * `lib/plan/load-progression-contract.ts` answers the owner's five questions
 * about what "approximately 55 miles" means, and its header lists a fifth
 * answer beside the four it implements:
 *
 *     demonstratedLoadAfterEachWeek     recomputed from completed weeks, which
 *                                       is what moves every number above
 *
 * It was not a field, not a type, not a symbol. Grepped across the whole
 * worktree on 2026-09-05, `demonstratedLoadAfterEach` resolved to FOUR HITS,
 * ALL PROSE: two in that header, and two in this directory quoting it to say
 * nothing recomputed it. The contract's `demonstrated` input was struck once,
 * at authoring, from `rampEvidence` in `generate.ts`, and never again for the
 * life of the block. So `currentlySupportedLoad`, `immediatelyPermittedLoad`,
 * `plannedFutureLoadMi` and `plannedPeakLoad` were frozen at the moment the
 * plan was written, and the sentence claiming otherwise was the only thing
 * anybody would read.
 *
 * That is CLAUDE.md Rule 20's corollary exactly: "a header comment asserting
 * an invariant is documentation, not enforcement. Gate the claim or delete the
 * sentence." This file is the first branch. `_volume_seam.test.ts` guard 1 is
 * the gate, and it resolves the header's own words against this symbol so the
 * two cannot drift apart again.
 *
 * ── WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────
 *
 * It FOLDS. Week by week, oldest first, through the readers this directory
 * already owns, and returns the belief that stands at the end plus the ledger
 * that produced it:
 *
 *   readWeekEvidence          two channels out of one week (evidence.ts)
 *   classifyLowWeek           the downward half, six causes (admit.ts)
 *   updateDemonstratedVolume  the capability belief (belief.ts)
 *   applyCapacityLoss         the one cause that may lower it (belief.ts)
 *   accumulateCapacityEvidence  the ledger across weeks (evidence.ts)
 *   asDemonstratedLoad        the handshake into the contract (belief.ts)
 *
 * It computes NO envelope. `resolveLoadProgressionContract` keeps that job
 * entirely; this hands it a fresher `DemonstratedLoad` and stops. A second
 * envelope would be Rule 16 and the defect that module exists to close.
 *
 * It does no IO, reads no clock and names no plan writer, so it stays inside
 * `_zero_mutation_scan.test.ts`'s guards without a new entry. `sustainedRank`
 * and `minConsecutiveWeeksForLoss` are PARAMETERS rather than imports for
 * exactly that reason: `lib/training/normal-window.ts`, which owns
 * `SUSTAINED_WEEK_RANK`, imports `@/lib/db/pool` three lines into itself, and
 * a pure fold should not drag a connection pool behind it.
 *
 * ── THE ONE THING IT OWNS THAT NO CALLER MAY OVERRIDE ─────────────────────
 *
 * "Did the runner carry the load on" — `followingWeekCompletionFrac`, the
 * fifth admission condition and the input `absorptionWeight` turns into
 * confidence. The fold HOLDS EVERY WEEK, so it can answer that question from
 * its own list; a caller passing it in would be a second answer to a question
 * this function is already standing on the data for (Rule 16). Hence the
 * `Omit` on `conditions`: the type refuses the field rather than a comment
 * asking callers not to send it.
 *
 * Rule 11 lives in that same answer, three ways:
 *
 *   the following week HAS NOT HAPPENED   `absent`  · provisional, not zero
 *   the following week was READ           `measured` · confirms in proportion
 *   the following week COULD NOT BE READ  `failed`  · a refusal, not a low week
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ───────────────────
 *
 * · It cannot fail on a WRONG LOADER. Every week arrives already classified
 *   for Rule 8, already canonical-filtered, already carrying its admission
 *   conditions. A loader that mislabels a taper as a build week produces a
 *   confidently wrong belief here and nothing in this file can tell.
 * · It cannot fail on weeks that were never loaded. A fold over a truncated
 *   list is arithmetically perfect and factually short, which is the shape
 *   Rule 14 is named for; the POPULATION is the loader's claim to make.
 * · It cannot fail on the ORDER being wrong in a way that still parses.
 *   The fold asserts ascending order and refuses, but two weeks with the same
 *   start date would be folded twice rather than caught.
 * · It cannot fail on the seam being shut. This returns a belief. Whether
 *   anything downstream spends it is `lib/plan/volume-evidence-proposal.ts`'s
 *   question and its gate's, not this one's.
 */
import type { DemonstratedLoad } from '@/lib/plan/load-progression-contract';
import { admitSurplus, classifyLowWeek, type AdmissionInput } from './admit';
import {
  applyCapacityLoss,
  asDemonstratedLoad,
  unmeasuredBelief,
  updateDemonstratedVolume,
} from './belief';
import {
  accumulateCapacityEvidence,
  readWeekEvidence,
  type CapacityAccumulation,
  type FatigueContribution,
  type WeekEvidenceReading,
} from './evidence';
import {
  absent, failed, measured,
  type DemonstratedVolumeBelief,
  type LowWeekReading,
  type Measured,
  type WeekSurplusInput,
} from './contract';

/**
 * One completed week, as the fold needs it.
 *
 * `conditions` is `AdmissionInput` minus the two fields this fold owns: the
 * week itself (classified here) and the following week's completion (answered
 * here, from the list).
 */
export interface CompletedWeek {
  readonly week: WeekSurplusInput;
  readonly conditions: Omit<AdmissionInput, 'week' | 'followingWeekCompletionFrac'>;
  /**
   * What the runner or the calendar SAID about a short week, when anything
   * did. Rule 11: absent is "nobody told us", never "nothing happened".
   * Handed straight to `classifyLowWeek`.
   */
  readonly declaredCause: Measured<'TRAVEL_OR_LIFE' | 'ILLNESS_OR_INJURY'>;
}

export interface RecomputeInput {
  readonly asOfISO: string;
  /** Ascending by `weekStartISO`, oldest first. Refused if not. */
  readonly weeks: readonly CompletedWeek[];
  /** `SUSTAINED_WEEK_RANK` in `lib/training/normal-window.ts`. Passed, not imported. */
  readonly sustainedRank: number;
  /** `VOLUME_MIN_CONSECUTIVE_WEEKS`. Passed for the same reason. */
  readonly minConsecutiveWeeksForLoss: number;
}

/**
 * Rule 11 · THREE OUTCOMES, AND THE REFUSAL BRANCH CARRIES NO BELIEF.
 *
 * Copied deliberately from `NormalReading<T>` in `lib/training/normal-window.ts`
 * and from `LoadReading` in the contract this feeds: `result.load` does not
 * compile until the caller has branched, so "we could not recompute" cannot be
 * spent as "we recomputed and found nothing".
 */
export type DemonstratedLoadRecompute =
  | {
    readonly ok: true;
    /** THE HANDSHAKE. What `resolveLoadProgressionContract` takes. */
    readonly load: DemonstratedLoad;
    /** The full belief, including the UNFILTERED absorbed number Rule 8's corollary needs. */
    readonly belief: DemonstratedVolumeBelief;
    /** CHANNEL 1's ledger across weeks. Its `progressionFraction` scales any step. */
    readonly accumulation: CapacityAccumulation;
    /**
     * CHANNEL 2, carried SEPARATELY and never folded into the belief. A
     * recovery week the runner overran adds fatigue and no capacity, and the
     * two must not arrive under one number (Rule 8's corollary, Rule 16).
     */
    readonly fatigue: readonly FatigueContribution[];
    /** Per-week receipts, in the order they were folded. */
    readonly readings: readonly WeekEvidenceReading[];
    /**
     * THE BELIEF AS IT STOOD AFTER EACH WEEK, index-aligned with `readings`.
     *
     * This is what the function's NAME says, in the plural the contract's
     * header used, and it is not decoration: a caller comparing "the envelope
     * before this evidence" against "the envelope after it" needs both
     * beliefs, and re-folding a truncated list to get the first would be a
     * second implementation of this loop.
     */
    readonly beliefAfterEachWeek: readonly DemonstratedVolumeBelief[];
    /** Every low week, classified. Only `GENUINE_CAPACITY_LOSS` moved anything. */
    readonly lowWeeks: readonly LowWeekReading[];
  }
  | { readonly ok: false; readonly because: string };

/**
 * THE FOLD. `demonstratedLoadAfterEachWeek`, as the contract's header has
 * promised since 2026-09-02.
 *
 * The order inside the loop is the argument:
 *
 *  1 · read the week's two channels, with the following week's completion
 *      resolved from the list rather than from the caller;
 *  2 · raise the capability belief on an ADMITTED surplus;
 *  3 · classify a SHORT week, and lower the belief only on the one cause of
 *      six that may — never the peak (`RULE_21_THRESHOLD_LEDGER` row 7);
 *  4 · carry the representative and unfiltered week lists forward, which is
 *      what makes `sustained` a rank statistic over history rather than a
 *      fact about the newest week.
 */
export function demonstratedLoadAfterEachWeek(input: RecomputeInput): DemonstratedLoadRecompute {
  if (input.weeks.length === 0) {
    return {
      ok: false,
      because: 'No completed weeks were loaded, so there is nothing to recompute a demonstrated '
        + 'load from. This is a refusal, not a runner who has trained nothing.',
    };
  }
  for (let i = 1; i < input.weeks.length; i += 1) {
    if (input.weeks[i - 1].week.weekStartISO >= input.weeks[i].week.weekStartISO) {
      return {
        ok: false,
        because: `The weeks handed in are not in ascending order at ${input.weeks[i].week.weekStartISO}. `
          + 'A fold over an unordered history would report a belief nobody could reproduce.',
      };
    }
  }

  let belief: DemonstratedVolumeBelief = unmeasuredBelief(input.asOfISO);
  const readings: WeekEvidenceReading[] = [];
  const lowWeeks: LowWeekReading[] = [];
  const fatigue: FatigueContribution[] = [];
  const beliefAfterEachWeek: DemonstratedVolumeBelief[] = [];
  /** Rule 8 FILTERED. Only ordinary weeks answer "what is his normal". */
  const representativeWeeklyMi: number[] = [];
  /** Rule 8's COROLLARY. Every week, taper included. What the legs carried. */
  const allWeeklyMiUnfiltered: number[] = [];
  let consecutiveLowRepresentative = 0;

  for (let i = 0; i < input.weeks.length; i += 1) {
    const w = input.weeks[i];

    /* THE FIFTH CONDITION, ANSWERED HERE. Rule 11, three ways, and the
     * `absent` branch is the one that matters most: the newest week's
     * successor has not been run, which is PROVISIONAL and is not the same
     * fact as a successor that came in low. */
    const next = input.weeks[i + 1];
    const followingWeekCompletionFrac: Measured<number> = next == null
      ? absent('the week after this one has not been run yet')
      : !next.week.dataComplete
        ? failed('the week after this one holds missing or duplicated activity data')
        : next.week.prescribedMi <= 0
          ? absent('the week after this one carries no prescription to measure completion against')
          : measured(completedOf(next.week) / next.week.prescribedMi);

    const reading = readWeekEvidence({
      asOfISO: input.asOfISO,
      week: w.week,
      conditions: { ...w.conditions, followingWeekCompletionFrac },
    });
    readings.push(reading);
    fatigue.push(reading.fatigue);

    const completedMi = reading.surplus.completedMi.ok ? reading.surplus.completedMi.value : null;
    if (completedMi != null) allWeeklyMiUnfiltered.push(completedMi);
    if (!reading.surplus.prescribedNonNormal && completedMi != null) {
      representativeWeeklyMi.push(completedMi);
    }

    /* ── THE DOWNWARD READING, TAKEN BEFORE THE UPWARD ONE IS SPENT ──────
     *
     * A week is SHORT when it was prescribed something and came in under it.
     * `classifyLowWeek` owns the six causes; this only decides whether to ask.
     * The consecutive counter walks REPRESENTATIVE weeks only, because a run
     * of prescribed recovery weeks is not a run of shortfalls (Rule 8). */
    let lowReading: LowWeekReading | null = null;
    const short = w.week.prescribedMi > 0
      && (completedMi == null || completedMi + 1e-9 < w.week.prescribedMi);
    if (short) {
      lowReading = classifyLowWeek({
        weekStartISO: w.week.weekStartISO,
        prescribedMi: w.week.prescribedMi,
        completedMi: reading.surplus.completedMi,
        prescribedNonNormal: reading.surplus.prescribedNonNormal,
        dataComplete: w.week.dataComplete,
        declaredCause: w.declaredCause,
        consecutiveLowRepresentativeWeeks: consecutiveLowRepresentative + 1,
        minConsecutiveWeeksForLoss: input.minConsecutiveWeeksForLoss,
      });
      lowWeeks.push(lowReading);
      if (!reading.surplus.prescribedNonNormal) consecutiveLowRepresentative += 1;
    } else if (!reading.surplus.prescribedNonNormal) {
      consecutiveLowRepresentative = 0;
    }

    belief = updateDemonstratedVolume({
      asOfISO: w.week.weekStartISO,
      prior: belief,
      week: reading.surplus,
      admission: reading.admission,
      representativeWeeklyMi,
      allWeeklyMiUnfiltered,
      sustainedRank: input.sustainedRank,
      lowWeek: lowReading,
    });

    if (lowReading != null && lowReading.mayLowerBelief && completedMi != null) {
      belief = applyCapacityLoss(belief, lowReading, completedMi, w.week.weekStartISO);
    }

    beliefAfterEachWeek.push(belief);
  }

  /* The belief's stamp becomes the question's date, not the last week's. The
   * contract's whole point is that it is time-aware, and handing it an
   * `asOfISO` a fortnight stale would make the envelope answer a question
   * nobody asked. */
  const stamped: DemonstratedVolumeBelief = { ...belief, asOfISO: input.asOfISO };

  return {
    ok: true,
    load: asDemonstratedLoad(stamped),
    belief: stamped,
    accumulation: accumulateCapacityEvidence(readings.map((r) => r.capacity), input.asOfISO),
    fatigue,
    readings,
    beliefAfterEachWeek,
    lowWeeks,
  };
}

/**
 * Completed miles for a week, canonical rows only, as a NUMBER for the
 * completion ratio above.
 *
 * Deliberately NOT a second implementation of `classifyWeekSurplus`'s sum: it
 * asks a narrower question (how much of the prescription did the following
 * week cover) and answers zero for a week whose rows could not be read, which
 * is why the `dataComplete` refusal is checked BEFORE this is called. Rule 14's
 * canonical predicate is applied at the loader, and `mergedIntoAnother` is
 * re-checked here so a loader that forgot it cannot inflate a completion
 * ratio into false confidence.
 */
function completedOf(week: WeekSurplusInput): number {
  let mi = 0;
  for (const r of week.runs) {
    if (r.mergedIntoAnother) continue;
    if (!r.distanceMi.ok) continue;
    mi += r.distanceMi.value;
  }
  return mi;
}
