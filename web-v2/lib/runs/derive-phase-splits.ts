/**
 * derive-phase-splits.ts · ONE WORK PHASE, MILE BY MILE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The runner, looking at his own 2026-09-08 session, whose middle phase is a
 * 3.5-mile tempo shown as one number:
 *
 *     "the 3.5 tempo shows just one number but I'd like to see it broken down
 *      by mile. the shorter tempos obv wont but 3.5 miles is long enough that
 *      seeing the mile breakdown would be helpful."
 *
 * A single average over 3.5 miles hides the shape of the effort. His own row
 * is the argument: 7:14 / 7:08 / 7:14 at 154 / 157 / 162 bpm, then a closing
 * half mile at 165. The pace is flat and the heart rate climbs eleven beats.
 * One "7:11/mi · HR 160" cannot say that, and drift is the whole reading a
 * tempo is run for.
 *
 * THIS IS PRESENTATION, NOT A NEW METRIC. Nothing here grades, prescribes or
 * feeds any coaching decision — it re-cuts a phase's own stored sample stream
 * at the mile boundaries the stream itself crossed. The verdict stays
 * `lib/execution/verdict.ts`'s (Brain Constitution: one owner per question).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ONE WALK, NOT TWO (Rule 16)
 *
 * The interpolation is `derive-splits.ts`'s `walkMileSplits`, unmodified and
 * shared — this file does not own a second copy of "where is a mile boundary".
 * It hands `flattenPhaseSamples` a ONE-element array, which makes both the
 * distance and the time offset zero, which is precisely "rebased to the
 * phase's own start". A per-phase mile is therefore cut by the same arithmetic
 * as a whole-run mile, and the two can never drift apart.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PHASE-GRAIN-1 · WHEN A PHASE EARNS A BREAKDOWN
 *
 * A phase shows its own mile table only when its stream crossed AT LEAST TWO
 * WHOLE MILE BOUNDARIES. One row is not a breakdown — it is the phase average
 * restated with a "1" beside it, which is Rule 17 — and a phase with no
 * boundary at all has nothing to cut.
 *
 * THE THRESHOLD IS A COUNT, NOT A DISTANCE, and that is the whole point under
 * Rule 9. There is no continuous quantity here compared against a cutoff, so
 * there is no cliff to smooth: a boundary was crossed or it was not. The
 * fitter runner never gets the worse screen, because crossing MORE boundaries
 * only ever adds rows.
 *
 * It is also empirically safe on this runner's real data. Measured 2026-09-08
 * across all 87 stored work phases in his history (`runs.data.phases`,
 * canonical rows only):
 *
 *     36 phases   ≤ 1.01 mi        · below the grain, draw nothing
 *      0 phases   1.02 – 1.99 mi   · THE BOUNDARY LANDS IN EMPTY SPACE
 *     51 phases   ≥ 2.00 mi        · eligible by length
 *       of which 46 carry samples and can be cut; 5 carry none.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RULE 11 · THREE FACTS, NOT ONE
 *
 * "Too short to cut", "long enough but no samples were recorded" and "the
 * samples are there but the walk could not complete" are three different
 * things, and this returns a discriminated union that keeps them apart. The
 * SCREEN treatment is the same for all three — no section, per Rule Three —
 * but a reader that cannot tell them apart cannot ever report the second one,
 * which is a recording gap worth knowing about.
 *
 * The refusal branch carries no `splits` field at all, so `reading.splits`
 * does not compile until the caller has branched. Same shape as
 * `NormalReading<T>` in `lib/training/normal-window.ts`, and for the same
 * reason: a type error beats a discipline.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RULE 22 · WHAT THIS FILE CANNOT FAIL ON
 *
 *   · It sees only what the stream recorded. A phase whose GPS dropped mid-way
 *     produces confidently-cut miles over a distance the runner did not run,
 *     and nothing here can tell. `distMi` is trusted as given.
 *   · It carries no elevation and no cadence, because a stored phase sample
 *     carries neither. Those columns are absent, never zero.
 *   · It knows nothing about the PRESCRIPTION. There is deliberately no
 *     per-mile target or tolerance: a stored phase carries one
 *     `tolerancePaceSPerMi` for the whole phase, and inventing a per-mile
 *     window from it would be a second, quieter grader.
 */
import {
  flattenPhaseSamples,
  walkMileSplits,
  averageBpmBetween,
  fmtMileClock,
  type SplitSourcePhase,
} from './derive-splits';
import { phasesFromCompletion } from '@/lib/execution/verdict';

/**
 * PHASE-GRAIN-1 · whole-mile boundaries a phase's own stream must cross before
 * it earns a mile table. Two, so the table always has at least two rows to
 * compare — the comparison IS the reading.
 */
export const PHASE_GRAIN_MIN_WHOLE_MILES = 2;

/** A trailing piece shorter than this is GPS drift past the last boundary, not
 *  a piece of the run, and gets no row. */
const MIN_REMAINDER_MI = 0.05;

/** One row of a phase's own mile table. */
export interface PhaseMileSplit {
  /** 1-based, counted from the START OF THE PHASE — not of the run. */
  mile: number;
  /** "7:14". Formatted by `fmtMileClock`, the same one the whole-run table uses. */
  pace: string;
  paceSecPerMi: number;
  /** Average HR across this piece. Null when no sample in it carried one. */
  hr: number | null;
  /**
   * How much of a mile this row covers — 1 for a whole mile, a fraction for
   * the trailing piece. Always stated, because this walk always knows it, and
   * `MilePiece.isPartial` is what turns the last row's numeral into its length.
   */
  distanceMi: number;
}

/** Why a phase draws no mile table. Three distinguishable facts (Rule 11). */
export type PhaseMileSplitsRefusal =
  /** Fewer than `PHASE_GRAIN_MIN_WHOLE_MILES` boundaries crossed. The
   *  overwhelmingly common case, and not a defect: a 1 km rep has nothing to
   *  break down. */
  | 'below-grain'
  /** Long enough by its own recorded distance, but the phase carries no usable
   *  `paceSamples` — 5 of this runner's 51 eligible phases. A RECORDING GAP,
   *  which is a different fact from "too short", and the reason this is not
   *  folded into `below-grain`. */
  | 'no-samples'
  /** Boundaries were crossed but the sanity guard dropped at least one mile, so
   *  the table would have a hole in it. Refuse rather than print a sequence
   *  that silently skips mile 2. */
  | 'incomplete-walk';

export type PhaseMileSplitsReading =
  | { ok: true; splits: PhaseMileSplit[] }
  | { ok: false; reason: PhaseMileSplitsRefusal };

/**
 * One phase → its own mile table, or an argued refusal.
 *
 * The trailing remainder is sized off the PHASE'S OWN ACTUAL totals when it
 * carries them, falling back to where the sample stream stops. That is the
 * same posture `flattenPhaseSamples` already takes for its cross-phase offsets,
 * and it is what makes the rows reconcile EXACTLY with the distance and
 * duration the phase row above the table is already showing (Rule 16 — two
 * numbers under one label on one screen have to agree).
 */
export function derivePhaseMileSplits(phase: SplitSourcePhase): PhaseMileSplitsReading {
  const flat = flattenPhaseSamples([phase]);
  if (flat.length < 2) return { ok: false, reason: 'no-samples' };

  const walk = walkMileSplits(flat);
  if (walk.wholeMilesCrossed < PHASE_GRAIN_MIN_WHOLE_MILES) {
    return { ok: false, reason: 'below-grain' };
  }
  if (walk.splits.length !== walk.wholeMilesCrossed) {
    return { ok: false, reason: 'incomplete-walk' };
  }

  const splits: PhaseMileSplit[] = walk.splits.map((s) => ({
    mile: s.mile,
    pace: s.pace,
    paceSecPerMi: s.paceSecPerMi,
    hr: s.hr,
    distanceMi: 1,
  }));

  const whole = walk.wholeMilesCrossed;
  /* THE PHASE'S OWN TOTALS WIN, but only where they can be reconciled with what
   * the walk actually saw. A stated distance BELOW the miles already crossed,
   * or a stated duration below the last crossing, is contradictory data, and
   * the stream is the half of it that was measured second by second — so the
   * stream is what the remainder is sized off in that case. Note this is not a
   * zero-erasure (Rule 11): a stated total of 0 is not discarded as "missing",
   * it fails the reconciliation on its own terms, which is a different and
   * honest reason. */
  const statedMi = finiteOrNull(phase.actualDistanceMi);
  const statedSec = finiteOrNull(phase.actualDurationSec);
  const totalMi = statedMi != null && statedMi >= whole ? statedMi : walk.endDistMi;
  const totalSec = statedSec != null && statedSec >= walk.lastCrossingSec ? statedSec : walk.endSec;
  const remainderMi = totalMi - whole;
  const remainderSec = totalSec - walk.lastCrossingSec;

  if (remainderMi >= MIN_REMAINDER_MI && remainderSec > 0) {
    const paceSecPerMi = Math.round(remainderSec / remainderMi);
    splits.push({
      // NUMBERED, even though the row will not PRINT its numeral. The number is
      // this piece's position in the phase, which VoiceOver still reads and
      // which `MilePiece.id` needs to be unique; the DECISION to show a length
      // instead of the numeral belongs to the renderer and is made off
      // `distanceMi`, in one place, for both tables.
      mile: whole + 1,
      // PACE, NOT ELAPSED. `pace` is seconds PER MILE on every row, the same
      // contract `RunSplit.pace` carries and the same one `MileBreakdownV5`
      // parses it back out under. A whole mile's elapsed and its pace are the
      // same number, which is why the distinction only shows up here; printing
      // this piece's 3:33 of elapsed in a column headed PACE would be a figure
      // in the wrong unit, beside three that are in the right one.
      pace: fmtMileClock(paceSecPerMi),
      paceSecPerMi,
      hr: averageBpmBetween(flat, walk.lastCrossingSec, walk.endSec),
      distanceMi: remainderMi,
    });
  }

  return { ok: true, splits };
}

/**
 * The whole completion payload → one entry per stored phase, positionally
 * aligned with `gradeStoredPhases`' own `phases` array.
 *
 * ALIGNMENT IS BY POSITION AND THAT IS DELIBERATE: `gradeStoredPhases` reads
 * its own raw element as `list[i]` over exactly this filter, so any call site
 * holding a `GradedPhase[]` can index straight into this. Re-deriving the
 * pairing from `index` would be a second answer to "which raw phase is this",
 * and stored payloads do not all carry `index`.
 *
 * `null` where the phase draws nothing, for any of the three reasons — the
 * caller that wants to tell them apart calls `derivePhaseMileSplits` directly.
 */
export function derivePhaseMileSplitsFromCompletion(raw: unknown): (PhaseMileSplit[] | null)[] {
  return phaseElements(raw).map((p) => {
    const reading = derivePhaseMileSplits(p as SplitSourcePhase);
    return reading.ok ? reading.splits : null;
  });
}

/** The same list `gradeStoredPhases` builds, line for line: ONE parser for
 *  "the completion payload's phase array, however it arrived"
 *  (`phasesFromCompletion` — its own header says a second copy is the bug),
 *  and the same object-element filter applied to it. */
function phaseElements(value: unknown): Record<string, unknown>[] {
  return phasesFromCompletion(value).filter(
    (el): el is Record<string, unknown> => !!el && typeof el === 'object' && !Array.isArray(el),
  );
}

/** A number, or "the payload did not carry one". NOT a zero-erasure — a stated
 *  zero survives as a zero and is judged on the reconciliation above, because
 *  "the phase recorded no distance" and "the field is absent" are two facts
 *  (Rule 11) and this is only allowed to answer the second. */
function finiteOrNull(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
