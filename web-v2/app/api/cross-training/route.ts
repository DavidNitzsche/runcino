/**
 * /api/cross-training — cross_training_sessions CRUD.
 *
 * Bike / swim / hike / row / ski / etc. The coach reads recent rows to
 * credit cross-training toward fitness preservation during INJURY mode
 * and to track non-impact volume during build phases.
 *
 * GET    /api/cross-training?days=14
 * POST   /api/cross-training { date, modality, duration_min?, intensity?, avg_hr?, notes? }
 *
 * Cite: Research/09-cross-training.md §carryover-matrix.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

const VALID_INTENSITY = new Set(['easy', 'moderate', 'hard']);

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const days = Math.max(1, Math.min(90, Number(req.nextUrl.searchParams.get('days') ?? 14)));
  const r = await pool.query(
    `SELECT id, date::text AS date, modality, duration_min, intensity,
            avg_hr, notes, created_at::text AS created_at
       FROM cross_training_sessions
      WHERE user_uuid = $1
        AND date >= CURRENT_DATE - $2::int
      ORDER BY date DESC`,
    [userId, days],
  ).catch(() => ({ rows: [] }));
  return NextResponse.json({ ok: true, sessions: r.rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }

  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const modality = typeof body.modality === 'string' ? body.modality.trim().toLowerCase() : '';
  if (!modality) return NextResponse.json({ ok: false, error: 'modality required' }, { status: 400 });

  const durationMin = Number.isFinite(Number(body.duration_min)) ? Number(body.duration_min) : null;
  const intensity = typeof body.intensity === 'string' && VALID_INTENSITY.has(body.intensity)
    ? body.intensity : null;
  const avgHr = Number.isFinite(Number(body.avg_hr)) ? Number(body.avg_hr) : null;
  const notes = typeof body.notes === 'string' ? body.notes : null;

  const r = await pool.query(
    `INSERT INTO cross_training_sessions (user_uuid, date, modality, duration_min, intensity, avg_hr, notes)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7)
     RETURNING id, date::text AS date, modality, duration_min, intensity, avg_hr, notes,
               created_at::text AS created_at`,
    [userId, date, modality, durationMin, intensity, avgHr, notes],
  );
  await bustBriefingCacheForEvent(userId, 'run_ingest').catch(() => {});
  return NextResponse.json({ ok: true, session: r.rows[0] });
}
