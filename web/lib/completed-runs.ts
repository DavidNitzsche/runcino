/**
 * Completed-run lookup.
 *
 * Returns a Set of YYYY-MM-DD dates the user actually ran (per
 * strava_activities). Pages use this to decide whether a planned
 * workout is marked complete, date alone isn't enough; we need
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
  const set = new Set(rows.map((r) => r.day).filter(Boolean));
  // Also count Apple-Watch completions that never reached Strava. The
  // workoutId is "YYYY-MM-DD-<slug>" → its date prefix is the run's day.
  const wc = await query<DateRow>(
    `SELECT DISTINCT LEFT(workout_id, 10) AS day
       FROM workout_completions
      WHERE user_id = $1
        AND status IN ('completed','partial')
        AND workout_id ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND LEFT(workout_id, 10) BETWEEN $2 AND $3`,
    [userId, fromISO, toISO],
  ).catch(() => [] as DateRow[]);
  for (const r of wc) if (r.day) set.add(r.day);
  return set;
}

/**
 * Per-day mileage rollup. Returns SUM (total miles ran that day) so the
 * weekly mileage bar accumulates correctly even on a two-a-day. For
 * checking whether the *workout* completed, use `getLongestRunByDate`
 * below — a 2.4-mi short threshold + a 5-mi easy later in the day must
 * not falsely mark the threshold workout DONE just because the day
 * total happens to clear 60% of the planned distance.
 */
export async function getCompletedMileageByDate(userId: string | null | undefined, fromISO: string, toISO: string): Promise<Map<string, number>> {
  interface Row { day: string; mi: string }
  const rows = await query<Row>(
    `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day,
            SUM((data->>'distanceMi')::NUMERIC) AS mi
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3
      GROUP BY day`,
    // null (not 'me') so anon reads the legacy demo activities via the
    // user_uuid IS NULL branch instead of failing the uuid cast.
    [userId ?? null, fromISO, toISO],
  );
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.day) out.set(r.day, Math.round(Number(r.mi) * 10) / 10);
  }
  // Fold in Apple-Watch completions (runs that never synced to Strava).
  // Date comes from the workoutId prefix ("YYYY-MM-DD-<slug>"). Take the
  // MAX per day, not the sum, a run logged in BOTH Strava and a watch
  // completion must not double-count.
  if (userId) {
    const wc = await query<Row>(
      `SELECT LEFT(workout_id, 10) AS day, SUM(total_distance_mi) AS mi
         FROM workout_completions
        WHERE user_id = $1
          AND status IN ('completed','partial')
          AND total_distance_mi IS NOT NULL
          AND workout_id ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          AND LEFT(workout_id, 10) BETWEEN $2 AND $3
        GROUP BY LEFT(workout_id, 10)`,
      [userId, fromISO, toISO],
    ).catch(() => [] as Row[]);
    for (const r of wc) {
      if (!r.day) continue;
      const mi = Math.round(Number(r.mi) * 10) / 10;
      out.set(r.day, Math.max(out.get(r.day) ?? 0, mi));
    }
  }
  return out;
}

/**
 * Per-day longest-single-run rollup (mi). Drives the WORKOUT completion
 * gate: a 2.4-mi short threshold + a 5-mi easy later that day must NOT
 * mark the threshold "done" just because the day total clears 60% of
 * planned. We compare PLANNED ↔ LONGEST single run instead of the sum,
 * so the badge reflects whether THE WORKOUT got done — the weekly
 * mileage bar still uses sum (above).
 */
export async function getLongestRunByDate(userId: string | null | undefined, fromISO: string, toISO: string): Promise<Map<string, number>> {
  interface Row { day: string; mi: string }
  const out = new Map<string, number>();
  const rows = await query<Row>(
    `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day,
            MAX((data->>'distanceMi')::NUMERIC) AS mi
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3
      GROUP BY day`,
    [userId ?? null, fromISO, toISO],
  );
  for (const r of rows) {
    if (r.day) out.set(r.day, Math.round(Number(r.mi) * 10) / 10);
  }
  // Also fold in watch completions per day (max, not sum).
  if (userId) {
    const wc = await query<Row>(
      `SELECT LEFT(workout_id, 10) AS day, MAX(total_distance_mi) AS mi
         FROM workout_completions
        WHERE user_id = $1
          AND status IN ('completed','partial')
          AND total_distance_mi IS NOT NULL
          AND workout_id ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          AND LEFT(workout_id, 10) BETWEEN $2 AND $3
        GROUP BY LEFT(workout_id, 10)`,
      [userId, fromISO, toISO],
    ).catch(() => [] as Row[]);
    for (const r of wc) {
      if (!r.day) continue;
      const mi = Math.round(Number(r.mi) * 10) / 10;
      out.set(r.day, Math.max(out.get(r.day) ?? 0, mi));
    }
  }
  return out;
}

/**
 * Did the runner complete the planned workout on `dateISO`?
 *
 * Rule: the LONGEST single run for that date must be ≥ 60% of plannedMi.
 * A two-a-day where the second run was a short shake-out won't false-DONE
 * a long run; a short quality session followed by a separate easy won't
 * false-DONE the quality. Rest days (plannedMi=0) auto-false. Tolerance is
 * loose on purpose — a 9.4-mi long run is still a long run, we don't want
 * to penalize a runner for ending at 9.4 instead of 10.5.
 *
 * `completedMileageByDate` parameter name is retained for API compat, but
 * callers should now pass the LONGEST-by-date map (getLongestRunByDate).
 */
export function isWorkoutComplete(
  dateISO: string,
  plannedMi: number,
  longestByDate: Map<string, number>,
): boolean {
  if (plannedMi <= 0) return false;
  const longest = longestByDate.get(dateISO) ?? 0;
  if (longest <= 0) return false;
  return longest >= plannedMi * 0.6;
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
 * 3 mi, picks out a threshold/intervals day from easy runs.
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
