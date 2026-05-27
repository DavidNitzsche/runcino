/**
 * GET   /api/runs/[id] — JSON view of a single run for the modal.
 * PATCH /api/runs/[id] — update fields on the run (P32: shoe_id).
 *
 * GET is the same shape as /runs/[id] server component, client-fetchable
 * so the run detail can open as a modal on /today without route change.
 *
 * PATCH supports:
 *   { shoe_id: number | null }   // assign / unassign a shoe (P32)
 *
 * On shoe_id change the server:
 *   1. Sets strava_activities.shoe_id
 *   2. Recomputes shoes.mileage_mi from SUM(distance) of all assigned runs
 *      (idempotent: re-running yields the same total regardless of history)
 *   3. Busts the briefing cache so the next /today reflects it
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadRunDetail } from '@/lib/coach/run-state';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || id === 'null' || id === 'undefined') {
    return NextResponse.json({ error: 'no activity id' }, { status: 404 });
  }
  const detail = await loadRunDetail(DAVID_USER_ID, id);
  if (!detail) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  // Run history is immutable once stored — pace, splits, HR don't change.
  // 5min browser cache + 30s SWR keeps repeat hits off the server. PATCH
  // (shoe assignment) writes don't propagate through this GET cache, but
  // that's fine; the modal updates optimistically.
  return NextResponse.json(detail, {
    headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=30' },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const userId = body.user_id ?? DAVID_USER_ID;

  // shoe_id: number | null (P32)
  if ('shoe_id' in body) {
    const shoeId: number | null = body.shoe_id === null ? null : Number(body.shoe_id);
    if (shoeId !== null && !Number.isFinite(shoeId)) {
      return NextResponse.json({ error: 'shoe_id must be integer or null' }, { status: 400 });
    }
    try {
      const updated = await pool.query(
        `UPDATE strava_activities
            SET shoe_id = $1::int
          WHERE (user_uuid = $2 OR user_uuid IS NULL)
            AND (data->>'id' = $3 OR data->>'activityId' = $3 OR id::text = $3)
       RETURNING id, shoe_id`,
        [shoeId, userId, id]
      );
      if (updated.rowCount === 0) {
        return NextResponse.json({ error: 'run not found' }, { status: 404 });
      }
      // Recompute mileage for affected shoes (old + new).
      await recomputeShoeMileage(userId);
      // Shoe re-assignment on an existing run; same event as direct shoe CRUD.
      await bustBriefingCacheForEvent(userId, 'shoe_crud');
      return NextResponse.json({ ok: true, shoe_id: shoeId });
    } catch (e: any) {
      console.error('[runs PATCH] shoe assign failed:', e);
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'no recognized fields' }, { status: 400 });
}

/**
 * Recompute `shoes.mileage_mi` from sum of distances of assigned runs.
 * Idempotent — re-running yields the same total. Run after any
 * shoe_id mutation on strava_activities.
 */
async function recomputeShoeMileage(userId: string): Promise<void> {
  await pool.query(
    `UPDATE shoes s
        SET mileage = COALESCE(t.total_mi, 0)
       FROM (
         SELECT shoe_id, SUM((data->>'distanceMi')::numeric) AS total_mi
           FROM strava_activities
          WHERE (user_uuid = $1 OR user_uuid IS NULL)
            AND shoe_id IS NOT NULL
            AND NOT (data ? 'mergedIntoId')
          GROUP BY shoe_id
       ) t
      WHERE s.id = t.shoe_id
        AND (s.user_uuid = $1 OR s.user_uuid IS NULL)`,
    [userId]
  );
}
