/**
 * E1 + E4 · Strava activity gap detection
 *
 * Powers two related surfaces on /overview:
 *
 *   E1 (stale Strava signal):
 *     0-7 days   · silent
 *     8-14 days  · "It's been N days since your last run. Everything OK?"
 *     15+ days   · "It's been N days. If you're injured or taking a
 *                  planned break, mark it so the plan adjusts."
 *
 *   E4 (miss-3-days coaching):
 *     0-2 days   · silent
 *     3-4 days   · "Three days off, planned recovery or unexpected?"
 *     5-7 days   · "It's been N days. Worth checking if the plan needs
 *                  adjusting."
 *
 * Both surfaces share the same "days since last run" measurement; they
 * differ in user-affordance shape. E4 fires within the E1 silent zone
 * (3-7 days), so they don't compete, the 8-day mark transitions from
 * E4 ("worth checking") to E1 ("everything OK?").
 *
 * STATE PERSISTENCE
 *   When the user marks "planned break" or "injured," we record:
 *     users.activity_gap_status = 'planned' | 'injured' | NULL
 *     users.activity_gap_at = TIMESTAMPTZ (when status was set)
 *     users.activity_gap_resume_at = TIMESTAMPTZ (auto-clear when activity resumes)
 *
 *   Effects of a marked gap:
 *     - planned: E1/E4 surfaces silent for 7 days OR until next activity
 *     - injured: L7 signals suspended, V5 silent, until next activity
 *
 *   On any new activity (last_run_at advances), gap_status auto-clears.
 *
 * SOURCE OF TRUTH
 *   Last activity date pulled from strava_activities WHERE distance > 0.
 *   Doesn't filter on workoutType, any run counts as "running activity"
 *   for the purpose of "are they still running."
 */

import { query } from './db';

export type GapState = 'silent' | 'e4-3to4' | 'e4-5to7' | 'e1-8to14' | 'e1-15plus';
export type GapMark = 'planned' | 'injured' | null;

export interface StravaGapFinding {
  /** Days since the most recent run activity. null = never run / no data. */
  daysSinceLastRun: number | null;
  /** Date of the most recent run activity (YYYY-MM-DD). */
  lastRunDate: string | null;
  /** Computed state for the surface to render. */
  state: GapState;
  /** Active user mark, if any. */
  mark: GapMark;
  /** When the user marked the gap. */
  markedAt: string | null;
  /** True when the system should suspend L7 signals + V5
   *  (mark === 'injured' AND no new activity since mark). */
  signalsSuspended: boolean;
  /** True when the user marked planned break (E1/E4 surfaces silent
   *  until activity resumes or 7 days elapse). */
  plannedBreakActive: boolean;
}

interface ActivityRow {
  last_date: string | null;
}

interface UserGapRow {
  activity_gap_status: GapMark;
  activity_gap_at: Date | null;
}

const PLANNED_SILENCE_DAYS = 7;

export async function computeStravaGap(
  userId: string,
  todayIso: string,
): Promise<StravaGapFinding> {
  // Pull last running activity. Any positive-distance activity counts.
  const rows = await query<ActivityRow>(
    `SELECT MAX(data->>'date') AS last_date
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'distanceMi')::NUMERIC > 0`,
    [userId],
  );
  const lastRunDate = rows[0]?.last_date ?? null;
  let daysSinceLastRun: number | null = null;
  if (lastRunDate) {
    const ms = Date.parse(todayIso + 'T00:00:00Z') - Date.parse(lastRunDate + 'T00:00:00Z');
    daysSinceLastRun = Math.max(0, Math.floor(ms / 86_400_000));
  }

  // Pull mark state. New columns; gracefully handle missing.
  let mark: GapMark = null;
  let markedAt: string | null = null;
  try {
    const userRows = await query<UserGapRow>(
      `SELECT activity_gap_status, activity_gap_at
         FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    mark = userRows[0]?.activity_gap_status ?? null;
    markedAt = userRows[0]?.activity_gap_at?.toISOString() ?? null;
  } catch { /* graceful if column doesn't exist yet */ }

  // Auto-clear: if there's a run AFTER the mark was set, clear it.
  if (mark && markedAt && lastRunDate) {
    const markedAtIso = markedAt.slice(0, 10);
    if (lastRunDate > markedAtIso) {
      try {
        await query(
          `UPDATE users SET activity_gap_status = NULL,
                             activity_gap_at = NULL,
                             activity_gap_resume_at = NOW()
            WHERE id = $1`,
          [userId],
        );
      } catch { /* non-fatal */ }
      mark = null;
      markedAt = null;
    }
  }

  // Planned break expiration: after PLANNED_SILENCE_DAYS, downgrade to no mark.
  let plannedBreakActive = false;
  if (mark === 'planned' && markedAt) {
    const ageDays = (Date.parse(todayIso + 'T00:00:00Z') - Date.parse(markedAt)) / 86_400_000;
    plannedBreakActive = ageDays < PLANNED_SILENCE_DAYS;
  }
  const signalsSuspended = mark === 'injured';

  // Compute state. Mark precedence: if planned break is active, silent.
  // If injured, still surface (we want to nudge the runner toward
  // resuming) but UI uses suspended-signals flag separately.
  let state: GapState = 'silent';
  if (daysSinceLastRun != null) {
    if (plannedBreakActive) {
      state = 'silent';
    } else if (daysSinceLastRun >= 15) {
      state = 'e1-15plus';
    } else if (daysSinceLastRun >= 8) {
      state = 'e1-8to14';
    } else if (daysSinceLastRun >= 5) {
      state = 'e4-5to7';
    } else if (daysSinceLastRun >= 3) {
      state = 'e4-3to4';
    }
  }

  return {
    daysSinceLastRun,
    lastRunDate,
    state,
    mark,
    markedAt,
    signalsSuspended,
    plannedBreakActive,
  };
}

/** Update the gap mark. Called by /api/profile/activity-gap/mark. */
export async function setActivityGapMark(userId: string, mark: GapMark): Promise<void> {
  if (mark === null) {
    await query(
      `UPDATE users SET activity_gap_status = NULL,
                         activity_gap_at = NULL,
                         activity_gap_resume_at = NOW()
        WHERE id = $1`,
      [userId],
    );
    return;
  }
  await query(
    `UPDATE users SET activity_gap_status = $2,
                       activity_gap_at = NOW()
      WHERE id = $1`,
    [userId, mark],
  );
}
