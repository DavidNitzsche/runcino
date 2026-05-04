/**
 * Pure helpers for the activities endpoint — kept separate from
 * route.ts so server-side modules (lib/strava-cache.ts) can import
 * the normalizer without dragging the GET handler into their bundle.
 *
 * NormalizedActivity is the wire shape consumed by:
 *   - /api/strava/activities (GET)
 *   - lib/strava-activities.ts (client cache + hook)
 *   - lib/strava-cache.ts (server-side Postgres cache)
 */

import { type StravaActivity } from '../../../../lib/strava';

export interface NormalizedActivity {
  id: number;
  name: string;
  type: string;
  sportType: string | null;
  workoutType: number | null;
  startLocal: string;
  date: string;
  distanceMi: number;
  movingTimeS: number;
  elapsedTimeS: number;
  paceSPerMi: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  elevGainFt: number;
  avgSpeedMph: number | null;
  startLatLng: [number, number] | null;
  endLatLng: [number, number] | null;
  summaryPolyline: string | null;
  kudosCount: number;
  achievementCount: number;
  sufferScore: number | null;
}

export function normalizeActivity(a: StravaActivity): NormalizedActivity {
  const distMi = a.distance / 1609.344;
  const paceSPerMi = distMi > 0 ? Math.round(a.moving_time / distMi) : 0;
  const startLocal = a.start_date_local || a.start_date;
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    sportType: a.sport_type ?? null,
    workoutType: a.workout_type ?? null,
    startLocal,
    date: startLocal.slice(0, 10),
    distanceMi: Math.round(distMi * 100) / 100,
    movingTimeS: a.moving_time,
    elapsedTimeS: a.elapsed_time,
    paceSPerMi,
    avgHr: a.average_heartrate ?? null,
    maxHr: a.max_heartrate ?? null,
    avgCadence: a.average_cadence ?? null,
    elevGainFt: Math.round((a.total_elevation_gain ?? 0) * 3.28084),
    avgSpeedMph: a.average_speed != null ? Math.round(a.average_speed * 2.23694 * 10) / 10 : null,
    startLatLng: a.start_latlng && a.start_latlng.length === 2 ? a.start_latlng : null,
    endLatLng: a.end_latlng && a.end_latlng.length === 2 ? a.end_latlng : null,
    summaryPolyline: a.map?.summary_polyline ?? null,
    kudosCount: a.kudos_count ?? 0,
    achievementCount: a.achievement_count ?? 0,
    sufferScore: a.suffer_score ?? null,
  };
}
