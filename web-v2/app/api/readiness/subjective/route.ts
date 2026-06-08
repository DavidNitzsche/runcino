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
import { runnerToday } from '@/lib/runtime/runner-tz';
import { requireUserId } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { loadCoachState } from '@/lib/coach/state-loader';
import { computeReadiness } from '@/lib/coach/readiness';

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
  const today = await runnerToday(userId);

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

  // 2026-06-03 · compute today's objective score LIVE (was: read from
  // readiness_snapshots which the nightly cron populates BEFORE the
  // day's signals come in, so the row holds yesterday's data and the
  // override comparison ran against the wrong score). David rated 8/10
  // on a 45 PULL-BACK day · gap is 35pts (well over the 15 threshold)
  // but the API said "in line with today's read" because the stale
  // snapshot showed 76.
  //
  // Now: loadCoachState + computeReadiness, same path the brief uses.
  // Cost is one full state read but the endpoint runs once per check-in
  // so it's fine. If state-load fails the override flag stays false
  // (graceful degradation · the next brief refresh will still surface
  // the override block correctly).
  let willTriggerOverride = false;
  let objectiveScore: number | null = null;
  try {
    const state = await loadCoachState(userId);
    const breakdown = computeReadiness(state);
    objectiveScore = breakdown.score;
    const subjective100 = Math.round(rating * 10);
    if (Math.abs(objectiveScore - subjective100) >= SUBJECTIVE_OVERRIDE_THRESHOLD) {
      willTriggerOverride = true;
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
  const today = await runnerToday(userId);
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
