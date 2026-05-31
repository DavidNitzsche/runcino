/**
 * /api/runs/[id]/rpe — post-run subjective RPE + notes per activity.
 *
 * Ports the legacy /api/activity/rpe path (legacy/web/app/api/activity/rpe)
 * to the v2 URL shape `/api/runs/[id]/rpe`. Same write target:
 * `post_run_rpe` table (UNIQUE on user_id + activity_id).
 *
 * GET  /api/runs/{id}/rpe                → { ok, rpe: { rpe, notes, logged_at } | null }
 * POST /api/runs/{id}/rpe { rpe, notes }  → { ok, rpe: { rpe, notes, logged_at } }
 *
 * Coach reads via /api/runs/[id] (loadRunDetail) to enrich the FORM
 * verdict. When subjectiveRpe ≥ 7 on a planned-easy day, the coach
 * reads it as a fatigue signal and softens tomorrow's prescription.
 *
 * Cite: docs/SYSTEM_AUDIT_2026-05-30.md SIM-04 finding — the v2 stack
 * had no RPE writer (legacy route was orphaned by the v2 cutover).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id } = await params;
  if (!id) return NextResponse.json({ ok: false, error: 'activity id required' }, { status: 400 });

  const r = await pool.query(
    `SELECT rpe, notes, logged_at::text AS logged_at
       FROM post_run_rpe
      WHERE (user_uuid = $1 OR user_id::text = $1::text) AND activity_id = $2
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userId, id],
  ).catch(() => ({ rows: [] }));
  return NextResponse.json({ ok: true, rpe: r.rows[0] ?? null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { id: activityId } = await params;
  if (!activityId) return NextResponse.json({ ok: false, error: 'activity id required' }, { status: 400 });

  let body: { rpe?: number | null; notes?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }

  // RPE is 1-10 per Borg CR10. Clamp to range; null is allowed (clears
  // a previously-set value).
  const rpe = body.rpe == null ? null : Math.min(10, Math.max(1, Number(body.rpe)));
  const notes = (typeof body.notes === 'string' && body.notes.trim()) || null;

  try {
    // UPSERT — the table's UNIQUE constraint is (user_id, activity_id).
    // user_id is TEXT for legacy reasons; we pass the UUID as text so
    // the upsert key matches.
    const r = await pool.query(
      `INSERT INTO post_run_rpe (user_id, user_uuid, activity_id, rpe, notes, logged_at)
       VALUES ($1::text, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, activity_id) DO UPDATE
       SET rpe = EXCLUDED.rpe,
           notes = EXCLUDED.notes,
           user_uuid = COALESCE(post_run_rpe.user_uuid, EXCLUDED.user_uuid),
           logged_at = NOW()
       RETURNING rpe, notes, logged_at::text AS logged_at`,
      [userId, userId, activityId, rpe, notes],
    );

    // RPE feeds the FORM read of /api/runs/[id]. Bust the coach cache
    // so the next read sees the new value.
    await bustBriefingCacheForEvent(userId, 'run_ingest').catch(() => {});

    return NextResponse.json({ ok: true, rpe: r.rows[0] });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}
