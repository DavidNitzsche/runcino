/**
 * POST /api/notifications/register
 *   { device_token, platform: 'ios', app_version?, user_id? }
 *
 * Upserts an APNs device token. The iPhone calls this from
 * native-v2/Faff/Faff/FaffApp.swift inside the
 * application(_:didRegisterForRemoteNotificationsWithDeviceToken:) handler,
 * AND on every foreground transition (Apple silently rotates).
 *
 * Auth: requireUserId session auth — the device token binds to the
 * session user (multi-user since 2026-05-30).
 *
 * Source spec: docs/2026-05-28-notifications.html §1 (token registration).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

interface RegisterBody {
  device_token?: string;
  platform?: 'ios' | 'web';
  app_version?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  let body: RegisterBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.device_token || typeof body.device_token !== 'string' || body.device_token.length < 16) {
    return NextResponse.json({ error: 'device_token required (string, ≥16 chars)' }, { status: 400 });
  }
  const platform = body.platform ?? 'ios';
  if (platform !== 'ios' && platform !== 'web') {
    return NextResponse.json({ error: `platform must be 'ios' or 'web'` }, { status: 400 });
  }

  try {
    // Upsert by device_token. If a different user registered this token
    // previously (e.g. handoff), the user_id flips — that's fine, the
    // physical device only belongs to one runner at a time.
    await pool.query(
      `INSERT INTO device_tokens (user_id, user_uuid, device_token, platform, app_version, registered_at, last_seen_at, revoked_at)
       VALUES ($1, $1, $2, $3, $4, now(), now(), null)
       ON CONFLICT (device_token) DO UPDATE
         SET user_id     = EXCLUDED.user_id,
             user_uuid   = EXCLUDED.user_uuid,
             platform    = EXCLUDED.platform,
             app_version = EXCLUDED.app_version,
             last_seen_at = now(),
             revoked_at  = null`,
      [userId, body.device_token, platform, body.app_version ?? null],
    );
  } catch (err: any) {
    return NextResponse.json({
      error: 'register failed',
      detail: err?.message ?? String(err),
      hint: 'Did you apply web-v2/db/migrations/121_notifications.sql?',
    }, { status: 500 });
  }

  return NextResponse.json({ registered: true });
}

export const dynamic = 'force-dynamic';
