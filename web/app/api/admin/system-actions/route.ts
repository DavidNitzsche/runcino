/**
 * GET /api/admin/system-actions
 *
 * S5 · admin visibility into "invisible but important" system actions
 * that happen behind the scenes — primarily one-shot data migrations
 * tracked by the `data_migrations` table, plus recent schema-affecting
 * events.
 *
 * Use case · "did the Rose Bowl auto-migration actually run?" When
 * migrations execute in ensureSchema on cold start, there's no UI
 * signal. This endpoint surfaces them so you can confirm without
 * grepping logs.
 *
 * Surfaces:
 *   - All data_migrations rows · name + applied_at (chronological)
 *   - workout_weather_cache · row count + most recent fetch
 *   - users with vdot_manual_override · count + most recent override
 *   - Recent activity_gap_status changes (last 30 days)
 *
 * Read-only. opt-token or admin session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { query } from '@/lib/db';

interface MigrationRow { name: string; applied_at: string }
interface CountRow { count: string }
interface FetchRow { last_fetched: string | null }

export async function GET(req: NextRequest) {
  await requireAdminOrOpToken(req);

  // Data migrations log
  const migrations = await query<MigrationRow>(
    `SELECT name, applied_at::TEXT FROM data_migrations
      ORDER BY applied_at DESC LIMIT 100`,
  );

  // Weather cache stats
  const weatherCount = await query<CountRow>(
    `SELECT COUNT(*)::TEXT AS count FROM workout_weather_cache`,
  );
  const weatherLast = await query<FetchRow>(
    `SELECT MAX(fetched_at)::TEXT AS last_fetched FROM workout_weather_cache`,
  );

  // VDOT manual override count
  const overrideStats = await query<{ count: string; latest_at: string | null }>(
    `SELECT COUNT(*) FILTER (WHERE vdot_manual_override IS NOT NULL)::TEXT AS count,
            MAX(vdot_manual_override_at)::TEXT                            AS latest_at
       FROM users`,
  );

  // Activity gap marks set in last 30 days
  const gapMarks = await query<{ user_id: string; status: string; at: string }>(
    `SELECT id::TEXT AS user_id, activity_gap_status AS status, activity_gap_at::TEXT AS at
       FROM users
      WHERE activity_gap_status IS NOT NULL
        AND activity_gap_at > NOW() - INTERVAL '30 days'
      ORDER BY activity_gap_at DESC LIMIT 20`,
  );

  // Splits backfill estimate · count activities with vs without splits
  const splitsStats = await query<{ with_splits: string; without_splits: string }>(
    `SELECT
        COUNT(*) FILTER (WHERE data->'splits' IS NOT NULL
                          AND jsonb_array_length(data->'splits') > 0)::TEXT AS with_splits,
        COUNT(*) FILTER (WHERE data->'splits' IS NULL
                          OR jsonb_array_length(data->'splits') = 0)::TEXT  AS without_splits
       FROM strava_activities`,
  );

  return NextResponse.json({
    dataMigrations: {
      count: migrations.length,
      entries: migrations,
    },
    weatherCache: {
      rowCount: weatherCount[0]?.count ?? '0',
      lastFetched: weatherLast[0]?.last_fetched ?? null,
    },
    vdotManualOverrides: {
      activeUsers: overrideStats[0]?.count ?? '0',
      mostRecentAt: overrideStats[0]?.latest_at ?? null,
    },
    activityGapMarks: {
      activeLast30d: gapMarks.length,
      entries: gapMarks,
    },
    splits: {
      activitiesWithSplits: splitsStats[0]?.with_splits ?? '0',
      activitiesWithoutSplits: splitsStats[0]?.without_splits ?? '0',
    },
    note: 'Read-only diagnostic. Surfaces invisible-but-important system state for debugging.',
  });
}
