/**
 * POST /api/onboarding/complete
 *
 * Lilian onboarding (locked 2026-05-28) · final write.
 * Called when the runner taps "Start training" on step 3. Persists
 * every answer collected through the URL-driven flow into the
 * profile table (columns added in migration 115_profile_onboarding.sql).
 *
 * Body:
 *   {
 *     distance:           '5k' | '10k' | 'half' | 'marathon' | 'none',
 *     date:               'YYYY-MM-DD' | null,
 *     time:               'HH:MM:SS'   | null,
 *     name:               string,
 *     timezone:           'America/Los_Angeles' | ...,
 *     connectionsSkipped: boolean,
 *   }
 *
 * Returns:
 *   { success: true, redirect: '/onboarding?step=done' }
 *
 * Persistence on the legacy `onboarded_at` column is kept in sync so the
 * existing OnboardingFlow / profile-state code paths keep working.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { userIdFromRequest } from '@/lib/auth/session';

const VALID_DISTANCES = new Set(['5k', '10k', 'half', 'marathon', 'none']);

export async function POST(req: NextRequest) {
  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const userId = await userIdFromRequest(req);

  // ── Validate inputs ──────────────────────────────────────────────
  const distance = typeof body.distance === 'string' && VALID_DISTANCES.has(body.distance)
    ? body.distance : null;
  if (!distance) {
    return NextResponse.json({ error: 'distance is required' }, { status: 400 });
  }

  const isRace = distance !== 'none';
  const date: string | null = isRace && isValidDate(body.date) ? body.date : null;
  if (isRace && !date) {
    return NextResponse.json({ error: 'race date is required when a race distance is picked' }, { status: 400 });
  }

  const time: string | null = isValidTime(body.time) ? body.time : null;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const timezone = typeof body.timezone === 'string' && body.timezone.length > 0
    ? body.timezone : null;
  if (!timezone) {
    return NextResponse.json({ error: 'timezone is required' }, { status: 400 });
  }

  const connectionsSkipped = Boolean(body.connectionsSkipped);

  // ── Upsert profile ───────────────────────────────────────────────
  // The PATCH at /api/profile is gated by an ALLOWED set that doesn't
  // include the new onboarding columns. Going direct to the DB keeps
  // that surface untouched and lets this endpoint stay specific.
  try {
    const update = await pool.query(
      `UPDATE profile SET
          goal_race_distance      = $1,
          goal_race_date          = $2,
          goal_race_time          = $3,
          full_name               = $4,
          timezone                = $5,
          onboarding_completed_at = NOW(),
          onboarded_at            = COALESCE(onboarded_at, NOW()),
          connections_skipped     = $6
        WHERE user_uuid = $7
        RETURNING user_uuid`,
      [distance, date, time, name, timezone, connectionsSkipped, userId]
    );

    if (update.rowCount === 0) {
      // No row yet — first-ever onboarder. Insert one.
      await pool.query(
        `INSERT INTO profile (
            user_uuid,
            goal_race_distance, goal_race_date, goal_race_time,
            full_name, timezone,
            onboarding_completed_at, onboarded_at,
            connections_skipped
          ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW(),$7)`,
        [userId, distance, date, time, name, timezone, connectionsSkipped]
      );
    }
  } catch (err: any) {
    return NextResponse.json({
      error: 'onboarding persist failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  }

  return NextResponse.json({ success: true, redirect: '/onboarding?step=done' });
}

function isValidDate(v: any): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function isValidTime(v: any): v is string {
  return typeof v === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(v);
}
