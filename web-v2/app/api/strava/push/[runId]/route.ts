/**
 * Per-run Strava push.
 *
 *   GET  /api/strava/push/[runId]  · current push state for a run.
 *     Returns the most recent strava_pushes row · status,
 *     strava_activity_id, pushed_at, completed_at. Returns
 *     { pushed: false, status: 'never' } when there's no row. UI
 *     uses this to render "Push to Strava" vs "Pushed ↗ activity
 *     12345" vs "Push failed · retry."
 *
 *   POST /api/strava/push/[runId]  · push (or re-attempt) one run.
 *     Body (optional):
 *       { privacy?, title?, description?, isRace? }
 *     Idempotent on run_id when the prior push succeeded · re-POSTing
 *     returns the prior result without re-uploading. On a failed prior
 *     push, re-POSTing retries.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { pushRunToStrava } from '@/lib/strava/push';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { runId } = await params;

  const row = (await pool.query(
    `SELECT id, status, strava_activity_id, title, privacy,
            error_message, pushed_at, completed_at
       FROM strava_pushes
      WHERE user_uuid = $1 AND run_id = $2
      ORDER BY pushed_at DESC LIMIT 1`,
    [userId, runId],
  )).rows[0];

  if (!row) {
    return NextResponse.json({ pushed: false, status: 'never' });
  }
  return NextResponse.json({
    pushed: row.status === 'uploaded' || row.status === 'pending',
    pushId: row.id,
    status: row.status,
    stravaActivityId: row.strava_activity_id,
    title: row.title,
    privacy: row.privacy,
    pushedAt: row.pushed_at,
    completedAt: row.completed_at,
    error: row.error_message,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { runId } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const result = await pushRunToStrava(userId, runId, {
      privacy: body.privacy,
      title: body.title,
      description: body.description,
      isRace: body.isRace,
    });
    return NextResponse.json({ ok: result.status !== 'failed', ...result });
  } catch (e: any) {
    console.error('[/api/strava/push] error:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'push failed' }, { status: 500 });
  }
}
