/**
 * /api/checkin — daily energy/soreness/stress check-in.
 *
 * GET  ?date=YYYY-MM-DD → { ok, today, checkin: { energy, soreness, stress, notes } | null }
 * GET                  → defaults to today in the user's timezone
 * POST { energy, soreness, stress, notes?, date? } → { ok, checkin }
 *
 * Writes to the legacy daily_checkin table (user_id TEXT 'me') AND
 * sets user_uuid so the row is properly multi-tenant. Reads filter by
 * user_uuid first, falling back to 'me' for legacy rows that haven't
 * been backfilled.
 *
 * CANONICAL endpoint · /api/health/checkin was a legacy single-tenant
 * duplicate removed during Phase 1 cleanup (2026-05-19).  All callers
 * use this path.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Date is optional; defaults to today in the user's timezone.
  const date = req.nextUrl.searchParams.get('date') ?? todayISO(userTimezone(user.location));

  // Prefer rows keyed by user_uuid. Fall back to 'me' for legacy.
  const rows = await query<{ energy: number; soreness: number; stress: number; notes: string | null }>(
    `SELECT energy, soreness, stress, notes
     FROM daily_checkin
     WHERE date = $1 AND (user_uuid = $2 OR (user_uuid IS NULL AND user_id = 'me'))
     ORDER BY user_uuid NULLS LAST
     LIMIT 1;`,
    [date, user.id],
  );
  return NextResponse.json({ ok: true, today: date, checkin: rows[0] ?? null });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { date?: string; energy?: number; soreness?: number; stress?: number; notes?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { energy, soreness, stress } = body;
  // Date optional; defaults to today in the user's timezone.
  const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : todayISO(userTimezone(user.location));

  if (typeof energy !== 'number' || typeof soreness !== 'number' || typeof stress !== 'number') {
    return NextResponse.json({ error: 'energy + soreness + stress required' }, { status: 400 });
  }
  if (energy < 1 || energy > 10 || soreness < 1 || soreness > 10 || stress < 1 || stress > 10) {
    return NextResponse.json({ error: 'values must be 1..10' }, { status: 400 });
  }

  // UPSERT on (user_uuid, date). Sets user_id='me' for legacy compat
  // until the cutover migration drops the text column.
  const rows = await query<{ energy: number; soreness: number; stress: number; notes: string | null }>(
    `INSERT INTO daily_checkin (user_id, user_uuid, date, energy, soreness, stress, notes, logged_at)
     VALUES ('me', $1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id, date)
     DO UPDATE SET
       user_uuid = EXCLUDED.user_uuid,
       energy    = EXCLUDED.energy,
       soreness  = EXCLUDED.soreness,
       stress    = EXCLUDED.stress,
       notes     = EXCLUDED.notes,
       logged_at = NOW()
     RETURNING energy, soreness, stress, notes;`,
    [user.id, date, energy, soreness, stress, body.notes?.trim() || null],
  );

  return NextResponse.json({ ok: true, checkin: rows[0] });
}
