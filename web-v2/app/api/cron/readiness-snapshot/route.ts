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

  // 2026-06-10 · multi-user: the SELECT above IS the population — no
  // hardcoded-user append (was a legacy-row safety net for David).

  const results = [] as Array<{ userUuid: string; date: string; score: number | null; band: string; written: boolean; reason?: string; error?: string }>;

  for (const u of userIds) {
    let perUserToday = '';
    try {
      perUserToday = await runnerToday(u);
      const r = await writeReadinessSnapshot(u, perUserToday);
      results.push(r);

      // 2026-06-09 Phase 2 (3.4) · race-week sleep-banking nudge.
      // When the runner's next A-race is 2-7 days out, queue tonight's
      // 21:00-local bedtime nudge (Research/08 §sleep-banking · the
      // night two-out is the one that counts; race-eve itself stays the
      // existing race_eve template's job, so the window stops at T-2).
      // Rides the race_eve category + prefs toggle; the per-night dedup
      // key makes cron re-runs no-ops. Best-effort · a nudge must never
      // fail the snapshot cron.
      try {
        const aRace = (await pool.query<{ slug: string; name: string | null; date: string }>(
          `SELECT slug, meta->>'name' AS name, meta->>'date' AS date
             FROM races
            WHERE user_uuid = $1::uuid
              AND meta->>'priority' = 'A'
              AND (meta->>'date')::date > $2::date + 1
              AND (meta->>'date')::date <= $2::date + 7
            ORDER BY meta->>'date' ASC LIMIT 1`,
          [u, perUserToday],
        ).catch(() => ({ rows: [] }))).rows[0];
        if (aRace?.date) {
          const { loadNotificationPrefs, categoryEnabled } = await import('@/lib/notifications/prefs');
          const prefs = await loadNotificationPrefs(u);
          if (categoryEnabled(prefs, 'race_eve')) {
            const daysToRace = Math.round(
              (Date.parse(aRace.date + 'T12:00:00Z') - Date.parse(perUserToday + 'T12:00:00Z')) / 86400000,
            );
            const { renderSleepBanking } = await import('@/lib/notifications/templates');
            const { enqueueNotification, todayAtHourLocal } = await import('@/lib/notifications/enqueue');
            const { runnerTimezone } = await import('@/lib/runtime/runner-tz');
            const tz = await runnerTimezone(u);
            await enqueueNotification(
              u,
              renderSleepBanking({
                race_id: aRace.slug,
                race_slug: aRace.slug,
                race_name: aRace.name ?? aRace.slug,
                days_to_race: daysToRace,
                tonight_iso: perUserToday,
              }),
              todayAtHourLocal(tz, 21, 0),
            );
          }
        }
      } catch (nudgeErr: unknown) {
        console.warn('[cron/readiness-snapshot] sleep-banking nudge skipped:',
          nudgeErr instanceof Error ? nudgeErr.message : String(nudgeErr));
      }
    } catch (e: unknown) {
      results.push({
        userUuid: u,
        date: perUserToday,
        score: 0,
        band: 'pull-back',
        written: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: results.every((r) => !r.error),
    // 2026-06-03 · per-runner today now lives on each result row;
    // top-level stamp is server UTC (a moment, not a calendar day).
    timestamp: new Date().toISOString(),
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
