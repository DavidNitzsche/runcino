/**
 * GET  /api/checkin/repair?days=30           — dry-run: list check-ins
 *                                              where the NEW chip→rating
 *                                              mapping would yield a
 *                                              different rating than
 *                                              what's stored.
 *
 * POST /api/checkin/repair  { days?, mode? } — apply the repair.
 *      mode='update'  (default) → UPDATE rating on each mismatched row
 *                                 to what the new mapping says it
 *                                 should be. Preserves the row + extras.
 *      mode='delete'           → DELETE each mismatched row (use only
 *                                 if you want it gone, not relabeled).
 *
 * P-PHANTOM-CHECKIN-2 — David flagged that the coach kept saying
 * "yesterday's check-in was TIRED" even though he never tapped TIRED.
 * Root cause: the original chip→rating mapping in /api/checkin treated
 * CONTROLLED, NOT CHATTY (a pace description) and WORKED (normal post-
 * run state) as fatigue signals → wrote TIRED to the DB. This endpoint
 * surfaces the diff so David can see what's actually there, then apply.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { requireUserId } from '@/lib/auth/session';

// Keep this in sync with /api/checkin/route.ts ratingFromPostRun.
function recomputeRating(execution?: string, body?: string): string | null {
  const exec = (execution ?? '').toLowerCase();
  if (['nailed', 'chatty', 'controlled', 'grinded', 'strong', 'faded',
       'crushed_goal', 'on_goal'].includes(exec)) return 'solid';
  if (['pushed', 'missed', 'walled', 'missed_goal'].includes(exec)) return 'tired';
  if (body === 'fresh' || body === 'worked') return 'solid';
  if (body === 'cooked') return 'wrecked';
  return null;
}

async function fetchPostRunCheckins(userId: string, days: number) {
  return (await pool.query(
    `SELECT id, ts, rating, surface, extras
       FROM check_ins
      WHERE COALESCE(user_uuid, user_id) = $1
        AND ts >= now() - ($2::int || ' days')::interval
        AND extras->>'kind' = 'post_run'
      ORDER BY ts DESC`,
    [userId, days]
  )).rows;
}

function diffRow(row: any) {
  const ex = row.extras ?? {};
  const newRating = recomputeRating(ex.execution, ex.body_state);
  return {
    id: row.id,
    ts: row.ts,
    surface: row.surface,
    stored_rating: row.rating,
    new_rating: newRating,
    execution: ex.execution ?? null,
    body: ex.body_state ?? null,
    niggle: ex.niggle ?? null,
    would_change: newRating != null && newRating !== row.rating,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const url = new URL(req.url);
  const days = Number(url.searchParams.get('days') ?? '30');
  const rows = await fetchPostRunCheckins(userId, days);
  const diffs = rows.map(diffRow);
  const mismatches = diffs.filter((d) => d.would_change);
  return NextResponse.json({
    user_id: userId,
    days,
    total: diffs.length,
    mismatches: mismatches.length,
    all: diffs,
    only_mismatches: mismatches,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => ({}));
  const days = Number(body.days ?? 30);
  const mode = (body.mode === 'delete' ? 'delete' : 'update') as 'update' | 'delete';

  const rows = await fetchPostRunCheckins(userId, days);
  const mismatches = rows.map(diffRow).filter((d) => d.would_change);

  let changed = 0;
  for (const m of mismatches) {
    if (mode === 'delete') {
      const r = await pool.query(`DELETE FROM check_ins WHERE id = $1`, [m.id]);
      changed += r.rowCount ?? 0;
    } else {
      const r = await pool.query(
        `UPDATE check_ins SET rating = $1 WHERE id = $2`,
        [m.new_rating, m.id]
      );
      changed += r.rowCount ?? 0;
    }
  }

  // Bust the brief cache so the next read regenerates voice without the
  // phantom TIRED references.
  if (changed > 0) {
    await bustBriefingCacheForEvent(userId, 'check_in');
  }

  return NextResponse.json({
    ok: true,
    mode,
    inspected: rows.length,
    mismatches_found: mismatches.length,
    changed,
  });
}
