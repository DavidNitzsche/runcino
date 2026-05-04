/**
 * /api/strava/sync — pulls Strava activities + matches against the
 * races the client has saved, returns a per-slug match payload.
 *
 * POST body: { races: [{ slug, date, distanceMi }, ...] }
 * Response: { matches: { [slug]: ActivityResult | null }, fetchedAt }
 *
 * Server-side caches the activity list for 15 minutes (module-level
 * Map) so back-to-back page navs don't hammer Strava's rate-limit
 * (100 req / 15 min on the read endpoint). Cache key is the
 * STRAVA_REFRESH_TOKEN — invalidates automatically on token rotation.
 */

import {
  fetchActivities,
  findRaceMatch,
  activityToResult,
  type StravaActivity,
  type ActivityResult,
} from '../../../../lib/strava';

type ActivitiesCache = { fetchedAt: number; activities: StravaActivity[]; tokenKey: string };
let cache: ActivitiesCache | null = null;
const TTL_MS = 15 * 60 * 1000;

async function getActivities(): Promise<StravaActivity[]> {
  const tokenKey = process.env.STRAVA_REFRESH_TOKEN ?? '';
  if (cache && cache.tokenKey === tokenKey && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.activities;
  }
  // Pull all activities from the start of the calendar year. Plenty
  // of headroom for race-history matching without paging through years.
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
  const activities = await fetchActivities({ after: Math.floor(yearStart) });
  cache = { fetchedAt: Date.now(), activities, tokenKey };
  return activities;
}

interface RaceQuery { slug: string; date: string; distanceMi: number }

export async function POST(req: Request) {
  if (!process.env.STRAVA_REFRESH_TOKEN) {
    return Response.json({
      matches: {},
      fetchedAt: null,
      error: 'STRAVA_REFRESH_TOKEN not set — visit /api/strava/connect to capture it.',
    }, { status: 200 });  // 200 so the client treats it as a no-op, not a hard fail
  }

  let body: { races?: RaceQuery[] };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const races = Array.isArray(body.races) ? body.races : [];

  let activities: StravaActivity[];
  try {
    activities = await getActivities();
  } catch (e) {
    return Response.json({ matches: {}, fetchedAt: null, error: String(e) }, { status: 200 });
  }

  const matches: Record<string, ActivityResult | null> = {};
  for (const r of races) {
    if (!r.slug || !r.date) { matches[r.slug] = null; continue; }
    const match = findRaceMatch(activities, r.date, r.distanceMi || 0);
    matches[r.slug] = match ? activityToResult(match, r.distanceMi) : null;
  }

  return Response.json({
    matches,
    fetchedAt: cache?.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
  });
}

/** GET fallback — returns the cached activity list as JSON, useful
 *  for debugging "did Strava actually return anything?" without
 *  needing a saved race to match against. */
export async function GET() {
  if (!process.env.STRAVA_REFRESH_TOKEN) {
    return Response.json({
      activities: [],
      error: 'STRAVA_REFRESH_TOKEN not set — visit /api/strava/connect to capture it.',
    }, { status: 200 });
  }
  try {
    const activities = await getActivities();
    return Response.json({
      activities: activities.map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        sport_type: a.sport_type,
        start_date_local: a.start_date_local,
        distance_mi: Math.round(a.distance / 1609.344 * 100) / 100,
        moving_time_s: a.moving_time,
        avg_hr: a.average_heartrate ?? null,
        elev_gain_ft: Math.round((a.total_elevation_gain ?? 0) * 3.28084),
      })),
      fetchedAt: cache?.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
    });
  } catch (e) {
    return Response.json({ activities: [], error: String(e) }, { status: 200 });
  }
}
