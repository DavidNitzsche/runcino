/**
 * GET /api/admin/inspect-splits
 *
 * Diagnostic for the splits-data state. Walks the last 14 days of
 * activities and reports per-activity:
 *   - has data.splits array?
 *   - if yes, count of splits with gapSPerMi populated
 *   - sample splits[0] shape
 *
 * Helps catch the regression class "backfill ran but splits got
 * dropped / mis-shaped." Read-only.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { query } from '@/lib/db';

interface Row {
  id: string;
  date: string;
  name: string;
  dist: string;
  splits: unknown;
  detail_has_splits_standard: boolean | null;
  detail_splits_standard_len: number | null;
  data_keys: string[];
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get('since');
  const cutoff = sinceParam && /^\d{4}-\d{2}-\d{2}$/.test(sinceParam)
    ? sinceParam
    : new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const rows = await query<Row>(
    `SELECT id::text AS id,
            data->>'date'                AS date,
            COALESCE(data->>'name', '')  AS name,
            (data->>'distanceMi')::TEXT  AS dist,
            data->'splits'               AS splits,
            (detail->'splits_standard' IS NOT NULL) AS detail_has_splits_standard,
            jsonb_array_length(COALESCE(detail->'splits_standard', '[]'::jsonb)) AS detail_splits_standard_len,
            (SELECT array_agg(key) FROM jsonb_object_keys(data) AS key) AS data_keys
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
      ORDER BY (data->>'date') DESC
      LIMIT 30`,
    [admin.id, cutoff],
  );

  return NextResponse.json({
    cutoff,
    count: rows.length,
    activities: rows.map((r) => {
      const splits = Array.isArray(r.splits) ? r.splits as Array<{ paceSPerMi?: number; gapSPerMi?: number | null; avgHr?: number | null }> : null;
      return {
        id: r.id,
        date: r.date,
        name: r.name,
        distanceMi: r.dist,
        splitsPresent: splits != null,
        splitCount: splits?.length ?? 0,
        sampleSplit: splits?.[0] ?? null,
        allSplits: splits ?? null,
        splitsWithGap: splits?.filter((s) => s.gapSPerMi != null).length ?? 0,
        splitsWithHr: splits?.filter((s) => s.avgHr != null).length ?? 0,
        detailHasSplitsStd: r.detail_has_splits_standard,
        detailSplitsStdLen: r.detail_splits_standard_len,
        dataKeys: r.data_keys,
      };
    }),
  });
}
