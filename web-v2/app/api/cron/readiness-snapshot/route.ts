// POST /api/cron/readiness-snapshot
//
// Nightly snapshot of every active user's readiness score + per-pillar
// values into readiness_snapshots. Idempotent on (user_uuid, snapshot_date).
//
// Read by lib/coach/readiness-brief.ts to render:
//   · 14-day score trend chart
//   · Day-vs-yesterday mover detection
//   · 3+ day persistence streaks per pillar
//
// Pattern mirrors /api/cron/snapshot-projections (same auth, same shape).

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { writeReadinessSnapshot } from '@/lib/coach/readiness-snapshot';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({
      error: 'CRON_SECRET not configured.',
    }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2026-06-03 · per-user TZ · each runner's snapshot keyed to their
  // calendar day, not server UTC.
  const { runnerToday } = await import('@/lib/runtime/runner-tz');
  const userIds = (await pool.query<{ user_uuid: string }>(
    `SELECT DISTINCT user_uuid FROM training_plans
      WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`,
  ).catch(() => ({ rows: [] }))).rows.map((r) => r.user_uuid);

  // Always include the default user (David's legacy id · same pattern as
  // snapshot-projections cron).
  const DEFAULT = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
  if (!userIds.includes(DEFAULT)) userIds.push(DEFAULT);

  const results = [] as Array<{ userUuid: string; date: string; score: number; band: string; written: boolean; reason?: string; error?: string }>;

  for (const u of userIds) {
    try {
      const today = await runnerToday(u);
      const r = await writeReadinessSnapshot(u, today);
      results.push(r);
    } catch (e: unknown) {
      results.push({
        userUuid: u,
        date: today,
        score: 0,
        band: 'pull-back',
        written: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: results.every((r) => !r.error),
    today,
    users: results.length,
    written: results.filter((r) => r.written).length,
    skipped: results.filter((r) => !r.written && !r.error).length,
    errors: results.filter((r) => r.error).length,
    results,
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/readiness-snapshot',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    recommended_schedule: '15 8 * * *  (daily at 01:15 PT = 08:15 UTC · runs AFTER snapshot-projections)',
    note: 'Idempotent · re-running same day overwrites. Brand-new users with no signal are skipped (reason=no_data).',
  });
}
