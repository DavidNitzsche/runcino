/**
 * POST /api/me/timezone
 *
 * The app reports the device's current IANA timezone (e.g.
 * "America/Los_Angeles") so the backend can date runs and compute
 * "today" wherever the user actually is — a 6 PM-local run is dated
 * today, not tomorrow (UTC). Stored on users.timezone; null/absent
 * falls back to the app-default FAFF_TZ (lib/dates.ts).
 *
 * Body: { timezone: "America/Los_Angeles" }
 * Response: { ok, timezone }
 *
 * Auth: Bearer access token (cookie also accepted for the web client).
 * Idempotent — the app re-reports on every launch/foreground; we only
 * write when the value actually changed.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';

/** True if `tz` is a valid IANA zone the runtime recognizes. */
function isValidTz(tz: string): boolean {
  if (!tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { timezone?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const tz = typeof body.timezone === 'string' ? body.timezone.trim() : '';
  if (!isValidTz(tz)) {
    return NextResponse.json({ error: 'timezone must be a valid IANA identifier' }, { status: 400 });
  }

  // Only write on change — this is hit on every app launch.
  if (tz !== user.timezone) {
    await query(`UPDATE users SET timezone = $1, updated_at = NOW() WHERE id = $2`, [tz, user.id])
      .catch(() => {});
  }

  return NextResponse.json({ ok: true, timezone: tz });
}
