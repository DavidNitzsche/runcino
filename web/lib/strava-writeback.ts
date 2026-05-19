/**
 * strava-writeback · server-side helpers for renaming a Strava
 * activity once we've matched it to a planned workout.
 *
 * Why: when we sync an activity and find it's the planned "Easy" run
 * for Apr 14, Strava shows the generic "Morning Run" name unless we
 * push our planned label back. The writeback gives the user a record
 * of *what they were supposed to be doing* embedded in their Strava
 * feed, so a post-mortem month later doesn't require cross-referencing
 * with this app.
 *
 * Scope requirement: Strava's PUT /activities/{id} requires the
 * `activity:write` OAuth scope. The /api/strava/connect flow asks for
 * it. If the stored refresh token predates the scope addition, the
 * Strava API call surfaces a 401 — caller logs and continues (no UI
 * regressions from a writeback failure).
 *
 * Idempotency: we only rename when the activity's current name doesn't
 * already start with the planned title prefix. So re-running sync
 * doesn't re-touch the activity. The Strava API also accepts the
 * unchanged value as a no-op but we avoid the round-trip.
 */

import { refreshAccessToken } from './strava';
import type { PlanWorkout, WorkoutType } from '../coach/plan-types';

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

const TYPE_LABEL: Record<WorkoutType, string> = {
  easy:      'Easy',
  long:      'Long Run',
  threshold: 'Threshold',
  interval:  'Intervals',
  mp:        'Marathon Pace',
  recovery:  'Recovery',
  shakeout:  'Shakeout',
  race:      'Race',
  rest:      'Rest',
};

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** "Apr 14" — month abbrev + day of month, parsed from ISO YYYY-MM-DD. */
export function formatActivityDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  if (!y || !m || !d) return dateISO;
  return `${MONTH_SHORT[m - 1]} ${d}`;
}

/** "Easy · Apr 14" or "Long Run · HM Finish · Apr 14".
 *  The subLabel (when present) carries the per-week variant
 *  ("HM Finish", "Progression") for richer Strava history. */
export function plannedActivityTitle(workout: PlanWorkout): string {
  const base = TYPE_LABEL[workout.type] ?? workout.type;
  const dateLabel = formatActivityDate(workout.dateISO);
  const parts: string[] = [base];
  if (workout.subLabel && workout.subLabel.trim() !== '' && workout.subLabel !== base) {
    // subLabel may already encode the workout type (e.g. "Long Run · HM Finish").
    // Strip a leading duplicate so we don't render "Long Run · Long Run · …".
    const stripped = workout.subLabel.replace(new RegExp(`^${base}\\s*·\\s*`, 'i'), '').trim();
    if (stripped) parts.push(stripped);
  }
  parts.push(dateLabel);
  return parts.join(' · ');
}

/** True when the activity's existing name already encodes our planned
 *  title (avoids re-PUTting Strava on every sync). We treat a leading
 *  prefix as "already named" — the user may have manually appended a
 *  note like "Easy · Apr 14 · felt great", and we leave that alone. */
export function nameAlreadyMatchesPlan(currentName: string, plannedTitle: string): boolean {
  const cur = currentName.trim();
  if (cur === plannedTitle) return true;
  return cur.startsWith(plannedTitle + ' ') || cur.startsWith(plannedTitle + '·');
}

export interface RenameResult {
  ok: boolean;
  /** True when we actually called Strava (and it returned 200). False
   *  when we skipped because the name already matched. */
  changed: boolean;
  newName?: string;
  error?: string;
}

/** PUT the new name to Strava. Returns ok=true/changed=false when we
 *  skipped because the name already matched; ok=true/changed=true on
 *  a successful rename; ok=false when Strava rejected the call (most
 *  commonly 401 if the token lacks activity:write scope). */
export async function renameStravaActivity(
  activityId: number,
  currentName: string,
  newName: string,
): Promise<RenameResult> {
  if (nameAlreadyMatchesPlan(currentName, newName)) {
    return { ok: true, changed: false };
  }
  try {
    const { accessToken } = await refreshAccessToken();
    const res = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        changed: false,
        error: `Strava rename failed: ${res.status} ${body.slice(0, 200)}`,
      };
    }
    return { ok: true, changed: true, newName };
  } catch (e) {
    return { ok: false, changed: false, error: e instanceof Error ? e.message : String(e) };
  }
}
