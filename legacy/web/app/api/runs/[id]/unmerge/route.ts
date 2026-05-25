/**
 * POST /api/runs/[id]/unmerge — pin this run as "keep separate" from auto-dedup.
 *
 * Two usage paths:
 *   - The detail modal is showing a CANONICAL run with mergedSources, and the
 *     user clicks unmerge on one of those sources. The request id is the
 *     SOURCE id (the one being extracted), and we pin it as keep-separate so
 *     the next dedup pass leaves it as its own row.
 *   - The detail modal is showing a MERGED run (a source that was folded into
 *     a canonical). Clicking "unmerge from <canonical>" sends the same call
 *     with the source id; same pin.
 *
 * Safe + idempotent: pinning a run twice is a no-op. The dedup grouper is
 * the read-edge — no rows are moved, no data is rewritten.
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { setKeepSeparate } from '@/lib/run-merge-overrides';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireActiveUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const activityId = Number(id);
  if (!Number.isFinite(activityId)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }
  try {
    await setKeepSeparate(user.id, activityId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unmerge failed' },
      { status: 500 },
    );
  }
}
