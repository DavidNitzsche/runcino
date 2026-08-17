/**
 * lib/plan/race-lifecycle.ts · pure predicates for the plan-drift cron's
 * race-lifecycle transitions.
 *
 * 2026-08-17 · race-lifecycle fixes. Two boundaries locked here so the
 * cron's behavior is unit-testable without pg:
 *
 *   · graduateDue — the post-race graduate fires the FIRST cron after
 *     race day (race date < today). Was race+2 (`< today - 1 day`),
 *     which left the runner in a dead plan for two mornings after a
 *     goal race.
 *
 *   · recoveryCompleteDue — a recovery-mode plan whose prescribed days
 *     have all passed, with the goal race still in the future, hands
 *     off to the next build. composeRecoveryPlan's header always
 *     claimed "the graduate cron re-enters when the recovery window
 *     closes" — that path never existed (graduate only watches for
 *     PAST race dates; a recovery plan's race_id points at the NEXT
 *     race). This predicate is the missing re-entry.
 *
 * All comparisons are ISO-8601 string comparisons (YYYY-MM-DD), the
 * same convention the rest of the plan engine uses.
 */

/** True when the active plan's goal race finished before today —
 *  fire the graduate rebuild toward the next A-race. Race DAY itself
 *  is not due (the runner is racing, not graduating). */
export function graduateDue(raceDateISO: string | null | undefined, todayISO: string): boolean {
  if (!raceDateISO || !todayISO) return false;
  return raceDateISO.slice(0, 10) < todayISO;
}

/**
 * True when a recovery-mode plan has run out of prescribed days and its
 * target race is still ahead — time to rebuild toward that race
 * (pickPlanMode will return race-prep or maintenance now that the
 * recovery window has elapsed, or a shorter recovery remainder if it
 * hasn't).
 *
 * Loop guard is structural: the rebuild archives this plan and authors
 * a new one whose last workout is >= today, so the predicate reads
 * false for the replacement on the next tick.
 *
 *   · lastWorkoutISO null → false (a plan with no rows is not "complete",
 *     it's broken — don't auto-fire off missing data)
 *   · race date passed or today → false (graduateDue's territory)
 */
export function recoveryCompleteDue(
  lastWorkoutISO: string | null | undefined,
  raceDateISO: string | null | undefined,
  todayISO: string,
): boolean {
  if (!lastWorkoutISO || !todayISO) return false;
  if (!raceDateISO || raceDateISO.slice(0, 10) <= todayISO) return false;
  return lastWorkoutISO.slice(0, 10) < todayISO;
}
