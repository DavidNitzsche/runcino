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

  // 2026-06-10 · multi-user: the SELECT above IS the population — no
  // hardcoded-user append (was a legacy-row safety net for David).

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

  // 2026-06-09 state-audit Tier 2.3 · load-bearing-flag tripwire.
  // 8 legacy flags carry ~49.6 mi of would-be double-count for the
  // default user, all OUTSIDE this cron's 14-day repair window — if a
  // full-replace writer wipes one, nothing self-heals and volume/TSB
  // silently inflate. Census each swept user nightly; alert on a DROP
  // vs the last stored census the same night it happens.
  const censusOut: Array<{ user_uuid: string; loadBearing: number; alerted: boolean }> = [];
  try {
    const { computeFlagCensus } = await import('@/lib/runs/flag-census');
    const { raiseAlert } = await import('@/lib/ops/alerts');
    for (const u of users) {
      try {
        const census = await computeFlagCensus(u);
        const prev = (await pool.query<{ metadata: { loadBearing?: number; loadBearingIds?: string[] } | null }>(
          `SELECT metadata FROM ops_alerts
            WHERE kind = 'dedup_flag_census' AND metadata->>'userUuid' = $1
            ORDER BY created_at DESC LIMIT 1`,
          [u],
        ).catch(() => ({ rows: [] }))).rows[0]?.metadata ?? null;

        const prevCount = prev?.loadBearing ?? null;
        const dropped = prevCount != null && census.loadBearing < prevCount;
        if (dropped) {
          const lostIds = (prev?.loadBearingIds ?? []).filter((id) => !census.loadBearingIds.includes(id));
          await raiseAlert({
            kind: 'dedup_flag_census',
            severity: 'error',
            source: 'cron/dedupe-runs',
            message: `Load-bearing dedup flags DROPPED ${prevCount} → ${census.loadBearing} for ${u.slice(0, 8)}… · ${census.loadBearingMi} mi still protected · wiped flags double-count outside the 14d repair window. Lost ids: ${lostIds.join(', ') || 'unknown'}.`,
            metadata: { ...census, previous: prevCount, lostIds },
          });
        } else if (prevCount == null || prevCount !== census.loadBearing) {
          // Baseline (first run) or a count CHANGE upward (new legacy
          // flags created) · store as the new comparison point, info-only.
          await raiseAlert({
            kind: 'dedup_flag_census',
            severity: 'info',
            source: 'cron/dedupe-runs',
            message: `Dedup flag census for ${u.slice(0, 8)}… · ${census.loadBearing} load-bearing flags (${census.loadBearingMi} mi protected) of ${census.flaggedTotal} total.`,
            metadata: { ...census },
          });
        }
        censusOut.push({ user_uuid: u, loadBearing: census.loadBearing, alerted: dropped });
      } catch (err: unknown) {
        console.warn('[cron/dedupe-runs] flag census failed for', u,
          err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err: unknown) {
    console.warn('[cron/dedupe-runs] flag census unavailable:',
      err instanceof Error ? err.message : String(err));
  }

  return NextResponse.json({
    ok: results.every((r) => !r.error),
    users: users.length,
    totalChanged,
    errors: results.filter((r) => r.error).length,
    results,
    flag_census: censusOut,
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
