/**
 * POST /api/strava/push-recent
 *
 * Push every recent run that hasn't been pushed yet. The "one-shot
 * backfill" companion to the auto-push toggle · turning auto-push ON
 * affects future runs only, so when a runner first enables it they
 * usually want to push their last N days too.
 *
 * Body (optional):
 *   { days?: number  · how far back to look. Defaults to 14.
 *     dryRun?: boolean  · when true, only LIST the runs that would
 *       push without actually uploading. Default false. }
 *
 * Returns:
 *   { ok, candidates: number,
 *     pushed: [{ runId, status, stravaActivityId? }],
 *     skipped: [{ runId, reason }] }
 *
 * Idempotent · `pushRunToStrava` is itself idempotent on run_id, so
 * a re-POST won't re-upload anything that already landed. Runs that
 * previously failed get re-attempted (one of the design points of
 * making pushRunToStrava re-retry failed prior pushes).
 *
 * Doctrine notes:
 *   · Only canonical rows (mergedIntoId NULL · absorbed_into_canonical_at NULL)
 *     are eligible · we don't push duplicate dedup-loser rows.
 *   · Runs that came FROM Strava (source IN ('strava', 'strava_webhook'))
 *     are skipped · they're already on Strava, no point pushing them back.
 *   · Default 14 days · longer windows are allowed but warned about in
 *     the response so a UI can confirm before firing a 30-day backfill.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { pushRunToStrava } from '@/lib/strava/push';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json().catch(() => ({}));
  const daysRaw = Number(body.days);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 90 ? daysRaw : 14;
  const dryRun = body.dryRun === true;

  // Eligibility query:
  //   · belongs to the runner
  //   · is a CANONICAL row (no mergedIntoId, no absorbed_at)
  //   · was run in the last N days
  //   · source is NOT already Strava
  //   · no prior successful push exists in strava_pushes
  // The NOT EXISTS subquery is the dedup against double-pushing.
  const candidates = (await pool.query<{ id: string }>(
    `SELECT r.id::text AS id
       FROM runs r
      WHERE r.user_uuid = $1
        AND r.absorbed_into_canonical_at IS NULL
        AND NOT (r.data ? 'mergedIntoId')
        AND COALESCE(r.data->>'source', '') NOT IN ('strava', 'strava_webhook')
        AND COALESCE(
              (r.data->>'date')::date,
              LEFT(r.data->>'startLocal', 10)::date
            ) >= CURRENT_DATE - $2::int
        AND NOT EXISTS (
              SELECT 1 FROM strava_pushes p
               WHERE p.user_uuid = $1
                 AND p.run_id = r.id::text
                 AND p.status IN ('uploaded', 'pending')
            )
      ORDER BY (r.data->>'date') DESC NULLS LAST
      LIMIT 50`,
    [userId, days],
  )).rows;

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      days,
      candidates: candidates.length,
      runIds: candidates.map(c => c.id),
    });
  }

  const pushed: Array<{ runId: string; status: string; stravaActivityId?: number; pushId: number }> = [];
  const skipped: Array<{ runId: string; reason: string }> = [];

  // Sequential · we could parallelize but Strava's upload endpoint
  // doesn't love bursts and we'd rather get all 50 through cleanly
  // than rate-limit out of half of them.
  for (const c of candidates) {
    try {
      const result = await pushRunToStrava(userId, c.id);
      pushed.push({
        runId: c.id,
        status: result.status,
        stravaActivityId: result.stravaActivityId,
        pushId: result.pushId,
      });
    } catch (e: any) {
      skipped.push({ runId: c.id, reason: e?.message?.slice(0, 200) ?? 'unknown' });
    }
  }

  return NextResponse.json({
    ok: true,
    days,
    candidates: candidates.length,
    pushed,
    skipped,
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/strava/push-recent',
    body: {
      days: 'optional number 1..90, default 14',
      dryRun: 'optional bool · returns the candidate list without pushing',
    },
    description: 'Push every recent run that has not already been uploaded to Strava. Companion to the auto-push toggle · use after the runner enables auto-push to backfill their last N days.',
  });
}
