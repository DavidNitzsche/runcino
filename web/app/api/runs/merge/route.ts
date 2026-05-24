/**
 * POST /api/runs/merge — force a set of source runs to fold into a target.
 *
 * Body: { targetId: number, sourceIds: number[] }
 *
 * Use case: auto-dedup didn't catch all the dupes for a session (e.g. a
 * paused/resumed run uploaded as four fragments with start times spread
 * across a 30+ min window). The user multi-selects rows on /log, picks one
 * to be canonical, and the rest get pinned with mode='merge-into' so the
 * next dedup pass collapses them into the chosen canonical.
 *
 * Stores manual overrides in run_merge_overrides; no rows are deleted or
 * mutated. To undo, hit /api/runs/[id]/unmerge on a source — it flips that
 * source to 'keep-separate' which overrides the force-merge.
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { setForceMerge } from '@/lib/run-merge-overrides';

interface Body {
  targetId?: unknown;
  sourceIds?: unknown;
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireActiveUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });
  }

  const targetId = Number(body.targetId);
  if (!Number.isFinite(targetId)) {
    return NextResponse.json({ error: 'targetId required' }, { status: 400 });
  }
  const sourceIds = Array.isArray(body.sourceIds)
    ? body.sourceIds.map(Number).filter((n) => Number.isFinite(n) && n !== targetId)
    : [];
  if (sourceIds.length === 0) {
    return NextResponse.json({ error: 'sourceIds required' }, { status: 400 });
  }

  try {
    await Promise.all(sourceIds.map((sid) => setForceMerge(user.id, sid, targetId)));
    return NextResponse.json({ ok: true, merged: sourceIds.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'merge failed' },
      { status: 500 },
    );
  }
}
