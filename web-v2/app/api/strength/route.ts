/**
 * /api/strength — strength_sessions CRUD.
 *
 * Research/07 prescribes 2 strength sessions/wk for distance runners.
 * This route lets the runner log when they did one. The coach reads
 * recent rows to credit the runner's strength habit + flags 3-week
 * gaps as a CHALLENGE per Research/07.
 *
 * GET    /api/strength?days=14    → list recent
 * POST   /api/strength { date, session_type?, duration_min?, notes? }
 *
 * Cite: Research/07-strength-programming.md §frequency-recommendations.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { userIdFromRequest } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

export async function GET(req: NextRequest) {
  const userId = await userIdFromRequest(req);
  const days = Math.max(1, Math.min(90, Number(req.nextUrl.searchParams.get('days') ?? 14)));
  const r = await pool.query(
    `SELECT id, date::text AS date, session_type, duration_min, notes,
            created_at::text AS created_at
       FROM strength_sessions
      WHERE user_uuid = $1
        AND date >= CURRENT_DATE - $2::int
      ORDER BY date DESC`,
    [userId, days],
  ).catch(() => ({ rows: [] }));
  return NextResponse.json({ ok: true, sessions: r.rows });
}

export async function POST(req: NextRequest) {
  const userId = await userIdFromRequest(req);
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }

  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const sessionType = typeof body.session_type === 'string' ? body.session_type : null;
  const durationMin = Number.isFinite(Number(body.duration_min)) ? Number(body.duration_min) : null;
  const notes = typeof body.notes === 'string' ? body.notes : null;

  const r = await pool.query(
    `INSERT INTO strength_sessions (user_uuid, date, session_type, duration_min, notes)
     VALUES ($1, $2::date, $3, $4, $5)
     RETURNING id, date::text AS date, session_type, duration_min, notes,
               created_at::text AS created_at`,
    [userId, date, sessionType, durationMin, notes],
  );
  await bustBriefingCacheForEvent(userId, 'run_ingest').catch(() => {});
  return NextResponse.json({ ok: true, session: r.rows[0] });
}
