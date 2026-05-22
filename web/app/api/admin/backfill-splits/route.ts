/**
 * POST /api/admin/backfill-splits
 *
 * One-shot backfill: for every activity in the user's strava_activities
 * that's missing `data.splits` (i.e., ingested before the wire-shape
 * expanded OR via the year-start LIST sync which doesn't return per-
 * mile data), fetch the detail via the single-activity endpoint and
 * re-normalize so `splits` lands.
 *
 * Strava rate limits: 100 requests / 15 min, 1000 / day. This handler
 * processes activities in small batches with a small pause between
 * requests to stay well under the burst limit. Returns counts so the
 * caller can decide whether to re-invoke.
 *
 * Query params:
 *   - limit (optional, default 20, max 50), # of activities to backfill
 *     in this invocation. Caller can poll to backfill all.
 *   - since (optional, ISO date, default 6 weeks ago), only backfill
 *     activities after this date. L7 Signal 2 needs ~8 weeks of data,
 *     so default to 6 weeks for the first signal pass.
 *
 * Admin-only. Read+write to strava_activities. Network to Strava.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { query } from '@/lib/db';
import { getActivityDetail } from '@/lib/sync-strava-user';
import { normalizeActivity } from '@/app/api/strava/activities/route-shared';

interface PendingRow {
  id: string;
  date: string;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit')) || 20;
  const limit = Math.max(1, Math.min(50, limitParam));
  const sinceParam = url.searchParams.get('since');
  const sinceIso = sinceParam && /^\d{4}-\d{2}-\d{2}$/.test(sinceParam)
    ? sinceParam
    : new Date(Date.now() - 42 * 86_400_000).toISOString().slice(0, 10);
  // `force=missing-gap` re-processes activities whose splits exist but
  // don't yet carry gapSPerMi (added 2026-05-19 round 4 for Signal 3
  // hill-grade comparison). Without this flag, default behavior only
  // touches activities with no splits at all.
  const force = url.searchParams.get('force');

  let pendingFilter = `(data->'splits' IS NULL OR jsonb_array_length(data->'splits') = 0)`;
  if (force === 'missing-gap') {
    // Reprocess if ANY split lacks a gapSPerMi key. Postgres jsonb path
    // existence is the cheapest check; if even one split is missing the
    // field, the activity is stale.
    pendingFilter = `(
      data->'splits' IS NULL
      OR jsonb_array_length(data->'splits') = 0
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(data->'splits') s
         WHERE NOT (s ? 'gapSPerMi')
      )
    )`;
  } else if (force === 'all') {
    pendingFilter = `TRUE`;
  }

  // Find activities matching the pending filter since the cutoff.
  const pending = await query<PendingRow>(
    `SELECT id::text AS id, data->>'date' AS date
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND ${pendingFilter}
      ORDER BY (data->>'date') DESC
      LIMIT $3`,
    [admin.id, sinceIso, limit],
  );

  const results: Array<{ id: string; date: string; status: 'updated' | 'skipped' | 'error'; note?: string }> = [];
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of pending) {
    try {
      const detail = await getActivityDetail(admin.id, row.id);
      if (!detail) {
        results.push({ id: row.id, date: row.date, status: 'skipped', note: 'detail unavailable' });
        skipped += 1;
        continue;
      }
      const norm = normalizeActivity(detail);
      if (!norm.splits || norm.splits.length === 0) {
        // Strava returned the activity but no splits_standard, common
        // for treadmill / manual-entry runs. Mark as skipped so we
        // don't try again next poll.
        results.push({ id: row.id, date: row.date, status: 'skipped', note: 'no splits_standard in detail' });
        skipped += 1;
        continue;
      }
      await query(
        `UPDATE strava_activities SET data = $2::jsonb WHERE id = $1`,
        [row.id, JSON.stringify(norm)],
      );
      results.push({ id: row.id, date: row.date, status: 'updated' });
      updated += 1;
    } catch (e) {
      results.push({
        id: row.id,
        date: row.date,
        status: 'error',
        note: e instanceof Error ? e.message : String(e),
      });
      errors += 1;
    }
    // 200ms pacing keeps us comfortably under the 100/15min Strava cap
    // for any reasonable batch size (20 × 200ms = 4 seconds).
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // Count remaining for the caller's progress UI.
  const remainingRows = await query<{ cnt: string }>(
    `SELECT COUNT(*)::TEXT AS cnt
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND (data->'splits' IS NULL OR jsonb_array_length(data->'splits') = 0)`,
    [admin.id, sinceIso],
  );
  const remaining = parseInt(remainingRows[0]?.cnt ?? '0', 10);

  return NextResponse.json({
    window: { since: sinceIso, limit },
    processed: pending.length,
    updated,
    skipped,
    errors,
    remaining,
    rateLimit: { perBatch: pending.length, sleepMs: 200 },
    results,
    next: remaining > 0
      ? `Re-POST /api/admin/backfill-splits?since=${sinceIso} to process the next ${Math.min(remaining, limit)}.`
      : 'All activities backfilled for this window.',
  });
}
