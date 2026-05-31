/**
 * POST /api/admin/recompute-runs
 *
 * One-shot cleanup endpoint. Re-runs the auto-merge writer for the
 * caller's recent N days so duplicate Strava/Watch/manual rows that
 * escaped the merge writers (e.g. Strava-webhook-only ingest path)
 * get their `mergedIntoId` flag set retroactively. Then busts the
 * brief cache so the next coach render reflects the corrected totals.
 *
 * Query: ?days=30 (default 14, max 90).
 *
 * 2026-05-27 P-DOUBLECOUNT: David's week strip showed 31.6 done vs
 * /log's 19.6 actual because Mon/Tue/Wed each had one un-flagged
 * duplicate row. The aggregation queries in glance-state +
 * state-loader were summing all `NOT mergedIntoId` rows by day, so
 * each phantom dup added ~6mi to the total. Inflated weekly volume
 * + inflated ACWR (1.80 vs realistic ~1.4) triggered the swap card
 * off ghost numbers.
 *
 * The aggregation sites now use canonicalMileageByDay (read-time
 * dedupe) so this is belt-and-suspenders — but persisting the
 * mergedIntoId flag is still worth doing so downstream queries that
 * don't yet use the dedupe helper (e.g. ad-hoc /log queries) also
 * agree.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { autoMergeRecent } from '@/lib/runs/merge';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const daysParam = req.nextUrl.searchParams.get('days');
  const days = Math.min(90, Math.max(1, Number(daysParam) || 14));

  try {
    const { totalChanged } = await autoMergeRecent(userId, days);
    // Cache bust regardless — even if no rows changed (idempotent
    // double-call), the runner might be trying to force a regen.
    await bustBriefingCacheForEvent(userId, 'run_ingest');
    return NextResponse.json({
      ok: true,
      days,
      rowsFlagged: totalChanged,
      cacheBusted: true,
    });
  } catch (e: any) {
    console.error('[/api/admin/recompute-runs] failed:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'recompute failed' }, { status: 500 });
  }
}
