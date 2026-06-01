/**
 * POST /api/cron/dedupe-runs · nightly defensive absorber sweep.
 *
 * The absorber (`lib/runs/merge.ts:autoMergeForDate`) fires from every
 * known ingest path (watch, HK workout, Strava webhook, manual). But
 * race conditions, silent failures, and edge clustering cases leave
 * occasional duplicate rows surviving as canonical siblings of the
 * same physical run.
 *
 * This cron runs `autoMergeRecent` for every active user over the
 * last 14 days. Idempotent · safe to run repeatedly. Catches anything
 * the ingest-time absorber missed.
 *
 * Doctrine context · the broader system also defends at READ time
 * via MAX-per-day dedupe at every aggregation site (see lib/plan/
 * generate.ts, lib/coach/training-form.ts, etc). This cron is the
 * preventive cleanup so reads stay fast and chip-level provenance
 * (source-tier) remains accurate.
 *
 * Recommended schedule: 03:00 PT daily (10:00 UTC) · after the
 * strava-sync cron finishes ingesting yesterday's webhook backfills.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { autoMergeRecent } from '@/lib/runs/merge';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured.' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // All users with any run in the last 14 days · the set the cron actually
  // needs to touch. We deliberately skip dormant users to keep the sweep
  // cheap; they'll be picked up when they next ingest a run.
  const users = (await pool.query<{ user_uuid: string }>(
    `SELECT DISTINCT user_uuid
       FROM runs
      WHERE user_uuid IS NOT NULL
        AND (data->>'date')::date >= CURRENT_DATE - 14`,
  ).catch(() => ({ rows: [] }))).rows.map((r) => r.user_uuid);

  // Always include the default user (David) per the other cron's pattern.
  const DEFAULT = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
  if (!users.includes(DEFAULT)) users.push(DEFAULT);

  const results: Array<{ user_uuid: string; changed: number; error?: string }> = [];
  let totalChanged = 0;

  for (const u of users) {
    try {
      const { totalChanged: changed } = await autoMergeRecent(u, 14);
      results.push({ user_uuid: u, changed });
      totalChanged += changed;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ user_uuid: u, changed: 0, error: msg });
      console.warn('[cron/dedupe-runs] failed for', u, msg);
    }
  }

  return NextResponse.json({
    ok: results.every((r) => !r.error),
    users: users.length,
    totalChanged,
    errors: results.filter((r) => r.error).length,
    results,
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/dedupe-runs',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    recommended_schedule: '0 10 * * *  (03:00 PT)',
    purpose: 'Defensive nightly sweep of autoMergeRecent for all active users in the last 14 days. Idempotent · catches duplicates the ingest-time absorber missed.',
  });
}
