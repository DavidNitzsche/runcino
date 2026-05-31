/**
 * POST /api/strava/push/[runId]
 *
 * Manually push a run to Strava. Body (optional):
 *   { privacy?: 'private'|'followers'|'public', title?: string, description?: string }
 *
 * Returns: { ok, pushId, status, stravaActivityId? }
 *
 * Idempotent on run_id — re-clicking after a successful push returns the
 * prior result without re-uploading.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { pushRunToStrava } from '@/lib/strava/push';

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
