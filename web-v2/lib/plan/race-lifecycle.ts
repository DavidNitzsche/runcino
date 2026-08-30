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
 * 2026-08-19 · race-shape audit · three more, for the runners the
 * lifecycle could not see at all:
 *
 *   · planElapsed — ANY plan whose last prescribed day is in the past.
 *     graduateDue only ever asked about a RACE date, so a goal-mode
 *     plan (race_id NULL) had no end at all: its sixteen weeks ran out
 *     and Today kept rendering a plan whose last day was months ago,
 *     forever, because nothing archived, graduated or rebuilt it.
 *
 *   · openBlockDue — the runner finished a race with nothing booked.
 *     The result chain archives the plan unconditionally, then looks
 *     for the next A/B race and finds none. There was no third branch:
 *     the plan is gone and no code path authors a replacement.
 *
 *   · openBlockMode — WHICH block that runner should get. This is a
 *     doctrine question, not a scheduling one, so it is answered here
 *     against Research/00b's recovery windows rather than guessed at
 *     the call site.
 *
 * All comparisons are ISO-8601 string comparisons (YYYY-MM-DD), the
 * same convention the rest of the plan engine uses.
 */

import { distanceCategoryOrNull } from '@/lib/race/distance-category';
import { postRaceRecoveryWeeks } from '@/lib/plan/goal-tiers';

/** True when the active plan's goal race finished before today —
 *  fire the graduate rebuild toward the next A-race. Race DAY itself
 *  is not due (the runner is racing, not graduating). */
export function graduateDue(raceDateISO: string | null | undefined, todayISO: string): boolean {
  if (!raceDateISO || !todayISO) return false;
  return raceDateISO.slice(0, 10) < todayISO;
}

/**
 * True when a recovery-mode plan has reached (or passed) its last
 * prescribed day and its target race is still ahead — time to rebuild
 * toward that race (pickPlanMode will return race-prep or maintenance
 * now that the recovery window has elapsed, or a shorter recovery
 * remainder if it hasn't).
 *
 * SAME-DAY ELIGIBLE (2026-08-30 · David's own ask). This used to be a
 * strict `<` — the block only counted "complete" the calendar day AFTER
 * its last prescribed day, no matter what hour the cron ran. Moving the
 * cron earlier in the day could never have fixed that: at any cron time
 * on the last prescribed day itself, `lastWorkoutISO < today` was still
 * false, because both sides named the same date. The fix is here, in
 * the predicate, not in the schedule — paired with a same-evening cron
 * run (`.github/workflows/plan-drift.yml`) so a runner whose block ends
 * today sees the next one start THAT EVENING, not cold the next morning.
 *
 * Loop guard is NO LONGER structural (a `<=` predicate can read true
 * again the same day the replacement plan is authored, if that plan's
 * own last day happens to be today too — a short recovery remainder).
 * Safety now rests entirely on the caller's dedupe (24h window OR a
 * standing pending row, checked before every fire) — verified this is
 * exactly what the cron already does. Running the cron twice a day
 * (morning + evening) does not double-fire this transition: the second
 * tick on the same day finds the first tick's proposal row inside the
 * 24h window and skips.
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
  return lastWorkoutISO.slice(0, 10) <= todayISO;
}

/**
 * True when a plan has run out of prescribed days — its LAST workout row is
 * before today.
 *
 * This is the end-of-plan question asked WITHOUT a race. `graduateDue` asks
 * it of the race date, which is the only end a race-prep plan has; a
 * goal-mode plan (race_id NULL, authored_state.goal_mode) has no race row at
 * all, so nothing ever asked whether it was over. Its sixteen weeks elapsed
 * and Today kept rendering it — the last prescribed day receding further into
 * the past every morning, with no archive, no graduate and no rebuild,
 * because the cron's plan lookup INNER JOINed `races` and dropped the row
 * before any of that logic was reached.
 *
 *   · lastWorkoutISO null → false. A plan with no rows is broken, not
 *     finished; the same reasoning `recoveryCompleteDue` uses. Firing a
 *     rebuild off missing data would re-author on a read failure.
 */
export function planElapsed(
  lastWorkoutISO: string | null | undefined,
  todayISO: string,
): boolean {
  if (!lastWorkoutISO || !todayISO) return false;
  return lastWorkoutISO.slice(0, 10) < todayISO;
}

/**
 * True when the runner has NO active plan and nothing on the calendar to
 * build toward — the state that follows finishing a race with nothing booked.
 *
 * `runPostResultChain` archives the plan the moment a finish time lands
 * (`SET archived_iso = NOW() ... WHERE race_id = $2`), then searches for the
 * next A/B race. When it finds none it leaves `nextPlan = null`. The cron's
 * mirror says "No next A-race · leave plan as-is" — but "as-is" is already
 * archived. The runner is left with zero active plans on the morning after a
 * marathon, which is the moment they most need something prescribed.
 *
 *   · hasActivePlan true  → false. Whatever they have, they have.
 *   · hasFutureTarget true → false. The graduate / build machinery owns it.
 */
export function openBlockDue(input: {
  hasActivePlan: boolean;
  /** A future A/B race, or a fitness goal whose deadline is still ahead. */
  hasFutureTarget: boolean;
}): boolean {
  return !input.hasActivePlan && !input.hasFutureTarget;
}

/** What an open block (no race booked) should be, per Research/00b. */
export type OpenBlockMode = 'recovery' | 'maintenance';

/**
 * Which block a runner with nothing booked should be given today.
 *
 * The whole question is whether they are still inside the recovery window of
 * the race they just ran. `Research/00b-recovery-protocols.md` sizes that
 * window by distance and scales it by the race's A/B/C grading, and
 * `postRaceRecoveryWeeks` is the engine's single reader of those two rules —
 * the same function `pickPlanMode` consults, so an open block and a
 * race-anchored block cannot disagree about when recovery ends.
 *
 * Inside the window → recovery. Outside it, or no race to recover from →
 * maintenance, which is exactly what `pickPlanMode` step 2 already returns
 * for "no next race".
 *
 * An unresolvable distance yields 'maintenance', not a guessed category: the
 * 2026-08-18 categorizer unification made `distanceCategoryOrNull` return
 * null rather than bucket `Number(null) === 0` as a 5K, and a recovery window
 * sized off a guessed event is the failure that rule exists to stop.
 */
export function openBlockMode(input: {
  lastRaceDateISO: string | null | undefined;
  lastRaceDistanceMi: number | null | undefined;
  lastRacePriority?: string | null;
  todayISO: string;
}): OpenBlockMode {
  const { lastRaceDateISO, lastRaceDistanceMi, todayISO } = input;
  if (!lastRaceDateISO || !todayISO) return 'maintenance';
  const cat = distanceCategoryOrNull(lastRaceDistanceMi ?? null);
  if (cat == null) return 'maintenance';
  const weeks = postRaceRecoveryWeeks(cat, input.lastRacePriority ?? null);
  if (weeks <= 0) return 'maintenance';
  const endMs = new Date(lastRaceDateISO.slice(0, 10) + 'T12:00:00Z').getTime()
    + weeks * 7 * 86400000;
  const todayMs = new Date(todayISO.slice(0, 10) + 'T12:00:00Z').getTime();
  return todayMs < endMs ? 'recovery' : 'maintenance';
}
