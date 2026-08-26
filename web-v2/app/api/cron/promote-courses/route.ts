/**
 * POST /api/cron/promote-courses
 *
 * Daily L1 → L2 promotion sweep.
 *
 * Two steps, in order.
 *
 * STEP 0 · HYDRATE (2026-08-25). Fill `course_geometry` from the `gpx_text`
 * already on the row. Added because step 1's scan is
 * `course_geometry IS NOT NULL`, which made this cron a promoter that could
 * never populate what it promotes: nine of the owner's eleven races had a NULL
 * column, six of them with parseable GPX in the same row, and the three
 * writers of that column all take a fresh user action as input. Nothing in
 * this app could turn a stored GPX into geometry. Now this does, on the pass
 * before promotion, so a hydrated race is promoted the same morning rather
 * than the next one. Refuses any track `assessGeometryConfidence` rejects.
 * The argument is in `lib/race/course-geometry-source.ts`.
 *
 * STEP 1 · PROMOTE. Scans recent races where:
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
 * Schedule: 07:45 UTC daily, per .github/workflows/promote-courses.yml.
 *
 * 2026-08-17 · the note here said "after run-adaptations at 07:15", which
 * stopped being true when run-adaptations moved to 03:00 UTC on
 * 2026-06-04. Promotion has no dependency on either neighbour, so nothing
 * broke — but a false ordering claim is how a real one gets trusted.
 * It still lands after snapshot-projections (07:30), which is the only
 * neighbour it shares any load with.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { promoteCourseFromRace, type PromoteResult } from '@/lib/courses/promote-from-race';
import { hydrateCourseGeometry } from '@/lib/race/hydrate-course-geometry';

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

  // ── STEP 0 · hydrate course_geometry from gpx_text ──────────────────────
  // Capped well below the promote limit: the parse is a regex over the whole
  // file and the owner's largest is 3.5 MB. Idempotent, so anything skipped
  // today is picked up tomorrow. Never overwrites a populated column.
  const hydration = await hydrateCourseGeometry({ commit: true, limit: 10 });

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
    ok: counts.error === 0 && hydration.plans !== null,
    timestamp: new Date().toISOString(),
    // `null` here means the hydrate candidate read FAILED. It is not the same
    // as an empty list, and the ok flag above says so.
    hydration: hydration.plans === null
      ? { read: 'failed' }
      : {
          read: 'ok',
          counts: hydration.counts,
          wrote: hydration.plans.filter((p) => p.written).map((p) => ({
            slug: p.slug, points: p.points, gainFt: p.gainFt, netFt: p.netFt,
            confidence: p.confidence, courseSource: p.courseSource,
          })),
          refused: hydration.plans
            .filter((p) => p.verdict === 'refused' || p.verdict === 'unparseable')
            .map((p) => ({ slug: p.slug, verdict: p.verdict, reason: p.reason })),
        },
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
