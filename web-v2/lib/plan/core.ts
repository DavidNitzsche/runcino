/**
 * lib/plan/core.ts — shared primitives for plan builders.
 *
 * The race-prep generator, the maintenance seeder, and the injury
 * builder all duplicated id() / todayPT() / addDays() / mondayOf() /
 * daysBetween() and the plan_workouts INSERT pattern. This module
 * consolidates them so doctrine changes only need a single-file edit
 * and so the three builders stay drift-free.
 *
 * No behavioral change — pure refactor.
 */
import { randomBytes } from 'crypto';

/** Random id with a 2-3 letter prefix (pln, phs, wk, wko, etc.). */
export function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/** Add (possibly negative) days to a YYYY-MM-DD string. */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

/** Whole-day difference: daysBetween('2026-01-01', '2026-01-05') === 4. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

/** Monday of the week containing `iso`. ISO week — Mon as start. */
export function mondayOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = d.getUTCDay();        // 0=Sun..6=Sat
  const shift = dow === 0 ? -6 : 1 - dow;
  return addDays(iso, shift);
}

/** Parse a goal time like "1:35:00" or "3:25:00" → seconds, or null. */
export function parseGoalSeconds(goal: string | null | undefined): number | null {
  if (!goal) return null;
  const m = String(goal).match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}

/** Round to 1 decimal — used widely for distance_mi values. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Round to 0.5 — used for maintenance volume curves. */
export function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * Map a numeric day-of-week (0=Sun..6=Sat) → a date offset relative to
 * a Monday-anchored week-start. Used by plan-builders to compute the
 * date_iso for each workout in a week.
 *
 * Example: weekStart='2026-05-25' (Monday), dow=0 (Sunday) → '2026-05-31'.
 */
export function dateForDow(weekStartMondayISO: string, dow: number): string {
  // ((dow - 1 + 7) % 7) — converts Sun..Sat to Mon-relative offset.
  return addDays(weekStartMondayISO, ((dow - 1 + 7) % 7));
}
