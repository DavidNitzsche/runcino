/**
 * /api/cron/coach-refresh — daily cache pre-warm.
 *
 * Configured as a Railway cron job (or any external scheduler) to
 * fire shortly after midnight America/Los_Angeles. Regenerates
 * coach_today_cache so the runner's first dashboard visit of the
 * new day is instant rather than blocking on the LLM brief.
 *
 * Also serves as a safety net for missed Strava webhook events —
 * even if a run's webhook never fires, the next-morning cron pulls
 * the latest activities and rebuilds the cache.
 *
 * Auth: requires CRON_SECRET in `Authorization: Bearer ...` header.
 * Railway cron jobs can set this via env var; manual triggers can
 * use the same header.
 *
 * Suggested cron schedule (Railway):
 *   0 8 * * *      (08:00 UTC = 00:00 PT before DST / 01:00 PDT)
 * Or run twice to cover both:
 *   0 7,8 * * *
 *
 * Returns:
 *   200 { ok, key, computedAtMs } on success
 *   401 if auth missing/wrong
 *   500 on regeneration failure
 */

import { regenerateCoachTodayCache } from '../../../../lib/coach-today-cache';
import { refreshActivities } from '../../../../lib/strava-cache';

export async function GET(req: Request) {
  // Bearer-token auth so a public cron URL isn't free-for-all.
  // CRON_SECRET should be a long random string set in env.
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return new Response('CRON_SECRET not configured', { status: 500 });
  }
  if (auth !== `Bearer ${expected}`) {
    return new Response('unauthorized', { status: 401 });
  }

  try {
    // Safety-net Strava sync — webhook is push-driven, but if it
    // missed an event we'll catch it here.
    await refreshActivities().catch(() => undefined);
    const result = await regenerateCoachTodayCache();
    // eslint-disable-next-line no-console
    console.log('[cron] coach cache regenerated', result.key, `${result.computedAtMs}ms`);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// POST mirror for cron services that prefer it.
export const POST = GET;
