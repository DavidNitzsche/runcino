/**
 * Watch GPS route + per-mile splits storage.
 *
 * Apple-Health-sourced companion to lib/watch-completion.ts. The iPhone
 * reads an HKWorkoutRoute for a watch-recorded run (one that never synced
 * to Strava, so /api/runs/by-date has no map/splits for it), encodes the
 * path as a Google polyline + computes per-mile splits on-device, and
 * POSTs here via /api/watch/route. /api/runs/by-date then serves the
 * polyline + splits so the recap shows a map for watch-only runs.
 *
 * IDEMPOTENCY: UNIQUE(user_id, started_at), re-uploading the same workout
 * (the Health sync re-runs on a rolling window) UPSERTs rather than
 * duplicating.
 */

import { query } from './db';

export interface WatchRouteSplitInput {
  mile: number;
  paceSPerMi: number;
  avgHr?: number | null;
  elevDeltaFt?: number | null;
}

export interface WatchRouteInput {
  startedAt: string;     // ISO 8601, dedupe key
  routeDate: string;     // YYYY-MM-DD local run day
  distanceMi?: number | null;
  durationSec?: number | null;
  polyline: string;      // encoded polyline (Google algorithm, precision 5)
  startLat?: number | null;
  startLng?: number | null;
  endLat?: number | null;
  endLng?: number | null;
  splits?: WatchRouteSplitInput[];
  source?: string;       // defaults to 'apple_health'
}

export interface StoreRouteResult {
  ok: boolean;
  routeId?: string;
  error?: string;
}

const MAX_POLYLINE_LEN = 400_000;   // ~ a very long ultra at full resolution
const MAX_SPLITS = 300;
const MAX_DISTANCE_MI = 200;
const MAX_DURATION_SEC = 12 * 60 * 60;
const PACE_MIN_S = 120;
const PACE_MAX_S = 3600;
const FUTURE_SLACK_MS = 12 * 60 * 60 * 1000;
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function validate(r: WatchRouteInput): string | null {
  if (typeof r.polyline !== 'string' || r.polyline.length === 0 || r.polyline.length > MAX_POLYLINE_LEN) {
    return 'polyline must be a non-empty string under the size cap';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.routeDate)) return 'routeDate must be YYYY-MM-DD';
  const started = Date.parse(r.startedAt);
  if (!Number.isFinite(started)) return 'startedAt is not a valid ISO datetime';
  const now = Date.now();
  if (started > now + FUTURE_SLACK_MS) return 'startedAt is in the future';
  if (started < now - MAX_AGE_MS) return 'startedAt is > 365 days old';
  if (r.distanceMi != null && (typeof r.distanceMi !== 'number' || r.distanceMi < 0 || r.distanceMi > MAX_DISTANCE_MI)) {
    return `distanceMi must be 0..${MAX_DISTANCE_MI}`;
  }
  if (r.durationSec != null && (typeof r.durationSec !== 'number' || r.durationSec < 0 || r.durationSec > MAX_DURATION_SEC)) {
    return `durationSec must be 0..${MAX_DURATION_SEC}`;
  }
  if (r.splits != null) {
    if (!Array.isArray(r.splits) || r.splits.length > MAX_SPLITS) return `splits must be an array under ${MAX_SPLITS}`;
    for (let i = 0; i < r.splits.length; i++) {
      const s = r.splits[i];
      if (!Number.isInteger(s.mile) || s.mile < 0) return `splits[${i}].mile invalid`;
      if (typeof s.paceSPerMi !== 'number' || s.paceSPerMi < PACE_MIN_S || s.paceSPerMi > PACE_MAX_S) {
        return `splits[${i}].paceSPerMi outside [${PACE_MIN_S}, ${PACE_MAX_S}]`;
      }
    }
  }
  return null;
}

export async function storeRoute(userId: string, r: WatchRouteInput): Promise<StoreRouteResult> {
  const err = validate(r);
  if (err) return { ok: false, error: err };

  // Sanitize splits to the stored shape.
  const splits = (r.splits ?? []).map((s) => ({
    mile: s.mile,
    paceSPerMi: Math.round(s.paceSPerMi),
    avgHr: num(s.avgHr) != null ? Math.round(num(s.avgHr)!) : null,
    elevDeltaFt: num(s.elevDeltaFt) != null ? Math.round(num(s.elevDeltaFt)!) : null,
  }));

  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO workout_routes
         (user_id, route_date, started_at, distance_mi, duration_sec,
          polyline, start_lat, start_lng, end_lat, end_lng, splits, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (user_id, started_at)
       DO UPDATE SET route_date   = EXCLUDED.route_date,
                     distance_mi  = EXCLUDED.distance_mi,
                     duration_sec = EXCLUDED.duration_sec,
                     polyline     = EXCLUDED.polyline,
                     start_lat    = EXCLUDED.start_lat,
                     start_lng    = EXCLUDED.start_lng,
                     end_lat      = EXCLUDED.end_lat,
                     end_lng      = EXCLUDED.end_lng,
                     splits       = EXCLUDED.splits,
                     source       = EXCLUDED.source,
                     recorded_at  = NOW()
       RETURNING id`,
      [
        userId,
        r.routeDate,
        new Date(r.startedAt).toISOString(),
        num(r.distanceMi),
        r.durationSec != null ? Math.round(r.durationSec) : null,
        r.polyline,
        num(r.startLat), num(r.startLng), num(r.endLat), num(r.endLng),
        JSON.stringify(splits),
        (typeof r.source === 'string' && r.source) || 'apple_health',
      ],
    );
    return { ok: true, routeId: rows[0]?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'database error' };
  }
}

/** The best (longest) stored route for a user on a given local date, or null. */
export async function getRouteForDate(userId: string, dateISO: string): Promise<{
  polyline: string; startLat: number | null; startLng: number | null;
  endLat: number | null; endLng: number | null;
  splits: Array<{ mile: number; paceSPerMi: number; avgHr: number | null; elevDeltaFt: number | null }>;
} | null> {
  const rows = await query<{
    polyline: string; start_lat: number | null; start_lng: number | null;
    end_lat: number | null; end_lng: number | null; splits: unknown;
  }>(
    `SELECT polyline, start_lat, start_lng, end_lat, end_lng, splits
       FROM workout_routes
      WHERE user_id = $1 AND route_date = $2
      ORDER BY distance_mi DESC NULLS LAST
      LIMIT 1`,
    [userId, dateISO],
  ).catch(() => []);
  const row = rows[0];
  if (!row) return null;
  const splits = Array.isArray(row.splits)
    ? (row.splits as Array<{ mile: number; paceSPerMi: number; avgHr: number | null; elevDeltaFt: number | null }>)
    : [];
  return {
    polyline: row.polyline,
    startLat: row.start_lat, startLng: row.start_lng,
    endLat: row.end_lat, endLng: row.end_lng,
    splits,
  };
}
