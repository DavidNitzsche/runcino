/**
 * POST /api/checkin   { rating, briefing_id?, surface?, note? }
 *
 * Closed loop §8.1: reply chip → check_ins row → next briefing reads recent
 * check-ins and adjusts voice + plan accordingly.
 *
 * Invalidates the briefing cache for this user so the next /api/briefing
 * call regenerates against the new state.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCache } from '@/lib/coach/cache';
import { generateBriefing } from '@/lib/coach/engine';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
const VALID_RATINGS = ['solid', 'tired', 'wrecked'] as const;
type Rating = typeof VALID_RATINGS[number];

export async function POST(req: NextRequest) {
  let body: { rating?: string; briefing_id?: string; surface?: string; note?: string; user_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rating = body.rating?.toLowerCase();
  if (!rating || !VALID_RATINGS.includes(rating as Rating)) {
    return NextResponse.json({ error: 'rating must be one of solid|tired|wrecked' }, { status: 400 });
  }

  const userId = body.user_id ?? DAVID_USER_ID;
  const surface = body.surface ?? 'today';

  try {
    await pool.query(
      `INSERT INTO check_ins (user_id, rating, briefing_id, surface, note, ts)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [userId, rating, body.briefing_id ?? null, surface, body.note ?? null]
    );
  } catch (err: any) {
    // If check_ins table is missing, fail loudly so the operator runs the
    // migration. We do NOT silently swallow this — that would break the loop.
    return NextResponse.json({
      error: 'check-in insert failed',
      detail: err.message,
      hint: 'Did you apply web-v2/db/migrations/100_check_ins.sql?',
    }, { status: 500 });
  }

  // Bust cache so the next briefing fetch sees the new check-in.
  // Fire-and-forget regen for the surface they're on — by the time the user
  // navigates back, the new voice is cached and ready.
  await bustBriefingCache(userId);
  void generateBriefing(userId, (surface as any) ?? 'today').catch(() => {});

  return NextResponse.json({
    ok: true,
    rating,
    recorded_at: new Date().toISOString(),
  });
}
