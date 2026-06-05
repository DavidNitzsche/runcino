/**
 * POST /api/profile/timezone  { timezone: string }
 *
 * 2026-06-05 · multi-tenant audit Pattern 3 fix · web-only Strava users
 *   never opened the iPhone app, so `captureTimezoneFromDevice` never
 *   fired from a watch / HK ingest. They stayed on UTC forever, and
 *   every "today" calculation was off by up to 7 hours · cold-start
 *   recovery panels disappeared at UTC-midnight (5pm Pacific), readiness
 *   "today" queries returned null on real evenings.
 *
 *   This endpoint takes the browser's IANA timezone (collected via
 *   `Intl.DateTimeFormat().resolvedOptions().timeZone`) and writes it
 *   through `captureTimezoneFromDevice` — which is silent + idempotent:
 *   only writes when `profile.timezone IS NULL`, never overrides a
 *   manually-set or device-synced value.
 *
 *   The client pings this:
 *     1. once per session on Shell mount (every authed page entry)
 *     2. before the Strava OAuth redirect (defense in depth)
 *
 *   Returns 200 { ok: true, timezone: <stored> } on either successful
 *   write or already-set no-op. Returns 400 only on invalid IANA name
 *   or missing body.
 *
 *   Why a separate route from PATCH /api/profile · PATCH requires a
 *   user-driven write (the field's in the ALLOWED set, sets audit-trail
 *   coach_intents). The TZ capture should be a silent background ping
 *   on every mount · routing through PATCH would flood `coach_intents`
 *   with a row per page-load. This route is silent + idempotent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { captureTimezoneFromDevice } from '@/lib/runtime/runner-tz';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  let body: { timezone?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const tz = typeof body?.timezone === 'string' ? body.timezone.trim() : '';
  if (!tz) {
    return NextResponse.json({ error: 'Missing timezone' }, { status: 400 });
  }

  // captureTimezoneFromDevice validates via Intl.DateTimeFormat · returns
  // null on bad name or on "already-set" no-op. Treat both as success
  // for the client (the silent no-op is the desired path on subsequent
  // visits).
  const stored = await captureTimezoneFromDevice(userId, tz);
  return NextResponse.json({ ok: true, timezone: stored ?? null });
}
