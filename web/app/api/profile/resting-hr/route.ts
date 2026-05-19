/**
 * /api/profile/resting-hr
 *   GET  → { value: number | null, source: 'manual' | 'none' }
 *   POST { restingHr: number | null } → { value, source }
 *
 * Mirror of /api/profile/max-hr but for users.resting_hr.
 *
 * Acceptance range: 30–100 bpm. Outside that we reject because
 * anything below 30 is almost certainly a sensor glitch and anything
 * above 100 is not "resting" in any meaningful sense.
 *
 * Once set, the fitness-resolver returns this in fitness.restingHr,
 * the freshness math will use trend to flag elevated/elevated-and-
 * rising, and the dormant goal-pace adjustment rule in /api/goal
 * (currently keyed off restingHrTrend) can come back online.
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const rows = await query<{ resting_hr: number | null }>(
    `SELECT resting_hr FROM users WHERE id = $1 LIMIT 1`, [user.id],
  );
  const value = rows[0]?.resting_hr ?? null;
  return NextResponse.json({
    value,
    source: value ? 'manual' : 'none',
  });
}

export async function POST(req: Request) {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  let body: { restingHr?: number | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (body.restingHr === null) {
    // Clear the manual override
    await query(`UPDATE users SET resting_hr = NULL WHERE id = $1`, [user.id]);
    return NextResponse.json({ value: null, source: 'none' });
  }

  const v = Number(body.restingHr);
  if (!Number.isFinite(v) || v < 30 || v > 100) {
    return NextResponse.json(
      { error: 'restingHr must be a number between 30 and 100 bpm' },
      { status: 400 },
    );
  }

  await query(`UPDATE users SET resting_hr = $2 WHERE id = $1`, [user.id, Math.round(v)]);
  return NextResponse.json({ value: Math.round(v), source: 'manual' });
}
