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

export interface WeekStats {
  totalMi: number;
  runDays: number;
  longest: { date: string; mi: number; name: string; paceSPerMi: number } | null;
  quality: { date: string; mi: number; name: string; paceSPerMi: number } | null;
  /** Sum of avg HR weighted by distance (a rough load proxy). null if no HR data. */
  avgHr: number | null;
}

/**
 * Aggregate stats for a user's runs across an inclusive date range.
 * Used by the coach briefing to talk about last week with real numbers.
 *
 * "quality" is the highest-pace (lowest seconds/mi) run that's at least
 * 3 mi — picks out a threshold/intervals day from easy runs.
 */
export async function getWeekStats(userId: string, fromISO: string, toISO: string): Promise<WeekStats> {
  interface Row {
    day: string;
    distance_mi: string | null;
    moving_s: string | null;
    name: string | null;
    avg_hr: string | null;
  }
  const rows = await query<Row>(
    `SELECT
        COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day,
        (data->>'distanceMi')::NUMERIC                          AS distance_mi,
        (data->>'movingTimeS')::NUMERIC                         AS moving_s,
        data->>'name'                                            AS name,
        (data->>'avgHr')::NUMERIC                                AS avg_hr
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3
      ORDER BY day ASC`,
    [userId, fromISO, toISO],
  );

  let totalMi = 0;
  let totalHrMi = 0;
  let hrMiWithHr = 0;
  const dayMi = new Map<string, number>();
  let longest: WeekStats['longest'] = null;
  let quality: WeekStats['quality'] = null;

  for (const r of rows) {
    const mi = Number(r.distance_mi) || 0;
    const movingS = Number(r.moving_s) || 0;
    const paceSPerMi = mi > 0 ? Math.round(movingS / mi) : 0;
    const hr = Number(r.avg_hr) || 0;
    const name = r.name || 'Run';

    totalMi += mi;
    if (hr > 0 && mi > 0) {
      totalHrMi += hr * mi;
      hrMiWithHr += mi;
    }
    if (r.day) dayMi.set(r.day, (dayMi.get(r.day) || 0) + mi);

    if (!longest || mi > longest.mi) {
      longest = { date: r.day, mi, name, paceSPerMi };
    }
    // Quality candidate: at least 3 mi AND faster pace than current best
    if (mi >= 3 && paceSPerMi > 0) {
      if (!quality || paceSPerMi < quality.paceSPerMi) {
        quality = { date: r.day, mi, name, paceSPerMi };
      }
    }
  }
  // If the longest IS the quality (same row), null out quality so we
  // don't repeat it in the briefing.
  if (longest && quality && longest.date === quality.date) quality = null;

  return {
    totalMi: Math.round(totalMi * 10) / 10,
    runDays: dayMi.size,
    longest,
    quality,
    avgHr: hrMiWithHr > 0 ? Math.round(totalHrMi / hrMiWithHr) : null,
  };
}
