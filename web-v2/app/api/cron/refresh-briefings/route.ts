/**
 * POST /api/cron/refresh-briefings
 *
 * Day-rollover handler. Hit this once daily (target: 00:05 PT, after the
 * timezone-adjusted "today" has rolled over) and it regenerates today +
 * today:ios briefings for every active user.
 *
 * Without this, the FIRST user-driven /today open of a new day waits
 * ~15-20s while the LLM regenerates (the day-rollover staleness check in
 * cache.ts returns null because cached _state.today != current today).
 * With this cron firing at the boundary, the cache is already warm.
 *
 * Auth: CRON_SECRET env var. Cron config sends it as Authorization: Bearer.
 * Without the secret set, the endpoint refuses requests. (Don't make it
 * public — each call costs N × LLM rounds.)
 *
 * Setup:
 *   1. Set CRON_SECRET in Railway env (any random string, e.g. `openssl rand -hex 32`).
 *   2. Point a cron service at:
 *      POST https://www.faff.run/api/cron/refresh-briefings
 *      Authorization: Bearer <CRON_SECRET>
 *      Schedule: 5 7 * * *   (00:05 PT = 07:05 UTC daily)
 *   3. Railway has cron jobs built-in (Railway > Service > Settings > Cron
 *      Schedule) — point it at the same URL with the secret in env.
 *      Alternative: cron-job.org, EasyCron, GitHub Actions schedule.
 *
 * Operates over ALL users with an active training plan (training_plans
 * row where archived_iso IS NULL). One LLM regen per active user per
 * surface — small bills for a small beta. Add a per-user rate limit
 * here when user count grows.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { generateBriefing } from '@/lib/coach/engine';

// LLM regens are slow — give it room.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // ── auth ──
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({
      error: 'CRON_SECRET not configured on the server.',
      hint: 'set CRON_SECRET in env, then redeploy + retry.',
    }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ── find active users ──
  // "Active" = has a non-archived training plan. If you have multiple
  // beta runners, they all get warmed. Adjust the WHERE clause if you
  // want to gate by last-active timestamp later.
  let activeUserIds: string[] = [];
  try {
    const r = await pool.query(
      `SELECT DISTINCT user_uuid FROM training_plans
        WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`
    );
    activeUserIds = r.rows.map((row: any) => row.user_uuid as string);

    // Include the fallback "me" user if a plan exists with NULL user_uuid
    // (legacy: David's plan was authored before the user_uuid column).
    const meRow = await pool.query(
      `SELECT 1 FROM training_plans
        WHERE archived_iso IS NULL AND (user_uuid IS NULL OR user_id = 'me') LIMIT 1`
    );
    if (meRow.rowCount && meRow.rowCount > 0) {
      const DAVID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
      if (!activeUserIds.includes(DAVID)) activeUserIds.push(DAVID);
    }
  } catch (e: any) {
    return NextResponse.json({ error: 'failed to list users', detail: e.message }, { status: 500 });
  }

  if (activeUserIds.length === 0) {
    return NextResponse.json({ ok: true, regenerated: 0, users: 0, note: 'no active users' });
  }

  // ── regenerate per user (today + today:ios) ──
  // Run users sequentially but the two surfaces per user in parallel —
  // controls peak LLM concurrency while keeping per-user latency low.
  const results: Array<{ user_id: string; today: 'ok' | string; today_ios: 'ok' | string }> = [];
  for (const userId of activeUserIds) {
    const [todayRes, iosRes] = await Promise.all([
      generateBriefing(userId, 'today').then(() => 'ok' as const).catch((e: any) => (e?.message ?? String(e))),
      generateBriefing(userId, 'today', undefined, true).then(() => 'ok' as const).catch((e: any) => (e?.message ?? String(e))),
    ]);
    results.push({ user_id: userId, today: todayRes, today_ios: iosRes });
  }

  const failed = results.filter((r) => r.today !== 'ok' || r.today_ios !== 'ok');
  return NextResponse.json({
    ok: failed.length === 0,
    users: activeUserIds.length,
    regenerated: results.length * 2 - failed.length,
    failed_count: failed.length,
    results,
    timestamp: new Date().toISOString(),
  });
}

// Allow GET for health probes — returns 200 with the unauth message so
// the operator can verify the endpoint exists without firing a regen.
export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/refresh-briefings',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    secret_configured: Boolean(process.env.CRON_SECRET),
    recommended_schedule: '5 7 * * * UTC (00:05 PT daily)',
  });
}
