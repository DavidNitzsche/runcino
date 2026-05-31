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
import { requireUserId } from '@/lib/auth/session';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id } = await params;
  if (!id || id === 'null' || id === 'undefined') {
    return NextResponse.json({ error: 'no activity id' }, { status: 404 });
  }
  const detail = await loadRunDetail(userId, id);
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
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  // shoe_id: number | null (P32)
  if ('shoe_id' in body) {
    const shoeId: number | null = body.shoe_id === null ? null : Number(body.shoe_id);
    if (shoeId !== null && !Number.isFinite(shoeId)) {
      return NextResponse.json({ error: 'shoe_id must be integer or null' }, { status: 400 });
    }
    try {
      // First try the direct match (real Strava activityId in data.id /
      // data.activityId, or the table's row id).
      let updated = await pool.query(
        `UPDATE strava_activities
            SET shoe_id = $1::int
          WHERE user_uuid = $2
            AND (data->>'id' = $3 OR data->>'activityId' = $3 OR id::text = $3)
       RETURNING id, shoe_id`,
        [shoeId, userId, id]
      );
      // 2026-05-27: synthetic-id fallback. Watch-synced runs without a
      // first-party Strava id are referenced by "YYYY-MM-DD-mi" — that
      // matches the GET fallback in loadRunDetail. Without this, PATCH
      // silently 404'd on those runs and the shoe never persisted even
      // though the UI optimistically showed it as assigned. David:
      // "I selected it, clicked off, came back. not there."
      if (updated.rowCount === 0) {
        const m = id.match(/^(\d{4}-\d{2}-\d{2})-([\d.]+)$/);
        if (m) {
          const [, date, mi] = m;
          updated = await pool.query(
            `UPDATE strava_activities
                SET shoe_id = $1::int
              WHERE user_uuid = $2
                AND NOT (data ? 'mergedIntoId')
                AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) = $3
                AND ABS((data->>'distanceMi')::numeric - $4::numeric) < 0.05
           RETURNING id, shoe_id`,
            [shoeId, userId, date, mi]
          );
        }
      }
      // 2026-05-27: second fallback for the "<uuid>-YYYY-MM-DD" and
      // "wko_<uuid>" formats that /api/log returns for manually-logged
      // runs. The trailing-date suffix is enough to scope the UPDATE
      // when there's only one run on that day for the user (the common
      // case). If multiple runs exist on a day and none has a real
      // Strava id this could over-match — but the worst case is shoe
      // tagged on the wrong same-day run, not data loss.
      if (updated.rowCount === 0) {
        const dateMatch = id.match(/(\d{4}-\d{2}-\d{2})$/);
        if (dateMatch) {
          updated = await pool.query(
            `UPDATE strava_activities
                SET shoe_id = $1::int
              WHERE user_uuid = $2
                AND NOT (data ? 'mergedIntoId')
                AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) = $3
           RETURNING id, shoe_id`,
            [shoeId, userId, dateMatch[1]]
          );
        }
      }
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
          WHERE user_uuid = $1
            AND shoe_id IS NOT NULL
            AND NOT (data ? 'mergedIntoId')
          GROUP BY shoe_id
       ) t
      WHERE s.id = t.shoe_id
        AND s.user_uuid = $1`,
    [userId]
  );
}
