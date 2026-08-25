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
// WEEK-READ-1 (2026-08-24) · THE arithmetic, once. This file and
// `lib/notifications/week-window.ts` each held their own copy of the same
// four lines — identical today, and each documented as the source of truth for
// the other's callers. Two identical implementations of one rule is the drift
// this file was created to prevent, one level up. This one now delegates and
// keeps only what it adds: the settings-shaped `long_run_day` string, its
// default, and the `{ startISO, endISO }` shape its callers read.
import { trainingWeekWindow } from '@/lib/notifications/week-window';

/** 0=Sun..6=Sat — the JS getUTCDay() basis (NOT the Mon-indexed plan basis). */
const DOW_OF: Record<UserSettings['long_run_day'], number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

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
  const dow = new Date(todayISO + 'T12:00:00Z').getUTCDay();    // 0=Sun..6=Sat
  const { week_start_iso, week_end_iso } = trainingWeekWindow(todayISO, dow, longRunDow);
  return { startISO: week_start_iso, endISO: week_end_iso };
}
