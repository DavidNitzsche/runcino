/**
 * GET   /api/profile/notifications  → { prefs: NotificationPrefs + phone aliases }
 * PATCH /api/profile/notifications  body { partial NotificationPrefs | phone shape }
 * PUT   /api/profile/notifications  — alias for PATCH (merge semantics)
 *
 * Reads / updates profile.notification_prefs (jsonb). The /profile
 * settings panel calls these to wire the master toggle + per-category
 * + race-day wake / weekly check-in / quiet hours surfaces.
 *
 * 2026-07-06 · audit P1-15 · WIRE TOLERANCE. The iPhone's
 * NotificationPrefs (G_Settings.swift) speaks a 7-key dialect
 * (readiness/workout_reminder/recap/race_countdown/adaptation/
 * reconnect/streak). The old handler 400'd the whole PATCH on the
 * first unknown key, so every phone toggle silently never saved, and
 * GET emitted only the canonical shape. Now:
 *   - PATCH/PUT accept BOTH shapes — phone alias keys are translated
 *     to canonical via translatePhonePrefKeys (prefs.ts documents the
 *     mapping); adaptation_enabled is stored as a passthrough.
 *   - GET/PATCH emit the canonical keys PLUS the derived phone alias
 *     keys BOTH at the TOP LEVEL of the response body AND under
 *     `prefs`. The top-level spread is load-bearing: the phone's
 *     fetchNotificationPrefs decodes the WHOLE body first with a
 *     per-key tolerant init (missing key → true), so a nested-only
 *     emit decodes as all-true, displays every toggle ON, and the
 *     phone's full-struct PATCH then re-enables categories disabled
 *     on web (adversarial review 2026-07-06, issue 1). Web
 *     Settings.tsx keeps reading j.prefs — additive, nothing breaks.
 * THE CANONICAL SHAPE IS THE SERVER'S NotificationPrefs — Wave 2
 * native migrates the phone to it, then the alias layer dies.
 *
 * The race_day_enabled flag is intentionally NOT enforced disabled
 * here — the UI renders it disabled (deck §SETTINGS · RACE-DAY LOCK)
 * but the column is honest. If a future hardware key flips it to
 * false, the sender respects it. The deck is the contract, not the
 * column. (The phone's race_countdown_enabled maps to race_eve_enabled
 * only — a phone toggle can never kill the race-day wake.)
 *
 * Source spec: the 2026-05-28 notifications deck, §SETTINGS SURFACE.
 * (The deck is a session artifact and was never committed to the repo —
 * docs/2026-05-28-notifications.html does not exist. The in-repo
 * contract is prefs.ts + lib/notifications/notifications-wire.test.ts.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import {
  DEFAULT_PREFS,
  bustPrefsCache,
  loadNotificationPrefs,
  translatePhonePrefKeys,
  dualShapePrefsBody,
  PHONE_PASSTHROUGH_KEYS,
} from '@/lib/notifications/prefs';
import { requireUserId } from '@/lib/auth/session';

const ALLOWED_KEYS = new Set<keyof typeof DEFAULT_PREFS>([
  'master_enabled',
  'race_day_enabled',
  'race_eve_enabled',
  'skip_recovery_enabled',
  'weekly_checkin_enabled',
  'niggle_sick_enabled',
  'streak_enabled',
  'strava_reconnect_enabled',
  'race_day_wake_time',
  'weekly_checkin_time',
  'quiet_hours_start',
  'quiet_hours_end',
]);

function validHm(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const prefs = await loadNotificationPrefs(userId);
  // P1-15 · emit BOTH shapes: canonical keys + the derived phone alias
  // keys, at the TOP LEVEL (the phone decodes the whole body — see the
  // header + dualShapePrefsBody in prefs.ts) and under `prefs` (web).
  // loadNotificationPrefs merges the raw jsonb over DEFAULT_PREFS, so
  // passthrough keys (adaptation_enabled) ride along in `prefs` at
  // runtime — pass it as raw for the alias derivation.
  const dual = dualShapePrefsBody(prefs, prefs as unknown as Record<string, unknown>);
  return NextResponse.json({ ...dual, prefs: dual });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // P1-15 · translate iPhone alias keys to canonical BEFORE validation
  // so a phone-shaped body no longer 400s on its first key.
  body = translatePhonePrefKeys(body);

  // Validate the patch shape
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'user_id') continue;
    if (!ALLOWED_KEYS.has(k as any) && !PHONE_PASSTHROUGH_KEYS.has(k)) {
      return NextResponse.json({ error: `Field not allowed: ${k}` }, { status: 400 });
    }
    if (k.endsWith('_enabled')) {
      if (typeof v !== 'boolean') {
        return NextResponse.json({ error: `${k} must be boolean` }, { status: 400 });
      }
      patch[k] = v;
    } else if (k.endsWith('_time') || k.startsWith('quiet_hours_')) {
      if (!validHm(v)) {
        return NextResponse.json({ error: `${k} must be 'HH:MM' (00-23 : 00-59)` }, { status: 400 });
      }
      patch[k] = v;
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields in body' }, { status: 400 });
  }

  try {
    // Merge into the JSONB column. COALESCE so missing column doesn't NPE.
    const r = await pool.query(
      `UPDATE profile
          SET notification_prefs = COALESCE(notification_prefs, '{}'::jsonb) || $2::jsonb
        WHERE user_uuid = $1
        RETURNING notification_prefs`,
      [userId, JSON.stringify(patch)],
    );
    if (r.rowCount === 0) {
      // No profile row yet → insert one with the partial prefs merged into defaults.
      const merged = { ...DEFAULT_PREFS, ...patch };
      await pool.query(
        `INSERT INTO profile (user_uuid, notification_prefs) VALUES ($1, $2::jsonb)`,
        [userId, JSON.stringify(merged)],
      );
    }
    bustPrefsCache(userId);
    const updated = await loadNotificationPrefs(userId);
    // P1-15 · same dual-shape emit as GET: top level for the phone's
    // whole-body decode, `prefs` for web. `ok` spread LAST so no pref
    // key can shadow it.
    const dual = dualShapePrefsBody(updated, updated as unknown as Record<string, unknown>);
    return NextResponse.json({ ...dual, prefs: dual, ok: true });
  } catch (err: any) {
    return NextResponse.json({
      error: 'prefs update failed',
      detail: err?.message ?? String(err),
      hint: 'Did you apply web-v2/db/migrations/121_notifications.sql?',
    }, { status: 500 });
  }
}

/** P1-15 · PUT tolerated as an alias for PATCH. The stored column is a
 *  jsonb merged over defaults, so merge semantics are safe for full-body
 *  PUTs too (a full body simply merges every key). */
export async function PUT(req: NextRequest) {
  return PATCH(req);
}

export const dynamic = 'force-dynamic';
