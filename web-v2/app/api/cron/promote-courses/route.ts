/**
 * POST /api/cron/promote-courses
 *
 * Daily L1 → L2 promotion sweep.
 *
 * Scans recent races where:
 *   - course_geometry IS NOT NULL (the runner has GPX on the race)
 *   - promoted_to_library_iso IS NULL (we haven't promoted it yet)
 *
 * For each, calls promoteCourseFromRace(), which genericizes the
 * geometry and upserts into course_library according to the
 * editorial / crowd-sourced / stub rules.
 *
 * Idempotent: a race is marked `promoted_to_library_iso = NOW()` on its
 * first promotion, so the next cron pass skips it. Safe to re-run.
 *
 * Why a cron (in addition to the inline trigger on GPX upload):
 *   - Catches races whose course_geometry was added by a backfill,
 *     a future Strava-route-match autocomplete, or any path that
 *     forgets to call the helper inline.
 *   - Catches races where the inline trigger threw and was swallowed.
 *
 * Auth: same CRON_SECRET pattern as the other cron routes.
 *
 * Recommended schedule: 07:45 UTC daily (after run-adaptations at 07:15
 * and snapshot-projections at 07:30 — promotion has no dependency on
 * those, but spreading the load is nice).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { promoteCourseFromRace, type PromoteResult } from '@/lib/courses/promote-from-race';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured.' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth.replace(/^Bearer\s+/i, '').trim() !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Cap the per-run scan so a backfill blowing past doesn't trip the
  // 60s budget. The cron is daily and idempotent, so anything skipped
  // today gets picked up tomorrow.
  //
  // 2026-06-04 · LIMIT dropped from 200 → 50 + soft deadline added.
  // The 200-cap was tripping the 60s maxDuration on Railway when
  // many races were waiting (each promote calls GPX genericize +
  // upserts course_library which can take 0.5-2s each · 200 × 1s
  // alone busts the budget). Curl saw a 90s timeout with no response.
  // Now bails after 45s elapsed even if more candidates remain ·
  // the next cron pass picks them up.
  const LIMIT = 50;
  const SOFT_DEADLINE_MS = 45_000;
  const startedAt = Date.now();
  const candidates = (await pool.query<{ slug: string; user_uuid: string }>(
    `SELECT slug, user_uuid
       FROM races
      WHERE course_geometry IS NOT NULL
        AND promoted_to_library_iso IS NULL
        AND user_uuid IS NOT NULL
      ORDER BY saved_at DESC NULLS LAST
      LIMIT $1`,
    [LIMIT],
  ).catch(() => ({ rows: [] as { slug: string; user_uuid: string }[] }))).rows;

  const results: Array<PromoteResult & { user_uuid: string }> = [];
  const counts: Record<string, number> = { created: 0, upgraded: 0, incremented: 0, noop: 0, error: 0, skipped_for_deadline: 0 };

  for (const c of candidates) {
    // Bail if we've blown the soft deadline · the cron is idempotent
    // so leftover candidates get picked up tomorrow. Better to return
    // a partial-success 200 than to time out and leave the workflow
    // failing every day with no progress visible.
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      counts.skipped_for_deadline = (counts.skipped_for_deadline ?? 0) + 1;
      continue;
    }
    try {
      const r = await promoteCourseFromRace({ userUuid: c.user_uuid, raceId: c.slug });
      results.push({ ...r, user_uuid: c.user_uuid });
      counts[r.action] = (counts[r.action] ?? 0) + 1;
    } catch (e: any) {
      counts.error = (counts.error ?? 0) + 1;
      results.push({
        ok: false, slug: c.slug, source: null, contributor_count: 0,
        action: 'noop', reason: e?.message ?? String(e),
        user_uuid: c.user_uuid,
      });
    }
  }

  return NextResponse.json({
    ok: counts.error === 0,
    timestamp: new Date().toISOString(),
    scanned: candidates.length,
    limit: LIMIT,
    counts,
    results,
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/promote-courses',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    recommended_schedule: '45 7 * * *  (daily at 07:45 UTC = 00:45 PT)',
    notes: 'Idempotent. Scans up to 200 races/run with course_geometry IS NOT NULL '
      + 'AND promoted_to_library_iso IS NULL, then calls promoteCourseFromRace() for each.',
  });
}
