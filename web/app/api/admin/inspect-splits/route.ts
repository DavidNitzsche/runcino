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
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const rows = await query<Row>(
    `SELECT id::text AS id,
            data->>'date'                AS date,
            COALESCE(data->>'name', '')  AS name,
            (data->>'distanceMi')::TEXT  AS dist,
            data->'splits'               AS splits
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
        splitsWithGap: splits?.filter((s) => s.gapSPerMi != null).length ?? 0,
        splitsWithHr: splits?.filter((s) => s.avgHr != null).length ?? 0,
      };
    }),
  });
}
