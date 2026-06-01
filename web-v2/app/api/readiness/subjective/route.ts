/**
 * /api/readiness/subjective · daily morning "how do you feel" capture.
 *
 * POST { rating: 0..10 } → 200 { ok: true, willTriggerOverride: boolean }
 *   Upserts into subjective_checkins · idempotent on (user_uuid, today).
 *   Returns willTriggerOverride=true when the rating, normalized to a
 *   0-100 scale (rating × 10), differs from the runner's current
 *   objective composite by ≥ 15 pts. Frontend uses this to surface a
 *   "your read overrides the numbers" toast immediately rather than
 *   waiting for the next brief refresh.
 *
 * GET → returns today's rating + whether the prompt should render.
 *
 * Web agent brief · readiness-brief-field-additions.md §1.
 * Doctrine: Saw et al. 2016 systematic review · subjective wellness
 * beats objective markers when they disagree.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

const SUBJECTIVE_OVERRIDE_THRESHOLD = 15;

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }

  const rating = Number(body.rating);
  if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
    return NextResponse.json(
      { ok: false, error: 'rating must be a number 0-10' },
      { status: 400 }
    );
  }
  const notes = typeof body.notes === 'string' ? body.notes : null;
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  // Upsert · runner can correct a tap-mistake within the day.
  await pool.query(
    `INSERT INTO subjective_checkins (user_uuid, date, rating, notes)
     VALUES ($1::uuid, $2::date, $3, $4)
     ON CONFLICT (user_uuid, date)
     DO UPDATE SET rating = EXCLUDED.rating,
                   notes  = COALESCE(EXCLUDED.notes, subjective_checkins.notes),
                   updated_at = NOW()`,
    [userId, today, Math.round(rating), notes],
  );

  // Compute whether this rating triggers the subjective-override block ·
  // need today's objective composite for the comparison. Read from the
  // most recent readiness_snapshots row.
  let willTriggerOverride = false;
  let objectiveScore: number | null = null;
  try {
    const snap = (await pool.query<{ score: number }>(
      `SELECT score FROM readiness_snapshots
        WHERE user_uuid = $1::uuid AND snapshot_date = $2::date
        LIMIT 1`,
      [userId, today],
    ).catch(() => ({ rows: [] }))).rows[0];
    if (snap?.score != null) {
      objectiveScore = snap.score;
      const subjective100 = Math.round(rating * 10);
      if (Math.abs(objectiveScore - subjective100) >= SUBJECTIVE_OVERRIDE_THRESHOLD) {
        willTriggerOverride = true;
      }
    }
  } catch { /* fall through · override flag stays false */ }

  // Cache bust · next brief composes with the new subjective signal.
  await bustBriefingCacheForEvent(userId, 'run_ingest').catch(() => {});

  return NextResponse.json({
    ok: true,
    rating: Math.round(rating),
    objectiveScore,
    willTriggerOverride,
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const row = (await pool.query<{ rating: number; created_at: Date; updated_at: Date }>(
    `SELECT rating, created_at, updated_at
       FROM subjective_checkins
      WHERE user_uuid = $1::uuid AND date = $2::date
      LIMIT 1`,
    [userId, today],
  ).catch(() => ({ rows: [] }))).rows[0];
  return NextResponse.json({
    ok: true,
    answered: row != null,
    rating: row?.rating ?? null,
    answeredAt: row?.updated_at?.toISOString() ?? null,
  });
}
