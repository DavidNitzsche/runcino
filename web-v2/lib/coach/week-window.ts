/**
 * lib/coach/week-window.ts · the ONE training-week window helper.
 *
 * #9 / #39 / #24 (audit 2026-06-16) · the training week ENDS on the runner's
 * long-run day (their last training day of the cycle) and STARTS the day after.
 * This is the SAME convention `/api/plan/week/route.ts` derives (weekStartDow =
 * (longRunDow + 1) % 7, week runs weekStart..weekStart+6) and that
 * `lib/plan/generate.ts:weekStartBoundaryOf` mirrors for plan_weeks (#10).
 * Centralised here so the week-total readers (training-state, glance-state,
 * log-state) + the strength recommender (#24) can't drift from that source of
 * truth — they all call this instead of re-deriving a hardcoded Monday.
 *
 * For David (long_run_day = 'sun' → longRunDow = 0 → weekStartDow = 1, Monday)
 * the window is Mon–Sun, byte-identical to the old hardcoded Monday boundary —
 * a provable no-op. A Saturday-long runner → Sun–Sat.
 *
 * All dates are noon-anchored UTC ISO (YYYY-MM-DD) so DST never shifts the day,
 * matching every other date helper in the coach layer.
 */
import type { UserSettings } from './settings';

/** 0=Sun..6=Sat — the JS getUTCDay() basis (NOT the Mon-indexed plan basis). */
const DOW_OF: Record<UserSettings['long_run_day'], number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function addDaysISO(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000)
    .toISOString().slice(0, 10);
}

export interface WeekWindow {
  /** ISO day the training week starts (day AFTER the long-run day). */
  startISO: string;
  /** ISO day the training week ends (the long-run day, 6 days after start). */
  endISO: string;
}

/**
 * The 7-day training-week window containing `todayISO`, where the week ends on
 * the runner's `longRunDay`. Returns { startISO, endISO } inclusive.
 *
 * `longRunDay` accepts the `user_settings.long_run_day` value ('sun'..'sat');
 * an unknown/undefined value defaults to Sunday (matching loadSettings'
 * DEFAULT_SETTINGS), which yields the Mon–Sun window.
 */
export function weekWindowFor(
  longRunDay: UserSettings['long_run_day'] | string | null | undefined,
  todayISO: string,
): WeekWindow {
  const longRunDow = DOW_OF[(longRunDay ?? 'sun') as UserSettings['long_run_day']] ?? 0;
  const weekStartDow = (longRunDow + 1) % 7;                    // day after the long run
  const dow = new Date(todayISO + 'T12:00:00Z').getUTCDay();    // 0=Sun..6=Sat
  const daysSinceWeekStart = (dow - weekStartDow + 7) % 7;
  const startISO = addDaysISO(todayISO, -daysSinceWeekStart);
  const endISO = addDaysISO(startISO, 6);
  return { startISO, endISO };
}
