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
import { raiseAlert } from '@/lib/ops/alerts';

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

  // P43 pause — skip the entire daily refresh when paused. The day-rollover
  // staleness check carries over: when paused clears, the next /today open
  // is a single-user wait of ~15s, not N × user wait.
  if (process.env.COACH_PAUSED === '1') {
    return NextResponse.json({ ok: true, paused: true, note: 'COACH_PAUSED=1; refresh skipped' });
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

  // ── regenerate per user (today + today:ios + touched surfaces) ──
  // Run users sequentially but the surfaces per user in parallel — controls
  // peak LLM concurrency while keeping per-user latency low.
  //
  // 2026-05-27: extended beyond today + today:ios to also warm the other
  // LLM-backed surfaces (training, races, health, profile) IFF the user
  // has touched them in the last 14 days. Reason: David hit /training +
  // /races at night and they lazy-regenerated because the daily cron
  // wasn't warming them. The 14-day touched-gate keeps cost bounded
  // (won't warm surfaces a runner never visits).
  type Surface = 'today' | 'training' | 'races' | 'health' | 'profile';
  type SurfaceResult = Record<string, 'ok' | string>;
  const results: Array<{ user_id: string; surfaces: SurfaceResult }> = [];

  for (const userId of activeUserIds) {
    // Always warm today + today:ios.
    const targets: Array<{ surface: Surface; compact?: boolean; key: string }> = [
      { surface: 'today', key: 'today' },
      { surface: 'today', compact: true, key: 'today:ios' },
    ];
    // Add other surfaces if the user has a cached briefing within 14 days.
    const recent = (await pool.query(
      `SELECT DISTINCT surface FROM briefings
        WHERE user_id = $1
          AND generated_at >= NOW() - interval '14 days'
          AND surface IN ('training', 'races', 'health', 'profile')`,
      [userId]
    ).catch(() => ({ rows: [] as Array<{ surface: string }> }))).rows;
    for (const r of recent) {
      targets.push({ surface: r.surface as Surface, key: r.surface });
    }

    const outcomes = await Promise.all(
      targets.map((t) =>
        generateBriefing(userId, t.surface, undefined, t.compact)
          .then(() => [t.key, 'ok' as const] as const)
          .catch((e: any) => [t.key, e?.message ?? String(e)] as const)
      )
    );
    const surfaces: SurfaceResult = Object.fromEntries(outcomes);
    results.push({ user_id: userId, surfaces });
  }

  const failed = results.filter((r) => Object.values(r.surfaces).some((v) => v !== 'ok'));
  if (failed.length > 0) {
    // P37 — surface regen failures through the alerts pipeline. Severity
    // bumps to 'error' if more than half failed; otherwise 'warn'.
    void raiseAlert({
      kind: 'regen_fail',
      severity: failed.length > results.length / 2 ? 'error' : 'warn',
      message: `Briefing refresh: ${failed.length}/${results.length} users failed`,
      metadata: { failed_users: failed.map((f) => f.user_id) },
      source: 'cron/refresh-briefings',
    }).catch(() => {});
  }
  const totalSurfaces = results.reduce((s, r) => s + Object.keys(r.surfaces).length, 0);
  const failedSurfaces = results.reduce(
    (s, r) => s + Object.values(r.surfaces).filter((v) => v !== 'ok').length,
    0
  );
  return NextResponse.json({
    ok: failed.length === 0,
    users: activeUserIds.length,
    surfaces_attempted: totalSurfaces,
    surfaces_failed: failedSurfaces,
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
