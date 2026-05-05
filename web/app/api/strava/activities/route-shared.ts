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
  /** Canonical-distance finish time, sourced from Strava's best_efforts
   *  (only present when activity detail has been fetched). For a half
   *  marathon ran as a 13.4 mi activity, this is the time at exactly
   *  13.1 mi — i.e., the time you crossed the finish line, not the
   *  total time on watch. Used by /log race rows so the displayed
   *  finish matches what the chip clock said. */
  canonicalFinishS: number | null;
  canonicalDistanceMi: number | null;
  canonicalLabel: string | null;
}

export function normalizeActivity(a: StravaActivity): NormalizedActivity {
  const distMi = a.distance / 1609.344;
  const paceSPerMi = distMi > 0 ? Math.round(a.moving_time / distMi) : 0;
  const startLocal = a.start_date_local || a.start_date;
  // Canonical-distance best_effort — only present when we have detail.
  // Pick the best_effort whose distance is closest to a canonical race
  // distance AND within 8% of the activity's actual distance (so a
  // 13.4mi run picks the half-marathon best_effort, not the marathon).
  const canonical = pickCanonicalBestEffort(a, distMi);

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
    canonicalFinishS: canonical?.elapsedS ?? null,
    canonicalDistanceMi: canonical?.distMi ?? null,
    canonicalLabel: canonical?.label ?? null,
  };
}

/** Pick the canonical-distance best_effort that matches this run.
 *  E.g., a 13.4 mi half marathon picks the "Half-Marathon" best_effort
 *  with elapsed_time ≈ 1:32:42 (the chip-time finish, not the 1:34:54
 *  total moving time). Returns null when activity has no best_efforts
 *  cached or no canonical match within tolerance. */
function pickCanonicalBestEffort(a: StravaActivity, distMi: number): { label: string; distMi: number; elapsedS: number } | null {
  if (!a.best_efforts || a.best_efforts.length === 0) return null;
  const CANON: Array<{ regex: RegExp; label: string; mi: number }> = [
    { regex: /^marathon$/i,           label: 'Marathon', mi: 26.22 },
    { regex: /^half[-\s]?marathon$/i, label: 'Half',     mi: 13.10 },
    { regex: /^10\s*k$/i,             label: '10K',      mi: 6.21  },
    { regex: /^5\s*k$/i,              label: '5K',       mi: 3.10  },
    { regex: /^1\s*mile$/i,           label: '1 mi',     mi: 1.00  },
  ];
  // Prefer the canonical that's closest to the activity's actual
  // distance — so a 13.4 mi run picks Half (13.10) over 10K (6.21),
  // and a 26.7 mi run picks Marathon (26.22).
  for (const c of CANON) {
    const tol = c.mi * 0.08;
    if (Math.abs(distMi - c.mi) > tol) continue;
    const eff = a.best_efforts.find(b => c.regex.test(b.name));
    if (eff) return { label: c.label, distMi: c.mi, elapsedS: eff.elapsed_time };
  }
  return null;
}
