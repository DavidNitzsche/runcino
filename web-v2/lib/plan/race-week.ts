/**
 * RACEWEEK-1 (2026-09-03) · "RACE WEEK" WAS ONE NAME FOR TWO QUESTIONS.
 *
 * `plan_weeks.is_race_week` holds the GOAL race's week and nothing else. That
 * is deliberate — the composer keeps tune-up races in their own set
 * (`bRaceWeeks` in `generate.ts`) because a B race and the goal race are not
 * the same event to a plan. The column is not wrong.
 *
 * What was wrong is that every reader spelled it "is race week" and answered a
 * different question with it. Measured on the owner's ACTIVE plan
 * (`pln_9a57561debb776e5`, authored 2026-08-31) on 2026-09-03:
 *
 *   week 2026-09-07  Santa Monica 10k  2026-09-13  is_race_week = FALSE
 *   week 2026-09-21  Dodgers           2026-09-26  is_race_week = FALSE
 *   week 2026-11-02  Run Malibu        2026-11-08  is_race_week = FALSE
 *   week 2026-11-30  CIM               2026-12-06  is_race_week = TRUE
 *
 * Three of his four race weeks read as ordinary training weeks, and the
 * nearest was TEN DAYS AWAY. The visible cost: `weekFlag` in `v5-block.ts`
 * labels a week off that column alone, so his 10K week fell through to its
 * phase label and the Block screen announced "QUALITY" over the week he races.
 *
 * This is Rule 16 — one quantity, one name — and the fix it prescribes: two
 * names, resolved in ONE place, so a caller has to say which it means.
 *
 * NO NEW QUERY. Every race day in the plan is written with `type: 'race'`;
 * verified against all four of his, so a week can answer "is there a race in
 * me" from rows it already holds.
 *
 * WHAT THIS FILE DOES NOT DO (Rule 22): it does not change any COACHING
 * behaviour. `libraryPhaseKey` still switches the workout library to
 * `race_week` on the goal race alone, and the adaptation guards in `adapt.ts`
 * still read the column directly. Whether a tune-up race should suppress
 * quality, or pull the library into race-week mode, is a coaching decision
 * with real blast radius and it belongs to the owner, not to a labelling fix.
 * It is written up in the master program as an open decision.
 */

/** The shape either question needs. Deliberately structural: both `PlanWeek`
 *  and the composer's own week satisfy it without importing either. */
export interface RaceWeekReadable {
  /** `plan_weeks.is_race_week`. */
  isRaceWeek?: boolean | null;
  /** The week's own days. A race day carries `type: 'race'`. */
  days?: ReadonlyArray<{ type?: string | null }> | null;
}

/**
 * THE GOAL RACE'S WEEK — the block's terminal event, the thing the taper aims
 * at. This is exactly what the column holds, and callers reasoning about the
 * SHAPE of the block (taper, peak, block end) want this one.
 */
export function isGoalRaceWeek(w: RaceWeekReadable): boolean {
  return w.isRaceWeek === true;
}

/**
 * A WEEK THE RUNNER RACES IN, of any priority. Callers speaking TO the runner
 * about what this week is want this one — he does not experience a B race as
 * an ordinary Tuesday.
 *
 * Reads the week's own days rather than the column, so it is right on a plan
 * authored before this file existed. That matters: it is what makes the owner's
 * live block read correctly without rewriting a single persisted row.
 */
export function weekContainsRace(w: RaceWeekReadable): boolean {
  if (isGoalRaceWeek(w)) return true;
  const days = w.days;
  if (days == null) return false;
  return days.some((d) => d?.type === 'race');
}

/**
 * A week with no `days` cannot answer `weekContainsRace` honestly, and Rule 11
 * says that is a third fact rather than a false. Callers that can act on the
 * difference use this; callers that only need a label use `weekContainsRace`,
 * whose `false` on absent days is the safe direction for a label (it under-
 * claims rather than announcing a race that may not be there).
 */
export function racePresence(w: RaceWeekReadable): 'goal-race' | 'race' | 'none' | 'unreadable' {
  if (isGoalRaceWeek(w)) return 'goal-race';
  if (w.days == null) return 'unreadable';
  return w.days.some((d) => d?.type === 'race') ? 'race' : 'none';
}
