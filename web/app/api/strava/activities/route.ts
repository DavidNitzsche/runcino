/**
 * /api/strava/activities — full normalized list of Strava runs YTD.
 *
 * Drives the /log feed, the / Overview rollups (weekly miles, YTD,
 * fun stats), the /health HR + cadence trends, and the /training
 * last-7-days strip.
 *
 * GET response: { activities: NormalizedActivity[], fetchedAt }
 *
 * The cache is shared with /api/strava/sync via lib/strava-cache.ts
 * (Postgres-backed, 15 min TTL on upstream Strava) so the whole app
 * rides one Strava read.
 */

import { getCachedActivities } from '../../../../lib/strava-cache';

export async function GET() {
  if (!process.env.STRAVA_REFRESH_TOKEN) {
    return Response.json({
      activities: [],
      fetchedAt: null,
      error: 'STRAVA_REFRESH_TOKEN not set — visit /api/strava/connect to capture it.',
    }, { status: 200 });
  }
  try {
    const { activities, fetchedAt } = await getCachedActivities();
    return Response.json({
      activities,
      fetchedAt: new Date(fetchedAt).toISOString(),
    });
  } catch (e) {
    return Response.json({ activities: [], fetchedAt: null, error: String(e) }, { status: 200 });
  }
}
