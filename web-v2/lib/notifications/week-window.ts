/**
 * week-window.ts — THE training-week boundary. One source of truth.
 *
 * THE WEEK RUNS SUNDAY TO SATURDAY. David, 2026-08-21: "I want the week to go
 * Sunday - Saturday."
 *
 * That replaces the 2026-06-16 rule, under which the week ENDED on the
 * runner's long_run_day and started the day after. The old rule had a real
 * argument — the week built toward the long run, and the long run closed it —
 * and it is superseded rather than wrong.
 *
 * `longRunDow` is still accepted so no call site has to change, and is now
 * deliberately unused. It is kept rather than deleted because the boundary
 * has moved once and may move again; a parameter that is present and ignored
 * is easier to re-honour than one that has to be threaded back through five
 * call sites.
 *
 * ONE SOURCE OF TRUTH IS THE WHOLE POINT OF THIS FILE. Both the plan week
 * (iPhone strip, training calendar, Today's own day resolution) and the
 * weekly check-in cron read it, so the strip and the totals cannot disagree.
 * The check-in previously anchored to ISO MONDAY on its own, which split a
 * Saturday-long runner's week in two and made the notification's
 * actual/planned totals contradict TRAIN and Today. Moving the boundary here
 * moves it everywhere at once, which is the property that matters. Consumed by
 * BOTH /api/plan/week (iPhone WeekStrip + training calendar) and the
 * weekly check-in cron (app/api/cron/notifications) — the plan route used
 * to reimplement this arithmetic inline; adversarial review 2026-07-06
 * issue 4 folded it onto this function so the two can't drift. The weekly
 * check-in previously anchored to ISO Monday, which split a Saturday-long
 * runner's training week in two and made the notification's
 * actual/planned totals disagree with TRAIN/Today (2026-07-06 audit ·
 * treadmill-strength-notif week-boundary finding, P2).
 *
 * Pure date arithmetic — noon-UTC anchored so DST transitions can't shift
 * the YYYY-MM-DD slice (same trick as lib/runs/volume.ts:isoDaysBefore).
 */

/**
 * The training week containing `dateISO`.
 *
 * @param dateISO    runner-local YYYY-MM-DD (from userLocalClock)
 * @param dow        runner-local day-of-week for dateISO (0=Sun…6=Sat)
 * @param _longRunDow accepted and ignored. The week no longer pivots on the
 *                    long run — see the note at the top of this file.
 * @returns week_start_iso (the Sunday) and week_end_iso (the Saturday),
 *          inclusive.
 */
export function trainingWeekWindow(
  dateISO: string,
  dow: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _longRunDow?: number,
): { week_start_iso: string; week_end_iso: string } {
  const weekStartDow = 0; // Sunday
  const daysSinceWeekStart = ((dow - weekStartDow) % 7 + 7) % 7;
  const anchor = Date.parse(dateISO + 'T12:00:00Z');
  const dayMs = 24 * 3600 * 1000;
  const start = new Date(anchor - daysSinceWeekStart * dayMs);
  const end = new Date(start.getTime() + 6 * dayMs);
  return {
    week_start_iso: start.toISOString().slice(0, 10),
    week_end_iso: end.toISOString().slice(0, 10),
  };
}
