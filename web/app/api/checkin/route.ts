/**
 * /api/checkin — daily energy/soreness/stress check-in.
 *
 * GET  ?date=YYYY-MM-DD → { checkin: { energy, soreness, stress } | null }
 * POST { date, energy, soreness, stress } → { ok: true }
 *
 * Writes to the legacy daily_checkin table (user_id TEXT 'me') AND
 * sets user_uuid so the row is properly multi-tenant. Reads filter by
 * user_uuid first, falling back to 'me' for legacy rows that haven't
 * been backfilled.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const date = req.nextUrl.searchParams.get('date');
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  // Prefer rows keyed by user_uuid. Fall back to 'me' for legacy.
  const rows = await query<{ energy: number; soreness: number; stress: number }>(
    `SELECT energy, soreness, stress
     FROM daily_checkin
     WHERE date = $1 AND (user_uuid = $2 OR (user_uuid IS NULL AND user_id = 'me'))
     ORDER BY user_uuid NULLS LAST
     LIMIT 1;`,
    [date, user.id],
  );
  return NextResponse.json({ checkin: rows[0] ?? null });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { date?: string; energy?: number; soreness?: number; stress?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { date, energy, soreness, stress } = body;
  if (!date || typeof energy !== 'number' || typeof soreness !== 'number' || typeof stress !== 'number') {
    return NextResponse.json({ error: 'date + energy + soreness + stress required' }, { status: 400 });
  }
  if (energy < 1 || energy > 10 || soreness < 1 || soreness > 10 || stress < 1 || stress > 10) {
    return NextResponse.json({ error: 'values must be 1..10' }, { status: 400 });
  }

  // UPSERT on (user_uuid, date). Sets user_id='me' for legacy compat
  // until the cutover migration drops the text column.
  await query(
    `INSERT INTO daily_checkin (user_id, user_uuid, date, energy, soreness, stress, logged_at)
     VALUES ('me', $1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id, date)
     DO UPDATE SET
       user_uuid = EXCLUDED.user_uuid,
       energy    = EXCLUDED.energy,
       soreness  = EXCLUDED.soreness,
       stress    = EXCLUDED.stress,
       logged_at = NOW();`,
    [user.id, date, energy, soreness, stress],
  );

  return NextResponse.json({ ok: true });
}
