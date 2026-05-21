/**
 * GET /api/admin/readiness-diagnostic
 *
 * Read-only diagnostic: runs computeReadinessScore for the owner (the same
 * userId the iPhone resolves to) and returns the full finding plus the raw
 * inputs that fed it, so we can see EXACTLY why the readiness ring is null
 * vs a number — without guessing from the client.
 *
 * Auth: admin session OR Authorization: Bearer <ADMIN_OPERATIONAL_TOKEN>
 * (binds to the legacy owner). Opt-in per requireAdminOrOpToken scope.
 */

import { requireAdminOrOpToken } from '@/lib/auth';
import { computeReadinessScore } from '@/lib/readiness-score';
import { computeStravaGap } from '@/lib/strava-gap';
import { gatherCoachState } from '@/lib/coach-state';
import { query } from '@/lib/db';

export async function GET(req: Request) {
  let admin;
  try {
    admin = await requireAdminOrOpToken(req);
  } catch {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const out: Record<string, unknown> = { userId: admin.id, email: admin.email, today };

  // How many activities are visible under this userId (the OR IS NULL clause
  // the readiness query uses) vs strictly under the UUID vs legacy NULL.
  try {
    const counts = await query<{ scope: string; n: string }>(
      `SELECT 'matches_query' AS scope, COUNT(*)::text AS n FROM strava_activities
         WHERE (user_uuid = $1 OR user_uuid IS NULL) AND (data->>'distanceMi')::NUMERIC > 0
       UNION ALL
       SELECT 'under_uuid', COUNT(*)::text FROM strava_activities
         WHERE user_uuid = $1 AND (data->>'distanceMi')::NUMERIC > 0
       UNION ALL
       SELECT 'under_null', COUNT(*)::text FROM strava_activities
         WHERE user_uuid IS NULL AND (data->>'distanceMi')::NUMERIC > 0`,
      [admin.id],
    );
    out.activityCounts = counts;
  } catch (e) {
    out.activityCountsError = e instanceof Error ? e.message : String(e);
  }

  // Gap / suspension state (the only thing that nulls the score).
  try {
    out.stravaGap = await computeStravaGap(admin.id, today);
  } catch (e) {
    out.stravaGapError = e instanceof Error ? e.message : String(e);
  }

  // Recovery vitals as the engine sees them server-side.
  try {
    const state = await gatherCoachState({ userId: admin.id });
    out.recovery = state.recovery;
  } catch (e) {
    out.recoveryError = e instanceof Error ? e.message : String(e);
  }

  // The actual finding — score, state, recommendation, inputs, suppressReason.
  try {
    const finding = await computeReadinessScore(admin.id, today, null, null);
    out.finding = finding;
  } catch (e) {
    out.findingError = e instanceof Error ? e.message : String(e);
    out.findingStack = e instanceof Error ? e.stack : undefined;
  }

  return Response.json({ ok: true, ...out });
}
