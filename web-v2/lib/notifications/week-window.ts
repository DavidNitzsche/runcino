/**
 * week-window.ts — training-week boundary for notification summaries.
 *
 * The training week ENDS on the runner's long_run_day and starts the day
 * after — ONE source of truth with /api/plan/week (locked 2026-06-16,
 * "Week boundary = long-run day"). The weekly check-in previously anchored
 * to ISO Monday, which split a Saturday-long runner's training week in two
 * and made the notification's actual/planned totals disagree with
 * TRAIN/Today (2026-07-06 audit · treadmill-strength-notif week-boundary
 * finding, P2).
 *
 * Pure date arithmetic — noon-UTC anchored so DST transitions can't shift
 * the YYYY-MM-DD slice (same trick as lib/runs/volume.ts:isoDaysBefore).
 */

/**
 * The training week containing `dateISO`.
 *
 * @param dateISO    runner-local YYYY-MM-DD (from userLocalClock)
 * @param dow        runner-local day-of-week for dateISO (0=Sun…6=Sat)
 * @param longRunDow day-of-week the long run lands on (0=Sun…6=Sat) —
 *                   DOW_OF[settings.long_run_day]
 * @returns week_start_iso (day after the previous long_run_day) and
 *          week_end_iso (the long_run_day this week ends on), inclusive.
 */
export function trainingWeekWindow(
  dateISO: string,
  dow: number,
  longRunDow: number,
): { week_start_iso: string; week_end_iso: string } {
  const weekStartDow = (longRunDow + 1) % 7; // day after the long run
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
