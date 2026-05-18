/**
 * Completed-run lookup.
 *
 * Returns a Set of YYYY-MM-DD dates the user actually ran (per
 * strava_activities). Pages use this to decide whether a planned
 * workout is marked complete — date alone isn't enough; we need
 * evidence of a logged run.
 *
 * Date logic: the activity row stores `data->>'startLocal'` as a full
 * ISO datetime (or `data->>'date'` as YYYY-MM-DD on newer normalized
 * rows). We coalesce LEFT(startLocal, 10) vs the date field so older
 * + newer rows both register.
 */

import { query } from './db';

interface DateRow { day: string }

export async function getCompletedDates(userId: string, fromISO: string, toISO: string): Promise<Set<string>> {
  const rows = await query<DateRow>(
    `SELECT DISTINCT COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3`,
    [userId, fromISO, toISO],
  );
  return new Set(rows.map((r) => r.day).filter(Boolean));
}
