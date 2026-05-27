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
// This is NOT the LLM-regen cron (that's refresh-briefings, daily).
// keep-warm is cheap and frequent — no LLM calls, just DB reads.
//
// Auth: same CRON_SECRET as refresh-briefings.
//
// Setup (Railway cron):
//   Schedule: every 15 min from 7am to 11pm UTC (cron: "0,15,30,45 7-23 * * *")
//             — slash-15 syntax is fine in the cron field; using explicit
//             list here because the literal asterisk-slash sequence would
//             otherwise close any block comment that wrapped this doc.
//   Method:   POST https://www.faff.run/api/cron/keep-warm
//   Header:   Authorization: Bearer <CRON_SECRET>
//
// Returns timing per step so you can see if any sub-call is slow.
//
// 2026-05-27 incident: this doc was originally a /** ... */ JSDoc and
// contained the literal "asterisk-slash-15" cron schedule, which closed
// the JSDoc block early on line 18 — the rest of the comment parsed as
// code, Next.js webpack threw Syntax Error, and Railway rejected every
// build for ~15 hours. PROMPT_VERSION bumps and other doctrine fixes
// never reached prod because of this one character pair. Converted to
// line comments to make it impossible to recur.
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { loadCoachState } from '@/lib/coach/state-loader';
import { loadGlanceState } from '@/lib/coach/glance-state';
import { loadTrainingState } from '@/lib/coach/training-state';
import { loadRacesState } from '@/lib/coach/races-state';
import { loadHealthState } from '@/lib/coach/health-state';
import { loadProfileState } from '@/lib/coach/profile-state';
import { generateBriefing } from '@/lib/coach/engine';

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
    const r = await pool.query(
      `SELECT DISTINCT user_uuid FROM training_plans
        WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`
    );
    activeUserIds = r.rows.map((row: any) => row.user_uuid as string);
    const meRow = await pool.query(
      `SELECT 1 FROM training_plans
        WHERE archived_iso IS NULL AND (user_uuid IS NULL OR user_id = 'me') LIMIT 1`
    );
    if (meRow.rowCount && meRow.rowCount > 0) {
      const DAVID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
      if (!activeUserIds.includes(DAVID)) activeUserIds.push(DAVID);
    }
    timings.list_users_ms = Date.now() - t2;
  } catch (e: any) {
    return NextResponse.json({ ok: false, step: 'list_users', error: e?.message ?? String(e) }, { status: 500 });
  }

  // ── pre-load ALL page-level state loaders per user ──
  // 2026-05-27: extended beyond loadCoachState to cover the loaders for
  // every LLM-backed surface. Each call populates pg query plan cache +
  // warms the shared race lookup memo. No LLM spend; pure DB work.
  //
  // Run loaders in parallel per user (they hit different tables); users
  // sequentially so a slow user doesn't block other users' warm windows.
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
    // 2026-05-27 P-KEEPWARM-SECONDARY: in addition to the DB state
    // loaders above, also pre-warm the briefing CACHE for every
    // LLM-backed surface. generateBriefing returns instantly when
    // cache is fresh (the common case), and regenerates exactly once
    // per invalidation event (day rollover, version bump, mutation).
    // Net effect: David never sees "Faffing on..." on a surface
    // he hasn't visited recently, because the cron warmed it.
    //
    // Cost in steady state: ~0 (cache hits). Cost after a daily
    // invalidation: ~5 LLM calls × active users (one per surface).
    await Promise.all([
      runLoader('brief:today',    () => generateBriefing(userId, 'today')),
      runLoader('brief:todayIos', () => generateBriefing(userId, 'today', undefined, true)),
      runLoader('brief:training', () => generateBriefing(userId, 'training')),
      runLoader('brief:races',    () => generateBriefing(userId, 'races')),
      runLoader('brief:health',   () => generateBriefing(userId, 'health')),
      runLoader('brief:profile',  () => generateBriefing(userId, 'profile')),
    ]);
    const ok = Object.values(loaders).every((v) => typeof v === 'number');
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
    purpose: 'keep container + DB pool + per-user state warm; no LLM spend',
  });
}
