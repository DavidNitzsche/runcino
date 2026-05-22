/**
 * Pre-workout briefing · V1 · /overview TodayCard
 *
 * "Coach's morning note" rendered above the workout action buttons.
 * Pulls together the inputs a runner would normally check in 3-4
 * different places before stepping out:
 *
 *   - Weather forecast (NOAA, anchored to user's most-recent
 *     workout start coords, that's the de-facto "where I run from")
 *   - Recommended shoe from the rotation (lib/shoe-picker.ts)
 *   - Last similar session (same workout type), how it went, when
 *   - The workout's target pace range (already in the calling
 *     scope as todayPace string)
 *
 * Returns null when there's nothing useful to surface, caller skips
 * the briefing render rather than showing an empty/half-empty card.
 *
 * Server-only (hits DB + Open-Meteo network). Caller awaits in the
 * /overview SSR pass.
 */

import { query } from './db';
import { fetchNoaaWeather } from './weather';
import { listShoes } from './shoe-store';
import { pickFromShoes } from './shoe-picker';

export interface PreWorkoutBriefing {
  weather: {
    temperatureF: number;
    shortForecast: string;
    windMph: number;
    label: string;       // "Morning (7am)" or "This afternoon"
  } | null;
  shoe: {
    brand: string;
    model: string;
    color: string | null;
    runTypesMatched: string[];
    mileage: number;
    mileageCap: number | null;
    /** % of mileage cap if cap is set; null otherwise. */
    wearPct: number | null;
  } | null;
  lastSimilar: {
    date: string;
    name: string;
    distanceMi: number;
    paceSPerMi: number;
    avgHr: number | null;
    /** Plain-English age, "yesterday", "5 days ago", "3 weeks ago". */
    ageLabel: string;
  } | null;
  /** Has any data → render. False = skip the whole card. */
  hasContent: boolean;
}

/** Map workout type strings (from todayDay.type / coach-engine) to
 *  the shoe-picker's RunType enum. Mirrors the mapping in
 *  lib/shoe-picker.ts but stays local to keep the briefing self-
 *  contained. */
function shoeRunTypeFor(workoutType: string): string {
  switch (workoutType) {
    case 'race':            return 'race';
    case 'long':            return 'long';
    case 'tempo':           return 'tempo';
    case 'threshold':       return 'tempo';
    case 'sub_threshold':   return 'tempo';
    case 'threshold_intervals': return 'tempo';
    case 'intervals':       return 'intervals';
    case 'recovery':        return 'recovery';
    case 'shakeout':        return 'recovery';
    case 'easy':
    case 'general_aerobic': return 'easy';
    default:                return 'easy';
  }
}

/** Plain-English age label for the last-similar-session date. */
function ageLabel(dateIso: string, todayIso: string): string {
  const a = Date.parse(dateIso + 'T12:00:00Z');
  const b = Date.parse(todayIso + 'T12:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return dateIso;
  const days = Math.round((b - a) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 30) return `${Math.round(days / 7)} weeks ago`;
  if (days < 60) return 'about a month ago';
  return `${Math.round(days / 30)} months ago`;
}

/** Fetch the user's most-recent activity start coordinates. Used as
 *  the de-facto home-base for the weather forecast. Returns null
 *  when no activity has coords (e.g., manual entries or treadmill). */
async function getRecentRunCoords(userId: string): Promise<[number, number] | null> {
  const rows = await query<{ lat: string; lon: string }>(
    `SELECT
        ((data->'startLatLng'->>0)::NUMERIC)::TEXT AS lat,
        ((data->'startLatLng'->>1)::NUMERIC)::TEXT AS lon
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND data->'startLatLng' IS NOT NULL
        AND jsonb_array_length(data->'startLatLng') = 2
      ORDER BY (data->>'date') DESC
      LIMIT 1`,
    [userId],
  );
  const r = rows[0];
  if (!r?.lat || !r?.lon) return null;
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lat, lon];
}

/** Most recent activity that matches today's workout-type bucket.
 *  "Similar" is intentionally broad: easy = easy/recovery/long buckets
 *  share a class for context purposes. Quality (T, I, R) all share a
 *  class. This gives the runner real "last time I did this" anchor
 *  without false precision. */
async function getLastSimilarSession(
  userId: string,
  todayWorkoutType: string,
  todayIso: string,
): Promise<PreWorkoutBriefing['lastSimilar']> {
  const isQuality = todayWorkoutType === 'threshold'
    || todayWorkoutType === 'sub_threshold'
    || todayWorkoutType === 'threshold_intervals'
    || todayWorkoutType === 'intervals'
    || todayWorkoutType === 'tempo';
  const isLong = todayWorkoutType === 'long';
  const isEasy = !isQuality && !isLong;

  // We only have `data->>'workoutType'` (Strava's enum: 0=default,
  // 1=race, 2=long, 3=workout) reliably across all rows. Combine with
  // distance heuristics for class match.
  //   - Long: workoutType=2 OR distance > 9 mi
  //   - Quality: workoutType=3 OR (avg pace fast AND distance 4-10 mi)
  //, pure quality detection is the L7 signal's job. Here we just
  //     pick the most recent workout-tagged session as a proxy.
  //   - Easy: default bucket.
  let where = '';
  if (isLong) {
    where = `AND (
      COALESCE((data->>'workoutType')::INTEGER, 0) = 2
      OR (data->>'distanceMi')::NUMERIC >= 9
    )`;
  } else if (isQuality) {
    where = `AND COALESCE((data->>'workoutType')::INTEGER, 0) = 3`;
  } else {
    // Easy, exclude races + workouts + longs
    where = `AND COALESCE((data->>'workoutType')::INTEGER, 0) NOT IN (1, 2, 3)
             AND (data->>'distanceMi')::NUMERIC < 9`;
  }

  const rows = await query<{
    date: string; name: string;
    distance_mi: string; pace_s: string; avg_hr: string | null;
  }>(
    `SELECT
        data->>'date'                            AS date,
        COALESCE(data->>'name', 'Run')           AS name,
        (data->>'distanceMi')::NUMERIC           AS distance_mi,
        ((data->>'movingTimeS')::NUMERIC / NULLIF((data->>'distanceMi')::NUMERIC, 0))::NUMERIC AS pace_s,
        (data->>'avgHr')::NUMERIC                AS avg_hr
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') < $2
        AND (data->>'movingTimeS')::NUMERIC > 0
        AND (data->>'distanceMi')::NUMERIC > 0
        ${where}
      ORDER BY (data->>'date') DESC
      LIMIT 1`,
    [userId, todayIso],
  );
  const r = rows[0];
  if (!r) return null;
  // Used `isEasy` only as a documentation aid above, the `where` branch
  // covers it. Reference it once so eslint doesn't ding the unused.
  void isEasy;
  return {
    date: r.date,
    name: r.name,
    distanceMi: Math.round(Number(r.distance_mi) * 10) / 10,
    paceSPerMi: Math.round(Number(r.pace_s)),
    avgHr: r.avg_hr != null ? Math.round(Number(r.avg_hr)) : null,
    ageLabel: ageLabel(r.date, todayIso),
  };
}

export async function buildPreWorkoutBriefing(
  userId: string,
  todayIso: string,
  todayWorkoutType: string,
): Promise<PreWorkoutBriefing> {
  // Fan-out: weather + shoe rotation + last similar in parallel.
  const [coords, shoes, lastSimilar] = await Promise.all([
    getRecentRunCoords(userId),
    listShoes().catch(() => []),
    getLastSimilarSession(userId, todayWorkoutType, todayIso).catch(() => null),
  ]);

  // Weather, only if we have coords. fetchNoaaWeather can be slow or
  // fail; never block the briefing on it.
  let weather: PreWorkoutBriefing['weather'] = null;
  if (coords) {
    try {
      const summary = await fetchNoaaWeather(coords[0], coords[1]);
      if (summary?.start_period) {
        const sp = summary.start_period;
        const wMin = sp.wind_speed_mph_min ?? 0;
        const wMax = sp.wind_speed_mph_max ?? 0;
        const wind = Math.round((wMin + wMax) / 2);
        weather = {
          temperatureF: sp.temperature_f,
          shortForecast: sp.short_forecast,
          windMph: wind,
          label: sp.name,
        };
      }
    } catch { /* weather optional */ }
  }

  // Shoe pick from the rotation.
  let shoe: PreWorkoutBriefing['shoe'] = null;
  if (shoes.length > 0) {
    const shoeId = pickFromShoes(shoes, todayWorkoutType);
    const picked = shoeId != null ? shoes.find((s) => s.id === shoeId) : null;
    if (picked) {
      const wearPct = picked.mileage_cap && picked.mileage_cap > 0
        ? Math.round((picked.mileage / picked.mileage_cap) * 100)
        : null;
      shoe = {
        brand: picked.brand,
        model: picked.model,
        color: picked.color,
        runTypesMatched: picked.run_types,
        mileage: Math.round(picked.mileage),
        mileageCap: picked.mileage_cap,
        wearPct,
      };
    }
  }

  const hasContent = !!(weather || shoe || lastSimilar);
  return { weather, shoe, lastSimilar, hasContent };
}
