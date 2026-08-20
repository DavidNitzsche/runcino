/**
 * lib/strava/streams.ts · Course geometry from a Strava activity.
 *
 * ── Why ──────────────────────────────────────────────────────────────────
 *
 * `course_library` holds elevation for courses we have no GPS track for, and
 * some of those hand-typed figures are wrong — Big Sur is stored at +260 ft
 * net against a published −346, and nothing in the app can correct it because
 * `resolveCourseElevation` has no geometry to measure. Correctly, it falls
 * through to the curated value and keeps the error.
 *
 * But we are not actually short of data. Six race rows carry a
 * `stravaActivityId` from the runner having run the thing, and Strava will
 * hand back the full altitude series for any activity the athlete owns. That
 * is the measurement the resolver wants.
 *
 * ── Why streams rather than the polyline ─────────────────────────────────
 *
 * `actual_result.summaryPolyline` is already stored for several of these
 * races, and it is tempting because it needs no API call. It is useless here:
 * an encoded polyline carries latitude and longitude only. There is no
 * elevation in it at all, and elevation is the entire point. The streams
 * endpoint is the only source that carries altitude.
 *
 * ── What comes back ──────────────────────────────────────────────────────
 *
 * `GET /activities/{id}/streams?keys=latlng,altitude,distance` returns one
 * object per requested key, each with a parallel `data` array indexed the
 * same way. Altitude is metres, distance is metres, latlng is [lat, lng]
 * pairs — matching the units `parseGPX` already produces, so the output slots
 * into `races.course_geometry` without conversion.
 *
 * Strava's altitude series is already smoothed and barometrically corrected
 * on their side, which makes it a better input than a raw GPX export from the
 * same watch. It is still a runner's recording of the course and not the
 * certified course, so it goes through `assessGeometryConfidence` like any
 * other trace — this module only fetches, it never decides what to trust.
 */
import { getStravaToken } from './auth';
import { elevationProfileFt } from '@/lib/race/course-elevation';

const STRAVA_API = 'https://www.strava.com/api/v3';

export interface StravaStreamSet {
  latlng: Array<[number, number]> | null;
  altitude: number[] | null;
  distance: number[] | null;
}

export class StravaStreamsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'StravaStreamsError';
  }
}

/**
 * Fetch the latlng / altitude / distance streams for one activity.
 *
 * Throws rather than returning null so a backfill cannot quietly record
 * "no geometry" for an activity that actually failed to fetch — the
 * difference between absent and unfetched is exactly the distinction this
 * whole area of the codebase keeps getting wrong.
 */
export async function fetchActivityStreams(
  userId: string,
  activityId: string | number,
): Promise<StravaStreamSet> {
  const token = await getStravaToken(userId);
  const url = `${STRAVA_API}/activities/${activityId}/streams` +
    `?keys=latlng,altitude,distance&key_by_type=true`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 429) {
    throw new StravaStreamsError('Strava rate limit reached — back off and retry later', 429);
  }
  if (res.status === 404) {
    throw new StravaStreamsError(`activity ${activityId} not found, or not owned by this athlete`, 404);
  }
  if (!res.ok) {
    throw new StravaStreamsError(`Strava streams request failed: ${res.status} ${res.statusText}`, res.status);
  }

  const body = (await res.json()) as Record<string, { data?: unknown } | undefined>;
  const series = <T,>(key: string): T[] | null => {
    const d = body?.[key]?.data;
    return Array.isArray(d) ? (d as T[]) : null;
  };

  return {
    latlng: series<[number, number]>('latlng'),
    altitude: series<number>('altitude'),
    distance: series<number>('distance'),
  };
}

export interface StreamGeometry {
  source: 'strava_match';
  trackPoints: { lat: number; lon: number; ele: number | null }[];
  distance_mi: number | null;
  elevation_gain_ft: number | null;
  elevation_loss_ft: number | null;
  net_elevation_ft: number | null;
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null;
  strava_activity_id: string;
}

/**
 * Convert a stream set into the `course_geometry` shape.
 *
 * Returns null when the streams carry no usable elevation — an activity
 * recorded without altitude gives us nothing, and writing a zeroed profile
 * would assert a flat course we never measured.
 *
 * `distance_mi` comes from Strava's own distance stream (its last value is
 * the activity length in metres) rather than being re-derived from latlng,
 * so it agrees with the figure Strava shows the runner.
 */
export function streamsToGeometry(
  streams: StravaStreamSet,
  activityId: string | number,
): StreamGeometry | null {
  const { latlng, altitude, distance } = streams;
  if (!altitude || altitude.length < 2) return null;

  const n = latlng ? Math.min(latlng.length, altitude.length) : altitude.length;
  const trackPoints: StreamGeometry['trackPoints'] = [];
  for (let i = 0; i < n; i++) {
    const ll = latlng?.[i];
    const ele = Number(altitude[i]);
    trackPoints.push({
      lat: ll ? Number(ll[0]) : NaN,
      lon: ll ? Number(ll[1]) : NaN,
      ele: isFinite(ele) ? ele : null,
    });
  }
  if (trackPoints.length < 2) return null;

  const profile = elevationProfileFt(
    trackPoints.map((p) => p.ele).filter((e): e is number => e != null),
  );

  const meters = distance && distance.length ? Number(distance[distance.length - 1]) : NaN;
  const distance_mi = isFinite(meters) && meters > 0
    ? +(meters / 1609.344).toFixed(2)
    : null;

  const lats = trackPoints.map((p) => p.lat).filter((x) => isFinite(x));
  const lons = trackPoints.map((p) => p.lon).filter((x) => isFinite(x));
  const bbox = lats.length && lons.length
    ? {
        minLat: Math.min(...lats), maxLat: Math.max(...lats),
        minLon: Math.min(...lons), maxLon: Math.max(...lons),
      }
    : null;

  return {
    source: 'strava_match',
    trackPoints,
    distance_mi,
    elevation_gain_ft: profile?.gainFt ?? null,
    elevation_loss_ft: profile?.lossFt ?? null,
    net_elevation_ft: profile?.netFt ?? null,
    bbox,
    strava_activity_id: String(activityId),
  };
}
