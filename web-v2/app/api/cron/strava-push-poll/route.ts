/**
 * POST /api/cron/strava-push-poll
 *
 * Backstop for the async Strava upload pipeline. lib/strava/push.ts uploads
 * a TCX and polls /uploads/{id} once ~2s later; Strava processes the upload
 * asynchronously, so the strava_pushes row usually lands 'pending'. This
 * cron re-polls every pending push in the 30s–24h window via
 * resolvePendingPush() and writes the terminal state — 'uploaded' (+
 * activity_id, + RPE PUT), 'duplicate', or 'failed' (+ Strava's actual
 * error). Pushes still pending after 24h are swept to 'failed' (Strava
 * drops the upload id by then, so it can never resolve).
 *
 * Auth: shared CRON_SECRET, same pattern as strava-sync + the other
 * GH-Actions-triggered crons.
 *
 * Schedule (GitHub Actions): every 15 min (waking + overnight windows).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { resolvePendingPush } from '@/lib/strava/push';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth.replace(/^Bearer\s+/i, '').trim() !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // 1. Sweep: pending > 24h → failed. Strava drops the upload id after
    //    ~a day, so these can never resolve; mark them terminal so the UI
    //    stops showing "Processing…" forever and offers a retry instead.
    const swept = (await pool.query(
      `UPDATE strava_pushes
          SET status = 'failed',
              completed_at = NOW(),
              error_message = COALESCE(error_message, 'unresolved after 24h (upload id expired)')
        WHERE status = 'pending'
          AND pushed_at < NOW() - INTERVAL '24 hours'
        RETURNING id`,
    )).rowCount ?? 0;

    // 2. Re-poll the live window: 30s < age < 24h, upload was accepted.
    const due = (await pool.query(
      `SELECT id, user_uuid, run_id, strava_upload_id
         FROM strava_pushes
        WHERE status = 'pending'
          AND strava_upload_id IS NOT NULL
          AND pushed_at < NOW() - INTERVAL '30 seconds'
          AND pushed_at > NOW() - INTERVAL '24 hours'
        ORDER BY pushed_at ASC
        LIMIT 200`,
    )).rows;

    const counts: Record<string, number> = { uploaded: 0, failed: 0, duplicate: 0, pending: 0 };
    for (const p of due) {
      try {
        const r = await resolvePendingPush(p.user_uuid, p);
        counts[r.status] = (counts[r.status] ?? 0) + 1;
      } catch {
        counts.pending = (counts.pending ?? 0) + 1;
      }
    }

    return NextResponse.json({
      ok: true,
      swept_stale: swept,
      polled: due.length,
      counts,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/strava-push-poll',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    description: 'Re-poll pending Strava uploads (30s–24h window) → terminal status; sweep >24h pending to failed.',
  });
}
