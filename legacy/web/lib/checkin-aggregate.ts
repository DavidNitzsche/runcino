/**
 * Daily check-in aggregator.
 *
 * Reads the last 7 days of `daily_checkin` rows (energy / soreness /
 * stress, each 1-10) and folds them into the compact summary the Coach
 * engine consumes. The Coach reads this via `state.checkin` (added in
 * coach-state.ts) so `assessReadiness` and `adjustForReality` don't have
 * to know where the bytes live, only the shape.
 *
 * Doctrine grounding for thresholds + the count-based decision rule:
 *
 *   @research Research/00b-recovery-protocols.md §Warning Signs of
 *             Incomplete Recovery, Qualitative Signals · Decision
 *             Matrix
 *   @research Research/00b-recovery-protocols.md §Sleep, The Highest-
 *             ROI Recovery Tool (energy/sleep proxy)
 *
 * What constitutes a "poor" day is conservative:
 *   energy   ≤ 4   → poor   (Hooper-axis low end)
 *   soreness ≥ 7   → poor   (qualitative warning sign, persistent)
 *   stress   ≥ 7   → poor   (qualitative warning sign, mood/stress)
 * Any one of those firing flips the day to "poor" so the engine has a
 * literal count to feed the doctrine's Decision Matrix.
 *
 * When no rows exist in the window, the aggregate is null, same NO
 * DATA YET contract Wave B enforced. No synthesized fallbacks.
 */

import { query } from './db';

/** Per-day check-in row shape (typed against the daily_checkin table
 *  defined in lib/db.ts). */
export interface CheckinRow {
  date: string;       // YYYY-MM-DD
  energy: number;     // 1-10, higher = better
  soreness: number;   // 1-10, higher = worse
  stress: number;     // 1-10, higher = worse
}

/** 7-day aggregate the Coach consumes. Sibling-wave coach-narrative
 *  tests construct minimal aggregates with just {rowsCount, latestDateISO,
 *  loggedToday, poorDaysCount?}; gatherCheckinAggregate fills the rest.
 *  Fields the narrative wave doesn't supply are typed optional. */
export interface CheckinAggregate {
  /** Window length in days the aggregate was computed over (≤7). */
  windowDays?: 7;
  /** Number of rows that fell inside the window. */
  rowsCount: number;
  /** Average energy over the window (1-10). null when rowsCount=0. */
  avgEnergy?: number | null;
  /** Average soreness over the window (1-10). null when rowsCount=0. */
  avgSoreness?: number | null;
  /** Average stress over the window (1-10). null when rowsCount=0. */
  avgStress?: number | null;
  /** Count of days with at least one "poor" signal. */
  poorDaysCount?: number;
  /** The most-recent ISO date with a check-in row, if any. */
  latestDateISO: string | null;
  /** True if the latest check-in was logged today. */
  loggedToday: boolean;
}

/** Threshold marker, a day is "poor" if any one signal is at or past
 *  the cutoff. Per doctrine, qualitative signals carry weight when they
 *  persist; the count surfaces that pattern. */
export function isPoorRow(row: CheckinRow): boolean {
  return row.energy <= 4 || row.soreness >= 7 || row.stress >= 7;
}

/** Pure aggregator. Takes ≤7 rows (newest-first or any order) and the
 *  reference "today" ISO and returns the shape the engine consumes.
 *  Exposed for tests + so the route can re-aggregate from a pre-fetched
 *  rowset without re-hitting Postgres. */
export function aggregateCheckins(
  rows: CheckinRow[],
  todayISO: string,
): CheckinAggregate {
  const n = rows.length;
  if (n === 0) {
    return {
      windowDays: 7,
      rowsCount: 0,
      avgEnergy: null,
      avgSoreness: null,
      avgStress: null,
      poorDaysCount: 0,
      latestDateISO: null,
      loggedToday: false,
    };
  }

  const avgEnergy = Math.round((rows.reduce((s, r) => s + r.energy, 0) / n) * 10) / 10;
  const avgSoreness = Math.round((rows.reduce((s, r) => s + r.soreness, 0) / n) * 10) / 10;
  const avgStress = Math.round((rows.reduce((s, r) => s + r.stress, 0) / n) * 10) / 10;
  const poorDaysCount = rows.filter(isPoorRow).length;

  const latest = rows.slice().sort((a, b) => b.date.localeCompare(a.date))[0];

  return {
    windowDays: 7,
    rowsCount: n,
    avgEnergy,
    avgSoreness,
    avgStress,
    poorDaysCount,
    latestDateISO: latest.date,
    loggedToday: latest.date === todayISO,
  };
}

/** Reads the last-7-days window from Postgres and aggregates. Wraps any
 *  DB failure in a graceful empty aggregate so coach-state never blows
 *  up because Postgres is temporarily unavailable. */
export async function gatherCheckinAggregate(
  todayISO: string,
  userId?: string | null,
): Promise<CheckinAggregate> {
  const sinceISO = isoDateOffset(todayISO, -6); // 7-day inclusive window
  try {
    // For an authenticated user, scope to THEIR rows by user_uuid (the
    // multi-tenant identity). For anonymous reads (legacy demo), fall back
    // to the 'me' single-tenant rows. The OLD behavior hardcoded 'me' for
    // every read, which meant a real user's coach gate read from the demo
    // account, not their own check-ins (or, with multiple users, a soup of
    // everyone's because POST hardcodes user_id='me').
    const rows = await query<CheckinRow>(
      userId
        ? `SELECT date::text, energy, soreness, stress
             FROM daily_checkin
            WHERE user_uuid = $1 AND date >= $2 AND date <= $3
            ORDER BY date DESC LIMIT 7`
        : `SELECT date::text, energy, soreness, stress
             FROM daily_checkin
            WHERE user_id = 'me' AND user_uuid IS NULL AND date >= $2 AND date <= $3
            ORDER BY date DESC LIMIT 7`,
      userId ? [userId, sinceISO, todayISO] : [null, sinceISO, todayISO],
    );
    return aggregateCheckins(rows, todayISO);
  } catch {
    // DATABASE_URL not set or table unavailable, same shape as 0 rows.
    return aggregateCheckins([], todayISO);
  }
}

function isoDateOffset(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
