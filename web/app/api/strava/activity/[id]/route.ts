/**
 * /api/strava/activity/[id], full detail for one activity.
 *
 * Drives /runs/[id]: route polyline + per-mile splits + best efforts +
 * description + suffer score + cadence.
 *
 * On first request, hits Strava's /activities/{id}?include_all_efforts
 * endpoint and caches the result in the `detail` JSONB column on
 * `strava_activities`. Subsequent requests serve from Postgres.
 */

import { activityToResult, fetchActivityDetail, type StravaActivity } from '../../../../../lib/strava';
import { getCachedDetail, setCachedDetail } from '../../../../../lib/strava-cache';
import { normalizeActivity } from '../../activities/route-shared';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.STRAVA_REFRESH_TOKEN) {
    return Response.json({ activity: null, error: 'STRAVA_REFRESH_TOKEN not set.' }, { status: 200 });
  }
  const numId = Number(id);
  if (!Number.isFinite(numId) || numId <= 0) {
    return Response.json({ activity: null, error: 'Invalid activity id.' }, { status: 400 });
  }

  try {
    const cached = await getCachedDetail(numId);
    let detail: StravaActivity;
    if (cached?.detail) {
      detail = cached.detail as StravaActivity;
    } else {
      detail = await fetchActivityDetail(numId);
      await setCachedDetail(numId, detail);
    }

    const summary = normalizeActivity(detail);
    const result = activityToResult(detail);
    return Response.json({
      activity: {
        ...summary,
        miles: result.miles ?? null,
        bestEfforts: result.bestEfforts ?? null,
        description: detail.description ?? null,
      },
    });
  } catch (e) {
    return Response.json({ activity: null, error: String(e) }, { status: 200 });
  }
}
