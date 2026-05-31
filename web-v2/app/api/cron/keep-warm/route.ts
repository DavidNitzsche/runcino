// POST /api/cron/keep-warm
//
// Lightweight warmer that fires every 10-15 minutes during the user's
// waking window. Purpose:
//   1. Keep the Railway container alive (no cold-start when David opens
//      /today at 6:45am, no spin-up between sessions).
//   2. Keep the Postgres connection pool warm.
//   3. Pre-load today's CoachState for active users so /today's first
//      paint reads from a fresh in-process cache.
//
// 2026-05-28 LLM rip: brief pre-regen step is GONE (no LLM, no cache).
// The state-loader warm is still useful — pg pool stays hot, and the
// per-process race-lookup memo gets populated so the first user-driven
// request doesn't pay the DB round-trip.
//
// Auth: same CRON_SECRET as refresh-briefings.

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { loadCoachState } from '@/lib/coach/state-loader';
import { loadGlanceState } from '@/lib/coach/glance-state';
import { loadTrainingState } from '@/lib/coach/training-state';
import { loadRacesState } from '@/lib/coach/races-state';
import { loadHealthState } from '@/lib/coach/health-state';
import { loadProfileState } from '@/lib/coach/profile-state';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  // ── auth ──
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({
      error: 'CRON_SECRET not configured.',
      hint: 'set CRON_SECRET in env, then redeploy + retry.',
    }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const timings: Record<string, number> = {};
  const start = Date.now();

  // ── DB ping ──
  const t1 = Date.now();
  try {
    await pool.query('SELECT 1');
    timings.db_ping_ms = Date.now() - t1;
  } catch (e: any) {
    return NextResponse.json({ ok: false, step: 'db_ping', error: e?.message ?? String(e) }, { status: 500 });
  }

  // ── find active users (same definition as refresh-briefings) ──
  const t2 = Date.now();
  let activeUserIds: string[] = [];
  try {
    // P0 cross-user leak follow-up (2026-05-30): the legacy
    // `(user_uuid IS NULL OR user_id='me')` fallback that auto-added
    // David's UUID is gone. His plan was backfilled to UUID long ago
    // and is in the DISTINCT list below. If we ever need to seed an
    // orphan owner here again, do it by explicit env var, not by a
    // global query that matches any unowned row.
    const r = await pool.query(
      `SELECT DISTINCT user_uuid FROM training_plans
        WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`
    );
    activeUserIds = r.rows.map((row: any) => row.user_uuid as string);
    timings.list_users_ms = Date.now() - t2;
  } catch (e: any) {
    return NextResponse.json({ ok: false, step: 'list_users', error: e?.message ?? String(e) }, { status: 500 });
  }

  // ── pre-load page-level state loaders per user ──
  // No LLM regen — just the state warm. Loaders hit different tables so
  // they parallelize cleanly per user; users run sequentially so one slow
  // user doesn't block others.
  const t3 = Date.now();
  const perUser: Array<{ user_id: string; ms: number; ok: boolean; loaders: Record<string, number | string> }> = [];
  for (const userId of activeUserIds) {
    const us = Date.now();
    const loaders: Record<string, number | string> = {};
    const runLoader = async (name: string, fn: () => Promise<unknown>) => {
      const t = Date.now();
      try { await fn(); loaders[name] = Date.now() - t; }
      catch (e: any) { loaders[name] = `err: ${e?.message ?? String(e)}`; }
    };
    await Promise.all([
      runLoader('coach',    () => loadCoachState(userId)),
      runLoader('glance',   () => loadGlanceState(userId)),
      runLoader('training', () => loadTrainingState(userId)),
      runLoader('races',    () => loadRacesState(userId)),
      runLoader('health',   () => loadHealthState(userId)),
      runLoader('profile',  () => loadProfileState(userId)),
    ]);
    // 2026-05-28 LLM rip: brief pre-regen step removed entirely.
    // fact-reciter rebuilds from state on every read; nothing to warm
    // beyond the state-loaders above.
    loaders['briefs_kicked_off'] = 0;
    const ok = Object.values(loaders).filter((v) => v !== 0).every((v) => typeof v === 'number');
    perUser.push({ user_id: userId, ms: Date.now() - us, ok, loaders });
  }
  timings.state_warm_total_ms = Date.now() - t3;
  timings.total_ms = Date.now() - start;

  return NextResponse.json({
    ok: perUser.every((u) => u.ok),
    users: activeUserIds.length,
    timings,
    per_user: perUser,
    timestamp: new Date().toISOString(),
  });
}

// Health probe — same shape as refresh-briefings.
export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/keep-warm',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    secret_configured: Boolean(process.env.CRON_SECRET),
    recommended_schedule: '*/15 7-23 * * *  (every 15 min, 7am-11pm UTC)',
  });
}
