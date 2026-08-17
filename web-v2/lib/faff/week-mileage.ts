/**
 * lib/faff/week-mileage.ts · one definition of "miles this week".
 *
 * ── The defect ───────────────────────────────────────────────────────
 * Two surfaces answered the same question with different numbers.
 *
 *   Today  (views/TodayView.tsx, RestDayCard) summed `w.dist` — the
 *     PLANNED distance of each day flagged done — and printed it under
 *     the label "done". A day planned 6.0 and run 7.4 contributed 6.0.
 *   Train  (views/TrainView.tsx, execWeeks) summed `d.doneMi` — actual
 *     mileage — and kept planned as a separate series.
 *
 * So a runner who over-ran their week read a smaller "done" number on
 * Today than on Train, for the same week. Neither surface was lying
 * deliberately; Today was summing the wrong column.
 *
 * ── The correct semantic ─────────────────────────────────────────────
 * "Miles this week", unqualified and labelled done/run/completed, means
 * MILES ACTUALLY RUN. Train is right.
 *
 * A coach uses actual because actual is the training load the runner's
 * body received. Planned mileage is an intention; it does not accumulate
 * fatigue, does not build aerobic base, and does not explain a niggle.
 * When the two diverge, the divergence is itself the coaching signal —
 * and you only see it if you keep both numbers and keep them separate.
 * Summing planned-of-completed-days is the one combination that is
 * neither: it discards the execution while claiming to report it, so it
 * hides exactly the gap a coach is looking for.
 *
 * This module therefore returns both, named so they cannot be confused,
 * plus the mid-week honest comparison. It never returns one blended
 * "miles" figure, because a single number is what allowed the confusion.
 *
 * ── plannedToDateMi ──────────────────────────────────────────────────
 * Comparing a part-finished week's actual against the FULL planned week
 * makes every runner look behind until Sunday night. Train's current-week
 * row does exactly that. `plannedToDateMi` counts only days that have
 * already happened, so "ahead/behind" means something on a Wednesday.
 * Callers that want the week's total commitment still have `plannedMi`.
 */

export interface WeekDayInput {
  /** ISO YYYY-MM-DD. Required for the to-date split; omit to skip it. */
  dateISO?: string | null;
  /** Miles the plan prescribes for this day. */
  plannedMi?: number | null;
  /** Miles actually run on this day. 0/null = not run. */
  doneMi?: number | null;
  /** Workout type, for the quality-session count. */
  type?: string | null;
}

export interface WeekMileage {
  /** Miles actually run in the window. THE "miles this week" number. */
  actualMi: number;
  /** Miles the plan prescribes across the whole window. */
  plannedMi: number;
  /** Planned miles for days that have already happened (≤ today). */
  plannedToDateMi: number;
  /** Actual miles on days that have already happened (≤ today). */
  actualToDateMi: number;
  /** Days with any mileage run. */
  daysRun: number;
  /** Days the plan prescribes a run on. */
  daysPlanned: number;
  /** Quality sessions (intervals / tempo / long) actually run. */
  hardSessionsDone: number;
  /**
   * actualToDateMi − plannedToDateMi. Positive = ahead of the week so far.
   * Both sides are restricted to the same days; comparing a full-window
   * actual against a to-date plan (or the reverse) is how a surface ends
   * up reporting a runner ahead or behind by an amount nobody ran.
   */
  vsPlanToDateMi: number;
}

const HARD_TYPES = new Set(['intervals', 'tempo', 'long', 'threshold', 'race']);

const num = (v: number | null | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;

/** One decimal, the precision every mileage surface in the app displays. */
const round1 = (v: number): number => Math.round(v * 10) / 10;

export function computeWeekMileage(
  days: readonly WeekDayInput[],
  opts?: {
    /**
     * Runner-local ISO day. Days on or before this count toward
     * plannedToDateMi. Omitted → plannedToDateMi equals plannedMi, and
     * callers must not present it as a to-date figure.
     */
    todayISO?: string | null;
  },
): WeekMileage {
  const todayISO = opts?.todayISO ?? null;

  let actualMi = 0;
  let plannedMi = 0;
  let plannedToDateMi = 0;
  let actualToDateMi = 0;
  let daysRun = 0;
  let daysPlanned = 0;
  let hardSessionsDone = 0;

  for (const d of days ?? []) {
    const done = num(d.doneMi);
    const planned = num(d.plannedMi);

    actualMi += done;
    plannedMi += planned;
    if (planned > 0) daysPlanned++;

    // ISO day strings compare correctly as strings — no Date, so no
    // timezone can shift the boundary (see lib/runtime/day-key.ts).
    if (todayISO == null || (d.dateISO != null && d.dateISO <= todayISO)) {
      plannedToDateMi += planned;
      actualToDateMi += done;
    }

    if (done > 0) {
      daysRun++;
      if (d.type && HARD_TYPES.has(d.type)) hardSessionsDone++;
    }
  }

  const plannedToDate = round1(plannedToDateMi);
  const actualToDate = round1(actualToDateMi);

  return {
    actualMi: round1(actualMi),
    plannedMi: round1(plannedMi),
    plannedToDateMi: plannedToDate,
    actualToDateMi: actualToDate,
    daysRun,
    daysPlanned,
    hardSessionsDone,
    vsPlanToDateMi: round1(actualToDate - plannedToDate),
  };
}
