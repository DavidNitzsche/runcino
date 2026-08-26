/**
 * /api/admin/backfill-course-geometry · fill `races.course_geometry` from the
 * `races.gpx_text` already sitting in the same row.
 *
 *   GET  ?scope=self|all&slug=<slug>          → DRY RUN. Reads only.
 *   POST { commit: true, scope, slug }        → writes the `write` verdicts.
 *   POST { }                                  → same dry run as GET.
 *
 * Admin session required on both.
 *
 * ── WHY THIS ENDPOINT EXISTS ─────────────────────────────────────────────
 *
 * Nine of the owner's eleven races have a NULL `course_geometry`; six of those
 * carry parseable GPX in the same row. Three writers populate that column and
 * every one of them takes a fresh user action as its input — a file picked in
 * a browser, a Strava route pasted in. None can read `gpx_text`, which is the
 * legacy column the old app wrote before `course_geometry` existed. The daily
 * `promote-courses` cron looked like the backstop and is not: it scans
 * `course_geometry IS NOT NULL`, so it promotes L1 to L2 and never populates
 * L1. The full argument is in `lib/race/course-geometry-source.ts`.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────
 *
 * DRY RUN IS THE DEFAULT and GET cannot write at all. The write fires only on
 * rows whose column is empty, so it can neither clobber a populated row (Rule
 * 6) nor double-apply. `gpx_text` is never touched.
 *
 * Reversal, exactly:
 *
 *     UPDATE races SET course_geometry = NULL, course_source = NULL
 *      WHERE slug = ANY(ARRAY[...]) AND user_uuid = '<uuid>';
 *
 * Promotion into the shared `course_library` is deliberately NOT run inline.
 * The daily cron does it, idempotently, and keeping this endpoint to one
 * column keeps the reversal above true.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { outage } from '@/lib/route/failure';
import { hydrateCourseGeometry } from '@/lib/race/hydrate-course-geometry';

export const maxDuration = 60;

async function run(req: NextRequest, commit: boolean, body: Record<string, unknown> | null) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const scope = String(body?.scope ?? url.searchParams.get('scope') ?? 'self');
  const slug = (body?.slug as string | undefined) ?? url.searchParams.get('slug') ?? null;
  const limitRaw = Number(body?.limit ?? url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 200) : 50;

  const result = await hydrateCourseGeometry({
    userUuid: scope === 'all' ? null : auth,
    slug,
    commit,
    limit,
  });

  // A failed candidate read must not render as "nothing needed backfilling".
  if (result.plans === null) {
    return outage('admin/backfill-course-geometry', new Error('candidate read failed'));
  }

  return NextResponse.json({
    ok: true,
    dryRun: !commit,
    scope,
    slug,
    counts: result.counts,
    plans: result.plans,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  return run(req, false, null);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  return run(req, body?.commit === true, body);
}
